# Chainlink Usage — Flow Forge

**Submission field:** *"Chainlink Usage — Please share the repo link to the specific piece of code that shows how you're using Chainlink in your project"*

---

## How We Use Chainlink

Flow Forge uses **Chainlink CRE** to run workflow steps in a deterministic, consensus-backed way. We use the **`@chainlink/cre-sdk`** TypeScript SDK and execute workflows via the CRE CLI (`cre workflow simulate`) for oracle price reads and LI.FI swap execution. This gives verified outcomes instead of trusting a single backend.

---

## Specific Code Locations (paths relative to repo root)

### 1. CRE SDK usage — Oracle workflow (Chainlink price feeds)

- **Path:** `./workflows/oracle/workflow/main.ts`
- **What it does:** Uses `@chainlink/cre-sdk` (`Runner`, `Runtime`, `HTTPPayload`, `cre.capabilities.EVMClient`, `getNetwork`, `encodeCallMsg`, `decodeFunctionResult`, etc.) to read Chainlink Price Feed Aggregator data on-chain in a CRE workflow. Returns price and metadata for configured feeds.

### 2. CRE SDK usage — LI.FI swap workflow (Safe module execution)

- **Path:** `./workflows/lifi-swap/workflow/main.ts`
- **What it does:** Uses `@chainlink/cre-sdk` (`Runner`, `Runtime`, `HTTPPayload`, `HTTPClient`, `HTTPSendRequester`, `consensusIdenticalAggregation`, `handler`, `CronCapability`, `HTTPCapability`) to fetch a LI.FI quote over HTTP in a consensus-backed way, then builds and sends the Flow Forge Safe module `execTask` transaction (EVM send via executor key). This is where Chainlink CRE drives the actual on-chain swap execution.

### 3. Backend CRE CLI runner (invokes CRE workflows)

- **Path:** `./creCliRunner.ts`
- **What it does:** Builds payloads and runs the CRE CLI (`cre workflow simulate ./workflow --target staging-settings --non-interactive [--broadcast] --trigger-index 1 --http-payload @payload.json`) for oracle and LI.FI workflows. Exports `simulateOracleCli`, `simulateLifiQuoteCli`, and `executeLifiSwapCli`, which are the backend entry points for Chainlink CRE execution.

### 4. Workflow engine integration (where CRE is triggered)

- **Path (Oracle):** `backend/src/services/workflow/processors/OracleNodeProcessor.ts`  
  - Calls `simulateOracleCli()` from `creCliRunner.ts` when processing oracle nodes.
- **Path (Swap):** `backend/src/services/workflow/processors/SwapNodeProcessor.ts`  
  - When `CRE_CLI_MODE=true` and provider is LI.FI, calls `executeLifiSwapCli()` (and thus the CRE LI.FI workflow) with the user’s Safe address and chain config.

### 5. CRE workflow layout and config

- **Path:** `backend/src/services/cre/workflows/`
- **Contents:**  
  - `README.md` — structure and execution model for CRE workflows.  
  - `oracle/` — oracle workflow (`workflow/main.ts`, `project.yaml`, config, ABI).  
  - `lifi-swap/` — LI.FI swap workflow (`workflow/main.ts`, `project.yaml`, `secrets.yaml`, config).

---
