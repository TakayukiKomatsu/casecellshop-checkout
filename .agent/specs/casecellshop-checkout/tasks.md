# CaseCellShop Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved one-item checkout with atomic PostgreSQL reservations, backend idempotency, asynchronous simulated ERP processing, coherent Next.js retry UX, and evidence for every acceptance criterion in SDD v0.2.

**Architecture:** A `pnpm` monorepo contains a Next.js web app and a NestJS API using Fastify. The API is a modular monolith; PostgreSQL owns catalog, inventory, orders, and idempotency. A single-concurrency in-process worker claims pending orders from PostgreSQL and invokes a deterministic ERP simulator outside database transactions.

**Tech Stack:** Node.js 22, pnpm 11.21.0, TypeScript, NestJS 11, Fastify 5.11.0, TypeORM, PostgreSQL 16, Next.js 16.3.0/React 19.2.8, Jest/Supertest, Vitest/React Testing Library/MSW, Playwright, Docker Compose.

## Global Constraints

- `spec.md` v0.2 is FINAL and is the source of truth.
- One order contains exactly one product and a positive safe-integer quantity.
- PostgreSQL is the only infrastructure dependency; API and web run outside Docker.
- Do not add payment, authentication, real ERP integration, Redis, a production queue, cloud deployment, or a multi-item cart.
- API e web permanecem deployables independentes: não criar pacote/lib compartilhado nem imports cruzados entre apps; contratos HTTP equivalentes devem ser declarados separadamente em cada aplicação.
- Claim idempotency before inventory evaluation; same-key races must never return false insufficient stock.
- Reuse a key after transport failure or `500 INTERNAL_ERROR`; use a new key after explicit `400/404/409` no-order responses or terminal `FAILED`.
- Do not automatically retry an interrupted real ERP operation; a crash may leave `PROCESSING` and must be documented.
- Worker concurrency is `1`; the scripted simulator consumes results in claim order.
- Every test must assert observable behavior or a persisted invariant; do not test source text or framework wiring.
- No commit may include generated attribution or co-author trailers.

> **Nota de entrega:** os artefatos e a validação das Tasks 1–8 foram consolidados no commit `2138ea0 feat: implement resilient checkout flow` (93 arquivos). As etapas de commit abaixo estão marcadas pelo escopo efetivamente entregue nesse commit consolidado; não afirmam a criação dos commits intermediários sugeridos pelo plano.

---

## File Structure

### Root

- `package.json` — workspace scripts and pinned package manager.
- `pnpm-workspace.yaml` — `apps/*` workspace declaration.
- `.nvmrc` — Node.js 22 runtime.
- `tsconfig.base.json` — shared strict TypeScript settings.
- `compose.yaml` — PostgreSQL 16 only.
- `infra/postgres/init/001-create-test-db.sql` — creates isolated `casecellshop_test` database.
- `.env.example` — safe local configuration contract.
- `.gitignore` — dependencies, builds, local env, coverage, Playwright output, database artifacts.
- `playwright.config.ts` — cross-app E2E configuration.
- `e2e/checkout.spec.ts` — browser success and failure/retry scenarios.
- `README.md` — installation, operation, architecture, decisions, limitations, verification, and repository link.
- `PROMPTS.md` — relevant AI prompts used for this task.

### API

