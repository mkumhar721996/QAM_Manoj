summary: |
  This repo (`qam-manoj-story-007-login-session-management`) currently has no payment, booking,
  invoice, or refund domain at all - only `auth/`, `sessions/`, `users/`, `pizzas/`, `cart/`,
  following a fixture -> repository -> service -> controller layering, in-memory `Map`-backed
  stores (no DB), snake_case JSON wire format, and `node:test` + raw `fetch` against an ephemeral
  `startTestServer()` for tests, all composed in `src/app.ts`. This plan adds a new
  `src/invoicing/` module implementing the credit-note/disbursement-record slice of the
  "Payments & Invoicing" epic: a minimal `InvoiceRepository` (fixture data standing in for
  invoices produced by the not-yet-built payment-capture flow), a `CreditNoteService` that
  generates a `CreditNote` when a refund event is processed (AC1) and a `DisbursementRecord`
  when a partial-cancellation non-refundable disbursement event is processed (AC2), both
  persisted in in-memory repositories and retrievable by id (AC3), and both carrying the
  originating transaction id/date and original invoice number so the association is observable
  via the API (AC4). New routes `POST /refunds`, `POST /cancellations/disbursements`,
  `GET /credit-notes/:id`, `GET /disbursement-records/:id` are wired into `src/app.ts`'s
  existing composition root, mirroring exactly how `pizzas`/`cart` were added. Per reviewer
  request, this revision widens test coverage beyond the four literal story ACs: it promotes
  disbursement-record retrieval/association to first-class, formally-tested ACs (symmetric to
  the credit-note ACs), and adds explicit negative/validation and multi-record-isolation
  coverage for both the refund and cancellation-disbursement flows.

