import { createDefectsApi } from "./api/defectsApi.js";
import { createDefectFlow } from "./pages/createDefectFlow.js";
import { renderDefectCreationForm } from "./render/renderDefectCreationForm.js";
import { renderDefectDetail } from "./render/renderDefectDetail.js";
import { MANDATORY_FIELDS } from "./validation/validateDefectForm.js";
import { getApiBaseUrl } from "./config.js";

const USER_ID_STORAGE_KEY = "defectTrackerUserId";

function getUserId() {
  let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (!userId) {
    userId = window.prompt("Enter your user id to continue as an authenticated user:") ?? "";
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  }
  return userId;
}

const api = createDefectsApi({ baseUrl: getApiBaseUrl(), getUserId, fetchImpl: (...args) => fetch(...args) });

function readFormValues(form) {
  const values = {};
  for (const field of MANDATORY_FIELDS) {
    values[field] = form.elements.namedItem(field)?.value ?? "";
  }
  return values;
}

async function showCreateForm(root, values = {}, errors = {}) {
  const options = await api.getOptions();
  root.innerHTML = renderDefectCreationForm({ options, values, errors });

  const form = root.querySelector("#defect-creation-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submittedValues = readFormValues(form);
    const result = await createDefectFlow(submittedValues, api);

    if (result.view === "detail") {
      window.location.hash = `#/defects/${result.defect.id}`;
    } else {
      showCreateForm(root, submittedValues, result.errors);
    }
  });
}

async function showDefectDetail(root, id) {
  const result = await api.getDefect(id);
  if (!result.ok) {
    root.innerHTML = `<p id="defect-not-found">Defect not found.</p>`;
    return;
  }
  root.innerHTML = renderDefectDetail(result.defect);
}

async function render() {
  const root = document.getElementById("app");
  const hash = window.location.hash;
  const detailMatch = /^#\/defects\/(.+)$/.exec(hash);

  if (detailMatch) {
    await showDefectDetail(root, decodeURIComponent(detailMatch[1]));
  } else {
    await showCreateForm(root);
  }
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
