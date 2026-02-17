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

      // Fetch user details to get linked wallets.
      // Newly-created embedded wallets may take a moment to propagate through
      // Privy's infrastructure, so retry a few times before giving up.
      const walletClientType = (
        acc: { address?: string; walletClientType?: string },
      ) => acc.walletClientType;

      let canonicalWallet: { address: string; walletClientType?: string } | undefined;

      const MAX_WALLET_RETRIES = 3;
      const WALLET_RETRY_DELAY_MS = 1500;

      for (let attempt = 1; attempt <= MAX_WALLET_RETRIES; attempt++) {
        const user = await client.getUser(userId);

        // Debug: log all linked accounts so we can see what Privy returns
        logger.info(
          {
            userId,
            attempt,
            linkedAccountCount: user.linkedAccounts?.length ?? 0,
            linkedAccountTypes: user.linkedAccounts?.map((a) => {
              const obj: Record<string, unknown> = { type: a.type };
              if ("walletClientType" in a) obj.walletClientType = (a as unknown as { walletClientType: string }).walletClientType;
              if ("address" in a) obj.address = (a as unknown as { address: string }).address;
              return obj;
            }),
          },
          "Privy getUser linked accounts"
        );

        const walletAccounts =
          user.linkedAccounts?.filter(
            (account): account is typeof account & { address: string } =>
              account.type === "wallet" && "address" in account
          ) ?? [];

        const externalWallet = walletAccounts.find(
          (account) => walletClientType(account) !== "privy"
        );
        const embeddedWallet = walletAccounts.find(
          (account) => walletClientType(account) === "privy"
        );
        canonicalWallet = externalWallet ?? embeddedWallet;

        if (canonicalWallet) break;

        if (attempt < MAX_WALLET_RETRIES) {
          logger.info(
            { userId, attempt, maxRetries: MAX_WALLET_RETRIES },
            "No linked wallet found yet, retrying after delay"
          );
          await new Promise((r) => setTimeout(r, WALLET_RETRY_DELAY_MS));
        }
      }

      if (!canonicalWallet) {
        // Allow email-only users for onboarding
        logger.info({ userId }, "User has no linked wallet - proceeding as email-only user");

        (req as AuthenticatedRequest).userId = userId;
        // Set empty string for wallet address - handlers must handle this case
        (req as AuthenticatedRequest).userWalletAddress = "";

        next();
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
          walletType: canonicalWallet.walletClientType ?? "embedded",
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