- `apps/api/src/main.ts` — Fastify bootstrap, UUID request IDs, validation pipe, filters, Swagger.
- `apps/api/src/app.module.ts` — module composition.
- `apps/api/src/config/env.schema.ts` — Zod environment validation.
- `apps/api/src/database/typeorm.config.ts` — runtime/test data-source options.
- `apps/api/src/database/data-source.ts` — TypeORM CLI data source.
- `apps/api/src/database/migrations/*-create-checkout-schema.ts` — products, orders, idempotency records, checks, indexes.
- `apps/api/src/database/seed.ts` — deterministic idempotent catalog seed.
- `apps/api/src/catalog/product.entity.ts` — product and stock columns.
- `apps/api/src/catalog/catalog.repository.ts` — local product queries.
- `apps/api/src/catalog/catalog.service.ts` — catalog use case.
- `apps/api/src/catalog/catalog.controller.ts` — `GET /api/products`.
- `apps/api/src/catalog/catalog.types.ts` — product response contract.
- `apps/api/src/orders/order-status.ts` — four legal order states and failure code.
- `apps/api/src/orders/order.entity.ts` — persisted order.
- `apps/api/src/orders/idempotency-record.entity.ts` — key/fingerprint/order association.
- `apps/api/src/orders/orders.repository.ts` — status read and worker claim/finalization.
- `apps/api/src/orders/orders.service.ts` — order status use case.
- `apps/api/src/orders/orders.controller.ts` — `GET /api/orders/:id`.
- `apps/api/src/inventory/inventory.service.ts` — reservation/finalization invariant mutations.
- `apps/api/src/checkout/create-order.dto.ts` — request validation.
- `apps/api/src/checkout/checkout.types.ts` — create-order command/result contracts.
- `apps/api/src/checkout/checkout.errors.ts` — typed application errors.
- `apps/api/src/checkout/checkout.service.ts` — transaction and idempotency orchestration.
- `apps/api/src/checkout/checkout.controller.ts` — `POST /api/orders`.
- `apps/api/src/erp/erp-processor.port.ts` — replaceable processing interface.
- `apps/api/src/erp/erp-simulator.service.ts` — fixed/scripted deterministic adapter.
- `apps/api/src/worker/order-worker.service.ts` — scheduled single-concurrency claimant.
- `apps/api/src/observability/http-error.filter.ts` — stable error envelope.
- `apps/api/src/observability/order-events.ts` — lifecycle event logger.
- `apps/api/src/health/health.controller.ts` — database readiness endpoint.
- `apps/api/test/support/database.ts` — migrate/reset/seed helpers for real PostgreSQL.
- `apps/api/test/*.e2e-spec.ts` — API, worker, logging, and concurrency acceptance tests.

### Web

- `apps/web/app/page.tsx` — checkout route shell.
- `apps/web/src/checkout/checkout-page.tsx` — composed screen and attempt state machine.
- `apps/web/src/checkout/product-list.tsx` — product display and selection.
- `apps/web/src/checkout/quantity-input.tsx` — positive integer input.
- `apps/web/src/checkout/order-feedback.tsx` — loading, replay, error, paused, and terminal messages.
- `apps/web/src/checkout/attempt-state.ts` — reducer and key policy.
- `apps/web/src/lib/api-client.ts` — products/orders HTTP client.
- `apps/web/src/lib/api-types.ts` — API DTOs and error discriminants.
- `apps/web/src/test/setup.ts` — Testing Library/MSW setup.
- `apps/web/src/checkout/*.test.tsx` — component and state acceptance tests.

---

### Task 1: Bootstrap the Workspace and PostgreSQL Schema

**Requirements:** `DEC-2`, `DEC-3`, `DEC-9`, `NFR-6`, `NFR-7`, `NFR-10`

**Files:**
- Create: root workspace/configuration files listed above.
- Create: `apps/api/package.json`, Nest configuration and TypeScript configuration.
- Create: `apps/web/package.json`, Next.js configuration and TypeScript configuration.
- Create: API database configuration, entities, migration, seed, and test support files.
- Modify: `.gitignore`.

**Interfaces:**
- Produces `AppEnv` with `DATABASE_URL`, `DATABASE_URL_TEST`, `WORKER_POLL_MS`, `ERP_SIMULATION_DELAY_MS`, `ERP_SIMULATION_MODE`, and `ERP_SIMULATION_SCRIPT`.
- Produces tables `products`, `orders`, and `idempotency_records` exactly as specified in `spec.md`.

- [x] **Step 1: Create workspace manifests and scaffold both apps**

Run:

```bash
corepack enable
pnpm init
pnpm dlx @nestjs/cli new apps/api --package-manager pnpm --skip-git
pnpm dlx create-next-app@latest apps/web --ts --eslint --app --src-dir --use-pnpm --no-tailwind
```

Set the root manifest to private, declare `"packageManager": "pnpm@11.21.0"`, and expose `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:revert`, and `db:seed` scripts through `pnpm --filter`.

- [x] **Step 2: Add PostgreSQL and isolated test database**

Create `compose.yaml` with image `postgres:16-alpine`, health command `pg_isready -U casecellshop`, host port `5432`, named volume, and init mount `./infra/postgres/init:/docker-entrypoint-initdb.d:ro`.

