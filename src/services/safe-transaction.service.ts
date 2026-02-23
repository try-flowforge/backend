import { ethers } from "ethers";
import { getRelayerService } from "./relayer.service";
import { logger } from "../utils/logger";
import {
  NUMERIC_CHAIN_IDS,
  getChainOrThrow,
  isConfiguredSafeAddress,
  isMainnetChain,
  type NumericChainId,
} from "../config/chain-registry";
import { SupportedChain } from "../types";

/**
 * Result of executeWithSignatures: either relayer sent (testnet) or client must submit (mainnet).
 */
export type ExecuteWithSignaturesResult =
  | { txHash: string; receipt: ethers.TransactionReceipt }
  | {
      submitOnClient: true;
      chainId: number;
      to: string;
      data: string;
      value: bigint;
    };

/**
 * MultiSend contract addresses for Safe
 * These are the official Gnosis Safe MultiSend contracts
 */
const MULTISEND_ADDRESSES: Partial<Record<NumericChainId, string>> = {
  421614: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761", // Arbitrum Sepolia
  42161: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761", // Arbitrum Mainnet
};

/**
 * MultiSend ABI - encodes multiple transactions into a single call
 */
const MULTISEND_ABI = [
  "function multiSend(bytes transactions) payable",
];

/**
 * ERC20 ABI for checking allowance
 */
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

/**
 * Service for building and executing Safe transactions
 * Handles both module-based execution (for autonomous agents) and signature-based execution (for user-signed transactions)
 */
export class SafeTransactionService {
  /**
   * Normalize signature blob to a canonical 0x-hex string.
   */
  private normalizeSignatures(rawSignatures: string): string {
    const sig = rawSignatures.startsWith("0x")
      ? rawSignatures.slice(2)
      : rawSignatures;
    if (!sig || sig.length % 2 !== 0 || /[^0-9a-fA-F]/.test(sig)) {
      throw new Error("Invalid signature format");
    }
    return `0x${sig}`;
  }

  /**
   * Adjust ECDSA `v` values for Gnosis Safe eth_sign compatibility.
   *
   * `personal_sign` / `eth_sign` prefix the message with
   * "\x19Ethereum Signed Message:\n32" before ECDSA signing, producing v=27|28.
   *
   * Gnosis Safe interprets v=27|28 as a *raw* ECDSA sig (no prefix) and will
   * ecrecover against the bare hash → wrong address → GS026.
   *
   * Adding +4 (v=31|32) tells the Safe contract this is an `eth_sign`
   * signature so it re-hashes with the prefix before ecrecover.
   */
  private adjustSignaturesForEthSign(rawSignatures: string): string {
    const signatures = this.normalizeSignatures(rawSignatures);
    const sig = signatures.slice(2);

    // Only rewrite fixed-size ECDSA concatenations (65 bytes each).
    // For dynamic signature containers, keep as-is.
    if (sig.length % 130 !== 0) {
      return signatures;
    }

    let adjusted = "";
    for (let i = 0; i < sig.length; i += 130) {
      const chunk = sig.slice(i, i + 130);
      const r = chunk.slice(0, 64);
      const s = chunk.slice(64, 128);
      let v = parseInt(chunk.slice(128, 130), 16);

      // Normalise: some wallets return v=0|1 instead of 27|28
      if (v === 0 || v === 1) {
        v += 27;
      }

      // Add +4 for eth_sign type (27→31, 28→32)
      if (v === 27 || v === 28) {
        v += 4;
      }

      adjusted += r + s + v.toString(16).padStart(2, "0");
    }

    return "0x" + adjusted;
  }

  private normalizeSignatureForRecover(signature: string): string | null {
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    if (sig.length !== 130) return null;

    const r = sig.slice(0, 64);
    const s = sig.slice(64, 128);
    let v = parseInt(sig.slice(128, 130), 16);

    if (v === 0 || v === 1) v += 27;
    if (v === 31 || v === 32) v -= 4; // Safe eth_sign adjusted signatures
    if (v !== 27 && v !== 28) return null;

    return "0x" + r + s + v.toString(16).padStart(2, "0");
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }

