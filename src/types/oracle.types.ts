import { SupportedChain } from './swap.types';

/**
 * Oracle Types (Chainlink Data Feeds)
 */
export enum OracleProvider {
  CHAINLINK = 'CHAINLINK',
}

export interface ChainlinkOracleConfig {
  provider: OracleProvider.CHAINLINK;
  chain: SupportedChain;

  /**
   * Chainlink AggregatorV3Interface feed address (e.g., ETH/USD).
   */
  aggregatorAddress: string;

  /**
   * Optional staleness guard. If set, fail when updatedAt is older than now - staleAfterSeconds.
   */
  staleAfterSeconds?: number;

  /**
   * Output mapping (for passing data to next nodes)
   */
  outputMapping?: Record<string, string>;
}

export type OracleNodeConfig = ChainlinkOracleConfig;

export interface ChainlinkPriceOutput {
  provider: OracleProvider.CHAINLINK;
  chain: SupportedChain;
  aggregatorAddress: string;

  description?: string;
  decimals: number;

  roundId: string;
  answeredInRound: string;
  startedAt: number;
  updatedAt: number;

  /**
   * Raw answer as a base-10 string (scaled by `decimals`).
   */
  answer: string;

  /**
   * Human-readable formatted answer (e.g. "2211.12345678").
   */
  formattedAnswer: string;
}


