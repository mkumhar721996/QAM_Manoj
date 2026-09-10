import { submitDefectForm } from "../controllers/submitDefectForm.js";

export async function createDefectFlow(values, api) {
  const result = await submitDefectForm(values, api);

  if (!result.submitted) {
    return { view: "form", errors: result.errors };
  }

  return { view: "detail", defect: result.defect };
}
