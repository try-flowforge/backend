import { ethers } from 'ethers';
import { query } from '../config/database';
import {
  NUMERIC_CHAIN_IDS,
  isMainnetChain,
  type NumericChainId,
} from '../config/chain-registry';
import { getChainlinkAddress } from '../config/oracle-feeds';
import { getRelayerService } from './relayer.service';
import { SupportedChain, SwapProvider, SwapQuote, TokenInfo } from '../types';

export type SpendingPolicyNetwork = 'testnet' | 'mainnet';

interface SpendingPolicyRow {
  id: string;
  user_id: string;
  network: SpendingPolicyNetwork;
  chain_id: number;
  safe_address: string;
  spend_limit_usd: string;
  daily_limit_usd: string;
  deadline: string;
  active: boolean;
  policy_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpendingPolicy {
  id: string;
  userId: string;
  network: SpendingPolicyNetwork;
  chainId: number;
  safeAddress: string;
  spendLimitUsd: number;
  dailyLimitUsd: number;
  deadline: string;
  active: boolean;
  policyTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpendingAllowanceResult {
  allowed: boolean;
  reason?: string;
  policy?: SpendingPolicy;
}

const CHAINLINK_FEED_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
];

export class SpendingPolicyService {
  private normalize(row: SpendingPolicyRow): SpendingPolicy {
    return {
      id: row.id,
      userId: row.user_id,
      network: row.network,
      chainId: row.chain_id,
      safeAddress: row.safe_address,
      spendLimitUsd: Number(row.spend_limit_usd),
      dailyLimitUsd: Number(row.daily_limit_usd),
      deadline: row.deadline,
      active: row.active,
      policyTxHash: row.policy_tx_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  networkForChainId(chainId: NumericChainId): SpendingPolicyNetwork {
    return isMainnetChain(chainId) ? 'mainnet' : 'testnet';
  }

  chainToNumeric(chain: SupportedChain): NumericChainId {
    return chain === SupportedChain.ARBITRUM
      ? NUMERIC_CHAIN_IDS.ARBITRUM
      : NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA;
  }

  async getActivePolicy(
    userId: string,
    network: SpendingPolicyNetwork,
    chainId: number
  ): Promise<SpendingPolicy | null> {
    const result = await query(
      `
      SELECT *
      FROM spending_policies
      WHERE user_id = $1
        AND network = $2
        AND chain_id = $3
        AND active = true
        AND deadline > NOW()
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [userId, network, chainId]
    );

    if (result.rows.length === 0) return null;
    return this.normalize(result.rows[0] as SpendingPolicyRow);
  }

  async createPolicy(params: {
    userId: string;
    network: SpendingPolicyNetwork;
    chainId: number;
    safeAddress: string;
    spendLimitUsd: number;
    dailyLimitUsd: number;
    deadline: string;
    policyTxHash?: string;
  }): Promise<SpendingPolicy> {
    const result = await query(
      `
      INSERT INTO spending_policies (
        user_id,
        network,
        chain_id,
        safe_address,
        spend_limit_usd,
        daily_limit_usd,
        deadline,
        active,
        policy_tx_hash,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, true, $8, NOW())
      ON CONFLICT (user_id, network, safe_address, chain_id)
      DO UPDATE SET
        spend_limit_usd = EXCLUDED.spend_limit_usd,
        daily_limit_usd = EXCLUDED.daily_limit_usd,
        deadline = EXCLUDED.deadline,
        active = true,
        policy_tx_hash = EXCLUDED.policy_tx_hash,
        updated_at = NOW()
      RETURNING *
      `,
      [
        params.userId,
        params.network,
        params.chainId,
        params.safeAddress,
        params.spendLimitUsd,
        params.dailyLimitUsd,
        params.deadline,
        params.policyTxHash || null,
      ]
    );

    return this.normalize(result.rows[0] as SpendingPolicyRow);
  }

  async revokePolicy(
    userId: string,
    network: SpendingPolicyNetwork,
    chainId: number
  ): Promise<SpendingPolicy | null> {
    const result = await query(
      `
      UPDATE spending_policies
      SET active = false, updated_at = NOW()
      WHERE user_id = $1 AND network = $2 AND chain_id = $3
      RETURNING *
      `,
      [userId, network, chainId]
    );

    if (result.rows.length === 0) return null;
    return this.normalize(result.rows[0] as SpendingPolicyRow);
  }

  async checkSpendingAllowance(
    userId: string,
    network: SpendingPolicyNetwork,
    chainId: number,
    amountUsd: number
  ): Promise<SpendingAllowanceResult> {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { allowed: false, reason: 'Unable to determine USD value for this swap' };
    }

    const policy = await this.getActivePolicy(userId, network, chainId);
    if (!policy) {
      return { allowed: false, reason: 'No active spending policy found' };
    }

    if (policy.spendLimitUsd > 0 && amountUsd > policy.spendLimitUsd) {
      return {
        allowed: false,
        policy,
        reason: `Transaction amount $${amountUsd.toFixed(2)} exceeds per-tx limit $${policy.spendLimitUsd.toFixed(2)}`,
      };
    }

    if (policy.dailyLimitUsd > 0) {
      const spendResult = await query(
        `
        SELECT COALESCE(SUM(amount_usd), 0) AS spent_last_24h
        FROM spending_ledger
        WHERE policy_id = $1
          AND created_at >= NOW() - INTERVAL '24 hours'
        `,
        [policy.id]
      );

      const spentLast24h = Number(spendResult.rows[0]?.spent_last_24h || 0);
      const projected = spentLast24h + amountUsd;
      if (projected > policy.dailyLimitUsd) {
        return {
          allowed: false,
          policy,
          reason: `Daily limit exceeded ($${projected.toFixed(2)} > $${policy.dailyLimitUsd.toFixed(2)})`,
        };
      }
    }

    return { allowed: true, policy };
  }

  async recordSpend(
    policyId: string,
    executionId: string | null,
    amountUsd: number,
    txHash: string
  ): Promise<void> {
    await query(
      `
      INSERT INTO spending_ledger (policy_id, execution_id, amount_usd, tx_hash)
      VALUES ($1, $2, $3, $4)
      `,
      [policyId, executionId, amountUsd, txHash]
    );
  }

  async getSwapUsdValue(
    quote: SwapQuote,
    sourceToken: TokenInfo,
    chain: SupportedChain
  ): Promise<number | null> {
    if (quote.provider === SwapProvider.LIFI) {
      const fromAmountUsd = Number((quote.rawQuote as any)?.estimate?.fromAmountUSD || 0);
      if (Number.isFinite(fromAmountUsd) && fromAmountUsd > 0) {
        return fromAmountUsd;
      }
    }

    const symbol = sourceToken.symbol?.toUpperCase();
    if (!symbol) return null;

    const feedAddress = getChainlinkAddress(`${symbol}/USD`, chain);
    if (!feedAddress) return null;

    const chainId = this.chainToNumeric(chain);
    const provider = getRelayerService().getProvider(chainId);
    const feed = new ethers.Contract(feedAddress, CHAINLINK_FEED_ABI, provider);

    const [roundData, feedDecimals] = await Promise.all([
      feed.latestRoundData(),
      feed.decimals(),
    ]);

    const rawPrice = BigInt(roundData.answer.toString());
    if (rawPrice <= 0n) return null;

    const tokenDecimals = sourceToken.decimals ?? 18;
    const amountInTokenUnits = BigInt(quote.amountIn);
    const feedDecimalsBI = BigInt(feedDecimals);

    const usdScaled = (amountInTokenUnits * rawPrice) /
      (10n ** BigInt(tokenDecimals));
    const usd = Number(usdScaled) / Number(10n ** feedDecimalsBI);

    if (!Number.isFinite(usd) || usd <= 0) return null;
    return usd;
  }
}

let spendingPolicyServiceInstance: SpendingPolicyService | undefined;

export const getSpendingPolicyService = (): SpendingPolicyService => {
  if (!spendingPolicyServiceInstance) {
    spendingPolicyServiceInstance = new SpendingPolicyService();
  }
  return spendingPolicyServiceInstance;
};
