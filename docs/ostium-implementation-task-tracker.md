# Ostium Implementation Task Tracker

## Usage
- Mark tasks complete with `[x]` when done.
- Keep `Status` updated per phase.
- Update `Last Updated` whenever progress changes.

## Tracking Meta
- Owner: _TBD_
- Status: `In Progress`
- Start Date: `2026-02-21`
- Target Completion Date: _TBD_
- Last Updated: `2026-02-21`

## Current Verification Snapshot
- [x] `flowforge-backend`: `npm run build` passed.
- [x] `flowforge-agent`: `npm run build` passed.
- [x] `flowforge-frontend`: `npx tsc --noEmit` and `npm run lint` passed.
- [x] `flowforge-ostium-service`: `python3 -m compileall app` passed.
- [ ] `flowforge-frontend`: `npm run build` blocked in sandbox due external Google Fonts fetch restrictions.

## Runtime Smoke Validation (Completed on 2026-02-21)
- [x] `flowforge-ostium-service` boots and serves `GET /health` and `GET /ready`.
- [x] `flowforge-ostium-service` accepts valid HMAC request for `POST /v1/markets/list`.
- [x] `flowforge-backend` boots with DB + Redis healthy.
- [x] Backend migration `042/043/044` executed successfully (`npm run migrate:up`).
- [x] Backend `POST /api/v1/ostium/markets/list` successfully proxies to ostium-service (service-key auth path).
- [x] Backend ownership guard returns expected error for non-owned safe on `POST /api/v1/ostium/accounts/balance`.
- [x] `flowforge-frontend` dev server boots and serves home page content.
- [ ] Agent runtime testing intentionally skipped for this round (per request).

---

## Completion Criteria (Definition of Done)
- [ ] Safe-funded user can trade on Ostium via delegation model.
- [ ] Testnet path is fully working end-to-end.
- [ ] Mainnet path is fully working end-to-end with safeguards.
- [x] Backend + ostium-service integration is stable and HMAC-secured.
- [x] Frontend Ostium block is executable (not coming soon).
- [x] Agent can create/compile Ostium workflows.
- [ ] All required tests pass (unit, contract, integration, e2e).
- [ ] Observability, alerting, and rollback controls are verified.

---

## Phase 0: Contract and Scope Freeze
Status: `In Progress`

- [x] Finalize backend <-> ostium-service endpoint contract.
- [x] Finalize request/response schema for each endpoint.
- [x] Finalize normalized error code catalog.
- [x] Freeze supported networks to Arbitrum Sepolia + Arbitrum Mainnet.
- [x] Freeze SDK version pin (`ostium-python-sdk`).
- [x] Document idempotency behavior for open/close actions.
- [ ] Security sign-off for secret handling and auth boundary.

Exit Criteria
- [x] No unresolved API shape questions.
- [ ] No unresolved security boundary questions.

---

## Phase 1: New Repo Setup (`flowforge-ostium-service`)
Status: `Completed`

- [x] Create new repository and baseline project structure.
- [x] Add `README.md` with local run + deployment notes.
- [x] Add `.env.example` with required configuration keys.
- [x] Add containerization (`Dockerfile`) and run command.
- [x] Add lint/test tooling baseline.
- [x] Add health/liveness endpoint (`GET /health`).
- [x] Add readiness endpoint (`GET /ready`).

Exit Criteria
- [x] Service builds and starts locally.
- [x] Health/readiness endpoints are operational.

---

## Phase 2: Security and Reliability Foundation
Status: `In Progress`

- [x] Implement HMAC verification for all `/v1/*` routes.
- [x] Validate `x-timestamp` freshness window and replay resistance.
- [ ] Enforce internal-only exposure (no public direct access).
- [x] Restrict CORS policy to internal service requirements.
- [ ] Add structured logging with `requestId`.
- [ ] Add secret redaction in logs.
- [x] Add timeout and retry policy wrapper for SDK calls.
- [x] Add per-endpoint error normalization utility.

Exit Criteria
- [x] Unsigned/expired requests fail correctly.
- [x] Signed requests pass.
- [ ] Logs contain correlation IDs and no secret leakage.

---

## Phase 3: SDK Adapter and Core Endpoints
Status: `Completed`

- [x] Implement SDK network mapper (`testnet`/`mainnet`).
- [x] Implement `/v1/markets/list`.
- [x] Implement `/v1/prices/get`.
- [x] Implement `/v1/accounts/balance`.
- [x] Implement `/v1/positions/list`.
- [x] Implement `/v1/positions/open`.
- [x] Implement `/v1/positions/close`.
- [x] Implement `/v1/positions/update-sl`.
- [x] Implement `/v1/positions/update-tp`.
- [x] Implement idempotency key handling for write endpoints.
- [x] Implement deterministic response envelope for success/error.

Exit Criteria
- [x] All contract endpoints return schema-compliant responses.
- [x] Write endpoints are idempotent under retried requests.

---

## Phase 4: Backend Integration
Status: `Completed`

- [x] Add backend env vars:
  - [x] `OSTIUM_SERVICE_BASE_URL`
  - [x] `OSTIUM_SERVICE_HMAC_SECRET`
  - [x] `OSTIUM_REQUEST_TIMEOUT_MS`
  - [x] `OSTIUM_ENABLED`
