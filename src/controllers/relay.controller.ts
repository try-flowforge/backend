import { Response } from "express";
import { ethers } from "ethers";
import { AuthenticatedRequest } from "../middleware/privy-auth";
import { getRelayerService } from "../services/relayer.service";
import { safeRelayValidationService } from "../services/safeRelayValidation.service";
import { acquireLock, releaseLock } from "../services/distributed-lock.service";
import { logger } from "../utils/logger";
import {
  config,
  getChainConfig,
  isMainnetChain,
  isSupportedChain,
  SUPPORTED_CHAINS,
  SupportedChainId,
} from "../config/config";
import { UserModel } from "../models/users";
import { PrivyClient } from "@privy-io/server-auth";
import { checkRateLimit } from "../services/rate-limiter.service";
import { RATE_LIMIT_CONSTANTS } from "../config/constants";

/**
 * Result of user creation/update operation
 */
interface UserSyncResult {
  success: boolean;
  userCreated: boolean;
  safeAddressUpdated: boolean;
  error?: string;
}

/**
 * Ensure user exists in database and update their Safe wallet address
 * Creates user if they don't exist, then updates the Safe address for the chain
 * Returns structured result for tracking - does not throw to avoid failing SAFE creation
 */
async function ensureUserExistsAndUpdateSafe(
  userId: string,
  walletAddress: string,
  safeAddress: string,
  chainId: SupportedChainId
): Promise<UserSyncResult> {
  const result: UserSyncResult = {
    success: false,
    userCreated: false,
    safeAddressUpdated: false,
  };

  try {
    // Check if user exists
    let user = await UserModel.findById(userId);

    if (!user) {
      // User doesn't exist, create them
      logger.info({ userId, walletAddress }, 'Creating new user in database');

      // Try to get email from Privy
      let email = `${userId}@privy.local`;
      try {
        const privyClient = new PrivyClient(config.privy.appId, config.privy.appSecret);
        const privyUser = await privyClient.getUser(userId);
        const emailAccount = privyUser.linkedAccounts?.find(
          (account) => account.type === 'email'
        );
        if (emailAccount && 'address' in emailAccount) {
          email = emailAccount.address;
        }
      } catch (privyError) {
        logger.warn({ privyError, userId }, 'Could not fetch email from Privy, using fallback');
      }

      // Create user
      user = await UserModel.findOrCreate({
        id: userId,
        address: walletAddress,
        email: email,
        onboarded_at: new Date(),
      });

      result.userCreated = true;
      logger.info({ userId, email }, 'User created in database');
    }

    // Update the Safe wallet address for the specific chain
    await UserModel.updateSafeAddressForChain(userId, chainId, safeAddress);
    logger.info({ userId, safeAddress, chainId }, 'Updated user Safe wallet address for chain');

    result.safeAddressUpdated = true;
    result.success = true;
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.error = errorMessage;
    logger.error(
      {
        error: errorMessage,
        userId,
        walletAddress,
        safeAddress,
        chainId,
        userCreated: result.userCreated,
        safeAddressUpdated: result.safeAddressUpdated,
      },
      'CRITICAL: Failed to sync user with database - SAFE may be orphaned'
    );

    return result;
  }
}


/**
 * POST /api/v1/relay/create-safe
 * Create a Safe wallet via direct relayer (sponsored)
 */
