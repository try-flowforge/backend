import { ethers } from 'ethers';

/** USD value uses 8 decimals on-chain (e.g. 100_00000000 = 100 USD). */
const USD_DECIMALS = 8;

/**
 * Convert a USD amount (e.g. 100.50) to 8-decimal bigint for contracts.
 */
export function usdTo8Decimals(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) return 0n;
  return BigInt(Math.round(usd * 10 ** USD_DECIMALS));
}

/**
 * Parses an amount string into its base units (Wei/smallest unit).
 * If the input string contains a comma or a decimal point, it's treated as a human-readable amount
 * and converted to base units using the provided decimals.
 * Otherwise, it's treated as an absolute amount already in base units.
 */
export function parseAmount(amount: string, decimals: number = 18): bigint {
    if (!amount || amount.trim() === '') {
        return BigUint64Array.from([0n])[0]; // 0n
    }

    const cleanAmount = amount.replace(/,/g, '');

    try {
        if (cleanAmount.includes('.')) {
            // Human-readable decimal (e.g., "0.2")
            return ethers.parseUnits(cleanAmount, decimals);
        } else {
            // Absolute amount in base units (e.g., "200000000000000000")
            return BigInt(cleanAmount);
        }
    } catch (error) {
        throw new Error(`Invalid amount format: ${amount}. ${error instanceof Error ? error.message : ''}`);
    }
}
