# Aave Lending — CRE Starter Template

Config-driven CRE workflow that performs a single Aave V3 Pool operation
(**supply**, **withdraw**, **borrow**, **repay**) on a single chain.

Config shape is aligned with FlowForge `LendingNodeConfig` so the same config
can be sent from the frontend, agent, or CLI.

## How It Works

| Aspect      | Detail |
|-------------|--------|
| Trigger     | **HTTP only** — immediate execution, no scheduled/delayed runs. |
| Config      | File config provides defaults; the HTTP payload can override any field per invocation. |
| Environment | `staging-settings` → testnet chains (e.g. `ARBITRUM_SEPOLIA`). `production-settings` → mainnet chains (e.g. `ARBITRUM`). Configurable via `chain` in the API call. |
| Execution   | CRE report → `AaveReceiver` contract → Aave V3 Pool. |
| Result      | `{ success, txHash?, operation, amount, chain, error? }` |

## Dynamic Config via HTTP Payload

The workflow reads defaults from the config file (`config.staging.json` or
`config.production.json` depending on which target you simulate against), then
deep-merges any fields sent in the HTTP payload on top.

**Blank payload** → runs with file defaults as-is.

**Partial payload** → overrides only the fields you send:

```jsonc
// Example: override operation, amount, and chain at invocation time
{
  "chain": "ARBITRUM_SEPOLIA",
  "inputConfig": {
    "operation": "BORROW",
    "amount": "5000000",
    "walletAddress": "0xYourWallet..."
  }
}
```

**Full payload** → replaces everything:

```jsonc
{
  "chain": "ARBITRUM",
  "provider": "AAVE",
  "aaveReceiverAddress": "0xDeployedReceiver...",
  "gasLimit": "500000",
  "inputConfig": {
    "operation": "SUPPLY",
    "asset": { "address": "0xUSDC...", "symbol": "USDC", "decimals": 6 },
    "amount": "1000000",
    "walletAddress": "0xYourWallet...",
    "interestRateMode": "VARIABLE"
  }
}
```

## Chain Resolution

You only need to pass `chain` — the workflow auto-resolves `poolAddress` and
`chainSelectorName` from its built-in registry:

| Chain               | Pool Address                                 | Chain Selector Name                        | Testnet? |
|---------------------|----------------------------------------------|--------------------------------------------|----------|
| `ARBITRUM_SEPOLIA`  | `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff` | `ethereum-testnet-sepolia-arbitrum-1`      | Yes      |
| `ETHEREUM_SEPOLIA`  | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | `ethereum-testnet-sepolia-1`              | Yes      |
| `ARBITRUM`          | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `ethereum-mainnet-arbitrum-1`             | No       |
| `ETHEREUM`          | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `ethereum-mainnet-1`                      | No       |

You can still pass `poolAddress` and `chainSelectorName` explicitly to override
the registry (e.g. for a custom fork or new chain).

## Setup

### 1. Deploy AaveReceiver

