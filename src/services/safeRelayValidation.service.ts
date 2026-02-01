import { ethers } from "ethers";
import { logger } from "../utils/logger";
import { getRelayerService } from "./relayer.service";
import { getChainConfig, SupportedChainId } from "../config/config";

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
  private getSafeModuleAddress(chainId: SupportedChainId): string {
    const chainConfig = getChainConfig(chainId);
    return chainConfig.moduleAddress.toLowerCase();
  }

  /**
   * Read Safe contract info (owners, threshold)
   */
  async readSafeInfo(
    safeAddress: string,
    chainId: SupportedChainId
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
   * Validate that the Safe transaction is exactly "enableModule(address)"
   */
  validateEnableModuleCalldata(
    safeTxData: SafeTxData,
    safeAddress: string,
    chainId: SupportedChainId
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
    chainId: SupportedChainId
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
        nonce: BigInt(safeTxData.nonce),
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
      logger.error(
        {
          error,
          safeAddress,
        },
        "Failed to verify Safe signatures"
      );
      return {
        isValid: false,
        error:
          error instanceof Error
            ? error.message
            : "Signature verification failed",
      };
    }
  }

  /**
   * Validate that a user is an owner of the Safe (optional additional check)
   */
  async validateUserIsOwner(
    safeAddress: string,
    userAddress: string,
    chainId: SupportedChainId
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
}

// Singleton instance
export const safeRelayValidationService = new SafeRelayValidationService();
