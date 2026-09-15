summary: |
  This repo currently has no payments, booking, or disbursement domain at all - only auth/session
  management (`src/auth`, `src/sessions`, `src/users`) and a pizza cart (`src/pizzas`, `src/cart`),
  wired together in a plain Node `http` server (`src/app.ts`) with in-memory `Map`-backed
  repositories, a repository -> service -> controller layering, snake_case JSON wire format, and
  `node:test` + raw `fetch` against `startTestServer()`. The `User` fixture already models
  `customer` / `provider` / `admin` roles, which this story's "payment capture" / "provider
  disbursement" language depends on. This plan adds a new `src/invoicing/` module (models, an
  in-memory `InvoiceRepository` / `DisbursementRepository`, a shared sequential invoice-number
  generator, a `PlatformSettingsRepository` for the optional tax rate, an `InvoiceService` with the
  generation/idempotency/tax/validation logic, and a controller with role-scoped portal endpoints),
  plus a small `src/notifications/` module (an injectable `EmailService` abstraction with a
  console-logging default), all wired into `src/app.ts` exactly like the existing pizza/cart feature
  was. Since there is no real payment gateway or booking system to hang off of, "a payment capture
  succeeds" / "a provider disbursement succeeds" are translated into two internal-facing trigger
  endpoints (`POST /internal/payment-captures`, `POST /internal/disbursements`) that a not-yet-built
  payment processor would call once it completes those actions - mirroring how the prior Pizza
  Customisation plan translated UI "screens" into API endpoints for this headless API repo. Every
  acceptance criterion is driven test-first against these routes plus the existing auth/JWT
  mechanism for customer/provider portal retrieval, and beyond the happy path each AC also gets at
  least one edge-case test (invalid input, wrong role, duplicate/interleaved events, cross-customer
  isolation) so the validation and authorization rules are pinned down before implementation.
