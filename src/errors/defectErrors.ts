export class DefectClosedError extends Error {
  constructor(defectId: string) {
    super(`Defect ${defectId} is closed and cannot be modified`);
    this.name = "DefectClosedError";
  }
}

export class ForbiddenReopenError extends Error {
  constructor(userId: string) {
    super(`User ${userId} is not permitted to reopen defects`);
    this.name = "ForbiddenReopenError";
  }
}

export class DefectNotFoundError extends Error {
  constructor(defectId: string) {
    super(`Defect ${defectId} was not found`);
    this.name = "DefectNotFoundError";
  }
}
