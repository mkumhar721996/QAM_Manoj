import type { DisbursementRecord } from "./invoiceModel.ts";

export class DisbursementRepository {
  private recordsById: Map<string, DisbursementRecord> = new Map();
  private recordByDisbursementId: Map<string, DisbursementRecord> = new Map();
  private recordsByProviderId: Map<string, DisbursementRecord[]> = new Map();

  save(record: DisbursementRecord): void {
    this.recordsById.set(record.id, record);
    this.recordByDisbursementId.set(record.disbursementId, record);
    const list = this.recordsByProviderId.get(record.providerId) ?? [];
    list.push(record);
    this.recordsByProviderId.set(record.providerId, list);
  }

  findByDisbursementId(disbursementId: string): DisbursementRecord | undefined {
    return this.recordByDisbursementId.get(disbursementId);
  }

  findByProviderId(providerId: string): DisbursementRecord[] {
    return this.recordsByProviderId.get(providerId) ?? [];
  }
}
