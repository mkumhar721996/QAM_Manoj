summary: |
  Add credential/document upload for providers to this in-memory Node.js auth/service backend
  (`src/app.ts`, native `node:http`, no framework, no external dependencies, `node:test` for
  tests). A logged-in provider can upload a PDF/JPG/PNG up to 10 MB; it is stored with status
  `pending_scan`, run through an injectable `MalwareScanner`, and flips to `ready` or `failed`
  once the scan settles. Providers see their own documents (name, upload date, status) and can
  only download their own files; admins can see and download only `ready` documents via a review
  queue, and `failed`/`pending_scan` documents never appear there. This follows the existing
  conventions from the login/session story: in-memory repositories injected via `AppDependencies`,
  hand-rolled request routing in `app.ts`, and `node:test` + `assert/strict` HTTP-level tests
  against a real `startTestServer()` instance.

scope:
  - description: |
      New document domain model: the scan-status enum and a pure mapping from internal status to
      the exact provider-facing label text used by the acceptance criteria.

      ```ts
      export type ScanStatus = "pending_scan" | "ready" | "failed";

      export interface DocumentRecord {
        id: string;
        providerId: string;
        fileName: string;
        contentType: string;
        content: Buffer;
        status: ScanStatus;
        uploadedAt: number;
      }

      export function toStatusLabel(status: ScanStatus): string {
        switch (status) {
          case "pending_scan":
            return "pending scan";
          case "ready":
            return "ready";
          case "failed":
            return "failed — file could not be verified";
        }
      }
      ```
    files:
      - src/documents/documentModel.ts
    rationale: |
      Mirrors `src/sessions/sessionModel.ts` (a plain interface, no behavior). Centralizing the
      label strings in one function means AC2/AC5/AC7's exact wording is defined once and reused
      by both the list and review-queue responses, instead of being duplicated in the controller.

  - description: |
      In-memory `DocumentRepository`, modeled directly on `SessionRepository`'s `Map`-based
      storage and method shapes.

      ```ts
      export class DocumentRepository {
        create(providerId: string, fileName: string, contentType: string, content: Buffer, now: number): DocumentRecord;
        findById(id: string): DocumentRecord | undefined;
        listByProviderId(providerId: string): DocumentRecord[];
        listReadyForReviewQueue(): DocumentRecord[];
        updateStatus(id: string, status: ScanStatus): void;
      }
      ```
    files:
      - src/documents/documentRepository.ts
    rationale: |
      Same storage pattern as `SessionRepository` (`sessionsById` / `sessionsByRefreshTokenHash`):
      one `Map<string, DocumentRecord>` plus derived lookups, so tests can inject their own
      repository instance and assert on it directly (as `login.test.ts` does with
      `sessionRepository.countByUserId`).

  - description: |
      `MalwareScanner` abstraction plus a stub default implementation, injected the same way
      `UserRepository`/`SessionRepository` are injected into `AuthService`.

      ```ts
      export interface MalwareScanner {
        scan(file: { buffer: Buffer; fileName: string }): Promise<"clean" | "threat">;
      }

      export class StubMalwareScanner implements MalwareScanner {
        async scan(): Promise<"clean" | "threat"> {
          return "clean";
        }
      }
      ```
    files:
      - src/documents/malwareScanner.ts
    rationale: |
      There is no real anti-malware engine wired into this repo (no dependency, no ADR, no
      credentials for a scanning vendor). Making the scanner an injected interface lets tests
      simulate both `"clean"` and `"threat"` outcomes deterministically (AC5–AC8) without a real
      scanning backend, while leaving a single seam (`StubMalwareScanner`) to swap in a real
      integration later.

  - description: |
      `DocumentService`: validates format/size, persists the record as `pending_scan`, kicks off
      the scan without blocking the response, and updates status when the scan settles. Also
      owns the two access-control checks (owner-only for providers, ready-only for admins).

      ```ts
      export const ACCEPTED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
      export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

      export class UnsupportedFileFormatError extends Error {
        constructor() {
          super("Only PDF, JPG, and PNG files are accepted");
        }
      }
      export class FileTooLargeError extends Error {
        constructor() {
          super(`File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB size limit`);
        }
      }
      export class DocumentAccessDeniedError extends Error {}

      export class DocumentService {
        constructor(private repository: DocumentRepository, private scanner: MalwareScanner) {}

        upload(providerId: string, fileName: string, contentType: string, content: Buffer, now: number = Date.now()): DocumentRecord {
          if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) throw new UnsupportedFileFormatError();
          const doc = this.repository.create(providerId, fileName, contentType, content, now);
          void this.scanner.scan({ buffer: content, fileName }).then((result) => {
            this.repository.updateStatus(doc.id, result === "clean" ? "ready" : "failed");
          });
          return doc;
        }

        listForProvider(providerId: string): DocumentRecord[] {
          return this.repository.listByProviderId(providerId);
        }

        listReviewQueue(): DocumentRecord[] {
          return this.repository.listReadyForReviewQueue();
        }

        getContentForProvider(documentId: string, requestingProviderId: string): DocumentRecord {
          const doc = this.repository.findById(documentId);
          if (!doc || doc.providerId !== requestingProviderId) throw new DocumentAccessDeniedError();
          return doc;
        }

        getContentForAdmin(documentId: string): DocumentRecord {
          const doc = this.repository.findById(documentId);
          if (!doc || doc.status !== "ready") throw new DocumentAccessDeniedError();
          return doc;
        }
      }
      ```
    files:
      - src/documents/documentService.ts
    rationale: |
      Mirrors `AuthService`'s shape (constructor-injected repositories, throw typed errors that
      the controller maps to status codes). The scan is fired with `void ...then(...)` instead of
      `await`ed so the HTTP response can return `pending_scan` immediately (AC1/AC2); size is
      enforced earlier during raw-body reading (see `httpUtils.ts` below), not re-checked here.

  - description: |
      Shared bearer-token authentication helper, extracted for reuse across the four new document
      handlers (upload/list/download/review-queue), following the same token parsing already
      inlined in `handleGetSession`.

      ```ts
      export function authenticateBearerToken(
        authorizationHeader: string | undefined,
        now: number = Date.now(),
      ): AccessTokenPayload | undefined {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
        if (!token) return undefined;
        return verifyAccessToken(token, now) ?? undefined;
      }
      ```
    files:
      - src/auth/authGuard.ts
    rationale: |
      `handleGetSession` in `authController.ts` inlines this same parsing once; the new document
      handlers need it four times, so it's worth factoring into one helper rather than
      duplicating it four times in new code. `authController.ts` itself is left untouched to keep
      this change scoped to the new feature.

  - description: |
      `documentController.ts`: request/response mapping for the four new endpoints, following the
      `ControllerResponse { status; body? }` pattern from `authController.ts`.

      ```ts
      export function handleUploadDocument(
        service: DocumentService,
        input: { authorizationHeader?: string; contentType?: string; fileName?: string; body: Buffer },
      ): ControllerResponse;

      export function handleListDocuments(service: DocumentService, authorizationHeader?: string): ControllerResponse;

      export function handleReviewQueue(service: DocumentService, authorizationHeader?: string): ControllerResponse;

      export function handleDownloadDocument(
        service: DocumentService,
        authorizationHeader: string | undefined,
        documentId: string,
      ): ControllerResponse & { fileBuffer?: Buffer; contentType?: string; fileName?: string };
      ```
    files:
      - src/documents/documentController.ts
    rationale: |
      Keeps HTTP concerns (status codes, header/body shaping, role checks) out of
      `DocumentService`, matching how `authController.ts` sits between `app.ts` and
      `AuthService`. `handleUploadDocument` requires role `"provider"`; `handleReviewQueue`
      requires role `"admin"`; both return 401 for a missing/invalid token and 403 for the wrong
      role, consistent with `handleGetSession`'s 401 for bad tokens.

  - description: |
      Generalize `PayloadTooLargeError` to accept a message, and add a raw (non-JSON) body reader
      with a caller-supplied byte cap, for streaming the uploaded file bytes.

      ```ts
      export class PayloadTooLargeError extends Error {
        constructor(message = "Request body too large") {
          super(message);
        }
      }

      export function readRawBody(req: IncomingMessage, maxBytes: number, tooLargeMessage?: string): Promise<Buffer>;
      ```
    files:
      - src/httpUtils.ts
    rationale: |
      `readJsonBody` is JSON-only and capped at 64 KB (`MAX_BODY_BYTES`), too small for a 10 MB
      file and the wrong shape for binary data. `readRawBody` reuses the same
      accumulate-then-reject-if-over-cap streaming pattern already proven in `readJsonBody`, so
      oversized uploads (AC4) are rejected while streaming rather than after fully buffering.
      The existing `new PayloadTooLargeError()` call site in `readJsonBody` keeps working
      unchanged since the new parameter is optional with the same default message.

  - description: |
      Wire the new routes and dependencies into `createApp`/`handleRequest`.

      ```ts
      POST   /documents               -> handleUploadDocument (raw body, Content-Type + X-File-Name headers)
      GET    /documents               -> handleListDocuments
      GET    /documents/:id/content   -> handleDownloadDocument (binary response, not sendJson)
      GET    /admin/documents         -> handleReviewQueue
      ```
    files:
      - src/app.ts
    rationale: |
      `POST /documents` must read a raw byte body (via `readRawBody`) instead of
      `readJsonBody`, so it needs its own branch before the existing
      `route !== "POST /auth/login" && ...` JSON-only gate. `GET /documents/:id/content` needs
      its own response path (raw bytes + `Content-Type`/`Content-Disposition` headers) instead of
      `sendJson`, matched with a small regex (`/^\/documents\/([^/]+)\/content$/`) since the
      existing router only does exact string matches on `${method} ${pathname}`.

  - description: |
      Add a second provider fixture user so AC10 (cross-provider access denial) has two distinct
      provider accounts to log in as.

      ```ts
      { id: "user-provider-2", username: "provider2", role: "provider" }
      ```
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      The current fixture list has exactly one `provider` user (`provider1`); testing that
      provider A cannot read provider B's document requires a second provider account with the
      same well-known `TEST_PASSWORD`.

  - description: |
      New HTTP-level test files, following the `login.test.ts` / `refresh.test.ts` /
      `logout.test.ts` convention: each file defines its own small local `login(baseUrl, username)`
      helper and exercises the real server via `startTestServer()` + `fetch`.
    files:
      - test/documentUpload.test.ts
      - test/documentScanning.test.ts
      - test/documentAccess.test.ts
    rationale: |
      Matches the existing test organization (one file per acceptance-criteria cluster) rather
      than one flat file, and keeps using real HTTP round-trips against the in-memory app instead
      of unit-testing the service in isolation, consistent with the rest of this repo's tests.

