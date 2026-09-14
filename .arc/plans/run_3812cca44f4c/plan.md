summary: |
  This repo (`qam-manoj-story-007-login-session-management`) currently implements ONLY login/session
  management: a plain Node `http` server (`src/app.ts`, `src/server.ts`) with `auth/`, `sessions/`,
  `users/` modules following a repository -> service -> controller layering, in-memory `Map`-backed
  repositories (no DB), snake_case JSON wire format, and `node:test` + raw `fetch` against an
  ephemeral `startTestServer()` for tests. There is no menu, pizza, or cart domain anywhere in the
  codebase, and no frontend/UI layer at all - it is a headless HTTP API. This plan adds a new
  Pizza Customisation feature as two new backend modules, `src/pizzas/` (a static in-memory pizza
  catalog: sizes, crusts, toppings) and `src/cart/` (cart repository/service/controller), wired into
  `src/app.ts` with new routes, and reuses the existing JWT access-token auth (`tokenService.ts`) to
  scope a cart to the authenticated customer - mirroring the exact conventions already used for
  auth/session. Each acceptance criterion is translated into an HTTP-API-observable behaviour (since
  there is no "screen" in this codebase) and driven test-first.
scope:
  - description: |
      Write the failing acceptance tests first, covering all 4 ACs against the not-yet-existing
      `/pizzas/:id`, `POST /cart/items`, and `GET /cart` routes. These must fail (404/import errors)
      before any implementation exists.
    files:
      - "test/cartCustomisation.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production code,
      matching the existing `test/login.test.ts` / `test/refresh.test.ts` style (raw `fetch` against
      `startTestServer()`, snake_case JSON assertions).
  - description: |
      Add a static in-memory pizza catalog fixture and a `PizzaRepository`, modeled directly on
      `src/users/fixtures/testUsers.ts` + `src/users/userRepository.ts`.

      ```ts
      // src/pizzas/fixtures/pizzaCatalog.ts
      export interface PizzaOption { id: string; name: string; }
      export interface Pizza {
        id: string;
        name: string;
        sizes: PizzaOption[];
        crusts: PizzaOption[];
        toppings: PizzaOption[];
      }
      export const testPizzas: Pizza[] = [
        {
          id: "pizza-margherita",
          name: "Margherita",
          sizes: [
            { id: "size-small", name: "Small" },
            { id: "size-medium", name: "Medium" },
            { id: "size-large", name: "Large" },
          ],
          crusts: [
            { id: "crust-thin", name: "Thin" },
            { id: "crust-thick", name: "Thick" },
            { id: "crust-stuffed", name: "Stuffed" },
          ],
          toppings: [
            { id: "topping-mushroom", name: "Mushroom" },
            { id: "topping-olives", name: "Olives" },
            { id: "topping-pepperoni", name: "Pepperoni" },
          ],
        },
      ];
      ```

      ```ts
      // src/pizzas/pizzaRepository.ts
      export class PizzaRepository {
        private pizzasById: Map<string, Pizza>;
        constructor(pizzas: Pizza[] = testPizzas) {
          this.pizzasById = new Map(pizzas.map((p) => [p.id, p]));
        }
        findById(pizzaId: string): Pizza | undefined {
          return this.pizzasById.get(pizzaId);
        }
      }
      ```
    files:
      - "src/pizzas/fixtures/pizzaCatalog.ts"
      - "src/pizzas/pizzaRepository.ts"
    rationale: |
      AC1 requires the customer to be able to choose "one size, one crust type, and one or more
      toppings" - this is the source of truth for which options are valid, used both to render
      choices (`GET /pizzas/:id`) and to validate a submitted configuration (`POST /cart/items`).
  - description: |
      Add the cart domain model and an in-memory `CartRepository`, modeled on
      `src/sessions/sessionModel.ts` + `src/sessions/sessionRepository.ts`.

      ```ts
      // src/cart/cartModel.ts
      export interface PizzaConfigurationInput {
        pizzaId: string;
        size: string;
        crust: string;
        toppings: string[];
        quantity: number;
        specialInstructions?: string;
      }
      export interface CartItem extends PizzaConfigurationInput {
        id: string;
        customerId: string;
        addedAt: number;
      }
      ```

      ```ts
      // src/cart/cartRepository.ts
      export class CartRepository {
        private itemsByCustomerId: Map<string, CartItem[]> = new Map();
        addItem(item: CartItem): void {
          const items = this.itemsByCustomerId.get(item.customerId) ?? [];
          items.push(item);
          this.itemsByCustomerId.set(item.customerId, items);
        }
        getItemsByCustomerId(customerId: string): CartItem[] {
          return this.itemsByCustomerId.get(customerId) ?? [];
        }
      }
      ```
    files:
      - "src/cart/cartModel.ts"
      - "src/cart/cartRepository.ts"
    rationale: |
      AC4 requires "the cart contains an entry reflecting exactly that configuration" - a
      per-customer in-memory store (matching the existing no-DB pattern) is the minimal way to make
      that assertion checkable via `GET /cart`.
  - description: |
      Add `CartService` with the validation/business rules for AC1-AC4.

      ```ts
      // src/cart/cartService.ts
      export class PizzaNotFoundError extends Error {}
      export class InvalidCustomisationError extends Error {}

      export class CartService {
        constructor(
          private pizzaRepository: PizzaRepository,
          private cartRepository: CartRepository,
        ) {}

        addPizzaToCart(customerId: string, input: PizzaConfigurationInput, now: number = Date.now()): CartItem {
          const pizza = this.pizzaRepository.findById(input.pizzaId);
          if (!pizza) throw new PizzaNotFoundError(`No pizza found with id ${input.pizzaId}`);
          if (!pizza.sizes.some((s) => s.id === input.size)) {
            throw new InvalidCustomisationError("size must be one of the pizza's available sizes");
          }
          if (!pizza.crusts.some((c) => c.id === input.crust)) {
            throw new InvalidCustomisationError("crust must be one of the pizza's available crusts");
          }
          if (input.toppings.length === 0) {
            throw new InvalidCustomisationError("at least one topping must be selected");
          }
          if (input.toppings.some((t) => !pizza.toppings.some((pt) => pt.id === t))) {
            throw new InvalidCustomisationError("toppings must be selected from the pizza's available toppings");
          }
          if (!Number.isInteger(input.quantity) || input.quantity < 1) {
            throw new InvalidCustomisationError("quantity must be a positive integer");
          }
          const item: CartItem = { ...input, id: crypto.randomUUID(), customerId, addedAt: now };
          this.cartRepository.addItem(item);
          return item;
        }

        getCart(customerId: string): CartItem[] {
          return this.cartRepository.getItemsByCustomerId(customerId);
        }
      }
      ```
    files:
      - "src/cart/cartService.ts"
    rationale: |
      Centralises the "exactly one size, one crust, one-or-more toppings, positive-integer
      quantity" rule from AC1/AC2 in one place, mirroring how `AuthService` centralises
      login/refresh/logout rules rather than spreading validation across the controller.
  - description: |
      Add `cartController.ts` with HTTP handlers, reusing `verifyAccessToken` from
      `src/auth/tokenService.ts` (same Bearer-token extraction as `handleGetSession`) to identify the
      customer who owns the cart, and `asRecord` from `httpUtils.ts` for body parsing.

      ```ts
      // src/cart/cartController.ts
      export function handleGetPizza(pizzaRepository: PizzaRepository, pizzaId: string): ControllerResponse {
        const pizza = pizzaRepository.findById(pizzaId);
        if (!pizza) return { status: 404, body: { error: "pizza not found" } };
        return { status: 200, body: { id: pizza.id, name: pizza.name, sizes: pizza.sizes, crusts: pizza.crusts, toppings: pizza.toppings } };
      }

      export function handleAddToCart(
        cartService: CartService,
        authorizationHeader: string | undefined,
        requestBody: unknown,
      ): ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        const payload = token ? verifyAccessToken(token) : null;
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };

        const { pizza_id: pizzaId, size, crust, toppings, quantity, special_instructions: specialInstructions } = asRecord(requestBody);
        if (
          typeof pizzaId !== "string" ||
          typeof size !== "string" ||
          typeof crust !== "string" ||
          !Array.isArray(toppings) ||
          !toppings.every((t) => typeof t === "string") ||
          typeof quantity !== "number" ||
          (specialInstructions !== undefined && typeof specialInstructions !== "string")
        ) {
          return { status: 400, body: { error: "invalid pizza configuration" } };
        }

        try {
          const item = cartService.addPizzaToCart(payload.userId, { pizzaId, size, crust, toppings, quantity, specialInstructions });
          return {
            status: 201,
            body: {
              id: item.id, pizza_id: item.pizzaId, size: item.size, crust: item.crust,
              toppings: item.toppings, quantity: item.quantity, special_instructions: item.specialInstructions,
            },
          };
        } catch (err) {
          if (err instanceof PizzaNotFoundError) return { status: 404, body: { error: err.message } };
          if (err instanceof InvalidCustomisationError) return { status: 400, body: { error: err.message } };
          throw err;
        }
      }

      export function handleGetCart(cartService: CartService, authorizationHeader: string | undefined): ControllerResponse {
        const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
        const payload = token ? verifyAccessToken(token) : null;
        if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };

        const items = cartService.getCart(payload.userId).map((item) => ({
          id: item.id, pizza_id: item.pizzaId, size: item.size, crust: item.crust,
          toppings: item.toppings, quantity: item.quantity, special_instructions: item.specialInstructions,
        }));
        return { status: 200, body: { items } };
      }
      ```
    files:
      - "src/cart/cartController.ts"
    rationale: |
      Keeps the HTTP-shape concerns (snake_case body, status codes, Bearer-token parsing) in the
      controller layer only, exactly like `authController.ts` does for login/refresh/logout, so
      `CartService` stays framework/HTTP-agnostic and unit-testable on its own if needed later.
  - description: |
      Wire the new routes into `src/app.ts`: instantiate `PizzaRepository`/`CartRepository`/`CartService`,
      extend `AppDependencies` so tests can inject repositories (matching how `userRepository`/
      `sessionRepository` are already injectable), and add route matching for `GET /pizzas/:id`,
      `POST /cart/items`, `GET /cart`.

      ```ts
      export interface AppDependencies {
        userRepository?: UserRepository;
        sessionRepository?: SessionRepository;
        pizzaRepository?: PizzaRepository;
        cartRepository?: CartRepository;
      }
      ```

      Routing addition inside `handleRequest` (path-param route, unlike the existing exact-string
      routes, since `/pizzas/:id` needs a segment match):

      ```ts
      const pizzaMatch = url.pathname.match(/^\/pizzas\/([^/]+)$/);
      if (method === "GET" && pizzaMatch) {
        const result = handleGetPizza(pizzaRepository, pizzaMatch[1]);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "POST /cart/items") {
        const body = await readJsonBody(req);
        const result = handleAddToCart(cartService, req.headers.authorization, body);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route === "GET /cart") {
        const result = handleGetCart(cartService, req.headers.authorization);
        sendJson(res, result.status, result.body);
        return;
      }
      ```
    files:
      - "src/app.ts"
    rationale: |
      `createApp` is the single composition root today (constructs `UserRepository`,
      `SessionRepository`, `AuthService` and dispatches on `${method} ${pathname}`) - the new modules
      must be composed and routed the same way rather than starting a second server or router.