export const createSafe = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  let lockValue: string | undefined;
  let lockKey: string | undefined;

  try {
    const { chainId } = req.body;

    // Validate chain ID
    if (!isSupportedChain(chainId)) {
      res.status(400).json({
        success: false,
        error: `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAINS.ETHEREUM_SEPOLIA} (Ethereum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_SEPOLIA} (Arbitrum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_MAINNET} (Arbitrum Mainnet)`,
      });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;

    const userAddress = req.userWalletAddress;
    const userId = req.userId;

    const chainConfig = getChainConfig(supportedChainId);

    // Acquire distributed lock to prevent race conditions
    // Lock is per-user per-chain to allow parallel creation on different chains
    lockKey = `safe-creation:${userId}:${supportedChainId}`;
    const lockResult = await acquireLock(lockKey, { ttlSeconds: 600 }); // Increased to 10 mins

    if (!lockResult.acquired) {
      logger.warn({ userId, chainId: supportedChainId }, "SAFE creation already in progress");
      res.status(409).json({
        success: false,
        error: "SAFE creation already in progress. Please wait and try again.",
        code: "CREATION_IN_PROGRESS",
      });
      return;
    }
    lockValue = lockResult.lockValue;

    logger.info(
      {
        userId,
        userAddress,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Checking for existing Safe wallet"
    );

    // Get factory address for the chain
    const factoryAddress = chainConfig.factoryAddress;

    // Check if user already has a Safe wallet (idempotency check)
    const relayerService = getRelayerService();
    const provider = relayerService.getProvider(supportedChainId);
    const factoryContract = new ethers.Contract(
      factoryAddress,
      [
        "function getSafeWallets(address user) view returns (address[])",
      ],
      provider
    );

    const existingSafes = await factoryContract.getSafeWallets(userAddress);

    if (existingSafes.length > 0) {
      // Return the first existing Safe (user already has one)
      const existingSafeAddress = existingSafes[0];

      logger.info(
        {
          userId,
          userAddress,
          safeAddress: existingSafeAddress,
          chainId: supportedChainId,
          chainName: chainConfig.name,
        },
        "User already has a Safe wallet, returning existing address"
      );

      // Ensure user exists in DB and has their Safe address recorded
      await ensureUserExistsAndUpdateSafe(userId, userAddress, existingSafeAddress, supportedChainId);

      // Release lock before returning
      await releaseLock(lockKey, lockValue!);

      res.json({
        success: true,
        data: {
          safeAddress: existingSafeAddress,
          txHash: null, // No new transaction was created
          alreadyExisted: true,
        },
      });
      return;
    }

    // Rate limiting: max Safe creations per user per day
    // Only apply rate limit when actually creating a new Safe
    const rateLimitKey = `create-safe:${userId}`;
    const rateLimitResult = await checkRateLimit(
      rateLimitKey,
      RATE_LIMIT_CONSTANTS.MAX_SAFE_CREATIONS_PER_DAY,
      RATE_LIMIT_CONSTANTS.RATE_LIMIT_WINDOW_MS
    );

    if (!rateLimitResult.allowed) {
      // Release lock before returning
      await releaseLock(lockKey, lockValue!);

      res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: rateLimitResult.retryAfterMs,
      });
      return;
    }

    logger.info(
      {
        userId,
        userAddress,
        chainId: supportedChainId,
        chainName: chainConfig.name,
      },
      "Creating new Safe wallet"
    );

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

    // Send via relayer (already initialized above for reading)
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

      // Release lock before returning
      await releaseLock(lockKey, lockValue!);

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

    // Ensure user exists in DB and has their Safe address recorded
    await ensureUserExistsAndUpdateSafe(userId, userAddress, safeAddress, supportedChainId);

    // Release lock before returning
    await releaseLock(lockKey, lockValue!);

    res.json({
      success: true,
      data: {
        safeAddress,
        txHash,
        alreadyExisted: false,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Ensure lock is released on error
    if (lockKey && lockValue) {
      await releaseLock(lockKey, lockValue);
    }

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
        error: `Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAINS.ETHEREUM_SEPOLIA} (Ethereum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_SEPOLIA} (Arbitrum Sepolia), ${SUPPORTED_CHAINS.ARBITRUM_MAINNET} (Arbitrum Mainnet)`,
      });
      return;
    }

    const supportedChainId = chainId as SupportedChainId;
    const chainConfig = getChainConfig(supportedChainId);

    const userAddress = req.userWalletAddress;
    const userId = req.userId;

    // Step 0: Check if module is already enabled (idempotency)
    // Do this BEFORE rate limiting to avoid consuming quota for no-op requests
    const moduleEnabledCheck = await safeRelayValidationService.isModuleEnabled(
      safeAddress,
      supportedChainId
    );

    if (moduleEnabledCheck.enabled) {
      logger.info(
        {
          userId,
          safeAddress,
          chainId: supportedChainId,
          chainName: chainConfig.name,
        },
        "Module already enabled, returning success"
      );

      res.json({
        success: true,
        data: {
          txHash: null,
          alreadyEnabled: true,
        },
      });
      return;
    }

    // Sponsorship on mainnet only: consume one of the user's sponsored tx slots (testnet = unlimited)
    if (isMainnetChain(supportedChainId)) {
      const sponsorResult = await UserModel.consumeOneSponsoredTx(userId);
      if (!sponsorResult.consumed) {
        res.status(403).json({
          success: false,
          error: `No sponsored mainnet transactions remaining (${sponsorResult.remaining} left). Gas sponsorship on mainnet is limited to 3 per user.`,
          code: "NO_SPONSORED_TXS_REMAINING",
        });
        return;
      }
    }

    // Rate limiting: max module enable per user per day
    const rateLimitKey = `enable-module:${userId}`;
    const rateLimitResult = await checkRateLimit(
      rateLimitKey,
      RATE_LIMIT_CONSTANTS.MAX_MODULE_ENABLES_PER_DAY,
      RATE_LIMIT_CONSTANTS.RATE_LIMIT_WINDOW_MS
    );

    if (!rateLimitResult.allowed) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: rateLimitResult.retryAfterMs,
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
