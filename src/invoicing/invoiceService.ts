import crypto from "node:crypto";
import type { UserRepository } from "../users/userRepository.ts";
import type { EmailService } from "../notifications/emailService.ts";
import type { InvoiceRepository } from "./invoiceRepository.ts";
import type { DisbursementRepository } from "./disbursementRepository.ts";
import type { PlatformSettingsRepository } from "./platformSettingsRepository.ts";
import type { InvoiceNumberSequence } from "./invoiceNumberSequence.ts";
import type { DisbursementEvent, DisbursementRecord, Invoice, PaymentCaptureEvent } from "./invoiceModel.ts";

export class InvalidEventError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class InvoiceService {
  private invoiceRepository: InvoiceRepository;
  private disbursementRepository: DisbursementRepository;
  private settingsRepository: PlatformSettingsRepository;
  private userRepository: UserRepository;
  private emailService: EmailService;
  private sequence: InvoiceNumberSequence;

  constructor(
    invoiceRepository: InvoiceRepository,
    disbursementRepository: DisbursementRepository,
    settingsRepository: PlatformSettingsRepository,
    userRepository: UserRepository,
    emailService: EmailService,
    sequence: InvoiceNumberSequence,
  ) {
    this.invoiceRepository = invoiceRepository;
    this.disbursementRepository = disbursementRepository;
    this.settingsRepository = settingsRepository;
    this.userRepository = userRepository;
    this.emailService = emailService;
    this.sequence = sequence;
  }

  recordPaymentCapture(event: PaymentCaptureEvent, now: number = Date.now()): Invoice {
    const existing = this.invoiceRepository.findByPaymentCaptureId(event.paymentCaptureId);
    if (existing) {
      return existing;
    }

    if (event.lineItems.length === 0) {
      throw new InvalidEventError("at least one line item is required");
    }
    if (event.lineItems.some((li) => !(li.amount > 0))) {
      throw new InvalidEventError("line item amounts must be positive");
    }
    if (!(event.serviceFee >= 0)) {
      throw new InvalidEventError("service fee must not be negative");
    }

    const taxRatePercent = this.settingsRepository.getTaxRatePercent();
    const taxAmount =
      taxRatePercent !== undefined ? round2(event.serviceFee * (taxRatePercent / 100)) : undefined;
    const total = round2(
      event.lineItems.reduce((sum, li) => sum + li.amount, 0) + event.serviceFee + (taxAmount ?? 0),
    );

    const invoice: Invoice = {
      id: crypto.randomUUID(),
      invoiceNumber: this.sequence.next(),
      paymentCaptureId: event.paymentCaptureId,
      customerId: event.customerId,
      providerId: event.providerId,
      transactionDate: now,
      lineItems: event.lineItems,
      serviceFee: event.serviceFee,
      taxRatePercent,
      taxAmount,
      total,
    };
    this.invoiceRepository.save(invoice);

    const customer = this.userRepository.findById(event.customerId);
    this.emailService.send({
      to: customer?.username ?? event.customerId,
      subject: `Invoice ${invoice.invoiceNumber}`,
      body: `Your invoice ${invoice.invoiceNumber} for ${invoice.total} is ready.`,
    });
    return invoice;
  }

  recordDisbursement(event: DisbursementEvent, now: number = Date.now()): DisbursementRecord {
    const existing = this.disbursementRepository.findByDisbursementId(event.disbursementId);
    if (existing) {
      return existing;
    }

    if (!(event.grossAmount > 0)) {
      throw new InvalidEventError("gross amount must be positive");
    }
    if (!(event.serviceFee >= 0)) {
      throw new InvalidEventError("service fee must not be negative");
    }
    if (event.serviceFee > event.grossAmount) {
      throw new InvalidEventError("service fee must not exceed the gross amount");
    }

    const taxRatePercent = this.settingsRepository.getTaxRatePercent();
    const taxAmount =
      taxRatePercent !== undefined ? round2(event.serviceFee * (taxRatePercent / 100)) : undefined;
    const netAmount = round2(event.grossAmount - event.serviceFee - (taxAmount ?? 0));

    const record: DisbursementRecord = {
      id: crypto.randomUUID(),
      invoiceNumber: this.sequence.next(),
      disbursementId: event.disbursementId,
      providerId: event.providerId,
      transactionDate: now,
      grossAmount: event.grossAmount,
      serviceFee: event.serviceFee,
      taxRatePercent,
      taxAmount,
      netAmount,
    };
    this.disbursementRepository.save(record);

    const provider = this.userRepository.findById(event.providerId);
    this.emailService.send({
      to: provider?.username ?? event.providerId,
      subject: `Disbursement ${record.invoiceNumber}`,
      body: `Your disbursement ${record.invoiceNumber} of ${record.netAmount} has been processed.`,
    });
    return record;
  }
}