  /**
   * Build a Safe transaction hash for EIP-712 signing
   * This is used when the user needs to sign the transaction
   */
  async buildSafeTransactionHash(
    safeAddress: string,
    chainId: NumericChainId,
    to: string,
    value: bigint,
    data: string,
    operation: number = 0 // 0 = CALL, 1 = DELEGATECALL
  ): Promise<string> {
    const provider = getRelayerService().getProvider(chainId);

    // Get Safe contract instance
    const SAFE_ABI = [
      "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
      "function nonce() view returns (uint256)",
    ];

    const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, provider);

    // Get current nonce
    const nonce = await safeContract.nonce();

    // Build transaction hash using Safe's getTransactionHash function
    // Parameters: to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce
    const txHash = await safeContract.getTransactionHash(
      to,
      value,
      data,
      operation,
      0, // safeTxGas - will be estimated
      0, // baseGas
      0, // gasPrice - 0 means use current gas price
      ethers.ZeroAddress, // gasToken - 0x0 means native token
      ethers.ZeroAddress, // refundReceiver
      nonce
    );

    return txHash;
  }

  /**
   * Execute a Safe transaction via module (for autonomous agents)
   * This requires the module to be enabled on the Safe
   */
  async executeViaModule(
    safeAddress: string,
    chainId: NumericChainId,
    to: string,
    value: bigint,
    data: string,
    operation: number = 0
  ): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
    const chainConfig = getChainOrThrow(chainId);
    const moduleAddress = chainConfig.safeModuleAddress;
    if (!isConfiguredSafeAddress(moduleAddress)) {
      throw new Error(
        `Safe module address is not configured for chain ${chainConfig.name} (${chainId})`
      );
    }
    const relayerService = getRelayerService();

    logger.info(
      {
        safeAddress,
        chainId,
        to,
        value: value.toString(),
        operation,
      },
      "Executing Safe transaction via module"
    );

    // Check if module is enabled
    const moduleEnabled = await this.isModuleEnabled(
      safeAddress,
      chainId,
      moduleAddress
    );

    if (!moduleEnabled) {
      throw new Error(
        `Module ${moduleAddress} is not enabled on Safe ${safeAddress}`
      );
    }

    // Encode execTransactionFromModule call
    const SAFE_ABI = [
      "function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation) returns (bool success)",
    ];

    const iface = new ethers.Interface(SAFE_ABI);
    const moduleData = iface.encodeFunctionData("execTransactionFromModule", [
      to,
      value,
      data,
      operation,
    ]);

    // Execute via relayer (relayer calls the Safe's execTransactionFromModule)
    const { txHash, receipt } = await relayerService.sendTransaction(
      chainId,
      safeAddress,
      moduleData,
      0n
    );

    logger.info(
      {
        safeAddress,
        chainId,
        txHash,
      },
      "Safe transaction executed via module"
    );

    return { txHash, receipt };
  }

  /**
   * Execute a Safe transaction with user signatures
   * This is used when the user has signed the transaction hash
   */
  async executeWithSignatures(
    safeAddress: string,
    chainId: NumericChainId,
    to: string,
    value: bigint,
    data: string,
    operation: number,
    rawSignatures: string, // Concatenated signatures (from personal_sign / eth_sign)
    expectedSafeTxHash?: string,
    safeTxGas: bigint = 0n,
    baseGas: bigint = 0n,
    gasPrice: bigint = 0n,
    gasToken: string = ethers.ZeroAddress,
    refundReceiver: string = ethers.ZeroAddress
  ): Promise<ExecuteWithSignaturesResult> {
    const normalizedSignatures = this.normalizeSignatures(rawSignatures);
    const ethSignAdjustedSignatures = this.adjustSignaturesForEthSign(normalizedSignatures);
    const signatureCandidates: Array<{ mode: "safe_sdk" | "eth_sign"; signatures: string }> = [
      { mode: "safe_sdk", signatures: normalizedSignatures },
    ];
    if (ethSignAdjustedSignatures.toLowerCase() !== normalizedSignatures.toLowerCase()) {
      signatureCandidates.push({ mode: "eth_sign", signatures: ethSignAdjustedSignatures });
    }

    let signaturesForExecution = normalizedSignatures;
    let signatureMode: "safe_sdk" | "eth_sign" = "safe_sdk";

    const relayerService = getRelayerService();
    const provider = relayerService.getProvider(chainId);

    logger.info(
      {
        safeAddress,
        chainId,
        to,
        value: value.toString(),
        operation,
      },
      "Executing Safe transaction with signatures"
    );

    // Best-effort diagnostics to pinpoint GS013 (signature/nonce/threshold issues)
    try {
      const SAFE_DIAG_ABI = [
        "function nonce() view returns (uint256)",
        "function getOwners() view returns (address[])",
        "function getThreshold() view returns (uint256)",
        "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
        "function checkSignatures(bytes32 dataHash, bytes data, bytes signatures) view",
      ];
      const safeContract = new ethers.Contract(safeAddress, SAFE_DIAG_ABI, provider);
      const [nonce, owners, threshold] = await Promise.all([
        safeContract.nonce(),
        safeContract.getOwners(),
        safeContract.getThreshold(),
      ]);

      // Recompute the exact Safe tx hash Safe will validate right now (uses current nonce)
      const computedTxHash = await safeContract.getTransactionHash(
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        nonce
      );

      const sigHex = normalizedSignatures.startsWith("0x")
        ? normalizedSignatures.slice(2)
        : normalizedSignatures;
      const sigCount = Math.floor(sigHex.length / 130); // 65 bytes per signature
      let recovered: string | null = null;
      if (expectedSafeTxHash && sigHex.length >= 130) {
        const firstSig = ("0x" + sigHex.slice(0, 130)) as string;
        const recoverableSig = this.normalizeSignatureForRecover(firstSig);
        try {
          recovered = recoverableSig
            ? ethers.recoverAddress(expectedSafeTxHash, recoverableSig)
            : null;
        } catch {
          recovered = null;
        }
      }

      logger.info(
        {
          safeAddress,
          chainId,
          safeNonce: nonce?.toString?.() ?? String(nonce),
          threshold: threshold?.toString?.() ?? String(threshold),
          owners: Array.isArray(owners) ? owners : undefined,
          ownersCount: Array.isArray(owners) ? owners.length : undefined,
          recoveredSigner: recovered,
          signatureCount: sigCount,
          expectedSafeTxHash,
          computedSafeTxHash: computedTxHash,
          computedMatchesExpected:
            expectedSafeTxHash
              ? String(computedTxHash).toLowerCase() === expectedSafeTxHash.toLowerCase()
              : undefined,
        },
        "Safe exec diagnostics"
      );

      // Validate signatures on-chain and auto-select matching signature mode.
      const preflightFailures: Record<string, string> = {};
      let preflightPassed = false;
      for (const candidate of signatureCandidates) {
        try {
          await safeContract.checkSignatures(computedTxHash, "0x", candidate.signatures);
          signaturesForExecution = candidate.signatures;
          signatureMode = candidate.mode;
          preflightPassed = true;
          logger.info(
            {
              safeAddress,
              chainId,
              computedSafeTxHash: computedTxHash,
              signatureMode: candidate.mode,
            },
            "Safe signature preflight passed (checkSignatures)"
          );
          break;
        } catch (sigErr) {
          preflightFailures[candidate.mode] = this.extractErrorMessage(sigErr);
          logger.warn(
            {
              safeAddress,
              chainId,
              computedSafeTxHash: computedTxHash,
              signatureMode: candidate.mode,
              error: sigErr,
            },
            "Safe signature preflight failed for signature mode"
          );
        }
      }

      if (!preflightPassed) {
        const detail = Object.entries(preflightFailures)
          .map(([mode, msg]) => `${mode}: ${msg}`)
          .join("; ");
        logger.error(
          {
            safeAddress,
            chainId,
            computedSafeTxHash: computedTxHash,
            preflightFailures,
          },
          "Safe signature preflight failed (all modes)"
        );
        throw new Error(`Safe signature validation failed (${detail || "unknown error"})`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Safe signature validation failed")) {
        throw e;
      }
      logger.warn({ error: e, safeAddress, chainId }, "Safe exec diagnostics failed");
    }

    // Encode execTransaction call
    const SAFE_EXEC_ABI = [
      "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool success)",
    ];

    const iface = new ethers.Interface(SAFE_EXEC_ABI);
    const execData = iface.encodeFunctionData("execTransaction", [
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
      signaturesForExecution,
    ]);

    // Mainnet: return payload for client submission (user pays gas). Testnet: relayer sends.
    if (isMainnetChain(chainId)) {
      logger.info(
        { safeAddress, chainId, signatureMode },
        "Mainnet: returning execTransaction payload for client submission"
      );
      return {
        submitOnClient: true,
        chainId,
        to: safeAddress,
        data: execData,
        value: 0n,
      };
    }

    const { txHash, receipt } = await relayerService.sendTransaction(
      chainId,
      safeAddress,
      execData,
      0n
    );

    logger.info(
      {
        safeAddress,
        chainId,
        txHash,
        signatureMode,
      },
      "Safe transaction executed with signatures"
    );

    return { txHash, receipt };
  }

  /**
   * Check if a module is enabled on a Safe
   */
  async isModuleEnabled(
    safeAddress: string,
    chainId: NumericChainId,
    moduleAddress: string
  ): Promise<boolean> {
    const provider = getRelayerService().getProvider(chainId);

    const SAFE_ABI = [
      "function isModuleEnabled(address module) view returns (bool)",
    ];

    try {
      const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, provider);
      const enabled = await safeContract.isModuleEnabled(moduleAddress);
      return enabled;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          safeAddress,
          moduleAddress,
          chainId,
        },
        "Failed to check if module is enabled"
      );
      return false;
    }
  }

  /**
   * Get Safe address for a user based on chain
   * Helper method to convert SupportedChain to chainId and determine if testnet
   */
  static getChainIdFromSupportedChain(chain: SupportedChain): NumericChainId {
    switch (chain) {
      case SupportedChain.ARBITRUM_SEPOLIA:
        return NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA;
      case SupportedChain.ARBITRUM:
        return NUMERIC_CHAIN_IDS.ARBITRUM;

      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  /**
   * Check if chain is testnet
   */
  static isTestnet(chainId: NumericChainId): boolean {
    return !isMainnetChain(chainId);
  }

  /**
   * Check ERC20 token allowance for Safe wallet
   * @param tokenAddress ERC20 token address
   * @param safeAddress Safe wallet address (owner)
   * @param spenderAddress Address that needs approval (e.g., Uniswap Router)
   * @param chainId Chain ID
   * @returns Current allowance amount
   */
  async checkTokenAllowance(
    tokenAddress: string,
    safeAddress: string,
    spenderAddress: string,
    chainId: NumericChainId
  ): Promise<bigint> {
    const provider = getRelayerService().getProvider(chainId);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    try {
      const allowance = await tokenContract.allowance(safeAddress, spenderAddress);
      return BigInt(allowance.toString());
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          tokenAddress,
          safeAddress,
          spenderAddress,
          chainId,
        },
        "Failed to check token allowance"
      );
      throw new Error(`Failed to check token allowance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check ERC20 token balance for an address (e.g. Safe wallet).
   * Used to fail fast with a clear message when swap would revert due to insufficient balance.
   */
  async checkTokenBalance(
    tokenAddress: string,
    ownerAddress: string,
    chainId: NumericChainId
  ): Promise<bigint> {
    const provider = getRelayerService().getProvider(chainId);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    try {
      const balance = await tokenContract.balanceOf(ownerAddress);
      return BigInt(balance.toString());
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          tokenAddress,
          ownerAddress,
          chainId,
        },
        "Failed to check token balance"
      );
      throw new Error(`Failed to check token balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Build a multicall transaction that combines approve + swap
   * This allows a single signature for both operations
   * 
   * @param approveCall Transaction data for ERC20 approve
   * @param swapCall Transaction data for swap
   * @param chainId Chain ID
   * @returns Encoded multicall transaction data
   */
  buildMulticallTransaction(
    approveCall: {
      to: string;
      value: bigint;
      data: string;
    },
    swapCall: {
      to: string;
      value: bigint;
      data: string;
    },
    chainId: NumericChainId
  ): {
    to: string; // MultiSend contract address
    value: bigint;
    data: string;
  } {
    const multisendAddress = MULTISEND_ADDRESSES[chainId];
    if (!multisendAddress) {
      throw new Error(`MultiSend contract not configured for chain ${chainId}`);
    }

    // MultiSend expects transactions in a specific format:
    // Each transaction is encoded as: operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes) + data (variable)
    // operation: 0 = CALL, 1 = DELEGATECALL

    const encodeTransaction = (
      operation: number,
      to: string,
      value: bigint,
      data: string
    ): string => {
      // Remove 0x prefix if present
      const toBytes = ethers.getBytes(to);
      const valueBytes = ethers.zeroPadValue(ethers.toBeHex(value), 32);
      const dataBytes = ethers.getBytes(data);
      const dataLengthBytes = ethers.zeroPadValue(ethers.toBeHex(dataBytes.length), 32);

      // Combine: operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes) + data
      const operationByte = ethers.zeroPadValue(ethers.toBeHex(operation), 1);
      const combined = ethers.concat([
        operationByte,
        toBytes,
        valueBytes,
        dataLengthBytes,
        dataBytes,
      ]);

      return combined;
    };

    // Encode both transactions
    const approveTx = encodeTransaction(
      0, // CALL operation
      approveCall.to,
      approveCall.value,
      approveCall.data
    );

    const swapTx = encodeTransaction(
      0, // CALL operation
      swapCall.to,
      swapCall.value,
      swapCall.data
    );

    // Combine both transactions
    const transactions = ethers.concat([approveTx, swapTx]);

    // Encode multiSend call
    const iface = new ethers.Interface(MULTISEND_ABI);
    const multicallData = iface.encodeFunctionData("multiSend", [transactions]);

    logger.info(
      {
        chainId,
        multisendAddress,
        approveTo: approveCall.to,
        swapTo: swapCall.to,
      },
      "Built multicall transaction (approve + swap)"
    );

    return {
      to: multisendAddress,
      // IMPORTANT:
      // MultiSend must be executed via Safe *DELEGATECALL* (operation=1 on Safe tx),
      // and the Safe-level `value` should be 0. Individual values are encoded per sub-tx.
      value: 0n,
      data: multicallData,
    };
  }

  /**
   * Build MultiSend transaction from an array of calls (e.g. approve + permit2.approve + swap).
   */
  buildMulticallFromCalls(
    calls: Array<{ to: string; value: bigint; data: string }>,
    chainId: NumericChainId
  ): { to: string; value: bigint; data: string } {
    const multisendAddress = MULTISEND_ADDRESSES[chainId];
    if (!multisendAddress) {
      throw new Error(`MultiSend contract not configured for chain ${chainId}`);
    }
    const encodeTransaction = (
      operation: number,
      to: string,
      value: bigint,
      data: string
    ): string => {
      const toBytes = ethers.getBytes(to);
      const valueBytes = ethers.zeroPadValue(ethers.toBeHex(value), 32);
      const dataBytes = ethers.getBytes(data);
      const dataLengthBytes = ethers.zeroPadValue(ethers.toBeHex(dataBytes.length), 32);
      const operationByte = ethers.zeroPadValue(ethers.toBeHex(operation), 1);
      return ethers.concat([
        operationByte,
        toBytes,
        valueBytes,
        dataLengthBytes,
        dataBytes,
      ]);
    };
    const encoded = calls.map((c) => encodeTransaction(0, c.to, c.value, c.data));
    const transactions = ethers.concat(encoded);
    const iface = new ethers.Interface(MULTISEND_ABI);
    const multicallData = iface.encodeFunctionData("multiSend", [transactions]);
    return {
      to: multisendAddress,
      value: 0n,
      data: multicallData,
    };
  }

  /**
   * Execute multicall transaction via Safe module
   * Combines approve + swap into a single Safe transaction
   */
  async executeMulticallViaModule(
    safeAddress: string,
    chainId: NumericChainId,
    multicallData: {
      to: string;
      value: bigint;
      data: string;
    }
  ): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
    return this.executeViaModule(
      safeAddress,
      chainId,
      multicallData.to,
      multicallData.value,
      multicallData.data,
      0 // CALL operation
    );
  }

  /**
   * Build Safe transaction hash for multicall (for user signing)
   */
  async buildMulticallSafeTransactionHash(
    safeAddress: string,
    chainId: NumericChainId,
    multicallData: {
      to: string;
      value: bigint;
      data: string;
    }
  ): Promise<string> {
    return this.buildSafeTransactionHash(
      safeAddress,
      chainId,
      multicallData.to,
      multicallData.value,
      multicallData.data,
      0 // CALL operation
    );
  }
}

// Export singleton instance
let safeTransactionServiceInstance: SafeTransactionService | undefined;

export const getSafeTransactionService = (): SafeTransactionService => {
  if (!safeTransactionServiceInstance) {
    safeTransactionServiceInstance = new SafeTransactionService();
  }
  return safeTransactionServiceInstance;
};
