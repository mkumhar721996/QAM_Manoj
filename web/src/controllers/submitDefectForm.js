import { validateDefectForm } from "../validation/validateDefectForm.js";

export async function submitDefectForm(values, api) {
  const validation = validateDefectForm(values);
  if (!validation.valid) {
    return { submitted: false, errors: validation.errors };
  }

  const result = await api.createDefect(values);
  if (!result.ok) {
    return { submitted: false, errors: result.errors };
  }

  return { submitted: true, defect: result.defect };
}
