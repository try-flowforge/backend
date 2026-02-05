import { ethers } from "ethers";
import { getRelayerService } from "./relayer.service";
import { logger } from "../utils/logger";
import { getChainConfig, SupportedChainId } from "../config/config";
import { SupportedChain } from "../types";

/**
 * MultiSend contract addresses for Safe
 * These are the official Gnosis Safe MultiSend contracts
 */
const MULTISEND_ADDRESSES: Record<SupportedChainId, string> = {
  421614: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761", // Arbitrum Sepolia
  42161: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761", // Arbitrum Mainnet (same address)
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
  "function approve(address spender, uint256 amount) returns (bool)",
];

/**
 * Service for building and executing Safe transactions
 * Handles both module-based execution (for autonomous agents) and signature-based execution (for user-signed transactions)
 */
export class SafeTransactionService {
  /**
   * Build a Safe transaction hash for EIP-712 signing
   * This is used when the user needs to sign the transaction
   */
  async buildSafeTransactionHash(
    safeAddress: string,
    chainId: SupportedChainId,
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
    chainId: SupportedChainId,
    to: string,
    value: bigint,
    data: string,
    operation: number = 0
  ): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
    const chainConfig = getChainConfig(chainId);
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
      chainConfig.moduleAddress
    );

    if (!moduleEnabled) {
      throw new Error(
        `Module ${chainConfig.moduleAddress} is not enabled on Safe ${safeAddress}`
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
    chainId: SupportedChainId,
    to: string,
    value: bigint,
    data: string,
    operation: number,
    signatures: string, // Concatenated signatures (EIP-712 format)
    expectedSafeTxHash?: string,
    safeTxGas: bigint = 0n,
    baseGas: bigint = 0n,
    gasPrice: bigint = 0n,
    gasToken: string = ethers.ZeroAddress,
    refundReceiver: string = ethers.ZeroAddress
  ): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
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

      const sigHex = signatures.startsWith("0x") ? signatures.slice(2) : signatures;
      const sigCount = Math.floor(sigHex.length / 130); // 65 bytes per signature
      let recovered: string | null = null;
      if (expectedSafeTxHash && sigHex.length >= 130) {
        const firstSig = ("0x" + sigHex.slice(0, 130)) as string;
        try {
          recovered = ethers.recoverAddress(expectedSafeTxHash, firstSig);
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

      // Validate signatures on-chain against the computed hash (will throw with GS0xx if invalid)
      try {
        await safeContract.checkSignatures(computedTxHash, "0x", signatures);
        logger.info(
          { safeAddress, chainId, computedSafeTxHash: computedTxHash },
          "Safe signature preflight passed (checkSignatures)"
        );
      } catch (sigErr) {
        logger.error(
          { safeAddress, chainId, computedSafeTxHash: computedTxHash, error: sigErr },
          "Safe signature preflight failed (checkSignatures)"
        );
      }
    } catch (e) {
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
      signatures,
    ]);

    // Execute via relayer
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
    chainId: SupportedChainId,
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
  static getChainIdFromSupportedChain(chain: SupportedChain): SupportedChainId {
    switch (chain) {
      case SupportedChain.ARBITRUM_SEPOLIA:
        return 421614 as SupportedChainId;
      case SupportedChain.ARBITRUM:
        return 42161 as SupportedChainId;
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  /**
   * Check if chain is testnet
   */
  static isTestnet(chainId: SupportedChainId): boolean {
    return chainId === 421614;
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
    chainId: SupportedChainId
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
    chainId: SupportedChainId
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
   * Execute multicall transaction via Safe module
   * Combines approve + swap into a single Safe transaction
   */
  async executeMulticallViaModule(
    safeAddress: string,
    chainId: SupportedChainId,
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
    chainId: SupportedChainId,
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
