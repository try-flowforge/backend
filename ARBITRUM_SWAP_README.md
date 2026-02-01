# Arbitrum Swap Aggregator

A production-ready DEX aggregator supporting multiple swap providers on Arbitrum mainnet and testnet.

## Supported Networks

- **Arbitrum One** (Mainnet - Chain ID: 42161)
- **Arbitrum Sepolia** (Testnet - Chain ID: 421614)

## Supported Providers

| Provider | Arbitrum Mainnet | Arbitrum Sepolia | API Key Required |
| -------- | ---------------- | ---------------- | ---------------- |
| **Uniswap V3** | Yes | Yes | No |
| **Relay** | Yes | Yes | Optional |
| **1inch** | Yes | No (mainnet only) | Yes |

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configuration

Create `.env` file:

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Redis
REDIS_URL=redis://localhost:6379

# Arbitrum RPC
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# API Keys (Optional)
RELAY_API_KEY=your_relay_api_key
ONEINCH_API_KEY=your_1inch_api_key

# For Testing/Execution
TEST_WALLET_PRIVATE_KEY=your_private_key_here
```

### 3. Database Setup

```bash
npm run migrate
```

### 4. Start Server

```bash
npm run dev
```

## Testing

The API can be tested using direct HTTP requests with curl or Postman to the endpoints described below.

**Prerequisites for testing swaps**:

- WETH in your wallet (wrap ETH first)
- At least 0.00002 ETH for swap + gas

**Note**: Arbitrum Sepolia has limited liquidity on testnet - quotes may fail.

## API Endpoints

### Get Quote

```bash
POST /api/v1/swaps/quote/:provider/:chain
```

**Example**:

```bash
curl -X POST http://localhost:3000/api/v1/swaps/quote/UNISWAP/ARBITRUM \
  -H "Content-Type: application/json" \
  -d '{
    "sourceToken": {
      "address": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "symbol": "WETH",
      "decimals": 18
    },
    "destinationToken": {
      "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "symbol": "USDC",
      "decimals": 6
    },
    "amount": "10000000000000",
    "swapType": "EXACT_INPUT",
    "walletAddress": "0xYourAddress",
    "slippageTolerance": 0.5
  }'
```

### Get Supported Providers

```bash
GET /api/v1/swaps/providers/:chain
```

**Example**:

```bash
curl http://localhost:3000/api/v1/swaps/providers/ARBITRUM
```

## Token Addresses (Arbitrum Mainnet)

```javascript
WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
ARB:  '0x912CE59144191C1204E64559FE8253a0e49E6548'
```

## Uniswap V3 Contracts (Arbitrum)

### Mainnet

- SwapRouter02: `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`
- QuoterV2: `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`
- Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`

### Sepolia

- SwapRouter02: `0x101F443B4d1b059569D643917553c771E1b9663E`
- QuoterV2: `0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B`
- Factory: `0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e`

## Features

### Swap Providers

- Uniswap V3 with multi-fee-tier support
- Relay for cross-chain operations
- 1inch for DEX aggregation

### Workflow System

- Create multi-step workflows
- Trigger-based execution
- Swap nodes with multiple providers
- Queue-based job processing

### Production Ready

- PostgreSQL database
- Redis caching
- BullMQ job queues
- Comprehensive error handling
- Request logging
- TypeScript

## Cost Estimates (Arbitrum Mainnet)

| Operation | Gas | Cost (@ 0.1 gwei) | USD (@ $3000/ETH) |
| --------- | --- | ----------------- | ----------------- |
| Uniswap Swap | ~92k | 0.0000092 ETH | ~$0.028 |
| Approval | ~46k | 0.0000046 ETH | ~$0.014 |
| **Total First Swap** | ~138k | 0.0000138 ETH | ~$0.042 |

*Subsequent swaps only need ~92k gas (no approval needed)*

## Testing Recommendations

1. **For Development**: Use Arbitrum Sepolia (free testnet)
   - Limited liquidity
   - Free testnet tokens
   - May not get quotes due to no liquidity

2. **For Integration Testing**: Use Arbitrum Mainnet with small amounts
   - Real liquidity (~$0.03 per test swap)
   - Accurate quotes and execution
   - Verifiable on Arbiscan

## Verification

After executing swaps, verify on:

- **Mainnet**: https://arbiscan.io
- **Sepolia**: https://sepolia.arbiscan.io

## Documentation

- **Provider Support Matrix**: `PROVIDER_SUPPORT_MATRIX.md`
- **Quick Answer Guide**: `QUICK_ANSWER.md`
- **Swap Execution Flow**: `SWAP_EXECUTION_FLOW.md`

## Production Deployment

1. Set environment variables
2. Configure database and Redis
3. Run migrations
4. Start worker processes
5. Deploy with proper monitoring

```bash
npm run build
npm run migrate
npm start
npm run worker  # In separate process
```
