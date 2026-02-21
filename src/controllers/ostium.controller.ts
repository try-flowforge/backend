import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { UserModel } from '../models/users';
import { NUMERIC_CHAIN_IDS } from '../config/chain-registry';
import {
  OstiumBalanceRequest,
  OstiumMarketsListRequest,
  OstiumNetwork,
  OstiumPositionCloseRequest,
  OstiumPositionOpenRequest,
  OstiumPositionsListRequest,
  OstiumPositionUpdateSlRequest,
  OstiumPositionUpdateTpRequest,
  OstiumPriceRequest,
} from '../types/ostium.types';
import { ostiumServiceClient, OstiumServiceClientError } from '../services/ostium/ostium-service-client';
import { ostiumDelegationService } from '../services/ostium/ostium-delegation.service';
import { ostiumSetupService } from '../services/ostium/ostium-setup.service';

function sendSuccess(res: Response, data: any): void {
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

function sendServiceError(res: Response, error: OstiumServiceClientError): void {
  res.status(error.statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: error.retryable,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (res.req as Request).requestId,
    },
  });
}

function sendGenericError(res: Response, statusCode: number, code: string, message: string, details?: any): void {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (res.req as Request).requestId,
    },
  });
}

function resolveUserId(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

function networkToChainId(network: 'testnet' | 'mainnet'): number {
  return network === 'testnet' ? NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA : NUMERIC_CHAIN_IDS.ARBITRUM;
}

async function resolveOwnedSafeAddress(userId: string, network: 'testnet' | 'mainnet'): Promise<string> {
  const safeAddress = await UserModel.getSafeAddressByChain(userId, networkToChainId(network));
  if (!safeAddress) {
    throw new Error(`Safe wallet not found for ${network}. Create Safe first.`);
  }
  return safeAddress;
}

async function resolveAndValidateAddress(
  userId: string,
  network: 'testnet' | 'mainnet',
  providedAddress: string | undefined,
  fieldName: 'address' | 'traderAddress',
): Promise<string> {
  const safeAddress = await resolveOwnedSafeAddress(userId, network);
  if (!providedAddress) {
    return safeAddress;
  }

  if (providedAddress.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(`${fieldName} must match your Safe wallet address for ${network}`);
  }

  return safeAddress;
}

export const listOstiumMarkets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumMarketsListRequest;
    const data = await ostiumServiceClient.listMarkets(payload, req.requestId);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const getOstiumPrice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPriceRequest;
    const data = await ostiumServiceClient.getPrice(payload, req.requestId);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const getOstiumBalance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumBalanceRequest;
    const userId = resolveUserId(req);
    const address = await resolveAndValidateAddress(userId, payload.network, payload.address, 'address');
    const data = await ostiumServiceClient.getBalance(
      {
        ...payload,
        address,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const listOstiumPositions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPositionsListRequest;
    const userId = resolveUserId(req);
    const traderAddress = await resolveAndValidateAddress(
      userId,
      payload.network,
      payload.traderAddress,
      'traderAddress',
    );
    const data = await ostiumServiceClient.listPositions(
      {
        ...payload,
        traderAddress,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const openOstiumPosition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPositionOpenRequest;
    const userId = resolveUserId(req);
    const traderAddress = await resolveAndValidateAddress(
      userId,
      payload.network,
      payload.traderAddress,
      'traderAddress',
    );
    const data = await ostiumServiceClient.openPosition(
      {
        ...payload,
        traderAddress,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const closeOstiumPosition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPositionCloseRequest;
    const userId = resolveUserId(req);
    const traderAddress = await resolveAndValidateAddress(
      userId,
      payload.network,
      payload.traderAddress,
      'traderAddress',
    );
    const data = await ostiumServiceClient.closePosition(
      {
        ...payload,
        traderAddress,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const updateOstiumStopLoss = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPositionUpdateSlRequest;
    const userId = resolveUserId(req);
    const traderAddress = await resolveAndValidateAddress(
      userId,
      payload.network,
      payload.traderAddress,
      'traderAddress',
    );
    const data = await ostiumServiceClient.updateStopLoss(
      {
        ...payload,
        traderAddress,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const updateOstiumTakeProfit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body as OstiumPositionUpdateTpRequest;
    const userId = resolveUserId(req);
    const traderAddress = await resolveAndValidateAddress(
      userId,
      payload.network,
      payload.traderAddress,
      'traderAddress',
    );
    const data = await ostiumServiceClient.updateTakeProfit(
      {
        ...payload,
        traderAddress,
      },
      req.requestId,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error && !(error instanceof OstiumServiceClientError)) {
      sendGenericError(res, 400, 'OSTIUM_ADDRESS_VALIDATION_FAILED', error.message);
      return;
    }
    if (error instanceof OstiumServiceClientError) {
      sendServiceError(res, error);
      return;
    }
    next(error);
  }
};

export const prepareOstiumDelegationApproval = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, delegateAddress } = req.body as { network: 'testnet' | 'mainnet'; delegateAddress?: string };
    const data = await ostiumDelegationService.prepareApproval(userId, network, delegateAddress);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'DELEGATION_PREPARE_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const executeOstiumDelegationApproval = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, signature, delegateAddress } = req.body as {
      network: 'testnet' | 'mainnet';
      signature: string;
      delegateAddress?: string;
    };
    const data = await ostiumDelegationService.executeApproval(userId, network, signature, delegateAddress);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'DELEGATION_EXECUTE_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const getOstiumDelegationStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, delegateAddress } = req.body as { network: 'testnet' | 'mainnet'; delegateAddress?: string };
    const data = await ostiumDelegationService.getStatus(userId, network, delegateAddress);
    sendSuccess(res, { delegation: data });
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'DELEGATION_STATUS_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const prepareOstiumDelegationRevoke = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, delegateAddress } = req.body as { network: 'testnet' | 'mainnet'; delegateAddress?: string };
    const data = await ostiumDelegationService.prepareRevoke(userId, network, delegateAddress);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'DELEGATION_REVOKE_PREPARE_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const executeOstiumDelegationRevoke = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, signature, delegateAddress } = req.body as {
      network: 'testnet' | 'mainnet';
      signature: string;
      delegateAddress?: string;
    };
    const data = await ostiumDelegationService.executeRevoke(userId, network, signature, delegateAddress);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'DELEGATION_REVOKE_EXECUTE_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const getOstiumReadiness = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network } = req.body as { network: OstiumNetwork };
    const data = await ostiumSetupService.getReadiness(userId, network);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'OSTIUM_READINESS_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const prepareOstiumAllowanceApproval = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network } = req.body as { network: OstiumNetwork };
    const data = await ostiumSetupService.prepareAllowance(userId, network);
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'ALLOWANCE_PREPARE_FAILED', error.message);
      return;
    }
    next(error);
  }
};

export const executeOstiumAllowanceApproval = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = resolveUserId(req);
    const { network, signature, safeTxHash, safeTxData } = req.body as {
      network: OstiumNetwork;
      signature: string;
      safeTxHash: string;
      safeTxData: {
        to: string;
        value: string;
        data: string;
        operation: number;
      };
    };
    const data = await ostiumSetupService.executeAllowance(
      userId,
      network,
      signature,
      safeTxHash,
      safeTxData,
    );
    sendSuccess(res, data);
  } catch (error) {
    if (error instanceof Error) {
      sendGenericError(res, 400, 'ALLOWANCE_EXECUTE_FAILED', error.message);
      return;
    }
    next(error);
  }
};
