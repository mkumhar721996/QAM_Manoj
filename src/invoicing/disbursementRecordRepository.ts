import type { DisbursementRecord } from "./creditNoteModel.ts";

export class DisbursementRecordRepository {
  private recordsById: Map<string, DisbursementRecord> = new Map();

  add(record: DisbursementRecord): void {
    this.recordsById.set(record.id, record);
  }

  findById(id: string): DisbursementRecord | undefined {
    return this.recordsById.get(id);
  }
}
