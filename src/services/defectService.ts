import { DefectRepository } from "../repositories/defectRepository.ts";
import { AuditLogService } from "./auditLogService.ts";
import type { Defect, MutableDefectFields } from "../models/defect.ts";
import type { User } from "../models/user.ts";
import {
  DefectClosedError,
  DefectNotFoundError,
  ForbiddenReopenError,
} from "../errors/defectErrors.ts";

const ROLES_ALLOWED_TO_REOPEN = ["QA_LEAD", "ADMIN"];

export class DefectService {
  private readonly defectRepository: DefectRepository;
  private readonly auditLogService: AuditLogService;

  constructor(defectRepository: DefectRepository, auditLogService: AuditLogService) {
    this.defectRepository = defectRepository;
    this.auditLogService = auditLogService;
  }

  getDefect(defectId: string): Defect {
    return this.requireDefect(defectId);
  }

  isEditable(defect: Defect): boolean {
    return defect.status !== "CLOSED";
  }

  updateDefect(
    defectId: string,
    fields: MutableDefectFields,
    user: User
  ): Defect {
    const defect = this.requireDefect(defectId);

    if (defect.status === "CLOSED") {
      this.auditLogService.record(user.id, "EDIT_REJECTED", defectId);
      throw new DefectClosedError(defectId);
    }

    const updated: Defect = { ...defect, ...fields };
    this.defectRepository.save(updated);
    return updated;
  }

  deleteDefect(defectId: string, user: User): void {
    const defect = this.requireDefect(defectId);

    if (defect.status === "CLOSED") {
      this.auditLogService.record(user.id, "DELETE_REJECTED", defectId);
      throw new DefectClosedError(defectId);
    }

    this.defectRepository.delete(defectId);
  }

  reopenDefect(defectId: string, user: User): Defect {
    const defect = this.requireDefect(defectId);

    if (!ROLES_ALLOWED_TO_REOPEN.includes(user.role)) {
      throw new ForbiddenReopenError(user.id);
    }

    const reopened: Defect = { ...defect, status: "REOPENED" };
    this.defectRepository.save(reopened);
    return reopened;
  }

  private requireDefect(defectId: string): Defect {
    const defect = this.defectRepository.findById(defectId);
    if (!defect) {
      throw new DefectNotFoundError(defectId);
    }
    return defect;
  }
}
