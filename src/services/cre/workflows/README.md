# CRE Workflows (Hackathon-Only)

This folder contains local Chainlink CRE workflows used **only** for the hackathon demo.
They are executed via the `cre` CLI (`cre workflow simulate`) and are **not** deployed
to a CRE network.

## Structure:

- `cre/oracle/` – Chainlink price oracle workflow.
- `cre/lifi-swap/` – LI.FI swap workflow.

## Setup (one-time per workflow):

```bash
./scripts/install-workflow-dependency.sh
```

Create the `.env` file in the root directory and add the following environment variables:

```bash
# Executor key for LI.FI module execution (workflow reads secret EXECUTOR_PRIVATE_KEY from this env var)
CRE_EXECUTOR_PRIVATE_KEY=0x...
# Optional alias
CRE_ETH_PRIVATE_KEY=0x...
```

This script must run on the machine that has the `cre` CLI installed. The backend assumes the workflows are already built and will NOT run `bun install` per execution.

## Execution model:

- The backend writes per-execution artifacts into each workflow's `workflow/` folder:
  - `workflow/payload-<executionId>.json`
  - `workflow/result-<executionId>.json`
  - `workflow/result-workflow.json`
- Oracle workflow runs quote/read simulation only:

  ```bash
  cre workflow simulate ./workflow --target <target> --non-interactive --trigger-index 1 --http-payload @<absolute_payload_path>
  ```

- LI.FI swap workflow runs module execution in broadcast mode:

  ```bash
  cre workflow simulate ./workflow --target <target> --non-interactive --broadcast --trigger-index 1 --http-payload @<absolute_payload_path>
  ```

- The workflow's `main.ts` returns a JSON string; the backend CLI runner parses the
  `Workflow Simulation Result` from stdout and writes a per-execution result file
  (`result-<executionId>.json`) for debugging.

This approach is **hackathon-only** and must remain on the `feat/integrate-cre` branch.
