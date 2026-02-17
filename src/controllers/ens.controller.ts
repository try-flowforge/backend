import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { UserModel } from '../models/users';
import { UserEnsSubdomainModel } from '../models/ens';
import { sponsorshipAllowanceFromDuration } from '../services/ens-sponsorship.service';
import { ENS_PRICER_PERIOD_SECONDS } from '../config/config';
import { logger } from '../utils/logger';

/**
 * POST /api/v1/ens/subdomain-registered
 * Record an ENS subdomain registration and grant sponsored tx allowance.
 * Allowance = 3 sponsored txs per 0.5 USDC (per 1 week), from FlowForgeEthUsdcPricer.
 * Caller must be authenticated; ownerAddress must match the authenticated user's wallet.
 */
export const subdomainRegistered = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const userWalletAddress = req.userWalletAddress;
    if (!userId || !userWalletAddress) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const { ensName, ownerAddress, expiry, durationSeconds, chainId } = req.body as {
      ensName: string;
      ownerAddress: string;
      expiry: string;
      durationSeconds: number;
      chainId: number;
    };

    if (ownerAddress.toLowerCase() !== userWalletAddress.toLowerCase()) {
      res.status(403).json({
        success: false,
        error: 'Owner address must match your connected wallet',
        code: 'OWNER_MISMATCH',
      });
      return;
    }

    // Match contract: duration must be whole weeks (FlowForgeEthUsdcPricer reverts otherwise)
    if (durationSeconds % ENS_PRICER_PERIOD_SECONDS !== 0) {
      res.status(400).json({
        success: false,
        error: `Duration must be a whole number of weeks (multiple of ${ENS_PRICER_PERIOD_SECONDS} seconds).`,
        code: 'DURATION_NOT_WHOLE_WEEKS',
      });
      return;
    }

    const allowance = sponsorshipAllowanceFromDuration(durationSeconds);
    if (allowance <= 0) {
      res.status(400).json({
        success: false,
        error:
          'Duration too short for sponsorship. Minimum 1 week (604800 seconds) for 3 sponsored txs.',
        code: 'INSUFFICIENT_DURATION',
      });
      return;
    }

    const expiryDate = new Date(expiry);
    await UserEnsSubdomainModel.upsert({
      userId,
      ensName,
      ownerAddress: ownerAddress.toLowerCase(),
      expiry: expiryDate,
      chainId,
    });

    await UserModel.setRemainingSponsoredTxs(userId, allowance);

    logger.info(
      { userId, ensName, allowance, chainId },
      'ENS subdomain registered, sponsorship allowance granted'
    );

    res.json({
      success: true,
      data: {
        ensName,
        expiry: expiryDate.toISOString(),
        remaining_sponsored_txs: allowance,
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error, userId: req.userId },
      'Failed to record ENS subdomain registration'
    );
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record subdomain registration',
    });
  }
};

/**
 * GET /api/v1/ens/subdomains
 * List ENS subdomains for the authenticated user.
 */
export const listSubdomains = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const subdomains = await UserEnsSubdomainModel.findByUserId(userId);

    res.json({
      success: true,
      data: subdomains.map((s) => ({
        id: s.id,
        ens_name: s.ens_name,
        owner_address: s.owner_address,
        expiry: s.expiry,
        chain_id: s.chain_id,
        created_at: s.created_at,
        active: new Date(s.expiry) > new Date(),
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error, userId: req.userId },
      'Failed to list ENS subdomains'
    );
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list subdomains',
    });
  }
};
