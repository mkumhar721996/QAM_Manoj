summary: |
  Add a document upload feature for logged-in providers: accept PDF/JPG/PNG files up to 10 MB,
  store them with a 'pending' scan status, run them through a pluggable malware scanner, and
  expose the resulting status ('pending scan' / 'ready' / "failed — file could not be verified")
  to the uploading provider. Only files that scan clean become visible to admins in a review
  queue; failed/pending files are never exposed there or to other providers. This introduces a
  new `documents` module (model, in-memory repository, service, controller) that plugs into the
  existing hand-rolled `node:http` app the same way `auth`/`sessions`/`users` already do — no
  web framework, no ORM, in-memory `Map`-backed repositories, and dependency injection through
  `AppDependencies` for testability, matching `SessionRepository`/`UserRepository` conventions.
  There is no "application" entity in the codebase yet, so uploaded documents are tied directly
  to the authenticated provider's user id.

scope:
  - description: |
      Add the `Document` domain type and an in-memory `DocumentRepository`, mirroring
      `SessionRepository`'s shape (a `Map` keyed by id, plus lookup helpers).

      ```ts
      // src/documents/documentModel.ts
      export type ScanStatus = "pending" | "ready" | "failed";

      export interface Document {
        id: string;
        providerId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        content: Buffer;
        status: ScanStatus;
        createdAt: number;
      }
      ```

      ```ts
      // src/documents/documentRepository.ts (key methods)
      create(input: {
        providerId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        content: Buffer;
      }, now: number = Date.now()): Document;
      findById(id: string): Document | undefined;
      listByProviderId(providerId: string): Document[];
      listReadyForReview(): Document[]; // status === "ready" only
      updateStatus(id: string, status: ScanStatus): void;
      ```
    files:
      - src/documents/documentModel.ts
      - src/documents/documentRepository.ts
    rationale: |
      Matches the existing repository pattern (`SessionRepository`, `UserRepository`): plain
      in-memory `Map`, constructor-injectable for tests, no persistence layer since none exists
      anywhere else in the codebase yet.

  - description: |
      Add a pluggable `MalwareScanner` interface plus a default stub implementation, since no
      real AV vendor/engine is specified anywhere in the story or codebase. The stub flags the
      standard EICAR test string as a threat and everything else as clean — a widely used,
      deterministic convention for exercising AV integration points without a real engine.

      ```ts
      // src/documents/malwareScanner.ts
      export type ScanResult = "clean" | "threat";

      export interface MalwareScanner {
        scan(content: Buffer): Promise<ScanResult>;
      }

      const EICAR_SIGNATURE =
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

      export class EicarMalwareScanner implements MalwareScanner {
        async scan(content: Buffer): Promise<ScanResult> {
          return content.includes(EICAR_SIGNATURE) ? "threat" : "clean";
        }
      }
      ```
    files:
      - src/documents/malwareScanner.ts
    rationale: |
      Keeps "mandatory malware scanning" testable and swappable (constructor injection via
      `AppDependencies`, same as `sessionRepository`/`userRepository`) without hard-coding a
      specific third-party AV product that was never named in the story.

  - description: |
      Add `DocumentService`, the orchestration layer: validates format/size, persists the
      document as 'pending', fires off an (unawaited) scan, and updates status when the scan
      resolves. Also owns the access-control rules for AC6/AC8/AC10.

      ```ts
      // src/documents/documentService.ts
      export const ACCEPTED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
      export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

      export class UnsupportedFileFormatError extends Error {
        constructor() { super("Unsupported file format. Accepted formats: PDF, JPG, PNG"); }
      }
      export class FileTooLargeError extends Error {
        constructor() { super("File exceeds the maximum size of 10 MB"); }
      }
      export class DocumentAccessDeniedError extends Error {}

      export class DocumentService {
        constructor(
          private documentRepository: DocumentRepository,
          private malwareScanner: MalwareScanner,
        ) {}

        upload(providerId: string, fileName: string, mimeType: string, content: Buffer): Document {
          if (!ACCEPTED_MIME_TYPES.has(mimeType)) throw new UnsupportedFileFormatError();
          if (content.byteLength > MAX_FILE_SIZE_BYTES) throw new FileTooLargeError();

          const document = this.documentRepository.create({
            providerId, fileName, mimeType, sizeBytes: content.byteLength, content,
          });
          void this.runScan(document.id, content);
          return document;
        }

        private async runScan(documentId: string, content: Buffer): Promise<void> {
          const result = await this.malwareScanner.scan(content).catch<ScanResult>(() => "threat");
          this.documentRepository.updateStatus(documentId, result === "clean" ? "ready" : "failed");
        }

        listForProvider(providerId: string): Document[] {
          return this.documentRepository.listByProviderId(providerId);
        }

        listReviewQueue(): Document[] {
          return this.documentRepository.listReadyForReview();
        }

        getForDownload(documentId: string, requesterId: string, requesterRole: Role): Document {
          const document = this.documentRepository.findById(documentId);
          const isOwner = document?.providerId === requesterId;
          const adminMayView = requesterRole === "admin" && document?.status === "ready";
          if (!document || !(isOwner || adminMayView)) throw new DocumentAccessDeniedError();
          return document;
        }
      }
      ```
    files:
      - src/documents/documentService.ts
    rationale: |
      Centralizes validation and the AC6/AC8/AC10 access rules in one place so the HTTP
      controller stays a thin translation layer, matching how `AuthService` (not
      `authController`) owns the login/refresh/logout business rules today.

  - description: |
      Add binary body reading (with an early size cutoff to avoid buffering unbounded uploads
      in memory) and a raw-bytes response helper to `httpUtils.ts`, reusing the same
      accumulate-until-limit shape as the existing `readJsonBody`.

      ```ts
      // src/httpUtils.ts (additions)
      export function readBinaryBody(
        req: IncomingMessage,
        maxBytes: number,
        onTooLarge: () => Error,
      ): Promise<Buffer> { /* same accumulate-then-reject shape as readJsonBody */ }

      export function sendBinary(res: ServerResponse, status: number, contentType: string, content: Buffer): void {
        res.writeHead(status, { "Content-Type": contentType, "Content-Length": content.length });
        res.end(content);
      }
      ```

      Add a shared `extractBearerToken` helper to `tokenService.ts` (currently the `Bearer `
      parsing is inlined once in `handleGetSession`) so both `authController` and the new
      `documentController` share one implementation instead of duplicating the substring logic.

      ```ts
      // src/auth/tokenService.ts (addition)
      export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
        return authorizationHeader?.startsWith("Bearer ")
          ? authorizationHeader.slice("Bearer ".length)
          : undefined;
      }
      ```

      Add `documentController.ts` with `handleUploadDocument`, `handleListDocuments`,
      `handleDownloadDocument`, `handleReviewQueue`, each taking the already-authenticated
      `{ userId, role }` plus the parsed request data, returning `{ status, body }` (or, for
      downloads, `{ status, contentType?, body: Buffer | Record<string, unknown> }`) exactly
      like the existing `ControllerResponse` shape in `authController.ts`.

      Wire four routes into `app.ts`'s `handleRequest`: `POST /documents`, `GET /documents`,
      `GET /documents/:id/content` (matched via
      `url.pathname.match(/^\/documents\/([^/]+)\/content$/)`), and `GET /admin/documents`. Each
      route first resolves the bearer token via `verifyAccessToken` + `extractBearerToken` and
      returns 401 if missing/invalid, mirroring the existing inline check in
      `handleGetSession`. Extend `AppDependencies` with optional `documentRepository` and
      `malwareScanner`, defaulting to `new DocumentRepository()` / `new EicarMalwareScanner()`,
      and construct a `DocumentService` alongside the existing `AuthService` construction.
    files:
      - src/httpUtils.ts
      - src/auth/tokenService.ts
      - src/auth/authController.ts
      - src/documents/documentController.ts
      - src/app.ts
    rationale: |
      Keeps the same hand-rolled `node:http` style used throughout (no Express/Fastify, no
      multipart-parsing dependency): the upload request is sent as a raw binary body with the
      MIME type in `Content-Type` and the filename in an `X-File-Name` header, read via a
      size-bounded reader analogous to `readJsonBody`/`PayloadTooLargeError`. Refactoring
      `handleGetSession` to use the new `extractBearerToken` is a two-line, low-risk dedup since
      the new document routes need the identical parsing.

  - description: |
      Add a second provider test user (`provider2`) to the shared test fixtures so AC10
      (cross-provider access denial) has two distinct real providers to test against.
    files:
      - src/users/fixtures/testUsers.ts
    rationale: |
      The current fixture only seeds one `provider` user; AC10 is meaningless without a second
      provider identity to attempt cross-access with.

  - description: |
      Add a `ManualMalwareScanner` test double that lets a test control exactly when a queued
      scan resolves and with what result, so 'pending' (AC1/AC2), 'ready' (AC5/AC6), and
      'failed' (AC7/AC8) states can each be asserted deterministically instead of racing a real
      async scan.

      ```ts
      // test/support/manualMalwareScanner.ts
      export class ManualMalwareScanner implements MalwareScanner {
        private resolvers: Array<(result: ScanResult) => void> = [];

        scan(_content: Buffer): Promise<ScanResult> {
          return new Promise((resolve) => { this.resolvers.push(resolve); });
        }

        resolveNext(result: ScanResult): void {
          const resolve = this.resolvers.shift();
          if (!resolve) throw new Error("no pending scan to resolve");
          resolve(result);
        }
      }
      ```
    files:
      - test/support/manualMalwareScanner.ts
    rationale: |
      `DocumentService.upload` fires the scan without awaiting it (so the HTTP response can
      return 'pending scan' immediately, per AC2). Tests need a way to hold that scan open and
      then resolve it on demand to observe the status transition.

  - description: |
      Add the test files covering all 10 acceptance criteria against a real HTTP server via
      `startTestServer`, following the existing `login.test.ts`/`refresh.test.ts` pattern
      (`node:test` + `node:assert/strict` + `fetch`).
    files:
      - test/documentUpload.test.ts
      - test/documentScan.test.ts
      - test/documentAccess.test.ts
    rationale: |
      Splits by concern the same way the auth suite is split across
      `login.test.ts`/`refresh.test.ts`/`logout.test.ts`: upload validation (AC1-4), async scan
      outcomes (AC5-8), and provider-facing listing/isolation (AC9-10).

