import type { ControllerResponse } from "../auth/authController.ts";
import { getBearerPayload } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import { metricsRegistry } from "../observability/metrics.ts";
import type { CreditNote, DisbursementRecord } from "./creditNoteModel.ts";
import { CreditNoteService, ForbiddenInvoiceAccessError, InvoiceNotFoundError } from "./creditNoteService.ts";

const ROUTE_REFUNDS = "POST /refunds";
const ROUTE_DISBURSEMENTS = "POST /cancellations/disbursements";
const ROUTE_GET_CREDIT_NOTE = "GET /credit-notes/:id";
const ROUTE_GET_DISBURSEMENT_RECORD = "GET /disbursement-records/:id";

type LogLevel = "info" | "warn" | "error";

function recordAndLog(
  route: string,
  status: number,
  startedAt: number,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown>,
): void {
  const durationMs = Date.now() - startedAt;
  metricsRegistry.recordRequest(route, status, durationMs);
  const entry = { event, route, status, duration_ms: durationMs, ...fields };
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export function handlePostRefund(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const start = Date.now();
  const payload = getBearerPayload(authorizationHeader);
  if (!payload) {
    recordAndLog(ROUTE_REFUNDS, 401, start, "warn", "refund.unauthorized", {});
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
    recordAndLog(ROUTE_REFUNDS, 400, start, "warn", "refund.validation_failed", { userId: payload.userId });
    return { status: 400, body: { error: "invalid refund event" } };
  }

  try {
    const creditNote = creditNoteService.generateCreditNote(
      { invoiceNumber, transactionId, refundAmount, transactionDate },
      payload.userId,
    );
    recordAndLog(ROUTE_REFUNDS, 201, start, "info", "refund.credit_note_created", {
      userId: payload.userId,
      invoiceNumber,
      creditNoteId: creditNote.id,
    });
    return { status: 201, body: toCreditNoteBody(creditNote) };
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      recordAndLog(ROUTE_REFUNDS, 404, start, "warn", "refund.invoice_not_found", {
        userId: payload.userId,
        invoiceNumber,
      });
      return { status: 404, body: { error: err.message } };
    }
    if (err instanceof ForbiddenInvoiceAccessError) {
      recordAndLog(ROUTE_REFUNDS, 403, start, "warn", "refund.forbidden", {
        userId: payload.userId,
        invoiceNumber,
      });
      return { status: 403, body: { error: err.message } };
    }
    recordAndLog(ROUTE_REFUNDS, 500, start, "error", "refund.unexpected_error", {
      userId: payload.userId,
      invoiceNumber,
    });
    throw err;
  }
}

export function handlePostCancellationDisbursement(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const start = Date.now();
  const payload = getBearerPayload(authorizationHeader);
  if (!payload) {
    recordAndLog(ROUTE_DISBURSEMENTS, 401, start, "warn", "disbursement.unauthorized", {});
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
    recordAndLog(ROUTE_DISBURSEMENTS, 400, start, "warn", "disbursement.validation_failed", {
      userId: payload.userId,
    });
    return { status: 400, body: { error: "invalid disbursement event" } };
  }

  try {
    const record = creditNoteService.generateDisbursementRecord(
      { cancellationEventId, invoiceNumber, providerId, amount },
      payload.userId,
    );
    recordAndLog(ROUTE_DISBURSEMENTS, 201, start, "info", "disbursement.record_created", {
      userId: payload.userId,
      invoiceNumber,
      disbursementRecordId: record.id,
    });
    return { status: 201, body: toDisbursementRecordBody(record) };
  } catch (err) {
    if (err instanceof InvoiceNotFoundError) {
      recordAndLog(ROUTE_DISBURSEMENTS, 404, start, "warn", "disbursement.invoice_not_found", {
        userId: payload.userId,
        invoiceNumber,
      });
      return { status: 404, body: { error: err.message } };
    }
    if (err instanceof ForbiddenInvoiceAccessError) {
      recordAndLog(ROUTE_DISBURSEMENTS, 403, start, "warn", "disbursement.forbidden", {
        userId: payload.userId,
        invoiceNumber,
      });
      return { status: 403, body: { error: err.message } };
    }
    recordAndLog(ROUTE_DISBURSEMENTS, 500, start, "error", "disbursement.unexpected_error", {
      userId: payload.userId,
      invoiceNumber,
    });
    throw err;
  }
}

export function handleGetCreditNote(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  id: string,
): ControllerResponse {
  const start = Date.now();
  const payload = getBearerPayload(authorizationHeader);
  if (!payload) {
    recordAndLog(ROUTE_GET_CREDIT_NOTE, 401, start, "warn", "credit_note.unauthorized", {});
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  try {
    const creditNote = creditNoteService.getCreditNote(id, payload.userId);
    if (!creditNote) {
      recordAndLog(ROUTE_GET_CREDIT_NOTE, 404, start, "warn", "credit_note.not_found", {
        userId: payload.userId,
        creditNoteId: id,
      });
      return { status: 404, body: { error: "credit note not found" } };
    }
    recordAndLog(ROUTE_GET_CREDIT_NOTE, 200, start, "info", "credit_note.retrieved", {
      userId: payload.userId,
      creditNoteId: id,
    });
    return { status: 200, body: toCreditNoteBody(creditNote) };
  } catch (err) {
    if (err instanceof ForbiddenInvoiceAccessError) {
      recordAndLog(ROUTE_GET_CREDIT_NOTE, 403, start, "warn", "credit_note.forbidden", {
        userId: payload.userId,
        creditNoteId: id,
      });
      return { status: 403, body: { error: err.message } };
    }
    recordAndLog(ROUTE_GET_CREDIT_NOTE, 500, start, "error", "credit_note.unexpected_error", {
      userId: payload.userId,
      creditNoteId: id,
    });
    throw err;
  }
}

export function handleGetDisbursementRecord(
  creditNoteService: CreditNoteService,
  authorizationHeader: string | undefined,
  id: string,
): ControllerResponse {
  const start = Date.now();
  const payload = getBearerPayload(authorizationHeader);
  if (!payload) {
    recordAndLog(ROUTE_GET_DISBURSEMENT_RECORD, 401, start, "warn", "disbursement_record.unauthorized", {});
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  try {
    const record = creditNoteService.getDisbursementRecord(id, payload.userId);
    if (!record) {
      recordAndLog(ROUTE_GET_DISBURSEMENT_RECORD, 404, start, "warn", "disbursement_record.not_found", {
        userId: payload.userId,
        disbursementRecordId: id,
      });
      return { status: 404, body: { error: "disbursement record not found" } };
    }
    recordAndLog(ROUTE_GET_DISBURSEMENT_RECORD, 200, start, "info", "disbursement_record.retrieved", {
      userId: payload.userId,
      disbursementRecordId: id,
    });
    return { status: 200, body: toDisbursementRecordBody(record) };
  } catch (err) {
    if (err instanceof ForbiddenInvoiceAccessError) {
      recordAndLog(ROUTE_GET_DISBURSEMENT_RECORD, 403, start, "warn", "disbursement_record.forbidden", {
        userId: payload.userId,
        disbursementRecordId: id,
      });
      return { status: 403, body: { error: err.message } };
    }
    recordAndLog(ROUTE_GET_DISBURSEMENT_RECORD, 500, start, "error", "disbursement_record.unexpected_error", {
      userId: payload.userId,
      disbursementRecordId: id,
    });
    throw err;
  }
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
