# Ostium Service Specification and Implementation Plan

## 1) Objective
Build a **separate Ostium service** (like `flowforge-llm`) and integrate it into `flowforge-backend` so Ostium perpetuals can be tested end-to-end and operated on **both testnet and mainnet**.

This document is a planning/spec artifact only. It does **not** implement code.

---

## 2) Inputs Reviewed

### Internal codebase (FlowForge)
- `flowforge-agent`, `flowforge-backend`, `flowforge-frontend`, `flowforge-llm`
- Existing service pattern (`flowforge-llm`) and backend client pattern (`src/services/llm/llm-service-client.ts`)
- Existing backend service auth patterns (`x-service-key`, `x-on-behalf-of`) and HMAC utility
- Existing workflow node architecture (node types, processors, validation schemas, migrations)
- Existing frontend status for Ostium (`coming-soon/perpetuals.ts`)

### External / online resources
- Official SDK repo: https://github.com/0xOstium/ostium-python-sdk
- SDK package metadata: https://pypi.org/project/ostium-python-sdk/
- Example usage repo: https://github.com/0xOstium/use-ostium-python-sdk

### External local implementation to audit
- `/home/darshit/Downloads/ostium-service.py`

---

## 3) Current-State Findings

## 3.1 FlowForge architecture today
- `flowforge-agent`: plans/compiles workflows and calls backend APIs.
- `flowforge-backend`: core orchestration, workflow execution engine, node processors, DB, queues.
- `flowforge-frontend`: block-based UI, swap/lending/oracle configured; Ostium is currently “coming soon”.
- `flowforge-llm`: isolated internal microservice with strict HMAC auth and backend client integration.

## 3.2 Ostium in current stack
- No runtime backend Ostium integration exists.
- Frontend has Ostium branding and a “coming soon” perpetuals entry, but no executable node/API path.
- Agent planner catalog does not include an executable Ostium/perps block.

## 3.3 Audit of `/home/darshit/Downloads/ostium-service.py`
Useful parts:
- Broad endpoint coverage: balance, positions, open/close, SL/TP, history, market info.
- Supports testnet/mainnet switching and delegation-style fields.
- Has idempotency attempts for open/close behavior.

Critical gaps for production integration:
- No internal service authentication (no HMAC/service-key gate on endpoints).
- Accepts or resolves private keys in request-path logic; tightly coupled with external DB schema.
- Global SSL verification disable and very broad CORS.
- Mixed async/event-loop handling (`new_event_loop` per request patterns) with inconsistent SDK usage.
- Contains logic/quality issues (example: in `/closed-positions`, code comment says “filter to only closed trades” but no filtering condition is actually applied before appending rows).
- Uses non-official package naming in error text (`ostium-python-sdk-test`) and requires explicit SDK version compatibility checks.

Conclusion: treat this file as **reference only**, not as drop-in service.

---

## 4) Official SDK Verification Notes
- Verification timestamp: **Feb 21, 2026 (UTC)**.
- Official package is `ostium-python-sdk` (PyPI latest observed: `3.1.0`, released Feb 15, 2026).
- SDK examples consistently use `NetworkConfig.testnet()` / `NetworkConfig.mainnet()` with `OstiumSDK(...)`.
- Read operations and subgraph/price usage are async in examples (`await sdk.subgraph...`, `await sdk.price.get_price(...)`).
- SDK release velocity is high (many releases), so version pinning + compatibility re-check is mandatory.

Implication for FlowForge:
- Service must pin a known SDK version and avoid unstable assumptions copied from third-party scripts.
- Service contract should shield backend from SDK drift.

---

## 5) Target Architecture

## 5.1 New service
Create a standalone Python service (recommended: FastAPI + uvicorn) named `ostium-service`.

Responsibilities:
- Encapsulate all Ostium SDK interaction.
- Expose a narrow, stable internal API for backend.
- Handle network selection (`testnet` / `mainnet`) deterministically.
- Apply robust retries/timeouts/circuit-breaker style handling around RPC/subgraph calls.

