import type { Defect } from "../models/defect.ts";

export class DefectRepository {
  private readonly defects = new Map<string, Defect>();

  save(defect: Defect): void {
    this.defects.set(defect.id, { ...defect });
  }

  findById(id: string): Defect | undefined {
    const defect = this.defects.get(id);
    return defect ? { ...defect } : undefined;
  }

  delete(id: string): void {
    this.defects.delete(id);
  }
}
