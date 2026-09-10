export const MANDATORY_FIELDS = [
  "title",
  "description",
  "severity",
  "reporter",
  "stepsToReproduce",
  "environment",
];

const FIELD_LABELS = {
  title: "Title",
  description: "Description",
  severity: "Severity",
  reporter: "Reporter",
  stepsToReproduce: "Steps to reproduce",
  environment: "Environment",
};

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

export function validateDefectForm(values) {
  const errors = {};

  for (const field of MANDATORY_FIELDS) {
    if (isBlank(values[field])) {
      errors[field] = `${FIELD_LABELS[field]} is required`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