Non-responsibilities:
- No direct frontend consumption.
- No direct public internet exposure.
- No business-orchestration duplication already in backend.

## 5.2 Security model
Mirror `llm-service` style internal contract:
- HMAC-authenticated requests (`x-timestamp`, `x-signature`) between backend and ostium-service.
- Timestamp tolerance and replay resistance.
- Private keys never accepted as plaintext from external/public requests.
- Optional backend-owned key retrieval strategy stays in backend boundary (or dedicated vault), not embedded ad hoc in service routes.

## 5.3 High-level call path
`frontend/agent -> backend (authenticated) -> ostium-service (HMAC) -> Ostium SDK -> chain/subgraph`

---

## 6) Service API Specification (Proposed)

All endpoints below are **internal** (`/v1/...`) and HMAC-protected except health/readiness.

1. `GET /health`
- Liveness only.

2. `GET /ready`
- Verifies SDK bootability + minimal dependency checks.

3. `POST /v1/markets/list`
- Inputs: `network`
- Output: normalized market list (symbol, pairId, status).

4. `POST /v1/accounts/balance`
- Inputs: `network`, `address`
- Output: usdc/native balances.

5. `POST /v1/positions/list`
- Inputs: `network`, `traderAddress`
- Output: normalized open positions.

6. `POST /v1/positions/open`
- Inputs: `network`, `trade params`, delegation context (optional), idempotency key.
- Output: order/tx identifiers + normalized execution state.

7. `POST /v1/positions/close`
- Inputs: `network`, `pairId`, `tradeIndex`, delegation context (optional), idempotency key.
- Output: close result + tx metadata.

8. `POST /v1/positions/update-sl`
- Inputs: `network`, `pairId`, `tradeIndex`, `slPrice`, delegation context (optional).
- Output: success/failure with structured error.

9. `POST /v1/positions/update-tp`
- Inputs: `network`, `pairId`, `tradeIndex`, `tpPrice`, delegation context (optional).
- Output: success/failure with structured error.

10. `POST /v1/prices/get`
- Inputs: `network`, `base`, `quote` (default USD)
- Output: price + flags (`isMarketOpen`, etc., if available).

Standard response envelope (aligned with backend style):
- Success: `{ success: true, data, meta: { timestamp, requestId } }`
- Error: `{ success: false, error: { code, message, details?, retryable? }, meta }`

---

## 7) Backend Integration Specification

## 7.1 New backend module (planned)
- `src/services/ostium/ostium-service-client.ts` (HMAC signing + retries + typed methods)
- `src/types/ostium.types.ts` (request/response contracts)
- `src/controllers/ostium.controller.ts`
- `src/routes/ostium.routes.ts`

## 7.2 Auth boundary
- Public/user requests continue to authenticate at backend (Privy or service-key).
- Backend is sole caller of ostium-service.

## 7.3 Runtime config
Add envs in backend `.env.example`:
- `OSTIUM_SERVICE_BASE_URL`
- `OSTIUM_SERVICE_HMAC_SECRET`
- `OSTIUM_REQUEST_TIMEOUT_MS`
- Optional feature flag: `OSTIUM_ENABLED`

## 7.4 Execution and persistence
Phase split recommended:
- Phase A: API-only integration (manual open/close/list operations via backend endpoints).
- Phase B: workflow-node integration (`PERPS` node type + processor + validation + migrations + execution table).

---

## 8) Workflow/Frontend/Agent Scope Plan

## 8.1 Backend workflow engine (optional phase)
Add `PERPS` node type only after API path is stable:
- Add node type constraints in migrations.
- Add processor (similar structure to `SwapNodeProcessor`/`LendingNodeProcessor`).
- Add `perps_executions` table (similar lifecycle columns to swap/lending executions).

## 8.2 Frontend
Current Ostium is “coming soon”.
- Phase A: no frontend changes required (backend/API test path first).
- Phase B: add executable Ostium block definition/config UI and map to backend `PERPS` node type.

## 8.3 Agent
- Phase A: no planner changes.
- Phase B: add planner block-catalog entry for Ostium and compiler mapping once backend/workflow node is production-ready.