Create `infra/postgres/init/001-create-test-db.sql`:

```sql
CREATE DATABASE casecellshop_test;
```

- [x] **Step 3: Write a failing schema integration test**

Create `apps/api/test/schema.e2e-spec.ts` that migrates `DATABASE_URL_TEST`, queries `information_schema.tables`, and expects:

```ts
expect(tableNames).toEqual(
  expect.arrayContaining(['products', 'orders', 'idempotency_records']),
);
```

Also query `pg_constraint` and assert non-negative stock, reserved-not-greater-than-on-hand, positive quantity, and unique idempotency key constraints exist.

- [x] **Step 4: Run the schema test and observe the expected failure**

Run:

```bash
docker compose up -d postgres
pnpm --filter api test:e2e -- schema.e2e-spec.ts
```

Expected: failure because migration/entities do not exist.

- [x] **Step 5: Implement configuration, entities, migration, and seed**

Use a Zod schema that rejects missing URLs, negative delays, empty scripted sequences, and modes outside `success | failure | scripted`. Configure TypeORM with `synchronize: false`.

The migration must create:

```sql
CHECK (price_cents >= 0)
CHECK (stock_on_hand >= 0)
CHECK (stock_reserved >= 0 AND stock_reserved <= stock_on_hand)
CHECK (quantity > 0)
UNIQUE (idempotency_records.key)
UNIQUE (idempotency_records.order_id)
```

Seed at least three stable UUID/SKU rows with different stock quantities using `INSERT ... ON CONFLICT (sku) DO UPDATE` so reset is deterministic.

- [x] **Step 6: Run schema, migration, seed, typecheck, and build checks**

Run:

```bash
pnpm db:migrate:test
pnpm db:seed:test
pnpm --filter api test:e2e -- schema.e2e-spec.ts
pnpm typecheck
pnpm build
```

Expected: schema test passes; migration and seed can run twice without drift; builds succeed.

- [x] **Step 7: Commit the independently testable foundation**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc tsconfig.base.json compose.yaml infra .env.example .gitignore apps/api apps/web
git commit -m "chore: bootstrap checkout workspace and database"
```

---

### Task 2: Deliver the Local Product Catalog and Health Endpoints

**Requirements:** `FR-1`, `FR-13`, `NFR-11`, `AC-1`, `AC-17`

**Files:**
- Create catalog and health files from the structure map.
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`.
- Test: `apps/api/test/catalog.e2e-spec.ts`, `apps/api/test/health.e2e-spec.ts`.

**Interfaces:**
- Produces `CatalogProduct = { id; sku; name; description; priceCents; availableStock }`.
- Produces `GET /api/products` and `GET /api/health`.

- [x] **Step 1: Write failing catalog and health tests**

Assert `GET /api/products` returns `200`, seeded SKUs, integer cents, and `availableStock = stock_on_hand - stock_reserved`. Override `ErpProcessorPort` with a spy and assert zero calls.

Assert health returns `200` with a live test database and `503` when the data-source query is forced to reject.

- [x] **Step 2: Run only these tests and observe 404 failures**

```bash
pnpm --filter api test:e2e -- catalog.e2e-spec.ts health.e2e-spec.ts
```

Expected: both endpoint suites fail with 404.

- [x] **Step 3: Implement focused catalog and health modules**

`CatalogRepository.list()` must select only storefront fields and compute availability in SQL. `CatalogService` depends only on the repository. `HealthController` executes `SELECT 1` and maps failure to `503`.

- [x] **Step 4: Run the focused tests**

```bash
pnpm --filter api test:e2e -- catalog.e2e-spec.ts health.e2e-spec.ts
```

Expected: all catalog/health tests pass and ERP spy has no calls.

- [x] **Step 5: Commit the read path**

```bash
git add apps/api/src/catalog apps/api/src/health apps/api/src/app.module.ts apps/api/test/catalog.e2e-spec.ts apps/api/test/health.e2e-spec.ts
git commit -m "feat(api): add local catalog and health endpoints"
```

---

### Task 3: Implement Atomic Checkout and Idempotency

**Requirements:** `FR-2`–`FR-5`, `NFR-1`, `NFR-3`, `AC-2`–`AC-7`, `AC-23`, `AC-24`

