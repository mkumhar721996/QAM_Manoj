import type { Severity, Environment } from "../constants/defectOptions.ts";

export type DefectStatus = "Open";

export interface DefectInput {
  title: string;
  description: string;
  severity: Severity;
  reporter: string;
  stepsToReproduce: string;
  environment: Environment;
}

export interface Defect extends DefectInput {
  id: string;
  status: DefectStatus;
  createdBy: string;
}