**Prerequisites:** [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`),
ETH on the target chain for gas.

```bash
cd starter-templates/aave-lending/contracts
git submodule update --init --recursive

export PRIVATE_KEY=0x...

forge script scripts/DeployAaveReceiver.s.sol:DeployAaveReceiver \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --broadcast --chain-id 421614 \
  --verify --verifier-api-key $ETHERSCAN_API_KEY
```

Copy the deployed address and set it in `aaveReceiverAddress` (in the config
file or in each HTTP payload).

### 2. Token Approvals

The wallet in `inputConfig.walletAddress` must hold tokens and approve the
AaveReceiver contract:

| Operation | Approval required |
|-----------|-------------------|
| SUPPLY    | Approve AaveReceiver for the underlying token (e.g. USDC) |
| WITHDRAW  | Approve AaveReceiver for the aToken |
| BORROW    | None; borrowed funds are forwarded to the wallet |
| REPAY     | Approve AaveReceiver for the borrowed asset |

```bash
cast send <TOKEN_ADDRESS> \
  "approve(address,uint256)" <AAVE_RECEIVER_ADDRESS> \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $PRIVATE_KEY
```

### 3. Run the Workflow

```bash
cd starter-templates/aave-lending/aave-lending-ts/workflow
bun install   # or npm install

# Run with file defaults (blank payload):
cre workflow simulate workflow \
  --target staging-settings \
  --trigger-index 0 \
  --non-interactive \
  --http-payload '{}'

# Run with config overrides in the payload:
cre workflow simulate workflow \
  --target staging-settings \
  --trigger-index 0 \
  --non-interactive \
  --http-payload '{
    "chain": "ARBITRUM_SEPOLIA",
    "aaveReceiverAddress": "0xYourReceiver...",
    "inputConfig": {
      "operation": "SUPPLY",
      "asset": { "address": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
      "amount": "1000000",
      "walletAddress": "0xYourWallet..."
    }
  }'

# Production (mainnet):
cre workflow simulate workflow \
  --target production-settings \
  --trigger-index 0 \
  --non-interactive \
  --http-payload '{}'
```

- `--target staging-settings` → uses `config.staging.json` (testnet defaults)
- `--target production-settings` → uses `config.production.json` (mainnet defaults)
- `--trigger-index 0` → HTTP trigger (the only trigger registered)

> `cre workflow simulate` runs locally in simulation mode. To submit reports
> on-chain you need a registered CRE workflow and DON.

## Config Shape Reference

```jsonc
{
  "chain": "ARBITRUM_SEPOLIA",        // Chain name — resolves pool + selector from registry
  "chainSelectorName": "...",         // Optional — auto-resolved from chain
  "provider": "AAVE",
  "aaveReceiverAddress": "0x...",     // Deployed AaveReceiver (required)
  "poolAddress": "0x...",             // Optional — auto-resolved from chain
  "gasLimit": "500000",
  "inputConfig": {
    "operation": "SUPPLY",            // SUPPLY | WITHDRAW | BORROW | REPAY
    "asset": {
      "address": "0x...",
      "symbol": "USDC",              // optional
      "decimals": 6,                 // optional
      "aTokenAddress": "0x..."       // optional; fetched from Pool for WITHDRAW if omitted
    },
    "amount": "1000000",             // wei / smallest unit
    "walletAddress": "0x...",        // executor wallet
    "interestRateMode": "VARIABLE",  // STABLE | VARIABLE (default VARIABLE)
    "onBehalfOf": "",                // defaults to walletAddress
    "referralCode": 0
  },
  "simulateFirst": true              // optional
}
```

> `ENABLE_COLLATERAL` and `DISABLE_COLLATERAL` require the user to call
> `Pool.setUserUseReserveAsCollateral(asset, useAsCollateral)` directly.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `AaveReceiver: supply transferFrom failed` | Wallet lacks underlying tokens or hasn't approved AaveReceiver. |
| `AaveReceiver: withdraw transferFrom failed` | Wallet lacks aTokens or hasn't approved AaveReceiver for the aToken. |
| `AaveReceiver: repay transferFrom failed` | Fund the wallet with the borrowed asset and approve AaveReceiver. |
| `No poolAddress configured and chain "X" is not in the registry` | Add the chain to `CHAIN_REGISTRY` in `main.ts` or pass `poolAddress` explicitly. |

## Structure

```
starter-templates/aave-lending/
├── README.md
├── aave-lending-ts/
│   ├── contracts/abi/
│   │   ├── IPool.ts                    # Aave V3 Pool minimal ABI
│   │   └── index.ts
│   └── workflow/
│       ├── main.ts                     # CRE workflow (HTTP trigger, config merge)
│       ├── workflow.yaml               # CRE settings (staging + production targets)
│       ├── config.staging.json         # Testnet defaults (Arb Sepolia)
│       ├── config.production.json      # Mainnet defaults (Arb One)
│       └── package.json
└── contracts/
    ├── foundry.toml
    ├── remappings.txt
    ├── scripts/DeployAaveReceiver.s.sol
    └── src/
        ├── AaveReceiver.sol
        └── keystone/
            ├── IERC165.sol
            └── IReceiver.sol
```
