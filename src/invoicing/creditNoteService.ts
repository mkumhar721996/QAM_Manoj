import crypto from "node:crypto";
import type { InvoiceRepository } from "./invoiceRepository.ts";
import type { CreditNoteRepository } from "./creditNoteRepository.ts";
import type { DisbursementRecordRepository } from "./disbursementRecordRepository.ts";
import type { Invoice } from "./fixtures/testInvoices.ts";
import type {
  CancellationDisbursementInput,
  CreditNote,
  DisbursementRecord,
  RefundEventInput,
} from "./creditNoteModel.ts";

export class InvoiceNotFoundError extends Error {}
export class ForbiddenInvoiceAccessError extends Error {}

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

  generateCreditNote(input: RefundEventInput, userId: string, now: number = Date.now()): CreditNote {
    this.assertAuthorizedForInvoice(input.invoiceNumber, userId);
    const creditNote: CreditNote = { ...input, id: crypto.randomUUID(), createdAt: now };
    this.creditNoteRepository.add(creditNote);
    return creditNote;
  }

  getCreditNote(id: string, userId: string): CreditNote | undefined {
    const creditNote = this.creditNoteRepository.findById(id);
    if (!creditNote) {
      return undefined;
    }
    this.assertAuthorizedForInvoice(creditNote.invoiceNumber, userId);
    return creditNote;
  }

  generateDisbursementRecord(
    input: CancellationDisbursementInput,
    userId: string,
    now: number = Date.now(),
  ): DisbursementRecord {
    this.assertAuthorizedForInvoice(input.invoiceNumber, userId);
    const record: DisbursementRecord = { ...input, id: crypto.randomUUID(), createdAt: now };
    this.disbursementRecordRepository.add(record);
    return record;
  }

  getDisbursementRecord(id: string, userId: string): DisbursementRecord | undefined {
    const record = this.disbursementRecordRepository.findById(id);
    if (!record) {
      return undefined;
    }
    this.assertAuthorizedForInvoice(record.invoiceNumber, userId);
    return record;
  }

  private assertAuthorizedForInvoice(invoiceNumber: string, userId: string): Invoice {
    const invoice = this.invoiceRepository.findByInvoiceNumber(invoiceNumber);
    if (!invoice) {
      throw new InvoiceNotFoundError(`No invoice found with number ${invoiceNumber}`);
    }
    if (invoice.customerId !== userId && invoice.providerId !== userId) {
      throw new ForbiddenInvoiceAccessError(`User ${userId} is not authorized to access invoice ${invoiceNumber}`);
    }
    return invoice;
  }
}