tests:
  - |
    AC1 — a PDF under 10 MB is accepted and queued for scanning
    (test/documentUpload.test.ts):
    ```ts
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", "X-File-Name": "license.pdf" },
      body: Buffer.alloc(1024, 1),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, "pending scan");
    ```
    Minimal code: `DocumentService.upload` validates then calls `documentRepository.create`
    (status defaults to `"pending"`) and fires `runScan` without awaiting it;
    `handleUploadDocument` returns 201 with the mapped display status.
  - |
    AC2 — the uploaded file shows as 'pending scan' in the provider's document list before the
    scan completes (test/documentUpload.test.ts):
    ```ts
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${token}` } });
    const listBody = (await listRes.json()) as { documents: Array<{ status: string }> };
    assert.equal(listBody.documents[0].status, "pending scan");
    ```
    Minimal code: `handleListDocuments` maps each `Document.status` ("pending"|"ready"|"failed")
    to its display string ("pending scan"|"ready"|"failed — file could not be verified").
  - |
    AC3 — a non-PDF/JPG/PNG upload is rejected with an accepted-formats error
    (test/documentUpload.test.ts):
    ```ts
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain", "X-File-Name": "notes.txt" },
      body: Buffer.from("hello"),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Unsupported file format. Accepted formats: PDF, JPG, PNG");
    ```
    Minimal code: `DocumentService.upload` throws `UnsupportedFileFormatError` when
    `mimeType` is not in `ACCEPTED_MIME_TYPES`; `handleUploadDocument` catches it and returns 400.
  - |
    AC4 — a file over 10 MB is rejected with a size-limit error (test/documentUpload.test.ts):
    ```ts
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    const res = await fetch(`${server.baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", "X-File-Name": "big.pdf" },
      body: oversized,
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "File exceeds the maximum size of 10 MB");
    ```
    Minimal code: `readBinaryBody` in `app.ts`'s `POST /documents` handler is called with
    `MAX_FILE_SIZE_BYTES` and `() => new FileTooLargeError()`, so oversized bodies are rejected
    while still streaming (no unbounded buffering); the route catches `FileTooLargeError` and
    returns 413.
  - |
    AC5 — a clean scan result updates the provider-visible status to 'ready'
    (test/documentScan.test.ts):
    ```ts
    scanner.resolveNext("clean");
    await flushMicrotasks(); // await new Promise((resolve) => setImmediate(resolve));
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await listRes.json()) as { documents: Array<{ status: string }> };
    assert.equal(body.documents[0].status, "ready");
    ```
    Minimal code: `DocumentService.runScan` awaits the injected `ManualMalwareScanner` and calls
    `documentRepository.updateStatus(id, "ready")` on a `"clean"` result.
  - |
    AC6 — a document with a clean scan becomes visible to admins in the review queue
    (test/documentScan.test.ts):
    ```ts
    scanner.resolveNext("clean");
    await flushMicrotasks();
    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = (await queueRes.json()) as { documents: Array<{ id: string }> };
    assert.equal(body.documents.some((d) => d.id === uploadedId), true);
    ```
    Minimal code: `DocumentRepository.listReadyForReview` filters `status === "ready"`;
    `handleReviewQueue` requires `role === "admin"` and returns that list.
  - |
    AC7 — a threat scan result shows as 'failed — file could not be verified' to the provider
    (test/documentScan.test.ts):
    ```ts
    scanner.resolveNext("threat");
    await flushMicrotasks();
    const listRes = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await listRes.json()) as { documents: Array<{ status: string }> };
    assert.equal(body.documents[0].status, "failed — file could not be verified");
    ```
    Minimal code: `runScan` calls `updateStatus(id, "failed")` on a `"threat"` result; the
    controller's display-status map renders `"failed"` as
    `"failed — file could not be verified"`.
  - |
    AC8 — a failed-scan document never appears in the review queue and is never downloadable by
    an admin (test/documentScan.test.ts):
    ```ts
    scanner.resolveNext("threat");
    await flushMicrotasks();
    const queueRes = await fetch(`${server.baseUrl}/admin/documents`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const queueBody = (await queueRes.json()) as { documents: Array<{ id: string }> };
    assert.equal(queueBody.documents.length, 0);

    const downloadRes = await fetch(`${server.baseUrl}/documents/${documentId}/content`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(downloadRes.status, 404);
    ```
    Minimal code: `listReadyForReview` naturally excludes `"failed"` documents;
    `DocumentService.getForDownload` only allows an admin through when
    `document.status === "ready"`, otherwise throws `DocumentAccessDeniedError` (mapped to 404).
  - |
    AC9 — a provider's document list shows file name, upload date, and status for each document
    (test/documentAccess.test.ts):
    ```ts
    const res = await fetch(`${server.baseUrl}/documents`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { documents: Array<{ file_name: string; uploaded_at: number; status: string }> };
    assert.equal(body.documents[0].file_name, "license.pdf");
    assert.equal(typeof body.documents[0].uploaded_at, "number");
    assert.equal(body.documents[0].status, "pending scan");
    ```
    Minimal code: `handleListDocuments` maps each `Document` to
    `{ id, file_name: d.fileName, uploaded_at: d.createdAt, status: <mapped> }`.
  - |
    AC10 — a provider cannot view or download another provider's document, and no document
    content is returned (test/documentAccess.test.ts):
    ```ts
    const uploadRes = await upload(server.baseUrl, tokenA, "license.pdf", "application/pdf", Buffer.from("secret-bytes"));
    const documentId = (await uploadRes.json()).id;

    const res = await fetch(`${server.baseUrl}/documents/${documentId}/content`, { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.equal(res.status, 404);
    const raw = Buffer.from(await res.arrayBuffer());
    assert.equal(raw.includes("secret-bytes"), false);
    ```
    Minimal code: `DocumentService.getForDownload` throws `DocumentAccessDeniedError` when
    `requesterId !== document.providerId` and `requesterRole !== "admin"`;
    `handleDownloadDocument` maps that to a 404 JSON error body (never the raw `Buffer`), so no
    content leaks and existence of the document is not confirmed to the requester either.

assumptions_or_open_questions:
  - "There is no separate "Application" entity anywhere in the codebase yet (only `User` with
    role `provider`). Documents are modeled as belonging directly to the uploading provider's
    user id rather than to a distinct application id. If a future story introduces a formal
    Application entity, `Document.providerId` may need to become `applicationId`."
  - "No malware-scanning vendor/engine is specified by the story or any ADR. This plan
    implements a pluggable `MalwareScanner` interface with a default EICAR-signature-based stub
    (a standard, safe way to exercise 'threat detected' behavior without a real AV product).
    Wiring a real scanning engine (ClamAV, a cloud API, etc.) is explicitly out of scope for
    this plan and would be a follow-up story."
  - "'Queued for malware scanning' is implemented as an in-process, unawaited async call — there
    is no message queue or worker infrastructure anywhere in this codebase today. This keeps the
    behavior observable/testable within the existing architecture; swapping in a real queue
    later would only require changing `DocumentService.runScan`'s wiring, not the public API."
  - "Upload transport is a raw binary POST body (Content-Type = the file's MIME type, filename
    in an `X-File-Name` header) rather than `multipart/form-data`, to stay consistent with the
    existing hand-rolled body-reading style (`readJsonBody`) and avoid introducing a new
    multipart-parsing dependency. Assumes whatever client calls this API can be adapted to that
    contract."
  - "Document content is stored in memory only (`Buffer` on the `Document` record), matching the
    existing in-memory `UserRepository`/`SessionRepository` — there is no durable storage
    anywhere in this codebase yet. Uploaded files are lost on restart; acceptable for this
    codebase's current maturity but should be revisited before any real deployment."
  - "GET /documents/:id/content returns 404 (not 403) for both a nonexistent document and a
    forbidden one, so a requester can't distinguish 'doesn't exist' from 'exists but isn't
    yours' — a deliberate anti-enumeration choice, flagged here in case the reviewer wants an
    explicit 403 instead."
  - "Only a user with role `provider` may call POST /documents or GET /documents; only role
    `admin` may call GET /admin/documents. This mirrors the three roles already defined in
    `src/users/fixtures/testUsers.ts` (`customer`, `provider`, `admin`)."

