import { randomUUID } from "node:crypto";
import type { Defect, DefectInput } from "../models/defect.ts";

export class DefectRepository {
  #defects = new Map<string, Defect>();

  create(input: DefectInput, createdBy: string): Defect {
    const defect: Defect = {
      ...input,
      id: randomUUID(),
      status: "Open",
      createdBy,
    };
    this.#defects.set(defect.id, defect);
    return defect;
  }

  findById(id: string): Defect | undefined {
    return this.#defects.get(id);
  }
}
