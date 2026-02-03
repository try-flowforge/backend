import { Request, Response, NextFunction } from "express";
import { PrivyClient } from "@privy-io/server-auth";
import { logger } from "../utils/logger";
import { config } from "../config/config";

let privyClient: PrivyClient | null = null;

/**
 * Get or initialize Privy client
 */
function getPrivyClient(): PrivyClient | null {
  if (privyClient) {
    return privyClient;
  }

  try {
    privyClient = new PrivyClient(config.privy.appId, config.privy.appSecret);
    return privyClient;
  } catch (error) {
    logger.error({ error }, "Failed to initialize Privy client");
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  userId: string;
  userWalletAddress: string;
}

/**
 * Middleware to verify Privy access token and extract user wallet address
 * Can be bypassed for testing by setting DISABLE_AUTH=true
 */
export const verifyPrivyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // ========================================
  // TESTING MODE - BYPASS AUTHENTICATION
  // ========================================
  if (process.env.DISABLE_AUTH === 'true') {
    const testUserId = process.env.TEST_USER_ID || "test-user-id";
    const testWalletAddress = process.env.TEST_WALLET_ADDRESS || "0x742d35cc6634c0532925a3b844bc9e7595f0beb";
    
    (req as AuthenticatedRequest).userId = testUserId;
    (req as AuthenticatedRequest).userWalletAddress = testWalletAddress.toLowerCase();
    
    logger.warn(
      {
        userId: testUserId,
        walletAddress: testWalletAddress,
      },
      "⚠️  AUTHENTICATION DISABLED - Using test credentials"
    );
    
    next();
    return;
  }

  // ========================================
  // PRODUCTION MODE - NORMAL AUTHENTICATION
  // ========================================
  try {
    const client = getPrivyClient();

    if (!client) {
      logger.error(
        "Privy client not configured - missing PRIVY_APP_ID or PRIVY_APP_SECRET"
      );
      res.status(500).json({
        success: false,
        error: "Authentication service not configured",
      });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Missing or invalid Authorization header");
      res.status(401).json({
        success: false,
        error: "Missing or invalid Authorization header",
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Verify the Privy access token
      const verifiedClaims = await client.verifyAuthToken(token);

      // Extract user ID
      const userId = verifiedClaims.userId;

      if (!userId) {
        logger.warn("Invalid token: missing user ID");
        res.status(401).json({
          success: false,
          error: "Invalid token: missing user ID",
        });
        return;
      }

      // Fetch user details to get embedded wallet address
      const user = await client.getUser(userId);

      // Find the embedded wallet (Privy wallet)
      const embeddedWallet = user.linkedAccounts?.find(
        (account) =>
          account.type === "wallet" && account.walletClientType === "privy"
      );

      if (!embeddedWallet || !("address" in embeddedWallet)) {
        logger.warn({ userId }, "User does not have an embedded wallet");
        res.status(401).json({
          success: false,
          error: "User does not have an embedded wallet",
        });
        return;
      }

      // Attach authenticated user info to request
      (req as AuthenticatedRequest).userId = userId;
      (req as AuthenticatedRequest).userWalletAddress =
        embeddedWallet.address.toLowerCase();

      logger.info(
        {
          userId,
          walletAddress: embeddedWallet.address,
        },
        "User authenticated via Privy"
      );

      next();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Token verification failed"
      );
      res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
      return;
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Authentication middleware error"
    );
    res.status(500).json({
      success: false,
      error: "Authentication error",
    });
    return;
  }
};