- [x] Add `src/services/ostium/ostium-service-client.ts`.
- [x] Add backend request signing + retry logic for ostium-service calls.
- [x] Add backend types for Ostium request/response contracts.
- [x] Add backend controllers for Ostium operations.
- [x] Add backend routes for Ostium operations.
- [x] Add auth and ownership checks (user must own requested Safe).
- [x] Add backend feature-flag gating for Ostium routes.

Exit Criteria
- [x] Backend can successfully proxy read/write calls to ostium-service.
- [x] Unauthorized or invalid ownership requests are blocked.

---

## Phase 5: Safe Delegation Lifecycle
Status: `In Progress`

- [x] Define delegate identity model (`userId + network + safeAddress + delegateAddress`).
- [x] Add backend table: `ostium_delegations`.
- [x] Add delegation status service layer.
- [x] Add endpoint to prepare delegate-approval Safe transaction.
- [x] Add endpoint to execute signed delegate-approval transaction.
- [x] Add endpoint to query delegation status.
- [x] Add endpoint to revoke delegation.
- [x] Ensure no user private key is ever accepted in API payload.
- [ ] Integrate secure delegate key retrieval (vault/secret manager).

Exit Criteria
- [ ] User can complete one-time delegation from Safe on testnet.
- [ ] Delegation status is persisted and queryable.

---

## Phase 6: Workflow Engine Integration (`PERPS` Node)
Status: `In Progress`

- [x] Add `PERPS` to backend node type enum.
- [x] Add migration to update node-type constraints.
- [x] Add `PerpsNodeProcessor` implementation.
- [x] Register `PerpsNodeProcessor` in `NodeProcessorFactory`.
- [x] Add workflow validation schema for perps node config.
- [x] Add execution persistence model/table for perps actions.
- [x] Add execution event emissions and status updates.
- [ ] Add retry semantics for recoverable failures.

Exit Criteria
- [ ] Workflow execution engine runs PERPS node successfully.
- [ ] PERPS execution records persist correctly.

---

## Phase 7: Frontend Block Enablement
Status: `Completed`

- [x] Replace Ostium "coming soon" block with executable block definition.
- [x] Add block config UI for:
  - [x] Network
  - [x] Market
  - [x] Side
  - [x] Size/Collateral
  - [x] Leverage
  - [x] Stop-loss
  - [x] Take-profit
  - [x] Action type (open/close/update SL/update TP)
- [x] Wire frontend API client to backend Ostium endpoints.
- [x] Add delegation setup/status UX in onboarding or block flow.
- [x] Add preflight validation UX and clear error states.

Exit Criteria
- [x] User can configure and execute Ostium block from UI.
- [x] UI blocks execution when delegation is missing.

---

## Phase 8: Agent Integration
Status: `Completed`

- [x] Add Ostium entry in planner block catalog.
- [x] Add compiler mapping from planner output -> backend `PERPS` node.
- [x] Add planner prompt guidance for perps actions + required fields.
- [x] Add planner validation rules for Ostium block payload completeness.
- [x] Add fallback behavior when required fields are missing.

Exit Criteria
- [x] Agent-generated workflow with Ostium block compiles and executes.

---

## Phase 9: Testnet Validation (Mandatory)
Status: `Not Started`

- [ ] Unit tests for ostium-service:
  - [ ] HMAC auth verification
  - [ ] Request validation
  - [ ] Network mapping
  - [ ] Error normalization
  - [ ] Idempotency behavior
- [ ] Contract tests backend <-> ostium-service for all endpoints.
- [ ] Integration tests on Arbitrum Sepolia:
  - [ ] Delegation approval
  - [ ] Open position
  - [ ] List positions
  - [ ] Update SL
  - [ ] Update TP
  - [ ] Close position
- [ ] E2E workflow test from frontend block to chain execution.
- [ ] Failure tests:
  - [ ] Invalid market
  - [ ] Insufficient balance
  - [ ] Timeout/retry
  - [ ] Duplicate idempotent request replay
  - [ ] Missing delegation

Exit Criteria
- [ ] All critical testnet cases pass.

---

## Phase 10: Mainnet Readiness and Rollout
Status: `Not Started`

- [ ] Mainnet read-only validation (markets, price, balance, positions).
- [ ] Mainnet controlled write validation with allowlisted wallets.
- [ ] Configure observability dashboard and alerts.
- [ ] Configure error budget/SLOs for service health.
- [ ] Add kill switch (`OSTIUM_ENABLED=false`) and verify rollback.
- [ ] Run phased rollout:
  - [ ] Internal
  - [ ] Canary users
  - [ ] Limited mainnet write
  - [ ] General availability

Exit Criteria
- [ ] Mainnet flows stable under monitoring.
- [ ] Rollback path validated.

---

## Cross-Cutting Security Checklist
- [ ] No plaintext private keys in external/public API payloads.
- [ ] All inter-service calls are HMAC-signed.
- [ ] Secret storage uses vault/secure manager, not plain DB fields.
- [ ] TLS verification remains enabled in production.
- [ ] Request logs never print secret material.

---

## Cross-Cutting Operations Checklist
- [ ] SLOs defined (latency, error rate, availability).
- [ ] Alert routing configured for ostium-service failures.
- [ ] On-call runbook documented.
- [ ] Incident rollback checklist documented.

---

## Final Release Gate
- [ ] Testnet full path passed.
- [ ] Mainnet read/write validation passed.
- [ ] Backend workflow PERPS node passed.
- [ ] Frontend executable Ostium block passed.
- [ ] Agent planning flow passed.
- [ ] Security review passed.
- [ ] Observability/rollback passed.
