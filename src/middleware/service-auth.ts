import { Request, Response, NextFunction } from "express";
import { verifyPrivyToken, AuthenticatedRequest } from "./privy-auth";
import { logger } from "../utils/logger";
import { config } from "../config/config";

/**
 * Middleware that allows authentication via a configured Service Key or falls back to Privy.
 * This is useful for backend agents/services to act on behalf of a user.
 *
 * If `x-service-key` matches `config.server.serviceKey`, it checks for `x-on-behalf-of`.
 * If valid, it assigns the user ID to the request and bypasses Privy verification.
 * If no service key is provided or it doesn't match, it falls back to standard Privy auth.
 */
export const verifyServiceKeyOrPrivyToken = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const serviceKeyHeader = req.headers["x-service-key"];

    // 1. If service key header is provided, attempt service key auth
    if (serviceKeyHeader) {
        if (!config.server.serviceKey) {
            logger.warn("Service key received but not configured on the server");
            res.status(401).json({ success: false, error: "Service key auth not configured" });
            return;
        }

        if (serviceKeyHeader === config.server.serviceKey) {
            const onBehalfOfUrlHeader = req.headers["x-on-behalf-of"];
            const onBehalfOf = Array.isArray(onBehalfOfUrlHeader) ? onBehalfOfUrlHeader[0] : onBehalfOfUrlHeader;

            if (!onBehalfOf) {
                logger.warn("Service key auth requires x-on-behalf-of header");
                res.status(400).json({ success: false, error: "Missing x-on-behalf-of header" });
                return;
            }

            logger.info({ userId: onBehalfOf }, "Authenticated via Service Key");

            // Act on behalf of the user. Because agents don't have a wallet, we set userWalletAddress to empty string
            // just like email-only Privy users. The intent/transaction flow handles the target Safe address separately.
            (req as AuthenticatedRequest).userId = onBehalfOf;
            (req as AuthenticatedRequest).userWalletAddress = "";

            return next();
        } else {
            logger.warn("Invalid service key attempt");
            res.status(401).json({ success: false, error: "Invalid service key" });
            return;
        }
    }

    // 2. Fallback to standard Privy token authentication
    return verifyPrivyToken(req, res, next);
};