scope:
  - description: |
      Write the failing acceptance test file first, covering all 9 ACs plus their edge cases
      against the not-yet-existing `/internal/payment-captures`, `/internal/disbursements`,
      `/invoices`, `/disbursements`, and `/platform-settings/tax-rate` routes, plus a
      `RecordingEmailService` test double for AC8. These must fail (404 / import errors) before
      any implementation exists.
    files:
      - "test/invoiceGeneration.test.ts"
      - "test/testEmailService.ts"
    rationale: |
      Establishes the test-first contract for the whole feature - happy path AND edge cases -
      before writing any production code, matching the existing `test/cartCustomisation.test.ts`
      style (raw `fetch` against `startTestServer()`, snake_case JSON assertions, a small
      test-only double injected via `AppDependencies` the same way repositories already are).
  - description: |
      Add the invoicing domain model plus the two primitives everything else depends on: a shared
      monotonic invoice-number sequence and an in-memory platform-settings store for the optional
      tax rate.

      ```ts
      // src/invoicing/invoiceModel.ts
      export interface LineItem { description: string; amount: number; }

      export interface PaymentCaptureEvent {
        paymentCaptureId: string;
        customerId: string;
        providerId: string;
        lineItems: LineItem[];
        serviceFee: number;
      }

      export interface DisbursementEvent {
        disbursementId: string;
        providerId: string;
        grossAmount: number;
        serviceFee: number;
      }

      export interface Invoice {
        id: string;
        invoiceNumber: string;
        paymentCaptureId: string;
        customerId: string;
        providerId: string;
        transactionDate: number;
        lineItems: LineItem[];
        serviceFee: number;
        taxRatePercent?: number;
        taxAmount?: number;
        total: number;
      }

      export interface DisbursementRecord {
        id: string;
        invoiceNumber: string;
        disbursementId: string;
        providerId: string;
        transactionDate: number;
        grossAmount: number;
        serviceFee: number;
        taxRatePercent?: number;
        taxAmount?: number;
        netAmount: number;
      }
      ```

      ```ts
      // src/invoicing/invoiceNumberSequence.ts
      export class InvoiceNumberSequence {
        private counter = 0;
        next(): string {
          this.counter += 1;
          return `INV-${String(this.counter).padStart(5, "0")}`;
        }
      }
      ```

      ```ts
      // src/invoicing/platformSettingsRepository.ts
      export class PlatformSettingsRepository {
        private taxRatePercent: number | undefined;
        getTaxRatePercent(): number | undefined {
          return this.taxRatePercent;
        }
        setTaxRatePercent(rate: number | undefined): void {
          this.taxRatePercent = rate;
        }
      }
      ```
    files:
      - "src/invoicing/invoiceModel.ts"
      - "src/invoicing/invoiceNumberSequence.ts"
      - "src/invoicing/platformSettingsRepository.ts"
    rationale: |
      AC5 requires invoice numbers to be "unique and strictly sequential with no gaps or
      duplicates" across both invoices and disbursement records (AC2 says a disbursement record
      itself carries an "invoice number"), so one shared counter instance - constructed once in
      `createApp` and passed into `InvoiceService` - is the simplest way to guarantee that
      property, including under the AC7 idempotent-retry edge case (a retry must return the
      existing record WITHOUT calling `.next()` again, so the sequence stays gap-free). AC3/AC4
      require a configurable-but-optional tax rate, so `PlatformSettingsRepository` mirrors the
      existing bare in-memory repository pattern (e.g. `SessionRepository`) rather than
      introducing a generic key/value settings store.
  - description: |
      Add the two storage repositories, modeled directly on `src/cart/cartRepository.ts`, each
      indexed both by the originating event id (for AC6/AC7) and by owner id (for AC9 portal
      scoping).

      ```ts
      // src/invoicing/invoiceRepository.ts
      export class InvoiceRepository {
        private invoicesById: Map<string, Invoice> = new Map();
        private invoiceByPaymentCaptureId: Map<string, Invoice> = new Map();
        private invoicesByCustomerId: Map<string, Invoice[]> = new Map();

        save(invoice: Invoice): void {
          this.invoicesById.set(invoice.id, invoice);
          this.invoiceByPaymentCaptureId.set(invoice.paymentCaptureId, invoice);
          const list = this.invoicesByCustomerId.get(invoice.customerId) ?? [];
          list.push(invoice);
          this.invoicesByCustomerId.set(invoice.customerId, list);
        }
        findByPaymentCaptureId(paymentCaptureId: string): Invoice | undefined {
          return this.invoiceByPaymentCaptureId.get(paymentCaptureId);
        }
        findByCustomerId(customerId: string): Invoice[] {
          return this.invoicesByCustomerId.get(customerId) ?? [];
        }
      }
      ```

      `src/invoicing/disbursementRepository.ts` is the same shape, keyed by `disbursementId` and
      `providerId` instead (`findByDisbursementId`, `findByProviderId`).
    files:
      - "src/invoicing/invoiceRepository.ts"
      - "src/invoicing/disbursementRepository.ts"
    rationale: |
      AC6 requires the invoice/disbursement record to be "stored and associated with the
      originating transaction record" and AC7 requires idempotent lookup by that same originating
      event id - both are satisfied by indexing on `paymentCaptureId` / `disbursementId` the same
      way `SessionRepository` indexes on a hashed refresh token. Indexing by owner id (customer /
      provider) is what makes the AC9 portal-scoping and cross-customer-isolation edge case
      cheap and correct - a customer can only ever be handed back `this.invoicesByCustomerId.get(theirOwnId)`.
  - description: |
      Add an injectable email abstraction so `InvoiceService` doesn't depend on a concrete SMTP/
      third-party provider (none exists in this codebase).

      ```ts
      // src/notifications/emailService.ts
      export interface EmailMessage {
        to: string;
        subject: string;
        body: string;
      }
      export interface EmailService {
        send(message: EmailMessage): void;
      }
      export class ConsoleEmailService implements EmailService {
        send(message: EmailMessage): void {
          console.log(`email to=${message.to} subject="${message.subject}"`);
        }
      }
      ```
    files:
      - "src/notifications/emailService.ts"
    rationale: |
      AC8 requires "an automatic email notification" on every invoice/disbursement generation.
      There is no email provider dependency anywhere in this repo today (`package.json` has zero
      runtime dependencies), so this defines the seam as an interface with a console-logging
      default (matching the existing `console.log`-only style used for login/logout events in
      `authController.ts`), letting tests inject a recording double instead of a real mailer, and
      letting an AC7 retry be asserted to send NO additional email.
  - description: |
      Add `InvoiceService`, the single place that turns a payment-capture/disbursement event into a
      stored, numbered, optionally-taxed record and fires the notification - mirroring how
      `CartService` centralises the cart's business rules - including the input-validation edge
      cases (empty line items, non-positive amounts, a service fee that exceeds the gross amount).

      ```ts
      // src/invoicing/invoiceService.ts
      export class InvalidEventError extends Error {}

      function round2(value: number): number {
        return Math.round(value * 100) / 100;
      }

      export class InvoiceService {
        constructor(
          private invoiceRepository: InvoiceRepository,
          private disbursementRepository: DisbursementRepository,
          private settingsRepository: PlatformSettingsRepository,
          private userRepository: UserRepository,
          private emailService: EmailService,
          private sequence: InvoiceNumberSequence,
        ) {}

        recordPaymentCapture(event: PaymentCaptureEvent, now: number = Date.now()): Invoice {
          const existing = this.invoiceRepository.findByPaymentCaptureId(event.paymentCaptureId);
          if (existing) return existing;

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
          const taxAmount = taxRatePercent !== undefined ? round2(event.serviceFee * (taxRatePercent / 100)) : undefined;
          const total = round2(event.lineItems.reduce((sum, li) => sum + li.amount, 0) + event.serviceFee + (taxAmount ?? 0));

          const invoice: Invoice = {
            id: crypto.randomUUID(), invoiceNumber: this.sequence.next(),
            paymentCaptureId: event.paymentCaptureId, customerId: event.customerId, providerId: event.providerId,
            transactionDate: now, lineItems: event.lineItems, serviceFee: event.serviceFee,
            taxRatePercent, taxAmount, total,
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
          if (existing) return existing;

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
          const taxAmount = taxRatePercent !== undefined ? round2(event.serviceFee * (taxRatePercent / 100)) : undefined;
          const netAmount = round2(event.grossAmount - event.serviceFee - (taxAmount ?? 0));

          const record: DisbursementRecord = {
            id: crypto.randomUUID(), invoiceNumber: this.sequence.next(),
            disbursementId: event.disbursementId, providerId: event.providerId, transactionDate: now,
            grossAmount: event.grossAmount, serviceFee: event.serviceFee, taxRatePercent, taxAmount, netAmount,
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
      ```
    files:
      - "src/invoicing/invoiceService.ts"
    rationale: |
      Centralises the idempotency check (AC7), tax math (AC3/AC4), sequential numbering (AC5), and
      email trigger (AC8) in one framework-agnostic, unit-testable place, exactly like `CartService`
      keeps validation out of the controller/HTTP layer. Validation lives here (not just in the
      controller's type checks) so `service_fee > gross_amount` and "no line items" are rejected as
      domain errors (`InvalidEventError`) rather than silently producing a negative `net_amount` or
      a zero-item invoice.
  - description: |
      Add `invoiceController.ts` with HTTP handlers and snake_case (de)serialization, reusing
      `verifyAccessToken` from `src/auth/tokenService.ts` for the two portal-retrieval routes and
      the admin-only tax-rate route (same Bearer-extraction pattern as `cartController.ts`), and
      distinguishing "not authenticated" (401) from "authenticated but wrong role" (403) for the
      role-scoped routes.

      ```ts
      // src/invoicing/invoiceController.ts
      function serializeInvoice(invoice: Invoice, userRepository: UserRepository) {
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
      // serializeDisbursement(...) is the equivalent shape for DisbursementRecord.

      export function handleRecordPaymentCapture(
        invoiceService: InvoiceService,
        userRepository: UserRepository,
        requestBody: unknown,
      ): ControllerResponse {
        // ...type-check payment_capture_id/customer_id/provider_id/line_items/service_fee, 400 if malformed...
        try {
          const invoice = invoiceService.recordPaymentCapture({ /* ... */ });
          return { status: 201, body: serializeInvoice(invoice, userRepository) };
        } catch (err) {
          if (err instanceof InvalidEventError) return { status: 400, body: { error: err.message } };
          throw err;
        }
      }

      export function handleRecordDisbursement(
        invoiceService: InvoiceService,
        requestBody: unknown,
      ): ControllerResponse { /* same shape as above, catching InvalidEventError -> 400 */ }

      export function handleListInvoices(
        invoiceRepository: InvoiceRepository,
        userRepository: UserRepository,
        authorizationHeader: string | undefined,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        if (payload.role !== "customer") return { status: 403, body: { error: "customer role required" } };
        const invoices = invoiceRepository.findByCustomerId(payload.userId).map((inv) => serializeInvoice(inv, userRepository));
        return { status: 200, body: { invoices } };
      }

      export function handleListDisbursements(
        disbursementRepository: DisbursementRepository,
        authorizationHeader: string | undefined,
      ): ControllerResponse { /* same shape, 401 missing/invalid token, 403 if role !== "provider" */ }

      export function handleSetTaxRate(
        settingsRepository: PlatformSettingsRepository,
        authorizationHeader: string | undefined,
        requestBody: unknown,
      ): ControllerResponse {
        const payload = extractBearerPayload(authorizationHeader);
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
        if (payload.role !== "admin") return { status: 403, body: { error: "admin role required" } };
        const { rate_percent: ratePercent } = asRecord(requestBody);
        if (ratePercent !== null && (typeof ratePercent !== "number" || ratePercent < 0 || ratePercent > 100)) {
          return { status: 400, body: { error: "rate_percent must be a number between 0 and 100, or null" } };
        }
        settingsRepository.setTaxRatePercent(ratePercent === null ? undefined : ratePercent);
        return { status: 204 };
      }
      ```
    files:
      - "src/invoicing/invoiceController.ts"
    rationale: |
      Keeps HTTP-shape concerns (snake_case body, status codes, Bearer-token/role checks) out of
      `InvoiceService`, exactly like `cartController.ts` does for `CartService`. The tax-rate
      endpoint reuses the existing `admin` role from `src/users/fixtures/testUsers.ts` rather than
      inventing a new authorization scheme. Splitting 401 (no/invalid token) from 403 (wrong role)
      makes the role-mismatch edge cases (a provider hitting `/invoices`, a customer hitting
      `/disbursements` or the tax-rate route) independently testable from the missing-auth case.
  - description: |
      Wire everything into `src/app.ts`: extend `AppDependencies`, construct the new
      repositories/service/email-service in `createApp`, and add route matching for
      `POST /internal/payment-captures`, `POST /internal/disbursements`, `GET /invoices`,
      `GET /disbursements`, and `PUT /platform-settings/tax-rate` (the latter is this repo's first
      `PUT` route, so the body-reading gate needs to accept `PUT` as well as `POST`).

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        invoiceRepository?: InvoiceRepository;
        disbursementRepository?: DisbursementRepository;
        platformSettingsRepository?: PlatformSettingsRepository;
        invoiceNumberSequence?: InvoiceNumberSequence;
        emailService?: EmailService;
      }
      ```

      ```ts
      if (route === "GET /invoices") {
        const result = handleListInvoices(invoiceRepository, userRepository, req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "GET /disbursements") {
        const result = handleListDisbursements(disbursementRepository, req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }
      // ...extend the pre-body-read 404 gate with:
      //   route !== "POST /internal/payment-captures" &&
      //   route !== "POST /internal/disbursements" &&
      //   route !== "PUT /platform-settings/tax-rate"
      if (route === "POST /internal/payment-captures") {
        const result = handleRecordPaymentCapture(invoiceService, userRepository, body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "POST /internal/disbursements") {
        const result = handleRecordDisbursement(invoiceService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "PUT /platform-settings/tax-rate") {
        const result = handleSetTaxRate(platformSettingsRepository, req.headers.authorization, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - "src/app.ts"
    rationale: |
      `createApp` is the single composition root today (constructs `UserRepository`,
      `SessionRepository`, `PizzaRepository`, `CartRepository`/`CartService` and dispatches on
      `${method} ${pathname}`) - the new invoicing modules must be composed and routed the same way
      rather than starting a second server or router.
tests:
  - |
    AC1 (happy path) - a successful payment capture generates a customer invoice with all required
    fields.
    ```ts
    test("AC1: a successful payment capture generates a customer invoice with the required fields", async () => {
      const server = await startTestServer();
      try {
        const res = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-1", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [{ description: "1x Margherita (Large)", amount: 18 }], service_fee: 2,
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.match(body.invoice_number as string, /^INV-\d{5}$/);
        assert.equal(typeof body.transaction_date, "number");
        assert.equal(body.customer_name, "customer1");
        assert.equal(body.provider_name, "provider1");
        assert.deepEqual(body.line_items, [{ description: "1x Margherita (Large)", amount: 18 }]);
        assert.equal(body.service_fee, 2);
        assert.equal(body.total, 20);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC1 (edge case) - malformed events are rejected with 400 rather than producing a bad invoice:
    no line items, and a negative line-item amount.
    ```ts
    test("AC1 edge case: a payment capture with no line items is rejected", async () => {
      const server = await startTestServer();
      try {
        const res = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-1b", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [], service_fee: 2,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });

    test("AC1 edge case: a payment capture with a non-positive line item amount is rejected", async () => {
      const server = await startTestServer();
      try {
        const res = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-1c", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [{ description: "refund adjustment", amount: -5 }], service_fee: 2,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 (happy path) - a successful disbursement generates a provider disbursement record with all
    required fields.
    ```ts
    test("AC2: a successful disbursement generates a provider disbursement record", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          disbursement_id: "ds-1", provider_id: "user-provider-1", gross_amount: 18, service_fee: 2,
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.match(body.invoice_number as string, /^INV-\d{5}$/);
        assert.equal(typeof body.transaction_date, "number");
        assert.equal(body.gross_amount, 18);
        assert.equal(body.service_fee, 2);
        assert.equal(body.net_amount, 16);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 (edge case) - a service fee larger than the gross amount is rejected rather than producing
    a negative net amount.
    ```ts
    test("AC2 edge case: a service fee exceeding the gross amount is rejected", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          disbursement_id: "ds-1b", provider_id: "user-provider-1", gross_amount: 10, service_fee: 15,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 (happy path) - no tax rate configured means the invoice has no tax line.
    ```ts
    test("AC3: no tax rate configured means the invoice has no tax line", async () => {
      const server = await startTestServer();
      try {
        const res = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-2", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [{ description: "item", amount: 10 }], service_fee: 1,
        });
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal("tax_amount" in body, false);
        assert.equal("tax_rate_percent" in body, false);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 (edge case) - a tax rate that is configured and then explicitly cleared (`rate_percent:
    null`) goes back to producing no tax line.
    ```ts
    test("AC3 edge case: clearing a previously-configured tax rate removes the tax line again", async () => {
      const server = await startTestServer();
      try {
        const adminToken = await loginAs(server.baseUrl, "admin1");
        await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
          method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ rate_percent: 10 }),
        });
        await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
          method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ rate_percent: null }),
        });
        const res = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-2b", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [{ description: "item", amount: 10 }], service_fee: 1,
        });
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal("tax_amount" in body, false);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 (happy path) - a configured tax rate is applied to the invoice and disbursement tax line
    (no jurisdiction logic - just the configured rate applied to the service fee).
    ```ts
    test("AC4: a configured tax rate is applied to invoice and disbursement tax lines", async () => {
      const server = await startTestServer();
      try {
        const adminToken = await loginAs(server.baseUrl, "admin1");
        const settingsRes = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ rate_percent: 10 }),
        });
        assert.equal(settingsRes.status, 204);

        const invoiceRes = await postPaymentCapture(server.baseUrl, {
          payment_capture_id: "pc-3", customer_id: "user-customer-1", provider_id: "user-provider-1",
          line_items: [{ description: "item", amount: 10 }], service_fee: 2,
        });
        const invoiceBody = (await invoiceRes.json()) as Record<string, unknown>;
        assert.equal(invoiceBody.tax_rate_percent, 10);
        assert.equal(invoiceBody.tax_amount, 0.2);
        assert.equal(invoiceBody.total, 12.2);

        const disbursementRes = await postDisbursement(server.baseUrl, {
          disbursement_id: "ds-2", provider_id: "user-provider-1", gross_amount: 10, service_fee: 2,
        });
        const disbursementBody = (await disbursementRes.json()) as Record<string, unknown>;
        assert.equal(disbursementBody.tax_rate_percent, 10);
        assert.equal(disbursementBody.tax_amount, 0.2);
        assert.equal(disbursementBody.net_amount, 7.8);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 (edge case) - the tax-rate endpoint rejects out-of-range/non-numeric rates and is
    forbidden to non-admins.
    ```ts
    test("AC4 edge case: setting an invalid tax rate is rejected", async () => {
      const server = await startTestServer();
      try {
        const adminToken = await loginAs(server.baseUrl, "admin1");
        const negative = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
          method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ rate_percent: -5 }),
        });
        assert.equal(negative.status, 400);
      } finally {
        await server.close();
      }
    });

    test("AC4 edge case: a non-admin cannot set the tax rate", async () => {
      const server = await startTestServer();
      try {
        const customerToken = await loginAs(server.baseUrl, "customer1");
        const res = await fetch(`${server.baseUrl}/platform-settings/tax-rate`, {
          method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
          body: JSON.stringify({ rate_percent: 10 }),
        });
        assert.equal(res.status, 403);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 (happy path) - invoice numbers are unique and strictly sequential, with no gaps or
    duplicates, across both invoices and disbursement records.
    ```ts
    test("AC5: invoice numbers are unique and strictly sequential", async () => {
      const server = await startTestServer();
      try {
        const first = await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-4", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const second = await postDisbursement(server.baseUrl, { disbursement_id: "ds-3", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        const third = await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-5", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const numbers = await Promise.all([first, second, third].map(async (r) => ((await r.json()) as { invoice_number: string }).invoice_number));
        const sequenceNumbers = numbers.map((n) => Number(n.replace("INV-", "")));
        assert.deepEqual(sequenceNumbers, [sequenceNumbers[0], sequenceNumbers[0] + 1, sequenceNumbers[0] + 2]);
        assert.equal(new Set(numbers).size, 3);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 (edge case) - a rejected (400) event must not consume a sequence number, so the next valid
    event is still exactly one more than the last successful one.
    ```ts
    test("AC5 edge case: a rejected event does not create a gap in the sequence", async () => {
      const server = await startTestServer();
      try {
        const okRes = await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-5a", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const okNumber = Number(((await okRes.json()) as { invoice_number: string }).invoice_number.replace("INV-", ""));

        const rejected = await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-5b", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [], service_fee: 1 });
        assert.equal(rejected.status, 400);

        const nextRes = await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-5c", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const nextNumber = Number(((await nextRes.json()) as { invoice_number: string }).invoice_number.replace("INV-", ""));
        assert.equal(nextNumber, okNumber + 1);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 (happy path) - a generated invoice AND a generated disbursement record are each stored and
    associated with their originating transaction, retrievable via the portal endpoints.
    ```ts
    test("AC6: a generated invoice is retrievable by its originating payment capture id", async () => {
      const server = await startTestServer();
      try {
        const customerToken = await loginAs(server.baseUrl, "customer1");
        await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-6", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const listRes = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${customerToken}` } });
        const listBody = (await listRes.json()) as { invoices: Array<Record<string, unknown>> };
        assert.ok(listBody.invoices.some((inv) => inv.payment_capture_id === "pc-6"));
      } finally {
        await server.close();
      }
    });

    test("AC6: a generated disbursement record is retrievable by its originating disbursement id", async () => {
      const server = await startTestServer();
      try {
        const providerToken = await loginAs(server.baseUrl, "provider1");
        await postDisbursement(server.baseUrl, { disbursement_id: "ds-6", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        const listRes = await fetch(`${server.baseUrl}/disbursements`, { headers: { Authorization: `Bearer ${providerToken}` } });
        const listBody = (await listRes.json()) as { disbursements: Array<Record<string, unknown>> };
        assert.ok(listBody.disbursements.some((d) => d.disbursement_id === "ds-6"));
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 (happy path + edge case) - reprocessing the same payment-capture OR disbursement event does
    not create a duplicate record or send a duplicate email, while two genuinely different events
    are NOT falsely collapsed together.
    ```ts
    test("AC7: reprocessing the same payment capture event does not create a duplicate invoice or email", async () => {
      const emailService = new RecordingEmailService();
      const server = await startTestServer({ emailService });
      try {
        const customerToken = await loginAs(server.baseUrl, "customer1");
        const event = { payment_capture_id: "pc-7", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 };
        const first = await postPaymentCapture(server.baseUrl, event);
        const second = await postPaymentCapture(server.baseUrl, event);
        assert.equal((await first.json() as { invoice_number: string }).invoice_number, (await second.json() as { invoice_number: string }).invoice_number);

        const listRes = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${customerToken}` } });
        const listBody = (await listRes.json()) as { invoices: Array<Record<string, unknown>> };
        assert.equal(listBody.invoices.filter((inv) => inv.payment_capture_id === "pc-7").length, 1);
        assert.equal(emailService.sentMessages.length, 1);
      } finally {
        await server.close();
      }
    });

    test("AC7 edge case: two different disbursement events for the same provider are both recorded", async () => {
      const server = await startTestServer();
      try {
        const providerToken = await loginAs(server.baseUrl, "provider1");
        await postDisbursement(server.baseUrl, { disbursement_id: "ds-7a", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        await postDisbursement(server.baseUrl, { disbursement_id: "ds-7b", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        const listRes = await fetch(`${server.baseUrl}/disbursements`, { headers: { Authorization: `Bearer ${providerToken}` } });
        const listBody = (await listRes.json()) as { disbursements: Array<Record<string, unknown>> };
        assert.equal(listBody.disbursements.filter((d) => d.disbursement_id === "ds-7a" || d.disbursement_id === "ds-7b").length, 2);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 (happy path) - generating an invoice or a disbursement record sends an automatic email
    notification to the respective customer or provider.
    ```ts
    test("AC8: generating an invoice sends an email notification to the customer", async () => {
      const emailService = new RecordingEmailService();
      const server = await startTestServer({ emailService });
      try {
        await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-8", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        assert.equal(emailService.sentMessages.length, 1);
        assert.equal(emailService.sentMessages[0].to, "customer1");
        assert.match(emailService.sentMessages[0].body, /INV-\d{5}/);
      } finally {
        await server.close();
      }
    });

    test("AC8: generating a disbursement record sends an email notification to the provider", async () => {
      const emailService = new RecordingEmailService();
      const server = await startTestServer({ emailService });
      try {
        await postDisbursement(server.baseUrl, { disbursement_id: "ds-8", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        assert.equal(emailService.sentMessages.length, 1);
        assert.equal(emailService.sentMessages[0].to, "provider1");
        assert.match(emailService.sentMessages[0].body, /INV-\d{5}/);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC9 (happy path) - once generated and emailed, a customer/provider can retrieve their own
    invoice/disbursement record from the portal.
    ```ts
    test("AC9: a provider can retrieve their disbursement records from the portal", async () => {
      const server = await startTestServer();
      try {
        await postDisbursement(server.baseUrl, { disbursement_id: "ds-9", provider_id: "user-provider-1", gross_amount: 5, service_fee: 1 });
        const providerToken = await loginAs(server.baseUrl, "provider1");
        const res = await fetch(`${server.baseUrl}/disbursements`, { headers: { Authorization: `Bearer ${providerToken}` } });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { disbursements: Array<Record<string, unknown>> };
        assert.ok(body.disbursements.some((d) => d.disbursement_id === "ds-9"));
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC9 (edge cases) - portal retrieval enforces authentication, role, AND per-customer isolation:
    an unauthenticated request is rejected, a provider cannot read `/invoices`, and one customer
    cannot see another customer's invoices. A second customer is injected via a custom
    `UserRepository` for this test only, so the shared fixtures in `testUsers.ts` stay untouched.
    ```ts
    test("AC9 edge case: unauthenticated and wrong-role requests to the portal are rejected", async () => {
      const server = await startTestServer();
      try {
        const unauthenticated = await fetch(`${server.baseUrl}/invoices`);
        assert.equal(unauthenticated.status, 401);

        const providerToken = await loginAs(server.baseUrl, "provider1");
        const wrongRole = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${providerToken}` } });
        assert.equal(wrongRole.status, 403);
      } finally {
        await server.close();
      }
    });

    test("AC9 edge case: a customer cannot see another customer's invoices", async () => {
      const secondCustomer = { id: "user-customer-2", username: "customer2", role: "customer" as const, passwordHash: await hashPassword(TEST_PASSWORD) };
      const userRepository = new UserRepository([...testUsers, secondCustomer]);
      const server = await startTestServer({ userRepository });
      try {
        await postPaymentCapture(server.baseUrl, { payment_capture_id: "pc-9", customer_id: "user-customer-1", provider_id: "user-provider-1", line_items: [{ description: "i", amount: 5 }], service_fee: 1 });
        const otherCustomerToken = await loginAs(server.baseUrl, "customer2");
        const res = await fetch(`${server.baseUrl}/invoices`, { headers: { Authorization: `Bearer ${otherCustomerToken}` } });
        const body = (await res.json()) as { invoices: Array<Record<string, unknown>> };
        assert.equal(body.invoices.length, 0);
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - "This repo has no payment gateway, booking, or disbursement domain at all today - only auth/session and a pizza cart. This plan introduces `POST /internal/payment-captures` and `POST /internal/disbursements` as the boundary representing 'a payment capture succeeds' / 'a provider disbursement succeeds', i.e. an internal payment-processing component (not built in this repo) calls these once its own capture/disbursement completes - mirroring how the earlier Pizza Customisation plan translated UI-screen ACs into API endpoints for this headless repo. Please confirm this is the intended integration boundary, or point to where real payment/booking processing should plug in instead."
  - "The two `/internal/...` trigger endpoints are left unauthenticated in this pass, since no service-to-service/webhook auth mechanism exists anywhere in the codebase yet. This is a real production gap (anyone could POST a fake payment-capture event) - flagging it explicitly rather than inventing a new auth scheme unprompted. Please confirm whether these should be gated (e.g. a shared secret header, or requiring an admin-role bearer token) now or as a fast-follow."
  - "Tax is a single global rate (not per-jurisdiction, per AC4's 'no automatic jurisdiction-based calculation'), configured via `PUT /platform-settings/tax-rate` restricted to the existing `admin` role, and applied only to the service fee (not to line-item/gross totals), since AC4's 'applicable amount' is left ambiguous by the story. Please confirm the tax base is correct."
  - "Invoice numbers and disbursement-record numbers share one global monotonic `INV-NNNNN` sequence, since AC2 says a disbursement record itself carries an 'invoice number' and AC5 talks generically about 'an invoice' being assigned a number. Please confirm this shared-sequence interpretation vs. two independent sequences (e.g. a separate `DISB-NNNNN` series)."
  - "A rejected/invalid event (400) is assumed to consume NO sequence number and create NO record, since AC5's 'no gaps' most naturally reads as applying to successfully generated invoices only - covered explicitly by the AC5 edge-case test."
  - "'Customer and provider names' reuse the existing `User.username` field, since `User` has no separate display-name field today and adding one was judged out of scope for this story (it would touch fixtures relied on by `test/login.test.ts`, `test/refresh.test.ts`, `test/logout.test.ts`)."
  - "The idempotency key (AC7) is the caller-supplied `payment_capture_id` / `disbursement_id`; re-posting the same id is a no-op that returns the original record AND does not re-send the email, rather than an error."
  - "Portal retrieval (AC9) is assumed to be scoped strictly to the authenticated caller's own records (a customer only ever sees their own invoices, a provider only their own disbursements), even though the AC text doesn't say this explicitly - this is treated as an implied, non-negotiable data-isolation requirement given the domain, and is covered by a dedicated edge-case test using a second customer injected via a custom `UserRepository` instance (no changes to the shared `testUsers.ts` fixture)."
  - "Input validation (empty line items, non-positive amounts, service fee exceeding gross amount, out-of-range tax rate) is treated as in-scope even though no AC states it explicitly, since AC1/AC2's field lists and AC4's 'applicable amount' language only make sense if the inputs producing them are sane; these are the edge-case tests called out per-AC above rather than a separate AC."
  - "Email sending is an injectable `EmailService` interface with a console-logging default (`ConsoleEmailService`) - no real SMTP/third-party provider is wired up, since none exists in this codebase and none was specified in the story."
  - "Storage is in-memory only (`Map`-backed repositories, lost on process restart), matching every existing repository in this codebase (`SessionRepository`, `CartRepository`, etc.) - no database is introduced."
  - "Line items, amounts, and fees are supplied directly by the caller of the internal trigger endpoints (there is no order/booking total computed elsewhere in this repo to derive them from)."
package_dependencies: []
notes: |
  Layering/call-graph for the touched and reused modules, based on what was actually read while
  planning (`src/app.ts`, `src/cart/*`, `src/auth/tokenService.ts`, `src/httpUtils.ts`,
  `src/users/userRepository.ts`, `test/testServer.ts`):

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    invoiceController["src/invoicing/invoiceController.ts (new)"]
    invoiceService["src/invoicing/invoiceService.ts (new)"]
    invoiceRepository["src/invoicing/invoiceRepository.ts (new)"]
    disbursementRepository["src/invoicing/disbursementRepository.ts (new)"]
    settingsRepository["src/invoicing/platformSettingsRepository.ts (new)"]
    sequence["src/invoicing/invoiceNumberSequence.ts (new)"]
    emailService["src/notifications/emailService.ts (new)"]
    tokenService["src/auth/tokenService.ts (existing, reused)"]
    httpUtils["src/httpUtils.ts (existing, reused)"]
    userRepository["src/users/userRepository.ts (existing, reused)"]
    testFile["test/invoiceGeneration.test.ts (new)"]
    testEmailService["test/testEmailService.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes: internal captures/disbursements, GET /invoices, GET /disbursements, PUT tax-rate"| invoiceController
    invoiceController -->|"verifyAccessToken() for portal + tax-rate role checks (401 vs 403)"| tokenService
    invoiceController -->|"asRecord()/body parsing"| httpUtils
    invoiceController -->|"recordPaymentCapture(), recordDisbursement()"| invoiceService
    invoiceController -->|"findByCustomerId() for portal list, scoped to caller"| invoiceRepository
    invoiceController -->|"findByProviderId() for portal list, scoped to caller"| disbursementRepository
    invoiceController -->|"findById() to render customer/provider names"| userRepository
    invoiceService -->|"idempotent save/find, throws InvalidEventError on bad input"| invoiceRepository
    invoiceService -->|"idempotent save/find, throws InvalidEventError on bad input"| disbursementRepository
    invoiceService -->|"getTaxRatePercent()"| settingsRepository
    invoiceService -->|"next() shared counter, only on successful generation"| sequence
    invoiceService -->|"send() notification, once per new record"| emailService
    invoiceService -->|"findById() for recipient lookup"| userRepository
    testFile -->|"drives via fetch()"| app
    testFile -->|"injects RecordingEmailService"| testEmailService
    testFile -->|"startTestServer(), custom UserRepository for isolation edge case"| testServer

    classDef touched fill:#f96,color:#000
    class app,invoiceController,invoiceService,invoiceRepository,disbursementRepository,settingsRepository,sequence,emailService,testFile,testEmailService touched
  ```
