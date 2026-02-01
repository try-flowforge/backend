import { Router, Request, Response, NextFunction } from "express";
import {
  verifyPrivyToken,
  AuthenticatedRequest,
} from "../middleware/privy-auth";
import * as relayController from "../controllers/relay.controller";

const router = Router();

/**
 * All relay routes require Privy authentication
 */
router.use(verifyPrivyToken);

/**
 * POST /api/v1/relay/create-safe - Create a Safe wallet
 */
router.post(
  "/create-safe",
  (req: Request, res: Response, next: NextFunction) => {
    relayController.createSafe(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * POST /api/v1/relay/enable-module - Enable Safe module
 */
router.post(
  "/enable-module",
  (req: Request, res: Response, next: NextFunction) => {
    relayController.enableModule(req as AuthenticatedRequest, res).catch(next);
  }
);

export default router;
