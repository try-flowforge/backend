import { Response } from "express";
import { ethers } from "ethers";
import { AuthenticatedRequest } from "../middleware/privy-auth";
import { getRelayerService } from "../services/relayer.service";
import { safeRelayValidationService } from "../services/safeRelayValidation.service";
import { logger } from "../utils/logger";
import {
  config,
  getChainConfig,
  isSupportedChain,
  SUPPORTED_CHAINS,
  SupportedChainId,
} from "../config/config";

// In-memory rate limiting (for production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const checkRateLimit = (
  key: string,
  maxRequests: number,
  windowMs: number
): boolean => {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
};

/**
 * POST /api/v1/relay/create-safe
 * Create a Safe wallet via direct relayer (sponsored)
 */
export const createSafe = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { chainId } = req.body;

    // Validate chain ID
    if (!isSupportedChain(chainId)) {
      res.status(400).json({
        success: false,
        error: `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAINS.ARBITRUM_SEPOLIA} (Arbitrum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_MAINNET} (Arbitrum Mainnet)`,
      });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    const userAddress = req.userWalletAddress;
    const userId = req.userId;

    // Rate limiting: max Safe creations per user per day
    const rateLimitKey = `create-safe:${userId}`;
    const maxRequestsPerDay = config.rateLimit.maxTxsPerUserPerDay;
    if (!checkRateLimit(rateLimitKey, maxRequestsPerDay, 24 * 60 * 60 * 1000)) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      });
      return;
    }

    const chainConfig = getChainConfig(supportedChainId);

    logger.info(
      {
        userId,
        userAddress,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Creating Safe wallet"
    );

    // Get factory address for the chain
    const factoryAddress = chainConfig.factoryAddress;

    // Encode createSafeWallet(address) call
    const iface = new ethers.Interface([
      "function createSafeWallet(address owner) returns (address)",
    ]);
    const data = iface.encodeFunctionData("createSafeWallet", [userAddress]);

    logger.info(
      {
        factoryAddress,
        userAddress,
        data,
      },
      "Sending createSafeWallet transaction"
    );

    // Send via relayer
    const relayerService = getRelayerService();
    const { txHash, receipt } = await relayerService.sendTransaction(
      supportedChainId,
      factoryAddress,
      data
    );

    // Parse SafeWalletCreated event to get Safe address
    const eventTopic = ethers.id("SafeWalletCreated(address,address,uint256)");
    const log = receipt.logs.find((l) => l.topics[0] === eventTopic);

    if (!log) {
      logger.error(
        {
          txHash,
          receipt,
        },
        "SafeWalletCreated event not found in receipt"
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve Safe address from transaction",
      });
      return;
    }

    // Safe address is the 3rd topic (indexed parameter)
    const safeAddress = ethers.getAddress("0x" + log.topics[2].slice(-40));

    logger.info(
      {
        userId,
        userAddress,
        safeAddress,
        txHash,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Safe wallet created successfully"
    );

    res.json({
      success: true,
      data: {
        safeAddress,
        txHash,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        error: errorMessage,
        userId: req.userId,
        chainId: req.body.chainId,
      },
      "Failed to create Safe wallet"
    );

    res.status(500).json({
      success: false,
      error: errorMessage || "Failed to create Safe wallet",
    });
  }
};

/**
 * POST /api/v1/relay/enable-module
 * Execute Safe transaction to enable module via relayer (sponsored)
 */
export const enableModule = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { chainId, safeAddress, safeTxData, signatures } = req.body;

    // Validate required fields
    if (!chainId || !safeAddress || !safeTxData || !signatures) {
      res.status(400).json({
        success: false,
        error:
          "Missing required fields: chainId, safeAddress, safeTxData, signatures",
      });
      return;
    }

    // Validate chain ID
    if (!isSupportedChain(chainId)) {
      res.status(400).json({
        success: false,
        error: `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAINS.ARBITRUM_SEPOLIA} (Arbitrum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_MAINNET} (Arbitrum Mainnet)`,
      });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;
    const chainConfig = getChainConfig(supportedChainId);

    const userAddress = req.userWalletAddress;
    const userId = req.userId;

    // Rate limiting: max module enable per user per day
    const rateLimitKey = `enable-module:${userId}`;
    const maxRequestsPerDay = config.rateLimit.maxTxsPerUserPerDay;
    if (!checkRateLimit(rateLimitKey, maxRequestsPerDay, 24 * 60 * 60 * 1000)) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      });
      return;
    }

    logger.info(
      {
        userId,
        userAddress,
        safeAddress,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Enabling module for Safe"
    );

    // Step 1: Validate that user is an owner (optional but recommended)
    const ownerValidation =
      await safeRelayValidationService.validateUserIsOwner(
        safeAddress,
        userAddress,
        supportedChainId
      );

    if (!ownerValidation.isValid) {
      res.status(403).json({
        success: false,
        error: ownerValidation.error || "User is not an owner of this Safe",
      });
      return;
    }

    // Step 2: Validate the transaction is exactly enableModule
    const calldataValidation =
      safeRelayValidationService.validateEnableModuleCalldata(
        safeTxData,
        safeAddress,
        supportedChainId
      );

    if (!calldataValidation.isValid) {
      res.status(400).json({
        success: false,
        error: calldataValidation.error || "Invalid transaction data",
      });
      return;
    }

    // Step 3: Verify signatures
    const signatureValidation =
      await safeRelayValidationService.verifySafeSignatures(
        safeAddress,
        safeTxData,
        signatures,
        supportedChainId
      );

    if (!signatureValidation.isValid) {
      res.status(400).json({
        success: false,
        error: signatureValidation.error || "Invalid signatures",
      });
      return;
    }

    logger.info(
      {
        userId,
        safeAddress,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "All validations passed, executing Safe transaction"
    );

    // Step 4: Encode execTransaction call
    const iface = new ethers.Interface([
      "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)",
    ]);

    const execTxData = iface.encodeFunctionData("execTransaction", [
      safeTxData.to,
      safeTxData.value,
      safeTxData.data,
      safeTxData.operation,
      safeTxData.safeTxGas,
      safeTxData.baseGas,
      safeTxData.gasPrice,
      safeTxData.gasToken,
      safeTxData.refundReceiver,
      signatures,
    ]);

    // Step 5: Send via relayer
    const relayerService = getRelayerService();
    const { txHash } = await relayerService.sendTransaction(
      supportedChainId,
      safeAddress,
      execTxData
    );

    logger.info(
      {
        userId,
        userAddress,
        safeAddress,
        txHash,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Module enabled successfully"
    );

    res.json({
      success: true,
      data: {
        txHash,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        error: errorMessage,
        userId: req.userId,
        chainId: req.body.chainId,
        safeAddress: req.body.safeAddress,
      },
      "Failed to enable module"
    );

    res.status(500).json({
      success: false,
      error: errorMessage || "Failed to enable module",
    });
  }
};
