import { ethers } from "ethers";
import { logger } from "../utils/logger";
import { getRelayerService } from "./relayer.service";
import {
  getSafeRelayChainOrThrow,
  type SafeRelayNumericChainId,
} from "../config/chain-registry";

interface SafeTxData {
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
}

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Service for validating Safe transactions before relaying
 */
export class SafeRelayValidationService {
  /**
   * Get Safe module address for a specific chain
   */
  private getSafeModuleAddress(chainId: SafeRelayNumericChainId): string {
    const chainConfig = getSafeRelayChainOrThrow(chainId);
    return chainConfig.safeModuleAddress.toLowerCase();
  }

  /**
   * Read Safe contract info (owners, threshold)
   */
  async readSafeInfo(
    safeAddress: string,
    chainId: SafeRelayNumericChainId
  ): Promise<{
    owners: string[];
    threshold: number;
  }> {
    const relayerService = getRelayerService();
    const provider = relayerService.getProvider(chainId);

    const SAFE_ABI = [
      "function getOwners() view returns (address[])",
      "function getThreshold() view returns (uint256)",
    ];

    const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, provider);

    try {
      const [owners, thresholdBigInt] = await Promise.all([
        safeContract.getOwners(),
        safeContract.getThreshold(),
      ]);

      return {
        owners: owners.map((o: string) => o.toLowerCase()),
        threshold: Number(thresholdBigInt),
      };
    } catch (error) {
      logger.error(
        {
          error,
          safeAddress,
        },
        "Failed to read Safe info"
      );
      throw new Error("Failed to read Safe contract info");
    }
  }

  /**
 * Get current nonce from Safe contract
 */
  async getSafeNonce(
    safeAddress: string,
    chainId: SafeRelayNumericChainId
  ): Promise<number> {
    const relayerService = getRelayerService();
    const provider = relayerService.getProvider(chainId);

    const SAFE_ABI = ["function nonce() view returns (uint256)"];

    const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, provider);

    try {
      const nonce = await safeContract.nonce();
      return Number(nonce);
    } catch (error) {
      logger.error(
        {
          error,
          safeAddress,
        },
        "Failed to read Safe nonce"
      );
      throw new Error("Failed to read Safe nonce");
    }
  }
  
  /**
   * Validate that the Safe transaction is exactly "enableModule(address)"
   */
  validateEnableModuleCalldata(
    safeTxData: SafeTxData,
    safeAddress: string,
    chainId: SafeRelayNumericChainId
  ): ValidationResult {
    const moduleAddress = this.getSafeModuleAddress(chainId);

    // Check that the transaction is calling the Safe itself
    if (safeTxData.to.toLowerCase() !== safeAddress.toLowerCase()) {
      return {
        isValid: false,
        error: `Transaction must call the Safe contract itself, got: ${safeTxData.to}`,
      };
    }

    // Check operation type (0 = CALL)
    if (safeTxData.operation !== 0) {
      return {
        isValid: false,
        error: `Operation must be CALL (0), got: ${safeTxData.operation}`,
      };
    }

    // Decode the calldata
    try {
      const iface = new ethers.Interface([
        "function enableModule(address module)",
      ]);

      const decoded = iface.decodeFunctionData("enableModule", safeTxData.data);
      const targetModule = decoded[0].toLowerCase();

      if (targetModule !== moduleAddress) {
        return {
          isValid: false,
          error: `Can only enable module ${moduleAddress}, got: ${targetModule}`,
        };
      }

      logger.info(
        {
          safeAddress,
          moduleAddress: targetModule,
        },
        "EnableModule calldata validated"
      );

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: "Transaction data is not enableModule(address)",
      };
    }
  }

  /**
   * Reconstruct Safe transaction hash and verify signatures
   */
  async verifySafeSignatures(
    safeAddress: string,
    safeTxData: SafeTxData,
    signatures: string,
    chainId: SafeRelayNumericChainId
  ): Promise<ValidationResult> {
    try {
      // Read Safe info
      const { owners, threshold } = await this.readSafeInfo(
        safeAddress,
        chainId
      );

      logger.info(
        {
          safeAddress,
          chainId,
          owners,
          threshold,
        },
        "Safe info retrieved"
      );

      // Handle nonce - prefer client-provided but fall back to fetching if not provided
      let nonce: number;
      const currentNonce = await this.getSafeNonce(safeAddress, chainId);

      if (safeTxData.nonce === undefined || safeTxData.nonce === null) {
        logger.warn(
          { safeAddress, chainId },
          "Nonce not provided in safeTxData - fetching from chain (less secure)"
        );
        nonce = currentNonce;
      } else {
        // Validate provided nonce matches on-chain (with type coercion)
        const providedNonce = Number(safeTxData.nonce);

        if (isNaN(providedNonce)) {
          logger.warn({ safeAddress, chainId, rawNonce: safeTxData.nonce }, "Invalid nonce format");
          return {
            isValid: false,
            error: "Invalid nonce format",
          };
        }

        if (providedNonce !== currentNonce) {
          logger.warn(
            {
              safeAddress,
              chainId,
              providedNonce,
              expectedNonce: currentNonce,
            },
            "Nonce mismatch - possible stale transaction or replay attempt"
          );
          return {
            isValid: false,
            error: `Nonce mismatch: expected ${currentNonce}, got ${providedNonce}. Please refresh and sign again.`,
          };
        }

        nonce = providedNonce;
        logger.info({ safeAddress, chainId, nonce }, "Nonce validated successfully");
      }

      // Compute Safe transaction hash manually (EIP-712)
      const domain = {
        chainId: BigInt(chainId),
        verifyingContract: safeAddress,
      };

      const types = {
        SafeTx: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "operation", type: "uint8" },
          { name: "safeTxGas", type: "uint256" },
          { name: "baseGas", type: "uint256" },
          { name: "gasPrice", type: "uint256" },
          { name: "gasToken", type: "address" },
          { name: "refundReceiver", type: "address" },
          { name: "nonce", type: "uint256" },
        ],
      };

      const message = {
        to: safeTxData.to,
        value: BigInt(safeTxData.value),
        data: safeTxData.data as `0x${string}`,
        operation: safeTxData.operation,
        safeTxGas: BigInt(safeTxData.safeTxGas),
        baseGas: BigInt(safeTxData.baseGas),
        gasPrice: BigInt(safeTxData.gasPrice),
        gasToken: safeTxData.gasToken,
        refundReceiver: safeTxData.refundReceiver,
        nonce: BigInt(nonce),
      };

      // Compute EIP-712 hash
      const safeTxHash = ethers.TypedDataEncoder.hash(domain, types, message);

      logger.info(
        {
          safeTxHash,
          signaturesLength: signatures.length,
        },
        "Safe transaction hash computed"
      );

      // Recover signers from signatures
      // Signatures format: each signature is 65 bytes (r: 32, s: 32, v: 1)
      const signatureBytes = ethers.getBytes(signatures);
      const signerAddresses: string[] = [];

      for (let i = 0; i < signatureBytes.length; i += 65) {
        const r = ethers.hexlify(signatureBytes.slice(i, i + 32));
        const s = ethers.hexlify(signatureBytes.slice(i + 32, i + 64));
        const v = signatureBytes[i + 64];

        const signature = ethers.Signature.from({ r, s, v });
        const recoveredAddress = ethers.recoverAddress(safeTxHash, signature);

        signerAddresses.push(recoveredAddress.toLowerCase());
      }

      logger.info(
        {
          signers: signerAddresses,
          owners,
          threshold,
        },
        "Signatures recovered"
      );

      // Verify that all signers are owners
      for (const signer of signerAddresses) {
        if (!owners.includes(signer)) {
          return {
            isValid: false,
            error: `Signer ${signer} is not an owner of the Safe`,
          };
        }
      }

      // Verify threshold is met
      if (signerAddresses.length < threshold) {
        return {
          isValid: false,
          error: `Insufficient signatures: got ${signerAddresses.length}, need ${threshold}`,
        };
      }

      return { isValid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(
        {
          error: errorMessage,
          errorStack,
          safeAddress,
          chainId,
        },
        "Failed to verify Safe signatures"
      );
      return {
        isValid: false,
        error: errorMessage || "Signature verification failed",
      };
    }
  }

  /**
   * Validate that a user is an owner of the Safe (optional additional check)
   */
  async validateUserIsOwner(
    safeAddress: string,
    userAddress: string,
    chainId: SafeRelayNumericChainId
  ): Promise<ValidationResult> {
    try {
      const { owners } = await this.readSafeInfo(safeAddress, chainId);

      if (!owners.includes(userAddress.toLowerCase())) {
        return {
          isValid: false,
          error: "User is not an owner of this Safe",
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error:
          error instanceof Error ? error.message : "Failed to validate owner",
      };
    }
  }

  /**
   * Check if module is already enabled on the Safe (idempotency check)
   * Returns true if module is already enabled, false otherwise
   */
  async isModuleEnabled(
    safeAddress: string,
    chainId: SafeRelayNumericChainId
  ): Promise<{ enabled: boolean; error?: string }> {
    try {
      const moduleAddress = this.getSafeModuleAddress(chainId);
      const relayerService = getRelayerService();
      const provider = relayerService.getProvider(chainId);

      const SAFE_ABI = ["function isModuleEnabled(address module) view returns (bool)"];
      const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, provider);

      const isEnabled = await safeContract.isModuleEnabled(moduleAddress);

      logger.debug(
        {
          safeAddress,
          chainId,
          moduleAddress,
          isEnabled,
        },
        "Checked module enabled status"
      );

      return { enabled: isEnabled };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          safeAddress,
          chainId,
        },
        "Failed to check if module is enabled"
      );
      return {
        enabled: false,
        error: error instanceof Error ? error.message : "Failed to check module status",
      };
    }
  }
}

// Singleton instance
export const safeRelayValidationService = new SafeRelayValidationService();