**Files:**
- Create checkout, inventory, and order persistence files from the structure map.
- Modify: `apps/api/src/app.module.ts`.
- Test: `apps/api/test/checkout.e2e-spec.ts`, `apps/api/test/checkout-concurrency.e2e-spec.ts`.

**Interfaces:**

```ts
export type CreateOrderCommand = {
  idempotencyKey: string;
  productId: string;
  quantity: number;
};

export type CreateOrderResult = {
  replayed: boolean;
  order: OrderSnapshot;
};

export interface OrderSnapshot {
  id: string;
  productId: string;
  quantity: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  failureCode: 'TEMPORARY_ERP_FAILURE' | null;
  createdAt: string;
  updatedAt: string;
}
```

- [x] **Step 1: Write failing domain and integration tests**

Cover valid creation, invalid quantity/header/UUID, unknown product, insufficient stock, same-key replay, changed-payload conflict, and injected pre-commit failure. After every no-order response, query all three tables and assert no partial mutation.

The request fingerprint must be:

```ts
createHash('sha256')
  .update(JSON.stringify([productId, quantity]))
  .digest('hex');
```

- [x] **Step 2: Write the failing concurrency tests**

Use `Promise.allSettled` with independent database connections:

```ts
const [a, b] = await Promise.all([
  postOrder({ key: randomUUID(), productId, quantity: 1 }),
  postOrder({ key: randomUUID(), productId, quantity: 1 }),
]);
expect([a.status, b.status].sort()).toEqual([202, 409]);
```

For same-key concurrency, seed exactly the requested quantity and require statuses `[200, 202]`, one order, one idempotency record, and one reservation.

- [x] **Step 3: Run checkout tests and observe failures**

```bash
pnpm --filter api test:e2e -- checkout.e2e-spec.ts checkout-concurrency.e2e-spec.ts
```

Expected: failures because services/routes are absent.

- [x] **Step 4: Implement idempotency-first transaction orchestration**

Inside one `READ COMMITTED` transaction:

```ts
const claimed = await manager.query(
  `INSERT INTO idempotency_records (key, request_fingerprint, created_at)
   VALUES ($1, $2, now())
   ON CONFLICT DO NOTHING
   RETURNING key`,
  [key, fingerprint],
);
```

If `claimed.length === 0`, read the now-committed record before touching products. Compare fingerprints; return its order or throw `IdempotencyKeyReusedError`.

If claimed, lock the product with `pessimistic_write`, calculate availability, update `stock_reserved`, create `PENDING`, associate `order_id`, and commit. Let any thrown error roll back all writes.

- [x] **Step 5: Implement validation and stable error envelope**

Apply `@IsUUID()`, `@IsInt()`, `@Min(1)`, and `@Max(Number.MAX_SAFE_INTEGER)`. Require UUID `Idempotency-Key`. Map typed errors to the exact `400/404/409` codes from `spec.md`; include Fastify request UUID as `correlationId`. Unknown exceptions map to `500 INTERNAL_ERROR` without exposing internals.

- [x] **Step 6: Run checkout and concurrency tests repeatedly**

```bash
pnpm --filter api test:e2e -- checkout.e2e-spec.ts checkout-concurrency.e2e-spec.ts --runInBand
pnpm --filter api test:e2e -- checkout-concurrency.e2e-spec.ts --runInBand
pnpm --filter api test:e2e -- checkout-concurrency.e2e-spec.ts --runInBand
```

Expected: stable pass; persisted invariants hold after every race.

- [x] **Step 7: Commit the write path**

```bash
git add apps/api/src/checkout apps/api/src/inventory apps/api/src/orders apps/api/src/observability/http-error.filter.ts apps/api/src/app.module.ts apps/api/test/checkout*.e2e-spec.ts
git commit -m "feat(api): add atomic idempotent checkout"
```

---

### Task 4: Add Order Status, ERP Simulation, and Async Worker

**Requirements:** `FR-6`, `FR-7`, `FR-8`, `FR-11`, `NFR-2`, `NFR-5`, `AC-8`, `AC-9`, `AC-10`, `AC-11`, `AC-19`

**Files:**
- Create order controller/service/repository, ERP port/simulator, worker files.
- Modify: `apps/api/src/app.module.ts`.
- Test: `apps/api/test/order-processing.e2e-spec.ts`, `apps/api/test/orders.e2e-spec.ts`.

