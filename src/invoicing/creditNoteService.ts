import crypto from "node:crypto";
import type { InvoiceRepository } from "./invoiceRepository.ts";
import type { CreditNoteRepository } from "./creditNoteRepository.ts";
import type { DisbursementRecordRepository } from "./disbursementRecordRepository.ts";
import type {
  CancellationDisbursementInput,
  CreditNote,
  DisbursementRecord,
  RefundEventInput,
} from "./creditNoteModel.ts";

export class InvoiceNotFoundError extends Error {}

export class CreditNoteService {
  private invoiceRepository: InvoiceRepository;
  private creditNoteRepository: CreditNoteRepository;
  private disbursementRecordRepository: DisbursementRecordRepository;

  constructor(
    invoiceRepository: InvoiceRepository,
    creditNoteRepository: CreditNoteRepository,
    disbursementRecordRepository: DisbursementRecordRepository,
  ) {
    this.invoiceRepository = invoiceRepository;
    this.creditNoteRepository = creditNoteRepository;
    this.disbursementRecordRepository = disbursementRecordRepository;
  }

  generateCreditNote(input: RefundEventInput, now: number = Date.now()): CreditNote {
    const invoice = this.invoiceRepository.findByInvoiceNumber(input.invoiceNumber);
    if (!invoice) {
      throw new InvoiceNotFoundError(`No invoice found with number ${input.invoiceNumber}`);
    }
    const creditNote: CreditNote = { ...input, id: crypto.randomUUID(), createdAt: now };
    this.creditNoteRepository.add(creditNote);
    return creditNote;
  }

  getCreditNote(id: string): CreditNote | undefined {
    return this.creditNoteRepository.findById(id);
  }

  generateDisbursementRecord(input: CancellationDisbursementInput, now: number = Date.now()): DisbursementRecord {
    const invoice = this.invoiceRepository.findByInvoiceNumber(input.invoiceNumber);
    if (!invoice) {
      throw new InvoiceNotFoundError(`No invoice found with number ${input.invoiceNumber}`);
    }
    const record: DisbursementRecord = { ...input, id: crypto.randomUUID(), createdAt: now };
    this.disbursementRecordRepository.add(record);
    return record;
  }

  getDisbursementRecord(id: string): DisbursementRecord | undefined {
    return this.disbursementRecordRepository.findById(id);
  }
}
