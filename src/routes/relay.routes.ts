import { Router, Request, Response, NextFunction } from "express";
import {
  verifyPrivyToken,
  AuthenticatedRequest,
} from "../middleware/privy-auth";
import * as relayController from "../controllers/relay.controller";
import { validateBody } from "../middleware/validation";
import { createSafeSchema, enableModuleSchema, syncSafeFromTxSchema } from "../middleware/schemas";

const router = Router();

/**
 * All relay routes require Privy authentication
 */
router.use(verifyPrivyToken);

/**
 * GET /api/v1/relay/existing-safe?chainId= - Fetch existing Safe for owner (updates DB if found)
 */
router.get(
  "/existing-safe",
  (req: Request, res: Response, next: NextFunction) => {
    relayController.getExistingSafe(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * POST /api/v1/relay/create-safe - Create a Safe wallet
 */
router.post(
  "/create-safe",
  validateBody(createSafeSchema),
  (req: Request, res: Response, next: NextFunction) => {
    relayController.createSafe(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * POST /api/v1/relay/sync-safe-from-tx - Sync Safe address from client-submitted create-safe tx (mainnet)
 */
router.post(
  "/sync-safe-from-tx",
  validateBody(syncSafeFromTxSchema),
  (req: Request, res: Response, next: NextFunction) => {
    relayController.syncSafeFromTx(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * POST /api/v1/relay/enable-module - Enable Safe module
 */
router.post(
  "/enable-module",
  validateBody(enableModuleSchema),
  (req: Request, res: Response, next: NextFunction) => {
    relayController.enableModule(req as AuthenticatedRequest, res).catch(next);
  }
);

export default router;
