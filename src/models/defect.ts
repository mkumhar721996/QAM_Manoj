export type DefectStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | "REOPENED";

export const CLOSED_STATUS: DefectStatus = "CLOSED";

export interface Defect {
  id: string;
  title: string;
  description: string;
  severity: string;
  stepsToReproduce: string;
  environment: string;
  reporter: string;
  status: DefectStatus;
}

export type MutableDefectFields = Partial<
  Pick<
    Defect,
    | "title"
    | "description"
    | "severity"
    | "stepsToReproduce"
    | "environment"
    | "reporter"
  >
>;