**Interfaces:**

```ts
export interface ErpProcessorPort {
  process(input: { operationId: string; productId: string; quantity: number }): Promise<
    | { ok: true }
    | { ok: false; code: 'TEMPORARY_ERP_FAILURE' }
  >;
}
```

`operationId` is the order UUID for traceability; the simulator does not claim external exactly-once behavior.

- [x] **Step 1: Write failing order-status scenarios**

Use a scenario table for all four states and `failureCode`. Assert malformed path UUID is `400` and unknown valid UUID is `404 ORDER_NOT_FOUND`.

- [x] **Step 2: Write failing deterministic processing tests**

Use fresh simulator instances for each test. Cover fixed success, fixed failure, and script `failure,success`. Assert success decrements on-hand/reserved once; failure decrements only reserved. Assert a second finalization attempt changes zero rows.

- [x] **Step 3: Write the non-blocking checkout test**

Inject a deferred ERP promise. Create an order and require `202` before resolving the deferred promise. This test proves ordering, not wall-clock speed.

- [x] **Step 4: Run processing/status tests and observe failures**

```bash
pnpm --filter api test:e2e -- orders.e2e-spec.ts order-processing.e2e-spec.ts
```

Expected: missing route/provider/worker failures.

- [x] **Step 5: Implement the simulator contract**

Parse modes exactly:

```ts
type SimulationResult = 'success' | 'failure';
type SimulationMode = 'success' | 'failure' | 'scripted';
```

For scripted mode, split the configured comma-separated sequence, validate every token, consume one result per call, and throw `SimulationScriptExhaustedError` after the final token. Use a fresh process/test instance to reset cursor. Apply fixed delay before returning the selected result.

- [x] **Step 6: Implement the single-concurrency worker**

Use `@Interval(env.WORKER_POLL_MS)` plus an in-memory `running` guard. In a short transaction, select one `PENDING` using `FOR UPDATE SKIP LOCKED`, update it to `PROCESSING`, and commit. Invoke ERP outside the transaction. In a new transaction, conditionally update only `WHERE id = $1 AND status = 'PROCESSING'` and mutate stock in the same transaction.

Do not add lease reclaim. Log and document that a process crash can leave `PROCESSING`.

- [x] **Step 7: Run processing/status tests**

```bash
pnpm --filter api test:e2e -- orders.e2e-spec.ts order-processing.e2e-spec.ts
```

Expected: all states, inventory outcomes, script order, and non-blocking POST pass.

- [x] **Step 8: Commit asynchronous processing**

```bash
git add apps/api/src/orders apps/api/src/erp apps/api/src/worker apps/api/src/app.module.ts apps/api/test/orders.e2e-spec.ts apps/api/test/order-processing.e2e-spec.ts
git commit -m "feat(api): process orders asynchronously"
```

---

### Task 5: Add Structured Lifecycle Logging and OpenAPI

**Requirements:** `NFR-4`, `NFR-7`, `AC-18`

**Files:**
- Create/modify observability files, `apps/api/src/main.ts`, and module configuration.
- Test: `apps/api/test/observability.e2e-spec.ts`.

**Interfaces:**

```ts
type OrderEvent =
  | 'order.created'
  | 'order.idempotency_replayed'
  | 'order.processing_started'
  | 'order.completed'
  | 'order.failed';
```

- [x] **Step 1: Write failing lifecycle log tests**

Capture the logger transport in memory. Exercise creation, replay, success, and failure. Parse every line as JSON and assert event, correlationId, orderId, previousStatus/newStatus where applicable, durationMs, and failureCode. Assert request bodies, database URLs, and idempotency keys are absent.

- [x] **Step 2: Run the focused test and observe missing events**

```bash
pnpm --filter api test:e2e -- observability.e2e-spec.ts
```

- [x] **Step 3: Configure request IDs, structured logger, and event service**

Set Fastify `genReqId: () => randomUUID()`. Use `nestjs-pino` or the Fastify Pino instance consistently; do not create a second logging format. Log only allowlisted fields through `OrderEvents` methods.

- [x] **Step 4: Generate OpenAPI from controllers/DTOs**

Expose Swagger JSON/UI in development. Document `Idempotency-Key`, `Location`, order states, and every error envelope. Do not make OpenAPI a second source of truth; derive it from the implemented DTOs.

