import { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { ApiResponse, SupportedChain } from '../types';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import {
  getChainOrThrow,
  type NumericChainId,
} from '../config/chain-registry';
import { UserModel } from '../models/users';
import { getSafeTransactionService } from '../services/safe-transaction.service';
import { getRelayerService } from '../services/relayer.service';
import {
  getSpendingPolicyService,
  type SpendingPolicyNetwork,
} from '../services/spending-policy.service';
import { usdTo8Decimals } from '../utils/amount';

function sendSuccess(res: Response, data: unknown): void {
  const response: ApiResponse = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (res.req as Request).requestId,
    },
  };
  res.status(200).json(response);
}

function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string
): void {
  res.status(statusCode).json({
    success: false,
    error: { code, message },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (res.req as Request).requestId,
    },
  });
}

function chainToSupportedChain(chainId: NumericChainId): SupportedChain {
  return chainId === 42161 ? SupportedChain.ARBITRUM : SupportedChain.ARBITRUM_SEPOLIA;
}

function resolveUserId(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

export const getSpendingPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, chainId } = req.params as {
      network: SpendingPolicyNetwork;
      chainId: string;
    };
    const numericChainId = Number(chainId);
    const policy = await getSpendingPolicyService().getActivePolicy(
      userId,
      network,
      numericChainId
    );
    sendSuccess(res, { policy });
  } catch (error) {
    next(error);
  }
};

export const upsertSpendingPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const {
      network,
      chainId,
      spendLimitUsd,
      dailyLimitUsd,
      deadline,
      policyTxHash,
    } = req.body as {
      network: SpendingPolicyNetwork;
      chainId: number;
      spendLimitUsd: number;
      dailyLimitUsd: number;
      deadline: string;
      policyTxHash?: string;
    };

    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
    if (!safeAddress) {
      sendError(res, 400, 'SAFE_NOT_FOUND', `No Safe found for chain ${chainId}`);
      return;
    }

    const policy = await getSpendingPolicyService().createPolicy({
      userId,
      network,
      chainId,
      safeAddress,
      spendLimitUsd,
      dailyLimitUsd,
      deadline,
      policyTxHash,
    });
    sendSuccess(res, { policy });
  } catch (error) {
    next(error);
  }
};

export const revokeSpendingPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, chainId } = req.params as {
      network: SpendingPolicyNetwork;
      chainId: string;
    };
    const numericChainId = Number(chainId);
    const policy = await getSpendingPolicyService().revokePolicy(
      userId,
      network,
      numericChainId
    );
    sendSuccess(res, { policy });
  } catch (error) {
    next(error);
  }
};

export const prepareSpendingPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { chainId, deadline, spendLimitUsd = 0, dailyLimitUsd = 0 } = req.body as {
      chainId: NumericChainId;
      deadline: string;
      spendLimitUsd?: number;
      dailyLimitUsd?: number;
    };

    const chain = getChainOrThrow(chainId);
    if (!chain.spendingPolicyAddress) {
      sendError(
        res,
        400,
        'SPENDING_POLICY_CONTRACT_NOT_CONFIGURED',
        `Spending policy contract not configured for chain ${chainId}. Set SPENDING_POLICY_ADDRESS_${chainId} in the backend .env.`
      );
      return;
    }
    if (!ethers.isAddress(chain.spendingPolicyAddress)) {
      sendError(
        res,
        400,
        'SPENDING_POLICY_INVALID_ADDRESS',
        `Spending policy contract address for chain ${chainId} is not a valid Ethereum address. Check SPENDING_POLICY_ADDRESS_${chainId} in the backend .env.`
      );
      return;
    }

    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
    if (!safeAddress) {
      sendError(res, 400, 'SAFE_NOT_FOUND', `No Safe found for chain ${chainId}`);
      return;
    }
    if (!ethers.isAddress(safeAddress)) {
      sendError(
        res,
        400,
        'SAFE_INVALID_ADDRESS',
        `Stored Safe address for chain ${chainId} is invalid. Re-create your Safe for this chain.`
      );
      return;
    }

    const deadlineUnix = Math.floor(new Date(deadline).getTime() / 1000);
    const spendLimitPerTx8 = usdTo8Decimals(spendLimitUsd);
    const dailyLimitUsd8 = usdTo8Decimals(dailyLimitUsd);
    const iface = new ethers.Interface([
      'function setPolicy(uint64 deadline, uint256 spendLimitPerTx, uint256 dailyLimitUsd)',
    ]);
    const data = iface.encodeFunctionData('setPolicy', [
      deadlineUnix,
      spendLimitPerTx8,
      dailyLimitUsd8,
    ]);
    const safeTxService = getSafeTransactionService();
    const safeTxHash = await safeTxService.buildSafeTransactionHash(
      safeAddress,
      chainId,
      chain.spendingPolicyAddress,
      0n,
      data,
      0
    );

    sendSuccess(res, {
      chainId,
      network: getSpendingPolicyService().networkForChainId(chainId),
      safeAddress,
      safeTxHash,
      safeTxData: {
        to: chain.spendingPolicyAddress,
        value: '0',
        data,
        operation: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const executeSpendingPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const {
      chainId,
      network,
      signature,
      spendLimitUsd,
      dailyLimitUsd,
      deadline,
      safeTxHash,
      safeTxData,
    } = req.body as {
      chainId: NumericChainId;
      network: SpendingPolicyNetwork;
      signature: string;
      spendLimitUsd: number;
      dailyLimitUsd: number;
      deadline: string;
      safeTxHash: string;
      safeTxData: {
        to: string;
        value: string;
        data: string;
        operation: number;
      };
    };

    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
    if (!safeAddress) {
      sendError(res, 400, 'SAFE_NOT_FOUND', `No Safe found for chain ${chainId}`);
      return;
    }
    if (!ethers.isAddress(safeTxData.to)) {
      sendError(
        res,
        400,
        'INVALID_TX_TARGET',
        'Invalid parameters: must provide an Ethereum address. The spending policy contract may not be configured for this chain — set SPENDING_POLICY_ADDRESS_42161 (or SPENDING_POLICY_ADDRESS_421614 for testnet) in the backend .env and restart the backend.'
      );
      return;
    }

    const execResult = await getSafeTransactionService().executeWithSignatures(
      safeAddress,
      chainId,
      safeTxData.to,
      BigInt(safeTxData.value),
      safeTxData.data,
      safeTxData.operation,
      signature,
      safeTxHash
    );

    let txHash: string;
    if ('submitOnClient' in execResult && execResult.submitOnClient) {
      const relayerResult = await getRelayerService().sendTransaction(
        chainId,
        execResult.to,
        execResult.data,
        execResult.value,
      );
      txHash = relayerResult.txHash;
    } else if ('txHash' in execResult) {
      txHash = execResult.txHash;
    } else {
      sendError(res, 500, 'EXECUTION_FAILED', 'Unexpected result from Safe execution');
      return;
    }
    const policy = await getSpendingPolicyService().createPolicy({
      userId,
      network,
      chainId,
      safeAddress,
      spendLimitUsd,
      dailyLimitUsd,
      deadline,
      policyTxHash: txHash,
    });

    sendSuccess(res, {
      chain: chainToSupportedChain(chainId),
      txHash,
      policy,
    });
  } catch (error) {
    next(error);
  }
};
