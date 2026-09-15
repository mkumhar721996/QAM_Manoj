import type { ControllerResponse } from "../auth/authController.ts";
import { getBearerPayload } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { CreditNote, DisbursementRecord } from "./creditNoteModel.ts";
import { CreditNoteService, InvoiceNotFoundError } from "./creditNoteService.ts";

export function handlePostRefund(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  if (!getBearerPayload(authorizationHeader)) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const {
    invoice_number: invoiceNumber,
    transaction_id: transactionId,
    refund_amount: refundAmount,
    transaction_date: transactionDate,
  } = asRecord(requestBody);

  if (
    typeof invoiceNumber !== "string" ||
    typeof transactionId !== "string" ||
    typeof refundAmount !== "number" ||
    refundAmount <= 0 ||
    typeof transactionDate !== "string"
  ) {
    return { status: 400, body: { error: "invalid refund event" } };
  }

  try {
    const creditNote = creditNoteService.generateCreditNote({
      invoiceNumber,
      transactionId,
      refundAmount,
      transactionDate,
    });
    return { status: 201, body: toCreditNoteBody(creditNote) };
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}

export function handlePostCancellationDisbursement(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  if (!getBearerPayload(authorizationHeader)) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const {
    cancellation_event_id: cancellationEventId,
    invoice_number: invoiceNumber,
    provider_id: providerId,
    amount,
  } = asRecord(requestBody);

  if (
    typeof cancellationEventId !== "string" ||
    typeof invoiceNumber !== "string" ||
    typeof providerId !== "string" ||
    typeof amount !== "number" ||
    amount <= 0
  ) {
    return { status: 400, body: { error: "invalid disbursement event" } };
  }

  try {
    const record = creditNoteService.generateDisbursementRecord({
      cancellationEventId,
      invoiceNumber,
      providerId,
      amount,
    });
    return { status: 201, body: toDisbursementRecordBody(record) };
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleGetCreditNote(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  id: string,
): ControllerResponse {
  if (!getBearerPayload(authorizationHeader)) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const creditNote = creditNoteService.getCreditNote(id);
  if (!creditNote) {
    return { status: 404, body: { error: "credit note not found" } };
  }
  return { status: 200, body: toCreditNoteBody(creditNote) };
}

export function handleGetDisbursementRecord(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  id: string,
): ControllerResponse {
  if (!getBearerPayload(authorizationHeader)) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const record = creditNoteService.getDisbursementRecord(id);
  if (!record) {
    return { status: 404, body: { error: "disbursement record not found" } };
  }
  return { status: 200, body: toDisbursementRecordBody(record) };
}

function toCreditNoteBody(creditNote: CreditNote): Record<string, unknown> {
  return {
    id: creditNote.id,
    invoice_number: creditNote.invoiceNumber,
    transaction_id: creditNote.transactionId,
    refund_amount: creditNote.refundAmount,
    transaction_date: creditNote.transactionDate,
    created_at: creditNote.createdAt,
  };
}

function toDisbursementRecordBody(record: DisbursementRecord): Record<string, unknown> {
  return {
    id: record.id,
    cancellation_event_id: record.cancellationEventId,
    invoice_number: record.invoiceNumber,
    provider_id: record.providerId,
    amount: record.amount,
    created_at: record.createdAt,
  };
}