tests:
  - |
    AC1 (test/documentUpload.test.ts): a PDF under 10 MB is accepted and queued for scanning.
    ```ts
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/pdf", "X-File-Name": "license.pdf" },
      body: Buffer.alloc(1024, 1),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(documentRepository.findById(body.id)?.status, "pending_scan");
    ```
    Minimal code: `DocumentService.upload` + `POST /documents` route in `app.ts`.
  - |
    AC2 (test/documentUpload.test.ts): the uploaded document shows status `"pending scan"` via
    the documents list, before any scan has settled.
    ```ts
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${providerToken}` } });
    const { documents } = await listRes.json();
    assert.equal(documents[0].status, "pending scan");
    ```
    Minimal code: `handleListDocuments` mapping `toStatusLabel(doc.status)`.
  - |
    AC3 (test/documentUpload.test.ts): a non-PDF/JPG/PNG upload is rejected with the
    accepted-formats message.
    ```ts
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/msword", "X-File-Name": "resume.docx" },
      body: Buffer.from("not a real document"),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Only PDF, JPG, and PNG files are accepted");
    ```
    Minimal code: `ACCEPTED_CONTENT_TYPES` check + `UnsupportedFileFormatError` in `DocumentService.upload`.
  - |
    AC4 (test/documentUpload.test.ts): a file over 10 MB is rejected with the size-limit message.
    ```ts
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/pdf", "X-File-Name": "license.pdf" },
      body: oversized,
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /10 MB/);
    ```
    Minimal code: `readRawBody(req, MAX_DOCUMENT_SIZE_BYTES, ...)` rejecting mid-stream in `app.ts`.
  - |
    AC5 (test/documentScanning.test.ts): a clean scan result flips status to `ready`.
    ```ts
    let resolveScan: (r: "clean" | "threat") => void;
    const scanPromise = new Promise<"clean" | "threat">((r) => { resolveScan = r; });
    const scanner: MalwareScanner = { scan: () => scanPromise };
    // upload, then:
    resolveScan!("clean");
    await scanPromise;
    await Promise.resolve(); // let DocumentService's chained .then run (attached before this one)
    assert.equal(documentRepository.findById(id)?.status, "ready");
    ```
    Minimal code: `.then` callback in `DocumentService.upload` calling `repository.updateStatus`.
  - |
    AC6 (test/documentScanning.test.ts): once ready, the document appears in the admin review
    queue.
    ```ts
    resolveScan!("clean");
    await scanPromise;
    await Promise.resolve();
    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const { documents } = await queueRes.json();
    assert.equal(documents.some((d: { id: string }) => d.id === id), true);
    ```
    Minimal code: `DocumentRepository.listReadyForReviewQueue` + `GET /admin/documents` route.
  - |
    AC7 (test/documentScanning.test.ts): a detected threat sets the exact failed-status message.
    ```ts
    resolveScan!("threat");
    await scanPromise;
    await Promise.resolve();
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${providerToken}` } });
    const { documents } = await listRes.json();
    assert.equal(documents[0].status, "failed — file could not be verified");
    ```
    Minimal code: `toStatusLabel("failed")` returning the exact wording.
  - |
    AC8 (test/documentScanning.test.ts): a failed document never appears in the review queue and
    is never downloadable by an admin.
    ```ts
    resolveScan!("threat");
    await scanPromise;
    await Promise.resolve();
    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const { documents } = await queueRes.json();
    assert.equal(documents.some((d: { id: string }) => d.id === id), false);

    const downloadRes = await fetch(`${server.baseUrl}/documents/${id}/content`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(downloadRes.status, 404);
    ```
    Minimal code: `DocumentService.getContentForAdmin` throwing `DocumentAccessDeniedError` unless `status === "ready"`.
  - |
    AC9 (test/documentAccess.test.ts): the provider's document list shows file name, upload date,
    and current status for each document.
    ```ts
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${providerToken}` } });
    const { documents } = await listRes.json();
    assert.equal(documents[0].file_name, "license.pdf");
    assert.equal(typeof documents[0].uploaded_at, "string");
    assert.equal(documents[0].status, "pending scan");
    ```
    Minimal code: `handleListDocuments` response shape `{ documents: [{ id, file_name, uploaded_at, status }] }`.
  - |
    AC10 (test/documentAccess.test.ts): a provider cannot view or download a different provider's
    document.
    ```ts
    const uploaderToken = await login(server.baseUrl, "provider1");
    const otherProviderToken = await login(server.baseUrl, "provider2");
    const { id } = await (await uploadPdf(server.baseUrl, uploaderToken)).json();

    const res = await fetch(`${server.baseUrl}/documents/${id}/content`, { headers: { Authorization: `Bearer ${otherProviderToken}` } });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
    ```
    Minimal code: `DocumentService.getContentForProvider` throwing `DocumentAccessDeniedError`
    unless `doc.providerId === requestingProviderId`, mapped to 404 by `handleDownloadDocument`.

assumptions_or_open_questions:
  - |
    No multipart/form-data parser exists in this repo (`package.json` has empty `dependencies`).
    This plan uploads the raw file body directly (`Content-Type` header = file MIME type,
    `X-File-Name` header = original filename) rather than `multipart/form-data`, to avoid adding a
    new dependency. Please confirm this is acceptable, or say if the real client already sends
    multipart and a parser dependency should be added instead.
  - |
    "Queued for malware scanning" (AC1) is implemented as an in-process asynchronous step via the
    injectable `MalwareScanner`, not a separate message queue/worker service — there is no
    queue/broker infrastructure anywhere in this repo today.
  - |
    No real anti-malware engine is integrated. `StubMalwareScanner` always resolves `"clean"` as a
    placeholder so the pipeline is wired end-to-end and independently testable via dependency
    injection; wiring an actual scanning backend (e.g. ClamAV, a cloud AV API) is out of scope
    here and would be a follow-up story.
  - |
    Uploaded file bytes are stored in-memory only (inside `DocumentRecord`), consistent with this
    service's existing all-in-memory state (no DB, no blob storage layer exists yet).
  - |
    Only role `"provider"` may upload/list documents, and only role `"admin"` may view the review
    queue. This isn't stated verbatim by any single AC but is necessary to satisfy AC10's
    cross-provider isolation and the story's "admin access" framing.
  - |
    Cross-provider access (AC10) and access to a non-ready document by an admin (AC8) both return
    404, not 403, so the response doesn't confirm the document's existence to an unauthorized
    caller.
  - |
    If an upload is both the wrong format and over 10 MB, the size-limit rejection wins, since
    size is enforced while the body is still streaming (before any format check runs). No AC
    specifies the precedence for this combined case.
  - |
    `X-File-Name` is trusted as opaque display metadata only (never used as a filesystem path),
    so no path-traversal sanitization is needed.
  - |
    No cap is placed on how many documents a single provider may upload; none of the ACs mention
    a limit.

package_dependencies: []

notes: |
  This mirrors the QAM-MANOJ-STORY-007 login/session work: no framework, no persistence layer,
  dependency injection through `AppDependencies`/`createApp`, and `node:test` HTTP-level tests via
  `startTestServer()`. The scan-completion tests (AC5–AC8) rely on a deterministic ordering trick:
  the test's fake `MalwareScanner.scan()` returns one shared promise; `DocumentService.upload`
  attaches its `.then` to that promise first (during the upload request), and the test attaches
  its own `await` afterward — Node's microtask queue runs `.then` callbacks in attachment order,
  so by the time the test's `await scanPromise; await Promise.resolve();` resolves, the service's
  status update has already been applied to the repository. This avoids real timers/sleeps and
  keeps the tests fast and non-flaky.

  ```mermaid
  flowchart TD
    Client -->|POST /documents, GET /documents, GET /documents/:id/content, GET /admin/documents| AppTS[src/app.ts]
    AppTS -->|raw body read + size cap| HttpUtils[src/httpUtils.ts]
    AppTS -->|dispatch| DocController[src/documents/documentController.ts]
    DocController -->|bearer token parsing| AuthGuard[src/auth/authGuard.ts]
    AuthGuard --> TokenService[src/auth/tokenService.ts]
    DocController --> DocService[src/documents/documentService.ts]
    DocService --> DocRepository[src/documents/documentRepository.ts]
    DocService --> Scanner[src/documents/malwareScanner.ts]
    DocRepository --> DocModel[src/documents/documentModel.ts]

    classDef touched fill:#f96,color:#000
    class AppTS,HttpUtils,DocController,AuthGuard,DocService,DocRepository,Scanner,DocModel touched
  ```
