# Example Workflows

This directory contains example workflow configurations demonstrating various use cases.

## swap-workflow-example.json

A simple automated swap workflow that:

- Triggers every hour via cron
- Swaps 10 USDC for WETH on Arbitrum using Uniswap
- Includes automatic retries and simulation

### To Use:

1. **Update the wallet address** in the workflow JSON:

   ```json
   "walletAddress": "0xYourActualWalletAddress"
   ```

2. **Create the workflow via API**:

   ```bash
   curl -X POST http://localhost:3000/api/workflows \
     -H "Content-Type: application/json" \
     -d @examples/swap-workflow-example.json
   ```

3. **The workflow will automatically execute every hour**, or you can trigger it manually:

   ```bash
   curl -X POST http://localhost:3000/api/workflows/{workflow-id}/execute \
     -H "Content-Type: application/json"
   ```

## More Complex Examples

### Multi-Step Swap Workflow

Create a workflow that:

1. Swaps USDC → WETH
2. Checks if WETH balance > threshold
3. If yes, swaps WETH → ARB

### Conditional Swap

Create a workflow that:

1. Fetches token price from oracle
2. Only executes swap if price is favorable
3. Sends notification on completion

## Building Your Own

Workflows follow this structure:

```json
{
  "name": "My Workflow",
  "nodes": [
    {
      "id": "unique-id",
      "type": "SWAP | TRIGGER | CONDITION | WEBHOOK",
      "config": { /* node-specific config */ }
    }
  ],
  "edges": [
    {
      "sourceNodeId": "node-1",
      "targetNodeId": "node-2"
    }
  ],
  "triggerNodeId": "trigger-node-id"
}
```

See `ARCHITECTURE.md` for complete documentation.