package_dependencies: []

notes: |
  No new third-party dependencies are introduced — `package.json` currently has zero runtime
  dependencies, and this plan keeps it that way by hand-rolling binary body reading (mirroring
  `readJsonBody`) instead of adding a multipart-parsing library.

  ```mermaid
  flowchart TD
    client[HTTP client]
    app[src/app.ts\nhandleRequest routing]
    authCtrl[src/auth/authController.ts]
    tokenSvc[src/auth/tokenService.ts\n+ extractBearerToken]
    docCtrl[src/documents/documentController.ts]
    docSvc[src/documents/documentService.ts]
    docRepo[src/documents/documentRepository.ts]
    scanner[src/documents/malwareScanner.ts]
    httpUtils[src/httpUtils.ts\n+ readBinaryBody/sendBinary]
    testUsers[src/users/fixtures/testUsers.ts\n+ provider2]

    client --> app
    app -->|"POST /documents, GET /documents,\nGET /documents/:id/content,\nGET /admin/documents"| docCtrl
    app -->|existing auth routes, unchanged| authCtrl
    app -->|"reads raw body / writes file bytes"| httpUtils
    docCtrl -->|"401 if missing/invalid token"| tokenSvc
    authCtrl -->|"refactored to share parsing"| tokenSvc
    docCtrl --> docSvc
    docSvc --> docRepo
    docSvc -->|"fire-and-forget scan"| scanner
    testUsers -.->|"used by new cross-provider test (AC10)"| docCtrl

    classDef touched fill:#f96,color:#000
    class app,docCtrl,docSvc,docRepo,scanner,httpUtils,tokenSvc,authCtrl,testUsers touched
  ```

  `authController.ts` is touched only for the two-line `extractBearerToken` dedup — its existing
  login/refresh/logout behavior is unchanged, and no existing test in `login.test.ts`,
  `refresh.test.ts`, or `logout.test.ts` should need modification.
