# EOA Relayer Guide

## Overview

This project uses a **custom relayer EOA** to sponsor gas for Safe wallet creation and module enablement on-chain.

## Why

This approach has **no vendor rate limits** and supports **dynamic Safe addresses** without whitelisting.

## Relayer Configuration

```bash
# Arbitrum Sepolia RPC endpoint
ARBITRUM_SEPOLIA_RPC_URL=sepolia_rpc_url

# Relayer EOA private key
RELAYER_PRIVATE_KEY=0xyour_private_key

# Safe contract addresses for Arbitrum
SAFE_FACTORY_ADDRESS_421614=0xsepolia_factory_address
SAFE_FACTORY_ADDRESS_42161=0xmainnet_factory_address

SAFE_MODULE_ADDRESS_421614=0xsepolia_module_address
SAFE_MODULE_ADDRESS_42161=0xmainnet_module_address
```

## Rate Limit Configuration

```bash
RELAY_MAX_TXS_PER_USER_PER_DAY=5
```

## Relayer Wallet Creation

```bash
# Generate a new wallet
node -e "const ethers = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('Address:', w.address, '\nPrivate Key:', w.privateKey)"
```

**Output example:**

```bash
Address: 0x1234...5678
Private Key: 0xabcd...ef01
```

**Fund the Relayer Wallet with ETH and add Private Key to .env**

```bash
RELAYER_PRIVATE_KEY=0xabcd...ef01
```

## API Endpoints

### POST /api/v1/relay/create-safe

Creates a Safe wallet with gas sponsored by the relayer EOA.

### POST /api/v1/relay/enable-module

Enables a Safe module with gas sponsored by the relayer EOA.
