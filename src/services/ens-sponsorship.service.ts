import {
  SPONSORED_TXS_PER_PERIOD,
  ENS_PRICER_PERIOD_SECONDS,
  ensConfig,
  ENS_CHAIN_IDS,
  type EnsChainId,
} from '../config/config';
/**
 * Sponsorship allowance from FlowForgeEthUsdcPricer: 3 sponsored txs per 0.5 USDC per 1 week.
 * So for a given duration in seconds: allowance = floor((duration / PERIOD_SECONDS) * 3).
 */
export function sponsorshipAllowanceFromDuration(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const periods = durationSeconds / ENS_PRICER_PERIOD_SECONDS;
  const allowance = Math.floor(periods * SPONSORED_TXS_PER_PERIOD);
  return Math.max(0, allowance);
}

/**
 * Optional: fetch price from FlowForgeEthUsdcPricer and derive allowance.
 * allowance = (usdcPriceAmount / PRICE_PER_PERIOD) * SPONSORED_TXS_PER_PERIOD.
 * PRICE_PER_PERIOD = 0.5e6 (6 decimals). Not required for basic flow since we use duration.
 */
const PRICE_PER_PERIOD_USDC = 5 * 10 ** 5; // 0.5 USDC, 6 decimals

export function sponsorshipAllowanceFromUsdcAmount(usdcAmount6Decimals: number): number {
  if (usdcAmount6Decimals <= 0) return 0;
  const periods = usdcAmount6Decimals / PRICE_PER_PERIOD_USDC;
  return Math.floor(periods * SPONSORED_TXS_PER_PERIOD);
}

/**
 * Get ENS config for a chain (registry + pricer addresses). Returns null if not configured.
 */
export function getEnsConfigForChain(chainId: number): {
  registryAddress: string;
  pricerAddress: string;
  rpcUrl?: string;
} | null {
  if (chainId !== ENS_CHAIN_IDS.ETHEREUM_MAINNET && chainId !== ENS_CHAIN_IDS.ETHEREUM_SEPOLIA) {
    return null;
  }
  const cfg = ensConfig[chainId as EnsChainId];
  if (!cfg || !cfg.registryAddress || !cfg.pricerAddress) {
    return null;
  }
  return cfg;
}
