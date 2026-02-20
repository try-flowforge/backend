import { ethers } from 'ethers';

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
