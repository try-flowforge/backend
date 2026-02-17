import { ethers } from "ethers";
import { logger } from "../utils/logger";
import { config } from "../config/config";
import {
  getAllChains,
  getChainOrThrow,
  type NumericChainId,
} from "../config/chain-registry";

/**
 * Direct EOA relayer service
 * Supports multiple chains with separate providers and wallets per chain
 */
export class RelayerService {
  private providers: Map<NumericChainId, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<NumericChainId, ethers.Wallet> = new Map();
  private privateKey: string;

  constructor() {
    this.privateKey = config.relayer.relayerPrivateKey;

    // Initialize providers and wallets for all configured chains
    for (const chainConfig of getAllChains()) {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const wallet = new ethers.Wallet(this.privateKey, provider);

      this.providers.set(chainConfig.chainId, provider);
      this.wallets.set(chainConfig.chainId, wallet);

      logger.info(
        {
          relayerAddress: wallet.address,
          chainId: chainConfig.chainId,
          chainName: chainConfig.name,
        },
        "Relayer service initialized for chain"
      );
    }
  }

  /**
   * Get relayer wallet address (same for all chains)
   */
  getAddress(chainId: NumericChainId): string {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`Relayer not initialized for chain ${chainId}`);
    }
    return wallet.address;
  }

  /**
   * Get current balance for a specific chain
   */
  async getBalance(chainId: NumericChainId): Promise<string> {
    const wallet = this.wallets.get(chainId);
    const provider = this.providers.get(chainId);

    if (!wallet || !provider) {
      throw new Error(`Relayer not initialized for chain ${chainId}`);
    }

    const balance = await provider.getBalance(wallet.address);
    return ethers.formatEther(balance);
  }

  /**
   * Send a transaction and wait for confirmation on a specific chain
   * Includes timeout and retry logic for robustness
   */
  async sendTransaction(
    chainId: NumericChainId,
    to: string,
    data: string,
    value: bigint = 0n
  ): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
    const wallet = this.wallets.get(chainId);
    const provider = this.providers.get(chainId);

    if (!wallet || !provider) {
      throw new Error(`Relayer not initialized for chain ${chainId}`);
    }

    const MAX_RETRIES = 3;
    const CONFIRMATION_TIMEOUT_MS = 120000; // Increased to 120s for slow chains like Ethereum Sepolia
    const chainConfig = getChainOrThrow(chainId);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let tx: ethers.TransactionResponse | undefined;

      try {
        logger.info(
          {
            chainId,
            chainName: chainConfig.name,
            to,
            dataLength: data.length,
            value: value.toString(),
            from: wallet.address,
            attempt,
          },
          "Sending transaction via relayer"
        );

        // Estimate gas
        const gasEstimate = await provider.estimateGas({
          from: wallet.address,
          to,
          data,
          value,
        });

        // Get current gas price
        const feeData = await provider.getFeeData();
        const maxFeePerGas = feeData.maxFeePerGas;
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

        logger.info(
          {
            chainId,
            gasEstimate: gasEstimate.toString(),
            maxFeePerGas: maxFeePerGas?.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas?.toString(),
          },
          "Gas estimation complete"
        );

        // Send transaction
        tx = await wallet.sendTransaction({
          to,
          data,
          value,
          gasLimit: (gasEstimate * 120n) / 100n,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });

        logger.info(
          {
            chainId,
            txHash: tx.hash,
            nonce: tx.nonce,
            attempt,
          },
          "Transaction sent, waiting for confirmation"
        );

        // Wait for confirmation with timeout
        const receipt = await Promise.race([
          tx.wait(),
          new Promise<null>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Transaction confirmation timeout after ${CONFIRMATION_TIMEOUT_MS}ms`)),
              CONFIRMATION_TIMEOUT_MS
            )
          ),
        ]);

        if (!receipt) {
          throw new Error("Transaction receipt not available");
        }

        if (receipt.status === 0) {
          throw new Error("Transaction reverted");
        }

        logger.info(
          {
            chainId,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            status: receipt.status,
            attempt,
          },
          "Transaction confirmed"
        );

        return {
          txHash: receipt.hash,
          receipt,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === MAX_RETRIES;

        // Check if transaction was mined despite timeout/error
        if (tx?.hash) {
          try {
            const minedReceipt = await provider.getTransactionReceipt(tx.hash);
            if (minedReceipt && minedReceipt.status === 1) {
              logger.info(
                {
                  chainId,
                  txHash: minedReceipt.hash,
                  blockNumber: minedReceipt.blockNumber,
                },
                "Transaction was mined despite error, recovering"
              );
              return { txHash: minedReceipt.hash, receipt: minedReceipt };
            }
          } catch {
            // Ignore errors when checking receipt
          }
        }

        logger.error(
          {
            error: errorMessage,
            chainId,
            to,
            from: wallet.address,
            attempt,
            isLastAttempt,
          },
          isLastAttempt ? "Failed to send transaction (final attempt)" : "Transaction attempt failed, retrying"
        );

        if (isLastAttempt) {
          throw error;
        }

        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = 2000 * Math.pow(2, attempt - 1);
        logger.info({ backoffMs, nextAttempt: attempt + 1 }, "Waiting before retry");
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // This should never be reached due to the throw in the loop
    throw new Error("Transaction failed after all retry attempts");
  }

  /**
   * Get provider for a specific chain (for reading contract state)
   */
  getProvider(chainId: NumericChainId): ethers.JsonRpcProvider {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider not initialized for chain ${chainId}`);
    }
    return provider;
  }
}

// Singleton instance
let relayerServiceInstance: RelayerService | undefined;

/**
 * Get or initialize relayer service
 */
export const getRelayerService = (): RelayerService => {
  if (!relayerServiceInstance) {
    relayerServiceInstance = new RelayerService();
  }
  return relayerServiceInstance;
};
