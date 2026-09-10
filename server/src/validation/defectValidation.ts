import { SEVERITY_OPTIONS, ENVIRONMENT_OPTIONS } from "../constants/defectOptions.ts";

export const MANDATORY_FIELDS = [
  "title",
  "description",
  "severity",
  "reporter",
  "stepsToReproduce",
  "environment",
] as const;

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export function validateDefectInput(input: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of MANDATORY_FIELDS) {
    if (isBlank(input[field])) {
      errors[field] = `${field} is required`;
    }
  }

  if (!errors.severity && !SEVERITY_OPTIONS.includes(input.severity as never)) {
    errors.severity = `severity must be one of: ${SEVERITY_OPTIONS.join(", ")}`;
  }

  if (!errors.environment && !ENVIRONMENT_OPTIONS.includes(input.environment as never)) {
    errors.environment = `environment must be one of: ${ENVIRONMENT_OPTIONS.join(", ")}`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
