# HackMoney Bounty

## Uniswap v4 Agentic Finance

Making a swap from USDC ($5) to ETH on Base:

- TX: https://basescan.org/tx/0x8fe21d1957b7b3a3acc8ec5d9f5a10b16146d7b2051c5c18a2783fd86b6a9046
- TX: https://basescan.org/tx/0xdc00ee731a999a871911f1822360849b28318f233dd49a4bfea8c3cc815244ff

### Files which show the Uniswap v4 implementations

**Backend**

- [backend/src/services/swap/providers/UniswapV4Provider.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/providers/UniswapV4Provider.ts) — Uniswap V4 quote and transaction building (Quoter + Universal Router)
- [backend/src/services/swap/SwapExecutionService.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/SwapExecutionService.ts) — Swap execution (Permit2 approval + Universal Router execution)
- [backend/src/services/swap/providers/SwapProviderFactory.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/providers/SwapProviderFactory.ts) — Registers Uniswap V4 provider
- [backend/src/config/chains.ts](https://github.com/try-flowforge/backend/blob/main/src/config/chains.ts) — Chain config: `uniswapV4Quoter`, `universalRouter`, Permit2 per chain (Arbitrum One, Sepolia, etc.)
- [backend/src/services/swap/abis/quoter.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/abis/quoter.ts) — Uniswap V4 Quoter ABI
- [backend/src/services/swap/abis/universalRouter.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/abis/universalRouter.ts) — Uniswap Universal Router ABI
- [backend/src/migrations/028_add_uniswap_v4_swap_provider.ts](https://github.com/try-flowforge/backend/blob/main/src/migrations/028_add_uniswap_v4_swap_provider.ts) — Migration adding Uniswap V4 as swap provider

**Frontend**

- [frontend/src/blocks/definitions/defi/uniswap.ts](https://github.com/try-flowforge/frontend/blob/main/src/blocks/definitions/defi/uniswap.ts) — Uniswap block definition
- [frontend/src/blocks/configs/defi/swap/SwapNodeConfiguration.tsx](https://github.com/try-flowforge/frontend/blob/main/src/blocks/configs/defi/swap/SwapNodeConfiguration.tsx) — Swap UI; Uniswap V4 uses Permit2 + Universal Router approval flow
- [frontend/src/blocks/utils/backend-mapping.ts](https://github.com/try-flowforge/frontend/blob/main/src/blocks/utils/backend-mapping.ts) — Maps `uniswap` node type to backend
- [frontend/src/types/swap.ts](https://github.com/try-flowforge/frontend/blob/main/src/types/swap.ts) — Swap types and `SwapProvider.UNISWAP_V4`

---

## LI.FI

### Files which show the LI.FI implementations

**Backend**

- [backend/src/services/swap/providers/LiFiProvider.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/providers/LiFiProvider.ts) — LI.FI quote and transaction building (same-chain and cross-chain)
- [backend/src/services/swap/SwapExecutionService.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/SwapExecutionService.ts) — Executes LI.FI steps; uses approval from LI.FI response
- [backend/src/services/swap/providers/SwapProviderFactory.ts](https://github.com/try-flowforge/backend/blob/main/src/services/swap/providers/SwapProviderFactory.ts) — Registers LI.FI provider
- [backend/src/services/workflow/processors/SwapNodeProcessor.ts](https://github.com/try-flowforge/backend/blob/main/src/services/workflow/processors/SwapNodeProcessor.ts) — Passes `toChain` for LiFi cross-chain
- [backend/src/types/swap.types.ts](https://github.com/try-flowforge/backend/blob/main/src/types/swap.types.ts) — `toChain` and swap request types for cross-chain
- [backend/src/migrations/025_add_lifi_node_type.ts](https://github.com/try-flowforge/backend/blob/main/src/migrations/025_add_lifi_node_type.ts) — Migration adding LiFi node type
- [backend/src/migrations/026_add_lifi_swap_provider.ts](https://github.com/try-flowforge/backend/blob/main/src/migrations/026_add_lifi_swap_provider.ts) — Migration adding LI.FI swap provider

**Frontend**

- [frontend/src/blocks/definitions/defi/lifi.ts](https://github.com/try-flowforge/frontend/blob/main/src/blocks/definitions/defi/lifi.ts) — LI.FI block definition
- [frontend/src/blocks/configs/defi/swap/SwapNodeConfiguration.tsx](https://github.com/try-flowforge/frontend/blob/main/src/blocks/configs/defi/swap/SwapNodeConfiguration.tsx) — From/To chain selection and LiFi-specific UI
- [frontend/src/blocks/utils/backend-mapping.ts](https://github.com/try-flowforge/frontend/blob/main/src/blocks/utils/backend-mapping.ts) — Maps `lifi` node type and forces provider `LIFI`
- [frontend/src/types/swap.ts](https://github.com/try-flowforge/frontend/blob/main/src/types/swap.ts) — `SwapProvider.LIFI` and Base token set for cross-chain

---

## ENS

Claiming the ENS Domain:

- TX: https://sepolia.etherscan.io/tx/0x812280455f84136c0357fd1aaba8d66cd279ecd8168d2ced8058354708ed8bfb
- Page: https://sepolia.app.ens.domains/flowforge.eth

### Files which show the ENS implementations

**Frontend**

- [frontend/src/hooks/useEnsSubdomain.ts](https://github.com/try-flowforge/frontend/blob/main/src/hooks/useEnsSubdomain.ts) — Subdomain list, register/renew, price, chain switch for ENS
- [frontend/src/components/ens/ClaimEnsSubdomainModal.tsx](https://github.com/try-flowforge/frontend/blob/main/src/components/ens/ClaimEnsSubdomainModal.tsx) — Claim subdomain modal (label, duration, payment token, chain)
- [frontend/src/config/ens.ts](https://github.com/try-flowforge/frontend/blob/main/src/config/ens.ts) — `ENS_PARENT_NAME`, `ENS_CHAIN_IDS`, registry/pricer per chain
- [frontend/src/config/api.ts](https://github.com/try-flowforge/frontend/blob/main/src/config/api.ts) — ENS API endpoints (`/ens/subdomain-registered`, `/ens/subdomains`)
- [frontend/src/components/user-menu/UserMenu.tsx](https://github.com/try-flowforge/frontend/blob/main/src/components/user-menu/UserMenu.tsx) — ENS section and “Claim subdomain” opening the modal

**Backend**

- [backend/src/controllers/ens.controller.ts](https://github.com/try-flowforge/backend/blob/main/src/controllers/ens.controller.ts) — `POST /ens/subdomain-registered`, `GET /ens/subdomains`
- [backend/src/routes/ens.routes.ts](https://github.com/try-flowforge/backend/blob/main/src/routes/ens.routes.ts) — ENS route mounting
- [backend/src/services/ens-sponsorship.service.ts](https://github.com/try-flowforge/backend/blob/main/src/services/ens-sponsorship.service.ts) — Sponsorship allowance from duration; ENS config per chain
- [backend/src/config/config.ts](https://github.com/try-flowforge/backend/blob/main/src/config/config.ts) — `ENS_PRICER_PERIOD_SECONDS`, `ENS_CHAIN_IDS`, `ensConfig`
- [backend/src/models/ens/user_ens_subdomain.model.ts](https://github.com/try-flowforge/backend/blob/main/src/models/ens/user_ens_subdomain.model.ts) — User ENS subdomain upsert and queries
- [backend/src/models/ens/index.ts](https://github.com/try-flowforge/backend/blob/main/src/models/ens/index.ts) — ENS model exports
- [backend/src/migrations/030_create_user_ens_subdomains_table.ts](https://github.com/try-flowforge/backend/blob/main/src/migrations/030_create_user_ens_subdomains_table.ts) — `user_ens_subdomains` table
- [backend/src/middleware/schemas.ts](https://github.com/try-flowforge/backend/blob/main/src/middleware/schemas.ts) — Schema for ENS subdomain registration payload

### Contracts used

- [contracts/src/FlowForgeSubdomainRegistry.sol](https://github.com/try-flowforge/contracts/blob/main/src/FlowForgeSubdomainRegistry.sol) — Subdomain registrar for parent (e.g. `flowforge.eth`); register/renew with ETH or ERC-20 via pricer
- [contracts/src/FlowForgeEthUsdcPricer.sol](https://github.com/try-flowforge/contracts/blob/main/src/FlowForgeEthUsdcPricer.sol) — Pricer: 0.5 USDC per 1 week; ETH price via Chainlink ETH/USD
- [contracts/script/2_deployFlowForgeSubdomainRegistry.s.sol](https://github.com/try-flowforge/contracts/blob/main/script/2_deployFlowForgeSubdomainRegistry.s.sol) — Deploys registry + pricer (Ethereum mainnet)
- [contracts/src/interfaces/IFlowForgeSubdomainPricer.sol](https://github.com/try-flowforge/contracts/blob/main/src/interfaces/IFlowForgeSubdomainPricer.sol) — Pricer interface
- [contracts/src/interfaces/IFlowForgeSubdomainPricerMultiToken.sol](https://github.com/try-flowforge/contracts/blob/main/src/interfaces/IFlowForgeSubdomainPricerMultiToken.sol) — Multi-token pricer extension
- [contracts/src/interfaces/INameWrapper.sol](https://github.com/try-flowforge/contracts/blob/main/src/interfaces/INameWrapper.sol) — ENS Name Wrapper interface used by the registry