- [x] **Step 5: Run observability, API, and type checks**

```bash
pnpm --filter api test:e2e -- observability.e2e-spec.ts checkout.e2e-spec.ts orders.e2e-spec.ts
pnpm --filter api typecheck
```

Expected: JSON log assertions and existing API suites pass.

- [x] **Step 6: Commit observability**

```bash
git add apps/api/src/main.ts apps/api/src/observability apps/api/src/**/*.dto.ts apps/api/test/observability.e2e-spec.ts
git commit -m "feat(api): add correlated order lifecycle logs"
```

---

### Task 6: Build Product Selection and Safe Order Submission UI

**Requirements:** `FR-1`, `FR-2`, `FR-3`, `FR-5`, `FR-10`, `NFR-8`, `AC-13`, `AC-14`, `AC-15`, `AC-16`, `AC-21`

**Files:**
- Create web API types/client, checkout components, test setup, and component tests.
- Modify: `apps/web/app/page.tsx`, web package/test configuration.

**Interfaces:**

```ts
type AttemptState =
  | { kind: 'idle' }
  | { kind: 'submitting'; key: string; productId: string; quantity: number }
  | { kind: 'tracking'; key: string; order: OrderSnapshot }
  | { kind: 'tracking_paused'; key: string; order: OrderSnapshot }
  | { kind: 'succeeded'; order: OrderSnapshot }
  | { kind: 'failed'; order?: OrderSnapshot; error: ApiError };
```

- [x] **Step 1: Configure Vitest, Testing Library, and MSW**

