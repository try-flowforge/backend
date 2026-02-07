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
 */
export const verifyPrivyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
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

      // Fetch user details to get linked wallets
      const user = await client.getUser(userId);

      const walletAccounts =
        user.linkedAccounts?.filter(
          (account): account is typeof account & { address: string } =>
            account.type === "wallet" && "address" in account
        ) ?? [];

      // Canonical wallet: prefer first external (MetaMask, WalletConnect, etc.) else embedded
      const walletClientType = (acc: (typeof walletAccounts)[number]) =>
        "walletClientType" in acc ? (acc.walletClientType as string) : undefined;
      const externalWallet = walletAccounts.find(
        (account) => walletClientType(account) !== "privy"
      );
      const embeddedWallet = walletAccounts.find(
        (account) => walletClientType(account) === "privy"
      );
      const canonicalWallet = externalWallet ?? embeddedWallet;

      if (!canonicalWallet) {
        logger.warn({ userId }, "User has no linked wallet");
        res.status(401).json({
          success: false,
          error:
            "No wallet linked. Please create or connect a wallet in the app.",
        });
        return;
      }

      // Attach authenticated user info to request
      (req as AuthenticatedRequest).userId = userId;
      (req as AuthenticatedRequest).userWalletAddress =
        canonicalWallet.address.toLowerCase();

      logger.info(
        {
          userId,
          walletAddress: canonicalWallet.address,
          walletType: walletClientType(canonicalWallet) ?? "embedded",
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