scope:
  - description: |
      Write the failing acceptance tests first, covering all ACs (the 4 story ACs plus the
      reviewer-requested additional ACs below) against the not-yet-existing `POST /refunds`,
      `POST /cancellations/disbursements`, `GET /credit-notes/:id`, and
      `GET /disbursement-records/:id` routes. These must fail (404/import errors) before any
      implementation exists.
    files:
      - test/creditNoteGeneration.test.ts
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production
      code, matching the existing `test/cartCustomisation.test.ts` style (raw `fetch` against
      `startTestServer()`, snake_case JSON assertions).

  - description: |
      Add a minimal in-memory `Invoice` fixture + repository. This is new support code, not an
      AC itself, but AC1 ("referencing the original invoice number") and AC4 ("associated
      with ... original invoice records") are unfalsifiable without a real invoice record to
      validate a refund/disbursement event against - otherwise any string would be accepted as
      an "invoice number".

      ```ts
      // src/invoicing/fixtures/testInvoices.ts
      export interface Invoice {
        invoiceNumber: string;
        bookingId: string;
        customerId: string;
        providerId: string;
        amount: number;
        issuedAt: string;
      }
      export const testInvoices: Invoice[] = [
        { invoiceNumber: "INV-1001", bookingId: "booking-1", customerId: "user-1", providerId: "provider-1", amount: 120.0, issuedAt: "2026-08-01T10:00:00.000Z" },
        { invoiceNumber: "INV-1002", bookingId: "booking-2", customerId: "user-2", providerId: "provider-2", amount: 75.5, issuedAt: "2026-08-05T14:30:00.000Z" },
      ];
      ```

      ```ts
      // src/invoicing/invoiceRepository.ts
      import type { Invoice } from "./fixtures/testInvoices.ts";
      import { testInvoices } from "./fixtures/testInvoices.ts";

      export class InvoiceRepository {
        private invoicesByNumber: Map<string, Invoice>;
        constructor(invoices: Invoice[] = testInvoices) {
          this.invoicesByNumber = new Map(invoices.map((i) => [i.invoiceNumber, i]));
        }
        findByInvoiceNumber(invoiceNumber: string): Invoice | undefined {
          return this.invoicesByNumber.get(invoiceNumber);
        }
      }
      ```
    files:
      - src/invoicing/fixtures/testInvoices.ts
      - src/invoicing/invoiceRepository.ts
    rationale: |
      Modeled directly on `src/pizzas/fixtures/pizzaCatalog.ts` + `src/pizzas/pizzaRepository.ts`
      (verified: same fixture -> `Map`-backed repository shape already used twice in this
      codebase, keyed by id there and by invoice number here).

  - description: |
      Add the `CreditNote` / `DisbursementRecord` domain model types plus their input shapes.

      ```ts
      // src/invoicing/creditNoteModel.ts
      export interface RefundEventInput {
        invoiceNumber: string;
        transactionId: string;
        refundAmount: number;
        transactionDate: string;
      }
      export interface CreditNote extends RefundEventInput {
        id: string;
        createdAt: number;
      }
      export interface CancellationDisbursementInput {
        cancellationEventId: string;
        invoiceNumber: string;
        providerId: string;
        amount: number;
      }
      export interface DisbursementRecord extends CancellationDisbursementInput {
        id: string;
        createdAt: number;
      }
      ```
    files:
      - src/invoicing/creditNoteModel.ts
    rationale: |
      Mirrors `src/cart/cartModel.ts` (verified: a plain input interface `PizzaConfigurationInput`
      extended by the persisted-record interface `CartItem` with `id`/`customerId`/`addedAt`
      added) - same "input interface extended by stored-record interface" shape here.

  - description: |
      Add in-memory repositories for the two new record types, modeled on
      `src/sessions/sessionRepository.ts` / `src/cart/cartRepository.ts`.

      ```ts
      // src/invoicing/creditNoteRepository.ts
      import type { CreditNote } from "./creditNoteModel.ts";
      export class CreditNoteRepository {
        private creditNotesById: Map<string, CreditNote> = new Map();
        add(creditNote: CreditNote): void {
          this.creditNotesById.set(creditNote.id, creditNote);
        }
        findById(id: string): CreditNote | undefined {
          return this.creditNotesById.get(id);
        }
      }
      ```

      ```ts
      // src/invoicing/disbursementRecordRepository.ts
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
      ```
    files:
      - src/invoicing/creditNoteRepository.ts
      - src/invoicing/disbursementRecordRepository.ts
    rationale: |
      AC3 requires generated credit notes to be "stored as a retrievable record" - a per-id
      in-memory store (matching the existing no-DB `Map` pattern) is the minimal way to make
      that assertion checkable via a `GET` route. Per reviewer request this turn,
      `DisbursementRecord` retrieval/association is now promoted to formally-tested ACs 7 and 8
      below (previously an unconfirmed open question in this plan), so its repository is now
      firmly in scope rather than "for symmetry only".

  - description: |
      Add `CreditNoteService` with the generation logic for AC1/AC2, validating the referenced
      invoice exists before persisting either record type (this is what makes the AC4/AC8
      "association" real rather than just copying caller-supplied strings through).

      ```ts
      // src/invoicing/creditNoteService.ts
      export class InvoiceNotFoundError extends Error {}

      export class CreditNoteService {
        constructor(
          private invoiceRepository: InvoiceRepository,
          private creditNoteRepository: CreditNoteRepository,
          private disbursementRecordRepository: DisbursementRecordRepository,
        ) {}

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
      ```
    files:
      - src/invoicing/creditNoteService.ts
    rationale: |
      Centralises the "invoice must exist" and record-generation rules in one service, mirroring
      how `AuthService`/`CartService` centralise their domain rules (verified in
      `src/cart/cartService.ts`'s `PizzaNotFoundError`/`InvalidCustomisationError` pattern)
      rather than spreading validation across the controller. `crypto.randomUUID()` guarantees
      distinct ids across calls, which is what the new AC10 uniqueness test below exercises.

  - description: |
      Add `creditNoteController.ts` with HTTP handlers, reusing `asRecord` from `httpUtils.ts`
      for body parsing and `ControllerResponse` from `authController.ts` for the response shape.
      Validation here covers the new AC5/AC6 malformed-request cases.

      ```ts
      // src/invoicing/creditNoteController.ts
      export function handlePostRefund(creditNoteService: CreditNoteService, requestBody: unknown): ControllerResponse {
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
          const creditNote = creditNoteService.generateCreditNote({ invoiceNumber, transactionId, refundAmount, transactionDate });
          return { status: 201, body: toCreditNoteBody(creditNote) };
        } catch (err) {
          if (err instanceof InvoiceNotFoundError) return { status: 404, body: { error: err.message } };
          throw err;
        }
      }

      export function handlePostCancellationDisbursement(creditNoteService: CreditNoteService, requestBody: unknown): ControllerResponse {
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
          const record = creditNoteService.generateDisbursementRecord({ cancellationEventId, invoiceNumber, providerId, amount });
          return { status: 201, body: toDisbursementRecordBody(record) };
        } catch (err) {
          if (err instanceof InvoiceNotFoundError) return { status: 404, body: { error: err.message } };
          throw err;
        }
      }

      export function handleGetCreditNote(creditNoteService: CreditNoteService, id: string): ControllerResponse {
        const creditNote = creditNoteService.getCreditNote(id);
        if (!creditNote) return { status: 404, body: { error: "credit note not found" } };
        return { status: 200, body: toCreditNoteBody(creditNote) };
      }

      export function handleGetDisbursementRecord(creditNoteService: CreditNoteService, id: string): ControllerResponse {
        const record = creditNoteService.getDisbursementRecord(id);
        if (!record) return { status: 404, body: { error: "disbursement record not found" } };
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
      ```
    files:
      - src/invoicing/creditNoteController.ts
    rationale: |
      Keeps the HTTP-shape concerns (snake_case body, status codes, 400 validation) in the
      controller layer only, exactly like `authController.ts`/`cartController.ts` (verified:
      both do inline `typeof`/shape checks before calling their service), so `CreditNoteService`
      stays framework/HTTP-agnostic.

  - description: |
      Wire the new routes into `src/app.ts`: instantiate `InvoiceRepository`/
      `CreditNoteRepository`/`DisbursementRecordRepository`/`CreditNoteService`, extend
      `AppDependencies` so tests can inject repositories (matching the existing injectable
      pattern verified in `src/app.ts`), and add route matching for `POST /refunds`,
      `POST /cancellations/disbursements`, `GET /credit-notes/:id`,
      `GET /disbursement-records/:id`.

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
        invoiceRepository?: InvoiceRepository;
        creditNoteRepository?: CreditNoteRepository;
        disbursementRecordRepository?: DisbursementRecordRepository;
      }
      ```

      Routing additions inside `handleRequest`, following the existing `/pizzas/:id` path-param
      pattern (verified at `src/app.ts:56-61`) for the two `GET` routes:

      ```ts
      const creditNoteMatch = url.pathname.match(/^\/credit-notes\/([^/]+)$/);
      if (method === "GET" && creditNoteMatch) {
        const result = handleGetCreditNote(creditNoteService, creditNoteMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      const disbursementMatch = url.pathname.match(/^\/disbursement-records\/([^/]+)$/);
      if (method === "GET" && disbursementMatch) {
        const result = handleGetDisbursementRecord(creditNoteService, disbursementMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }

      // added to the existing method-allow-list (src/app.ts:69-74) before readJsonBody(req):
      // route !== "POST /refunds" && route !== "POST /cancellations/disbursements"

      if (route === "POST /refunds") {
        const result = handlePostRefund(creditNoteService, body);
        sendJson(res, result.status, result.body);
        return;
      }

      if (route === "POST /cancellations/disbursements") {
        const result = handlePostCancellationDisbursement(creditNoteService, body);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - src/app.ts
    rationale: |
      `createApp` is the single composition root today (verified: it constructs every
      repository/service and dispatches on `${method} ${pathname}` in `handleRequest`) - the
      new module must be composed and routed the same way rather than starting a second server
      or router.

tests:
  - |
    AC1 - GIVEN a full or partial refund is issued to a customer WHEN the refund is processed
    THEN the platform generates a credit note referencing the original invoice number, the
    refund amount, and the transaction date.

    ```ts
    test("AC1: a processed refund generates a credit note referencing the original invoice, refund amount, and transaction date", async () => {
      const server = await startTestServer();
      try {
        const res = await postRefund(server.baseUrl, {
          invoice_number: "INV-1001",
          transaction_id: "txn-500",
          refund_amount: 45.0,
          transaction_date: "2026-09-10T12:00:00.000Z",
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.invoice_number, "INV-1001");
        assert.equal(body.refund_amount, 45.0);
        assert.equal(body.transaction_date, "2026-09-10T12:00:00.000Z");
        assert.ok(typeof body.id === "string" && body.id.length > 0);
      } finally {
        await server.close();
      }
    });

    test("AC1: a full refund (refund_amount equal to the invoice amount) is accepted just like a partial refund", async () => {
      const server = await startTestServer();
      try {
        const res = await postRefund(server.baseUrl, {
          invoice_number: "INV-1001",
          transaction_id: "txn-full-1",
          refund_amount: 120.0,
          transaction_date: "2026-09-10T12:00:00.000Z",
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.refund_amount, 120.0);
      } finally {
        await server.close();
      }
    });

    test("AC1: a refund referencing a non-existent invoice is rejected", async () => {
      const server = await startTestServer();
      try {
        const res = await postRefund(server.baseUrl, {
          invoice_number: "INV-DOES-NOT-EXIST",
          transaction_id: "txn-501",
          refund_amount: 10,
          transaction_date: "2026-09-10T12:00:00.000Z",
        });
        assert.equal(res.status, 404);
      } finally {
        await server.close();
      }
    });
  - |
    AC2 - GIVEN a partial cancellation results in a non-refundable portion disbursed to the
    provider WHEN the disbursement is processed THEN the platform generates a corresponding
    disbursement record for the provider referencing the cancellation event.

    ```ts
    test("AC2: a partial-cancellation disbursement generates a disbursement record referencing the cancellation event", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-77",
          invoice_number: "INV-1002",
          provider_id: "provider-2",
          amount: 20.5,
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.cancellation_event_id, "cancel-77");
        assert.equal(body.provider_id, "provider-2");
        assert.equal(body.amount, 20.5);
        assert.ok(typeof body.id === "string" && body.id.length > 0);
      } finally {
        await server.close();
      }
    });

    test("AC2: a disbursement referencing a non-existent invoice is rejected", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-78",
          invoice_number: "INV-DOES-NOT-EXIST",
          provider_id: "provider-2",
          amount: 5,
        });
        assert.equal(res.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN a credit note is generated WHEN generation completes THEN it is stored as a
    retrievable record.

    ```ts
    test("AC3: a generated credit note is stored and retrievable by id", async () => {
      const server = await startTestServer();
      try {
        const createRes = await postRefund(server.baseUrl, {
          invoice_number: "INV-1001", transaction_id: "txn-502", refund_amount: 15, transaction_date: "2026-09-11T09:00:00.000Z",
        });
        const created = (await createRes.json()) as { id: string };

        const getRes = await fetch(`${server.baseUrl}/credit-notes/${created.id}`);
        assert.equal(getRes.status, 200);
        const fetched = await getRes.json();
        assert.deepEqual(fetched, created);
      } finally {
        await server.close();
      }
    });

    test("AC3: retrieving a credit note that doesn't exist returns 404", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/credit-notes/does-not-exist`);
        assert.equal(res.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN a credit note is generated WHEN generation completes THEN it is associated with
    the originating transaction and original invoice records.

    ```ts
    test("AC4: the stored credit note is associated with the originating transaction and original invoice", async () => {
      const server = await startTestServer();
      try {
        const createRes = await postRefund(server.baseUrl, {
          invoice_number: "INV-1002", transaction_id: "txn-503", refund_amount: 30, transaction_date: "2026-09-12T08:00:00.000Z",
        });
        const created = (await createRes.json()) as { id: string };

        const getRes = await fetch(`${server.baseUrl}/credit-notes/${created.id}`);
        const fetched = (await getRes.json()) as { invoice_number: string; transaction_id: string };
        assert.equal(fetched.invoice_number, "INV-1002");
        assert.equal(fetched.transaction_id, "txn-503");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC5 (added this revision, reviewer-requested extra coverage) - GIVEN a refund request is
    missing a required field or has a field of the wrong type/value WHEN `POST /refunds` is
    called THEN the platform rejects it with 400 before generating anything.

    ```ts
    test("AC5: a refund request missing invoice_number is rejected with 400", async () => {
      const server = await startTestServer();
      try {
        const res = await postRefund(server.baseUrl, {
          transaction_id: "txn-600", refund_amount: 10, transaction_date: "2026-09-10T12:00:00.000Z",
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });

    test("AC5: a refund request with a non-positive refund_amount is rejected with 400", async () => {
      const server = await startTestServer();
      try {
        const res = await postRefund(server.baseUrl, {
          invoice_number: "INV-1001", transaction_id: "txn-601", refund_amount: 0, transaction_date: "2026-09-10T12:00:00.000Z",
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC6 (added this revision, reviewer-requested extra coverage) - GIVEN a cancellation
    disbursement request is missing a required field or has a field of the wrong type/value
    WHEN `POST /cancellations/disbursements` is called THEN the platform rejects it with 400
    before generating anything.

    ```ts
    test("AC6: a disbursement request missing provider_id is rejected with 400", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-79", invoice_number: "INV-1002", amount: 5,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });

    test("AC6: a disbursement request with a non-positive amount is rejected with 400", async () => {
      const server = await startTestServer();
      try {
        const res = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-80", invoice_number: "INV-1002", provider_id: "provider-2", amount: -5,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC7 (added this revision, reviewer-requested extra coverage; promotes disbursement-record
    retrieval, previously an open question in this plan, to a formally tested AC symmetric to
    AC3) - GIVEN a disbursement record is generated WHEN generation completes THEN it is stored
    as a retrievable record.

    ```ts
    test("AC7: a generated disbursement record is stored and retrievable by id", async () => {
      const server = await startTestServer();
      try {
        const createRes = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-81", invoice_number: "INV-1002", provider_id: "provider-2", amount: 12.25,
        });
        const created = (await createRes.json()) as { id: string };

        const getRes = await fetch(`${server.baseUrl}/disbursement-records/${created.id}`);
        assert.equal(getRes.status, 200);
        const fetched = await getRes.json();
        assert.deepEqual(fetched, created);
      } finally {
        await server.close();
      }
    });

    test("AC7: retrieving a disbursement record that doesn't exist returns 404", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/disbursement-records/does-not-exist`);
        assert.equal(res.status, 404);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC8 (added this revision, reviewer-requested extra coverage; symmetric to AC4) - GIVEN a
    disbursement record is generated WHEN generation completes THEN it is associated with the
    originating cancellation event and original invoice record.

    ```ts
    test("AC8: the stored disbursement record is associated with the originating cancellation event and original invoice", async () => {
      const server = await startTestServer();
      try {
        const createRes = await postDisbursement(server.baseUrl, {
          cancellation_event_id: "cancel-82", invoice_number: "INV-1001", provider_id: "provider-1", amount: 8,
        });
        const created = (await createRes.json()) as { id: string };

        const getRes = await fetch(`${server.baseUrl}/disbursement-records/${created.id}`);
        const fetched = (await getRes.json()) as { invoice_number: string; cancellation_event_id: string };
        assert.equal(fetched.invoice_number, "INV-1001");
        assert.equal(fetched.cancellation_event_id, "cancel-82");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC9 (added this revision, reviewer-requested extra coverage) - GIVEN two separate refund
    events are processed against different invoices WHEN each completes THEN each produces its
    own distinct, independently retrievable credit note (guards against the in-memory `Map`
    keyed store silently overwriting or conflating records).

    ```ts
    test("AC9: two refunds against different invoices produce two distinct, independently retrievable credit notes", async () => {
      const server = await startTestServer();
      try {
        const first = await (await postRefund(server.baseUrl, {
          invoice_number: "INV-1001", transaction_id: "txn-700", refund_amount: 5, transaction_date: "2026-09-13T00:00:00.000Z",
        })).json() as { id: string };
        const second = await (await postRefund(server.baseUrl, {
          invoice_number: "INV-1002", transaction_id: "txn-701", refund_amount: 6, transaction_date: "2026-09-13T01:00:00.000Z",
        })).json() as { id: string };

        assert.notEqual(first.id, second.id);

        const firstFetched = await (await fetch(`${server.baseUrl}/credit-notes/${first.id}`)).json() as { invoice_number: string };
        const secondFetched = await (await fetch(`${server.baseUrl}/credit-notes/${second.id}`)).json() as { invoice_number: string };
        assert.equal(firstFetched.invoice_number, "INV-1001");
        assert.equal(secondFetched.invoice_number, "INV-1002");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC10 (added this revision, reviewer-requested extra coverage) - GIVEN a `POST` is made to an
    invoicing route with a non-JSON-object body (e.g. a JSON array or a primitive) WHEN the
    request is processed THEN it is rejected with 400 rather than throwing, exercising the
    existing `asRecord()` guard against this new module's routes.

    ```ts
    test("AC10: posting a non-object JSON body to /refunds is rejected with 400, not a server error", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/refunds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(["not", "an", "object"]),
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```

assumptions_or_open_questions:
  - |
    This codebase has no payment/booking/transaction domain at all today. `InvoiceRepository` is
    new fixture data standing in for invoices that a not-yet-built payment-capture flow would
    produce - please confirm this is the right stand-in rather than pointing to an existing
    invoice source I've missed.
  - |
    'Transaction' (AC1's transaction date, AC4's originating transaction) is represented purely
    as caller-supplied `transaction_id`/`transaction_date` on the refund event, with no separate
    Transaction domain/repository built, since payment capture appears to be a different story
    in this epic. If a real Transaction record already exists elsewhere it should be referenced
    instead - please confirm.
  - |
    `POST /refunds` and `POST /cancellations/disbursements` are left unauthenticated, treated as
    internal/system-triggered events (e.g. from a payment gateway webhook or
    booking-cancellation policy engine), since no admin/internal-service auth concept exists in
    this codebase yet (only customer Bearer-JWT auth via `tokenService.ts`). Flagging for
    reviewer to confirm vs. requiring some form of service auth.
  - |
    Per this turn's reviewer request ("add more acs and test cases"), ACs 5-10 above were added
    by me to widen test coverage (validation/negative cases, disbursement-record
    retrieval/association symmetry, multi-record isolation, malformed-body handling). These are
    QA-driven robustness cases derived from the existing 4 story ACs and this codebase's
    established conventions (e.g. `cartCustomisation.test.ts`'s own negative-case tests), not
    new ACs from the ticket text itself - please confirm they're the right additions, or tell me
    which direction to extend coverage in instead if this wasn't what was intended.
  - |
    Full vs. partial refund (AC1) is not modeled as a distinct field - both are just a
    `refund_amount` against the invoice's original amount; no separate 'refund type' is stored
    since no AC requires distinguishing them after the fact. AC1's new full-refund test in this
    revision only checks that `refund_amount` equal to the invoice amount is accepted, not that
    it is tagged differently from a partial refund.
  - |
    No business rule is enforced that `refund_amount` (or disbursement `amount`) must not exceed
    the original invoice's `amount` - only "greater than zero" is validated (AC5/AC6). Flagging
    in case the reviewer wants an over-refund/over-disbursement rejection rule added; it isn't
    implied by any of the 4 story ACs so I did not add it speculatively.
  - |
    A single implicit currency is assumed throughout (no currency code field), consistent with
    there being no currency/money modeling anywhere else in this codebase.
  - |
    Credit notes and disbursement records are in-memory only (lost on process restart), matching
    the existing `SessionRepository`/`UserRepository`/`CartRepository` pattern - no persistence
    layer is introduced.

package_dependencies: []

notes: |
  There is currently zero payment/invoicing/booking code in this repository - `src/invoicing/`
  is an entirely new module. This plan deliberately scopes it to exactly what the 4 story ACs
  need (invoice lookup, credit note generation/retrieval, disbursement record generation) plus
  the reviewer-requested extra validation/symmetry/isolation test coverage, rather than building
  out the full "Payments & Invoicing" epic (payment capture, fee-minus disbursement, general
  invoice generation, centralized refund execution) - those are assumed to be separate stories
  under the same epic.

  All referenced existing files/patterns were re-read against the current codebase this turn to
  confirm they still exist as described: `src/app.ts` (composition root + route dispatch,
  `AppDependencies` injectable pattern), `src/pizzas/pizzaRepository.ts` +
  `src/pizzas/fixtures/pizzaCatalog.ts` (fixture -> Map-repository shape), `src/cart/cartModel.ts`
  (input-interface -> stored-record-interface shape), `src/cart/cartController.ts` +
  `src/auth/authController.ts` (`ControllerResponse`, `asRecord` validation-in-controller
  pattern), `src/httpUtils.ts` (`asRecord`/`readJsonBody`/`sendJson`), `test/testServer.ts`
  (`startTestServer`/`AppDependencies` injection), and `test/cartCustomisation.test.ts` (raw
  `fetch`-based `node:test` style, including its own negative/validation test pattern that ACs
  5/6/10 above follow). No drift found; nothing needed to move or be renamed.

  Layering/call-graph for the touched modules, plus their existing real callers/callees read
  while planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    creditNoteController["src/invoicing/creditNoteController.ts (new)"]
    creditNoteService["src/invoicing/creditNoteService.ts (new)"]
    invoiceRepository["src/invoicing/invoiceRepository.ts (new)"]
    invoiceFixtures["src/invoicing/fixtures/testInvoices.ts (new)"]
    creditNoteRepository["src/invoicing/creditNoteRepository.ts (new)"]
    disbursementRepository["src/invoicing/disbursementRecordRepository.ts (new)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    authController["src/auth/authController.ts (existing, untouched - ControllerResponse type only)"]
    testFile["test/creditNoteGeneration.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes POST /refunds, POST /cancellations/disbursements, GET /credit-notes/:id, GET /disbursement-records/:id"| creditNoteController
    creditNoteController -->|"asRecord()/body parsing + 400 validation (AC5/AC6/AC10)"| httpUtils
    creditNoteController -->|"imports ControllerResponse type"| authController
    creditNoteController -->|"generateCreditNote(), generateDisbursementRecord(), getCreditNote(), getDisbursementRecord()"| creditNoteService
    creditNoteService -->|"findByInvoiceNumber() to validate the referenced invoice exists (AC1/AC2/AC4/AC8)"| invoiceRepository
    creditNoteService -->|"add(), findById() (AC3/AC9)"| creditNoteRepository
    creditNoteService -->|"add(), findById() (AC7)"| disbursementRepository
    invoiceRepository -->|"seeds from"| invoiceFixtures
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer()"| testServer

    classDef touched fill:#f96,color:#000
    class app,creditNoteController,creditNoteService,invoiceRepository,invoiceFixtures,creditNoteRepository,disbursementRepository,testFile touched
  ```