Add `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and MSW. Reset handlers after every test and fail tests on unhandled requests.

- [x] **Step 2: Write failing browser-component tests for AC-21 and AC-13**

Mock products, select the second product, set quantity `2`, click purchase, and inspect the intercepted POST:

```ts
expect(await request.json()).toEqual({ productId: secondProduct.id, quantity: 2 });
expect(request.headers.get('Idempotency-Key')).toMatch(UUID_PATTERN);
```

Keep POST unresolved and assert loading is visible and purchase button is disabled after rapid double click; exactly one logical request is observed.

- [x] **Step 3: Run focused web tests and observe failures**

```bash
pnpm --filter web test -- checkout-page.test.tsx
```

Expected: missing component/client failures.

- [x] **Step 4: Implement API client and basic attempt reducer**

`listProducts`, `createOrder`, and `getOrder` must decode non-2xx responses into `{ code, message, correlationId, details }`. The create call accepts a key argument; it must never generate keys internally.

The page generates a UUID once per logical submission, validates positive safe integers, sends exact selected values, and transitions to `tracking` on `202` or replay `200`.

- [x] **Step 5: Implement product list, quantity input, loading lock, and messages**

Use native radio/button/number semantics and associated labels. Messages must distinguish validation, product missing, insufficient stock, idempotent replay, temporary ERP failure, and success. Retain product/quantity after recoverable failures; reset quantity to `1` only after success.

- [x] **Step 6: Run component tests and accessibility smoke assertions**

```bash
pnpm --filter web test -- checkout-page.test.tsx
pnpm --filter web typecheck
```

Expected: product selection, exact payload, loading lock, and required message cases pass.

- [x] **Step 7: Commit the submission UI**

```bash
git add apps/web/app apps/web/src apps/web/package.json apps/web/vitest.config.ts
git commit -m "feat(web): add product checkout submission"
```

---

### Task 7: Implement Polling, Paused Tracking, and Retry-Key Policy

**Requirements:** `FR-7`, `FR-9`, `FR-10`, `AC-15`, `AC-16`, `AC-22`

**Files:**
- Modify: `apps/web/src/checkout/attempt-state.ts`, `checkout-page.tsx`, `order-feedback.tsx`, `api-client.ts`.
- Test: `apps/web/src/checkout/attempt-state.test.ts`, `checkout-page.test.tsx`.

**Interfaces:**
- `retryUnknown()` resubmits identical payload/key after transport failure or `500`.
- `resumeTracking()` issues only `GET /api/orders/{id}`.
- `retryTerminal()` generates a new key and POST only after terminal `FAILED`.

- [x] **Step 1: Write reducer tests for every key-policy branch**

Assert:

```ts
expect(nextKey({ outcome: 'transport-error', currentKey })).toBe(currentKey);
expect(nextKey({ outcome: 'internal-error', currentKey })).toBe(currentKey);
expect(nextKey({ outcome: 'validation-error', currentKey })).not.toBe(currentKey);
expect(nextKey({ outcome: 'insufficient-stock', currentKey })).not.toBe(currentKey);
expect(nextKey({ outcome: 'terminal-failed', currentKey })).not.toBe(currentKey);
```

- [x] **Step 2: Write fake-timer polling tests**

Return `PENDING`, then `PROCESSING`, then `COMPLETED`; assert polling stops and catalog refreshes. For client timeout, assert `tracking_paused`, preserved order ID/key, disabled new purchase, and no POST when “Consultar novamente” is clicked.

- [x] **Step 3: Run focused tests and observe failures**

```bash
pnpm --filter web test -- attempt-state.test.ts checkout-page.test.tsx
```

- [x] **Step 4: Implement explicit polling lifecycle**

Use one abortable polling effect keyed by order ID. Clear timer and abort fetch on terminal state/unmount. Count a configured number of consecutive polling failures or elapsed polling window before `tracking_paused`; do not change persisted order status.

“Consultar novamente” must call only `getOrder(existingId)` and return to `tracking` if still non-terminal.

- [x] **Step 5: Implement unknown/no-order/terminal retry behavior**

- Transport or `500`: render “Tentar novamente” and resubmit identical payload/key.
- `400/404/409`: let the user correct/retry and generate a new key.
- `FAILED/TEMPORARY_ERP_FAILURE`: preserve fields and create a new key/new order.
- Replay `200`: show existing-attempt notice and track returned order.

- [x] **Step 6: Run the complete web suite**

```bash
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
```

Expected: all state, timer, key, cleanup, and rendering tests pass without unhandled requests.

- [x] **Step 7: Commit resilient UI state**

```bash
git add apps/web/src/checkout apps/web/src/lib
git commit -m "feat(web): add resilient order tracking and retry"
```

---

### Task 8: Prove End-to-End Success, Failure, and Concurrency

**Requirements:** `AC-1`–`AC-11`, `AC-13`–`AC-24`

**Files:**
- Create: `playwright.config.ts`, `e2e/checkout.spec.ts`.
- Modify: root scripts and simulator test environment configuration.

**Interfaces:**
- Root `pnpm e2e` starts PostgreSQL, migrates/seeds test DB, starts API/web with scripted simulator, executes browser scenarios, and shuts down app processes.

- [x] **Step 1: Write a failing Playwright success scenario**

Load products, select a known seeded product, choose quantity `2`, submit once, observe loading, wait for success, and assert displayed availability decreased by `2`. Capture browser console errors and fail on unexpected entries.

- [x] **Step 2: Write a failing scripted failure-then-success scenario**

Start a fresh API with `ERP_SIMULATION_MODE=scripted` and `ERP_SIMULATION_SCRIPT=failure,success`. First order must become temporary failure and retain form values. Click Retry, assert a new key/new order, and observe success.

- [x] **Step 3: Add a paused-tracking E2E using delayed processing**

Configure simulator delay above the client polling window. Assert “pedido ainda em processamento”, click “Consultar novamente”, and verify network capture contains only GET status calls until terminal state.

- [x] **Step 4: Run E2E and observe failures before wiring scripts**

```bash
pnpm exec playwright install chromium
pnpm e2e
```

Expected: start/configuration or missing UI behavior fails.

- [x] **Step 5: Wire deterministic E2E lifecycle**

Add root scripts that call existing app CLIs; use no custom process supervisor beyond `concurrently`/`wait-on`. Ensure test DB reset and a fresh API process per scripted scenario so the script cursor starts at index zero.

- [x] **Step 6: Run all acceptance-focused suites**

```bash
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter web test
pnpm e2e
```

Expected: all suites pass, including real PostgreSQL concurrency and both browser flows.

- [x] **Step 7: Commit end-to-end evidence**

```bash
git add playwright.config.ts e2e package.json pnpm-lock.yaml
git commit -m "test: cover checkout end to end"
```

---

### Task 9: Complete Documentation and Final Verification

**Requirements:** `NFR-9`, `AC-20`, `OQ-1`–`OQ-3`

**Files:**
- Modify: `README.md`, `.agent/specs/casecellshop-checkout/spec.md`, `.agent/specs/casecellshop-checkout/tasks.md`.
- Create: `PROMPTS.md`.

**Interfaces:**
- README is the evaluator entry point and must contain exact commands exercised in this task.

> **Bloqueio externo — Parte 1.A:** as seis perguntas conceituais exigidas pela entrega não foram fornecidas. Não há conteúdo a responder sem esse insumo; o bloqueio permanece aberto para o repository owner.

- [x] **Step 1: Replace the placeholder README with observed instructions**

Include prerequisites, env copy, PostgreSQL start, install, migrate, seed, API/web start, simulator recipes, test commands, API table, architecture/sequence diagram, decisions, limitations, next steps, and public URL.

Do not claim commands pass until Step 4 records their actual output.

- [x] **Step 2: Write PROMPTS.md**

Record the material prompts used to understand `INSTRUCTIONS.md`, choose architecture, author/review the SDD, and implement. Exclude secrets, hidden system instructions, and irrelevant conversational text.

- [x] **Step 3: Run the clean-clone-equivalent smoke sequence**

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Then start the apps with documented commands and directly exercise:

```bash
curl -fsS http://localhost:3001/api/health
curl -fsS http://localhost:3001/api/products
```

Use the browser for checkout success and scripted failure/retry; capture the exact observed results.

- [x] **Step 4: Update documentation with only verified evidence**

Record command names and pass/fail counts actually observed. Document the accepted `PROCESSING` crash limitation, absence of real ERP/payment/auth/queue/cloud, local-only capacity, and missing Part 1.A questions.

- [x] **Step 5: Run independent verification/review**

Have a verifier check all `AC-1`–`AC-11` and `AC-13`–`AC-24`, compare implementation with `spec.md`, and report unresolved correctness/security issues. Fix any blocker and rerun the affected scenario plus the full relevant suite.

- [x] **Step 6: Close SDD task state**

Mark completed items in this file, keep external Part 1.A blocked if still unavailable, and add the implementation verification summary to the `spec.md` change log without changing the approved behavior.

- [x] **Step 7: Commit delivery documentation**

```bash
git add README.md PROMPTS.md .agent/specs/casecellshop-checkout
git commit -m "docs: document checkout delivery and verification"
```

- [ ] **Step 8: Complete external delivery**

O push do repositório e a publicação do link abaixo foram concluídos separadamente. Esta etapa permanece aberta somente porque as seis perguntas da Parte 1.A não foram fornecidas e, portanto, suas respostas continuam bloqueadas:

```text
https://github.com/TakayukiKomatsu/casecellshop-checkout
```

---

## Traceability Summary

| Requirement group | Owning tasks |
|---|---|
| Product query and browser selection (`FR-1`, `AC-1`, `AC-21`) | 2, 6, 8 |
| Validation and synchronous errors (`FR-3`, `AC-3`, `AC-23`, `AC-24`) | 3, 6 |
| Atomic inventory and concurrency (`FR-4`, `NFR-1`, `AC-2`, `AC-4`, `AC-5`) | 1, 3, 8 |
| Idempotency and retry keys (`FR-5`, `FR-9`, `NFR-3`, `AC-6`, `AC-7`, `AC-15`) | 3, 6, 7 |
| Async ERP/status (`FR-6`–`FR-8`, `FR-11`, `AC-8`–`AC-11`, `AC-19`) | 4, 7, 8 |
| Frontend coherence (`FR-10`, `AC-13`–`AC-16`, `AC-22`) | 6, 7, 8 |
| Health/logging (`FR-13`, `NFR-4`, `AC-17`, `AC-18`) | 2, 5 |
| Documentation/delivery (`NFR-9`, `AC-20`, `OQ-1`–`OQ-3`) | 9 |

## Plan Self-Review

- Spec coverage: every `FR-*`, `NFR-*`, and `AC-*` in FINAL spec v0.2 maps to at least one task above.
- Completeness scan: every step names concrete files, behavior, commands, and expected evidence.
- Type consistency: order statuses, failure code, API fields, idempotency key policy, simulator modes, and file names are consistent across tasks.
- Scope: nine independently reviewable tasks; no real ERP, auth, payment, queue, cloud, or multi-item cart work included.