---

## 9) Testing Strategy (Must Cover Testnet + Mainnet)

## 9.1 Test layers
1. Unit tests (ostium-service)
- Request validation, network mapping, error normalization, HMAC verification.

2. Contract tests (backend <-> ostium-service)
- Stable JSON schema assertions for every endpoint.

3. Integration tests (with real SDK)
- Read-only flows on both networks.
- Write flows gated and isolated with controlled wallets.

4. End-to-end tests (FlowForge path)
- Backend endpoint -> ostium-service -> SDK path.
- Later phase: workflow execution path.

## 9.2 Required matrix
- Networks: `testnet`, `mainnet`
- Modes: `direct`, `delegated`
- Actions: `balance`, `list positions`, `open`, `close`, `SL`, `TP`, `price`, `market list`
- Error classes: invalid market, insufficient funds, position already closed, RPC timeout, subgraph delay

## 9.3 Idempotency
Open/close endpoints must accept client idempotency key and return deterministic responses for replayed requests.

---

## 10) Phased Implementation Plan

## Phase 0: Contract freeze
- Finalize backend<->ostium-service API schema.
- Freeze SDK version target.
- Define normalized error codes.

Exit criteria:
- Reviewed spec approved; no unresolved API shape questions.

## Phase 1: ostium-service skeleton
- FastAPI app, HMAC middleware, health/readiness.
- SDK wrapper module, network config abstraction, structured logging.

Exit criteria:
- Health + at least one read endpoint works in local environment.

## Phase 2: backend client integration
- Add `ostium-service-client` in backend with retries and typed errors.
- Add backend routes/controllers to proxy Ostium operations securely.

Exit criteria:
- Backend API can execute read/write Ostium calls through service in testnet.

## Phase 3: mainnet readiness
- Mainnet config path, stricter safety checks, explicit allowlist per operation.
- Observability dashboards and alerting thresholds.

Exit criteria:
- Mainnet read flows verified; controlled write flow verified with guarded wallet.

## Phase 4: workflow integration (optional)
- Add `PERPS` node type, processor, schemas, migrations, execution table.

Exit criteria:
- Workflow run with Ostium node completes and is persisted end-to-end.

## Phase 5: frontend/agent enablement (optional)
- Replace “coming soon” with real block config path.
- Add planner support in agent catalog/compiler.

Exit criteria:
- User can create Ostium workflow from UI and from agent prompt.

---

## 11) Re-Verification Checklist (Before Implementation + Before Release)

## 11.1 SDK/docs correctness re-check
- Reconfirm latest official SDK version on PyPI.
- Reconfirm constructor and async method signatures against official docs/repo.
- Reconfirm any delegation-related API semantics.

## 11.2 Security re-check
- HMAC enforced on all non-health endpoints.
- No plaintext private key acceptance from external/public requests.
- No disabled SSL verification in production path.

## 11.3 Behavior re-check
- Testnet/mainnet network switch correctness.
- Error normalization consistency for known SDK/chain errors.
- Idempotency behavior for open/close retries.

## 11.4 Integration re-check
- Backend timeout/retry values tuned and validated under failure simulation.
- API response envelopes consistent with backend conventions.
- Logs include request IDs and omit secrets.

---

## 12) Risks and Mitigations

1. SDK drift (high release velocity)
- Mitigation: pin version, contract tests, scheduled dependency review.

2. RPC/subgraph instability
- Mitigation: controlled retries, fallback endpoints, fail-fast error classes.

3. Delegation/key handling complexity
- Mitigation: keep key lifecycle centralized; avoid leaking into HTTP payload contracts.

4. Workflow schema coupling
- Mitigation: ship API integration first, add workflow node only after stable service contract.

---

## 13) Final Recommendation
Proceed with a **clean, minimal, authenticated `ostium-service`** and integrate it into backend exactly like the llm-service pattern (internal service boundary + signed requests), then expand to workflow/frontend/agent in later phases.

Do **not** directly adopt `/home/darshit/Downloads/ostium-service.py` as production code; use it only as a reference for feature coverage.
