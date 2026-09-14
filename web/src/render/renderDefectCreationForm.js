import { escapeHtml } from "./htmlEscape.js";

const TEXT_FIELDS = [
  { id: "title", label: "Title", type: "input" },
  { id: "description", label: "Description", type: "textarea" },
  { id: "reporter", label: "Reporter", type: "input" },
  { id: "stepsToReproduce", label: "Steps to reproduce", type: "textarea" },
];

function renderError(field, errors) {
  const message = errors[field];
  return `<span id="${field}-error" class="field-error">${message ? escapeHtml(message) : ""}</span>`;
}

function renderTextField(field, values, errors) {
  const value = escapeHtml(values[field.id] ?? "");
  const control =
    field.type === "textarea"
      ? `<textarea id="${field.id}" name="${field.id}" aria-describedby="${field.id}-error">${value}</textarea>`
      : `<input id="${field.id}" name="${field.id}" type="text" value="${value}" aria-describedby="${field.id}-error" />`;

  return `
    <div class="field">
      <label for="${field.id}">${field.label}</label>
      ${control}
      ${renderError(field.id, errors)}
    </div>
  `;
}

function renderSelectField(id, label, choices, values, errors) {
  const selected = values[id] ?? "";
  const options = choices
    .map((choice) => {
      const isSelected = choice === selected ? " selected" : "";
      return `<option value="${escapeHtml(choice)}"${isSelected}>${escapeHtml(choice)}</option>`;
    })
    .join("");

  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}" name="${id}" aria-describedby="${id}-error">
        <option value="">-- select --</option>
        ${options}
      </select>
      ${renderError(id, errors)}
    </div>
  `;
}

export function renderDefectCreationForm({ options, values = {}, errors = {} }) {
  const formError = errors.form
    ? `<p id="form-error" class="form-error" role="alert">${escapeHtml(errors.form)}</p>`
    : "";

  return `
    <form id="defect-creation-form">
      ${formError}
      ${renderTextField(TEXT_FIELDS[0], values, errors)}
      ${renderTextField(TEXT_FIELDS[1], values, errors)}
      ${renderSelectField("severity", "Severity", options.severity, values, errors)}
      ${renderTextField(TEXT_FIELDS[2], values, errors)}
      ${renderTextField(TEXT_FIELDS[3], values, errors)}
      ${renderSelectField("environment", "Environment", options.environment, values, errors)}
      <button type="submit">Submit</button>
    </form>
  `;
}
