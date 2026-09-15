import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { UserRepository } from "../users/userRepository.ts";
import { InvalidEventError, InvoiceService } from "./invoiceService.ts";
import type { InvoiceRepository } from "./invoiceRepository.ts";
import type { DisbursementRepository } from "./disbursementRepository.ts";
import type { PlatformSettingsRepository } from "./platformSettingsRepository.ts";
import type { DisbursementRecord, Invoice, LineItem } from "./invoiceModel.ts";

function extractBearerPayload(authorizationHeader: string | undefined) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token) : null;
}

function serializeInvoice(invoice: Invoice, userRepository: UserRepository): Record<string, unknown> {
  const customer = userRepository.findById(invoice.customerId);
  const provider = userRepository.findById(invoice.providerId);
  return {
    invoice_number: invoice.invoiceNumber,
    payment_capture_id: invoice.paymentCaptureId,
    transaction_date: invoice.transactionDate,
    customer_name: customer?.username ?? invoice.customerId,
    provider_name: provider?.username ?? invoice.providerId,
    line_items: invoice.lineItems,
    service_fee: invoice.serviceFee,
    ...(invoice.taxAmount !== undefined
      ? { tax_rate_percent: invoice.taxRatePercent, tax_amount: invoice.taxAmount }
      : {}),
    total: invoice.total,
  };
}

function serializeDisbursement(record: DisbursementRecord): Record<string, unknown> {
  return {
    invoice_number: record.invoiceNumber,
    disbursement_id: record.disbursementId,
    transaction_date: record.transactionDate,
    gross_amount: record.grossAmount,
    service_fee: record.serviceFee,
    ...(record.taxAmount !== undefined
      ? { tax_rate_percent: record.taxRatePercent, tax_amount: record.taxAmount }
      : {}),
    net_amount: record.netAmount,
  };
}

function isValidLineItems(value: unknown): value is LineItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).description === "string" &&
        typeof (item as Record<string, unknown>).amount === "number",
    )
  );
}

export function handleRecordPaymentCapture(
  invoiceService: InvoiceService,
  userRepository: UserRepository,
  requestBody: unknown,
): ControllerResponse {
  const {
    payment_capture_id: paymentCaptureId,
    customer_id: customerId,
    provider_id: providerId,
    line_items: lineItems,
    service_fee: serviceFee,
  } = asRecord(requestBody);

  if (
    typeof paymentCaptureId !== "string" ||
    typeof customerId !== "string" ||
    typeof providerId !== "string" ||
    !isValidLineItems(lineItems) ||
    typeof serviceFee !== "number"
  ) {
    return { status: 400, body: { error: "invalid payment capture event" } };
  }

  try {
    const invoice = invoiceService.recordPaymentCapture({
      paymentCaptureId,
      customerId,
      providerId,
      lineItems: lineItems as LineItem[],
      serviceFee,
    });
    return { status: 201, body: serializeInvoice(invoice, userRepository) };
  } catch (err) {
    if (err instanceof InvalidEventError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleRecordDisbursement(invoiceService: InvoiceService, requestBody: unknown): ControllerResponse {
  const {
    disbursement_id: disbursementId,
    provider_id: providerId,
    gross_amount: grossAmount,
    service_fee: serviceFee,
  } = asRecord(requestBody);

  if (
    typeof disbursementId !== "string" ||
    typeof providerId !== "string" ||
    typeof grossAmount !== "number" ||
    typeof serviceFee !== "number"
  ) {
    return { status: 400, body: { error: "invalid disbursement event" } };
  }

  try {
    const record = invoiceService.recordDisbursement({ disbursementId, providerId, grossAmount, serviceFee });
    return { status: 201, body: serializeDisbursement(record) };
  } catch (err) {
    if (err instanceof InvalidEventError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleListInvoices(
  invoiceRepository: InvoiceRepository,
  userRepository: UserRepository,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }
  if (payload.role !== "customer") {
    return { status: 403, body: { error: "customer role required" } };
  }

  const invoices = invoiceRepository.findByCustomerId(payload.userId).map((inv) => serializeInvoice(inv, userRepository));
  return { status: 200, body: { invoices } };
}

export function handleListDisbursements(
  disbursementRepository: DisbursementRepository,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }
  if (payload.role !== "provider") {
    return { status: 403, body: { error: "provider role required" } };
  }

  const disbursements = disbursementRepository.findByProviderId(payload.userId).map(serializeDisbursement);
  return { status: 200, body: { disbursements } };
}

export function handleSetTaxRate(
  settingsRepository: PlatformSettingsRepository,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }
  if (payload.role !== "admin") {
    return { status: 403, body: { error: "admin role required" } };
  }

  const { rate_percent: ratePercent } = asRecord(requestBody);
  if (ratePercent !== null && (typeof ratePercent !== "number" || ratePercent < 0 || ratePercent > 100)) {
    return { status: 400, body: { error: "rate_percent must be a number between 0 and 100, or null" } };
  }

  settingsRepository.setTaxRatePercent(ratePercent === null ? undefined : ratePercent);
  return { status: 204 };
}
