# LI.FI CRE Module-Only Testing

This checklist validates the hackathon flow where CRE executes swaps via `FlowForgeSafeModule.execTask(...)` and never requests user signature.

## Prerequisites

- `SAFE_MODULE_ADDRESS_<CHAIN_ID>` is configured in backend env.
- User Safe exists and module is enabled.
- Spending policy is active on-chain for the Safe.
- `CRE_EXECUTOR_PRIVATE_KEY` (or `CRE_ETH_PRIVATE_KEY`) is set so the workflow secret `EXECUTOR_PRIVATE_KEY` is available.
- Workflow dependencies are installed (`./scripts/install-workflow-dependency.sh`).

## Test Case 1: In-limit swap should execute

1. Trigger a workflow containing a LI.FI swap node on the configured chain.
2. Use an amount that is clearly below per-tx and daily limits.
3. Observe node output:
   - `success: true`
   - `txHash` present
   - no `requiresSignature` payload
4. Confirm transaction exists on explorer and corresponds to module execution.

## Test Case 2: Above-limit swap should reject

1. Trigger the same workflow with an amount above policy limit.
2. Observe node output:
   - `success: false`
   - `error.code` is `SPENDING_POLICY_REJECTED` (or module rejection code)
   - no `requiresSignature` payload
3. Confirm workflow does not enter `WAITING_FOR_SIGNATURE`.

## Test Case 3: Missing executor secret should fail fast

1. Remove `CRE_EXECUTOR_PRIVATE_KEY`/`CRE_ETH_PRIVATE_KEY` from environment.
2. Trigger a LI.FI swap node.
3. Observe deterministic failure with `EXECUTOR_KEY_MISSING`.

## Rollout Notes

- Start on Arbitrum Sepolia only.
- Monitor first 5-10 executions for:
  - policy rejections vs successful module txs
  - CRE CLI stdout parse stability
  - tx broadcast success rate
- After stable behavior, promote to Arbitrum mainnet environment config.
