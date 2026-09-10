export const SEVERITY_OPTIONS = ["Low", "Medium", "High", "Critical"] as const;

export const ENVIRONMENT_OPTIONS = ["Staging", "Production", "QA", "Dev"] as const;

export type Severity = (typeof SEVERITY_OPTIONS)[number];
export type Environment = (typeof ENVIRONMENT_OPTIONS)[number];
