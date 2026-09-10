import type { DefectService } from "../services/defectService.ts";
import type { Defect, MutableDefectFields } from "../models/defect.ts";
import type { User } from "../models/user.ts";
import {
  DefectClosedError,
  DefectNotFoundError,
  ForbiddenReopenError,
} from "../errors/defectErrors.ts";

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

interface DefectLink {
  rel: "edit" | "delete";
  method: "PATCH" | "DELETE";
  href: string;
}

interface DefectView extends Defect {
  editable: boolean;
  links: DefectLink[];
}

function toView(defect: Defect): DefectView {
  const editable = defect.status !== "CLOSED";
  const links: DefectLink[] = editable
    ? [
        { rel: "edit", method: "PATCH", href: `/defects/${defect.id}` },
        { rel: "delete", method: "DELETE", href: `/defects/${defect.id}` },
      ]
    : [];

  return { ...defect, editable, links };
}

export class DefectController {
  private readonly defectService: DefectService;

  constructor(defectService: DefectService) {
    this.defectService = defectService;
  }

  getDefect(defectId: string): ApiResponse<DefectView | { message: string }> {
    try {
      const defect = this.defectService.getDefect(defectId);
      return { status: 200, body: toView(defect) };
    } catch (error) {
      if (error instanceof DefectNotFoundError) {
        return { status: 404, body: { message: error.message } };
      }
      throw error;
    }
  }

  updateDefect(
    defectId: string,
    fields: MutableDefectFields,
    user: User
  ): ApiResponse<DefectView | { message: string }> {
    try {
      const updated = this.defectService.updateDefect(defectId, fields, user);
      return { status: 200, body: toView(updated) };
    } catch (error) {
      if (error instanceof DefectClosedError) {
        return { status: 409, body: { message: error.message } };
      }
      if (error instanceof DefectNotFoundError) {
        return { status: 404, body: { message: error.message } };
      }
      throw error;
    }
  }

  deleteDefect(defectId: string, user: User): ApiResponse<null | { message: string }> {
    try {
      this.defectService.deleteDefect(defectId, user);
      return { status: 204, body: null };
    } catch (error) {
      if (error instanceof DefectClosedError) {
        return { status: 409, body: { message: error.message } };
      }
      if (error instanceof DefectNotFoundError) {
        return { status: 404, body: { message: error.message } };
      }
      throw error;
    }
  }

  reopenDefect(defectId: string, user: User): ApiResponse<DefectView | { message: string }> {
    try {
      const reopened = this.defectService.reopenDefect(defectId, user);
      return { status: 200, body: toView(reopened) };
    } catch (error) {
      if (error instanceof ForbiddenReopenError) {
        return { status: 403, body: { message: error.message } };
      }
      if (error instanceof DefectNotFoundError) {
        return { status: 404, body: { message: error.message } };
      }
      throw error;
    }
  }
}
