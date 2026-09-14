import { validateDefectForm } from "../validation/validateDefectForm.js";

export async function submitDefectForm(values, api) {
  const validation = validateDefectForm(values);
  if (!validation.valid) {
    return { submitted: false, errors: validation.errors };
  }

  let result;
  try {
    result = await api.createDefect(values);
  } catch {
    return { submitted: false, errors: { form: "Unable to reach the server. Please try again." } };
  }

  if (!result.ok) {
    return { submitted: false, errors: result.errors };
  }

  return { submitted: true, defect: result.defect };
}