tests:
  - |
    AC1 - GIVEN a customer has selected a pizza WHEN the customisation screen opens THEN they can
    choose one size, one crust type, and one or more toppings.

    Test 1 (options are exposed for the screen to render):
    ```ts
    test("AC1: pizza customisation options expose sizes, crusts, and toppings", async () => {
      const server = await startTestServer();
      try {
        const res = await fetch(`${server.baseUrl}/pizzas/pizza-margherita`);
        assert.equal(res.status, 200);
        const body = await res.json() as { sizes: unknown[]; crusts: unknown[]; toppings: unknown[] };
        assert.ok(Array.isArray(body.sizes) && body.sizes.length > 0);
        assert.ok(Array.isArray(body.crusts) && body.crusts.length > 0);
        assert.ok(Array.isArray(body.toppings) && body.toppings.length > 0);
      } finally {
        await server.close();
      }
    });
    ```

    Test 2 (exactly one size, one crust, one-or-more toppings is enforced on submission):
    ```ts
    test("AC1: adding to cart is rejected when size/crust is invalid or no toppings are selected", async () => {
      const server = await startTestServer();
      try {
        const { access_token: accessToken } = await login(server.baseUrl);
        const base = { pizza_id: "pizza-margherita", crust: "crust-thin", toppings: ["topping-mushroom"], quantity: 1 };

        const badSize = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-xxl" });
        assert.equal(badSize.status, 400);

        const noToppings = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-medium", toppings: [] });
        assert.equal(noToppings.status, 400);

        const ok = await postCartItem(server.baseUrl, accessToken, { ...base, size: "size-medium" });
        assert.equal(ok.status, 201);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC2 - GIVEN a customer is customizing a pizza WHEN they select a quantity value THEN that
    quantity is reflected in the item added to the cart.

    ```ts
    test("AC2: selected quantity is reflected in the cart item", async () => {
      const server = await startTestServer();
      try {
        const { access_token: accessToken } = await login(server.baseUrl);
        const res = await postCartItem(server.baseUrl, accessToken, {
          pizza_id: "pizza-margherita", size: "size-medium", crust: "crust-thin",
          toppings: ["topping-mushroom"], quantity: 3,
        });
        assert.equal(res.status, 201);
        const body = await res.json() as { quantity: number };
        assert.equal(body.quantity, 3);
      } finally {
        await server.close();
      }
    });

    test("AC2: a non-positive or non-integer quantity is rejected", async () => {
      const server = await startTestServer();
      try {
        const { access_token: accessToken } = await login(server.baseUrl);
        const res = await postCartItem(server.baseUrl, accessToken, {
          pizza_id: "pizza-margherita", size: "size-medium", crust: "crust-thin",
          toppings: ["topping-mushroom"], quantity: 0,
        });
        assert.equal(res.status, 400);
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC3 - GIVEN a customer is customizing a pizza WHEN they enter text in the special instructions
    field THEN that text is attached to the pizza configuration added to the cart.

    ```ts
    test("AC3: special instructions text is attached to the cart item", async () => {
      const server = await startTestServer();
      try {
        const { access_token: accessToken } = await login(server.baseUrl);
        const res = await postCartItem(server.baseUrl, accessToken, {
          pizza_id: "pizza-margherita", size: "size-medium", crust: "crust-thin",
          toppings: ["topping-mushroom"], quantity: 1, special_instructions: "Extra crispy, no onions",
        });
        assert.equal(res.status, 201);
        const body = await res.json() as { special_instructions: string };
        assert.equal(body.special_instructions, "Extra crispy, no onions");
      } finally {
        await server.close();
      }
    });
    ```
  - |
    AC4 - GIVEN a customer has chosen a size, a crust, one or more toppings, and a quantity WHEN
    they add the pizza to the cart THEN the cart contains an entry reflecting exactly that
    configuration.

    ```ts
    test("AC4: the cart contains an entry reflecting exactly the chosen configuration", async () => {
      const server = await startTestServer();
      try {
        const { access_token: accessToken } = await login(server.baseUrl);
        const config = {
          pizza_id: "pizza-margherita", size: "size-large", crust: "crust-stuffed",
          toppings: ["topping-olives", "topping-pepperoni"], quantity: 2, special_instructions: "Cut into squares",
        };
        const postRes = await postCartItem(server.baseUrl, accessToken, config);
        assert.equal(postRes.status, 201);

        const cartRes = await fetch(`${server.baseUrl}/cart`, { headers: { Authorization: `Bearer ${accessToken}` } });
        assert.equal(cartRes.status, 200);
        const cartBody = await cartRes.json() as { items: Array<Record<string, unknown>> };
        assert.equal(cartBody.items.length, 1);
        assert.deepEqual(cartBody.items[0], { id: cartBody.items[0].id, ...config });
      } finally {
        await server.close();
      }
    });
    ```
assumptions_or_open_questions:
  - "This repo is a headless HTTP API with no frontend/UI layer at all, so every AC (which is phrased in terms of a 'customisation screen') is translated into an equivalent API contract: GET /pizzas/:id exposes the selectable options, and POST /cart/items validates and accepts a submitted configuration. Please confirm this translation is the intended scope for this repo, or point to where a UI layer should actually live."
  - "A cart is assumed to belong to the authenticated customer, identified via the existing Bearer JWT access token (same mechanism as GET /auth/session), since there is no other customer/session identifier for cart ownership in this codebase. An anonymous/guest cart is out of scope unless the reviewer says otherwise."
  - "The pizza catalog (available pizzas, sizes, crusts, toppings) is new static in-memory fixture data seeded with a single sample pizza (pizza-margherita), mirroring src/users/fixtures/testUsers.ts, since no menu/catalog domain exists yet."
  - "Quantity is assumed to be a positive integer with no explicit maximum (AC2 doesn't specify a cap)."
  - "Special instructions has no length limit beyond the existing 64KB request-body cap in httpUtils.ts (AC3 doesn't specify one)."
  - "Duplicate topping ids submitted in one request are assumed to be preserved as-is (not deduplicated or rejected), since no AC addresses duplicates."
  - "Cart storage is in-memory only (lost on process restart), matching the existing SessionRepository/UserRepository pattern - no persistence layer is introduced."
package_dependencies: []
notes: |
  Route dispatch in `src/app.ts` today is a flat set of exact `${method} ${pathname}` string
  comparisons (see `route === "POST /auth/login"` etc.). `GET /pizzas/:id` is the first route in
  this codebase that needs a path parameter, so it needs a regex match instead of a string
  comparison - called out explicitly in scope so the reviewer can weigh in on that small deviation
  from the existing exact-match style before it's written.

  Layering/call-graph for the touched modules, plus their existing real callers/callees read while
  planning:

  ```mermaid
  flowchart TD
    app["src/app.ts (modified: routes + composition root)"]
    cartController["src/cart/cartController.ts (new)"]
    cartService["src/cart/cartService.ts (new)"]
    cartRepository["src/cart/cartRepository.ts (new)"]
    pizzaRepository["src/pizzas/pizzaRepository.ts (new)"]
    pizzaFixtures["src/pizzas/fixtures/pizzaCatalog.ts (new)"]
    tokenService["src/auth/tokenService.ts (existing, untouched)"]
    httpUtils["src/httpUtils.ts (existing, untouched)"]
    testFile["test/cartCustomisation.test.ts (new)"]
    testServer["test/testServer.ts (existing, untouched)"]

    app -->|"routes POST /cart/items, GET /cart, GET /pizzas/:id"| cartController
    cartController -->|"verifyAccessToken() to identify the cart owner"| tokenService
    cartController -->|"asRecord()/body parsing"| httpUtils
    cartController -->|"addPizzaToCart(), getCart()"| cartService
    cartService -->|"findById() to validate size/crust/toppings"| pizzaRepository
    cartService -->|"addItem(), getItemsByCustomerId()"| cartRepository
    pizzaRepository -->|"seeds from"| pizzaFixtures
    testFile -->|"drives via fetch()"| app
    testFile -->|"startTestServer()"| testServer

    classDef touched fill:#f96,color:#000
    class app,cartController,cartService,cartRepository,pizzaRepository,pizzaFixtures,testFile touched
  ```
