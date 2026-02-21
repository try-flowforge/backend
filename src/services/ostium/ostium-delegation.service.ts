import { ethers } from 'ethers';
import { query } from '../../config/database';
import { NUMERIC_CHAIN_IDS, type NumericChainId } from '../../config/chain-registry';
import { UserModel } from '../../models/users';
import { getSafeTransactionService } from '../safe-transaction.service';

export type OstiumNetwork = 'testnet' | 'mainnet';

interface SafeTxData {
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
}

export interface DelegationStatus {
  id: string;
  userId: string;
  network: OstiumNetwork;
  chainId: number;
  safeAddress: string;
  delegateAddress: string;
  tradingContract: string;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'FAILED';
  approvalTxHash: string | null;
  revokeTxHash: string | null;
  safeTxHash: string | null;
  safeTxData: SafeTxData | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DelegationRow {
  id: string;
  user_id: string;
  network: OstiumNetwork;
  chain_id: number;
  safe_address: string;
  delegate_address: string;
  trading_contract: string;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'FAILED';
  approval_tx_hash: string | null;
  revoke_tx_hash: string | null;
  safe_tx_hash: string | null;
  safe_tx_data: SafeTxData | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class OstiumDelegationService {
  private readonly safeTxService = getSafeTransactionService();

  private networkToChainId(network: OstiumNetwork): NumericChainId {
    return network === 'testnet' ? NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA : NUMERIC_CHAIN_IDS.ARBITRUM;
  }

  private getTradingContract(network: OstiumNetwork): string {
    const value = network === 'testnet'
      ? process.env.OSTIUM_TRADING_CONTRACT_TESTNET
      : process.env.OSTIUM_TRADING_CONTRACT_MAINNET;

    if (!value || !value.startsWith('0x') || value.length !== 42) {
      throw new Error(
        `Missing or invalid OSTIUM_TRADING_CONTRACT_${network === 'testnet' ? 'TESTNET' : 'MAINNET'} configuration`,
      );
    }

    return ethers.getAddress(value);
  }

  private getDelegateAddress(override?: string): string {
    const address = override || process.env.OSTIUM_DELEGATE_ADDRESS;
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      throw new Error('Missing or invalid OSTIUM_DELEGATE_ADDRESS configuration');
    }
    return ethers.getAddress(address);
  }

  private normalize(row: DelegationRow): DelegationStatus {
    return {
      id: row.id,
      userId: row.user_id,
      network: row.network,
      chainId: row.chain_id,
      safeAddress: row.safe_address,
      delegateAddress: row.delegate_address,
      tradingContract: row.trading_contract,
      status: row.status,
      approvalTxHash: row.approval_tx_hash,
      revokeTxHash: row.revoke_tx_hash,
      safeTxHash: row.safe_tx_hash,
      safeTxData: row.safe_tx_data,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async upsertPending(params: {
    userId: string;
    network: OstiumNetwork;
    chainId: number;
    safeAddress: string;
    delegateAddress: string;
    tradingContract: string;
    safeTxHash: string;
    safeTxData: SafeTxData;
  }): Promise<DelegationStatus> {
    const text = `
      INSERT INTO ostium_delegations (
        user_id,
        network,
        chain_id,
        safe_address,
        delegate_address,
        trading_contract,
        status,
        safe_tx_hash,
        safe_tx_data,
        last_error,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8::jsonb, NULL, NOW())
      ON CONFLICT (user_id, network, delegate_address)
      DO UPDATE SET
        chain_id = EXCLUDED.chain_id,
        safe_address = EXCLUDED.safe_address,
        trading_contract = EXCLUDED.trading_contract,
        status = 'PENDING',
        safe_tx_hash = EXCLUDED.safe_tx_hash,
        safe_tx_data = EXCLUDED.safe_tx_data,
        last_error = NULL,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      params.userId,
      params.network,
      params.chainId,
      params.safeAddress,
      params.delegateAddress,
      params.tradingContract,
      params.safeTxHash,
      JSON.stringify(params.safeTxData),
    ];

    const result = await query(text, values);
    return this.normalize(result.rows[0] as DelegationRow);
  }

  async prepareApproval(userId: string, network: OstiumNetwork, delegateAddressOverride?: string): Promise<DelegationStatus> {
    const chainId = this.networkToChainId(network);
    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);

    if (!safeAddress) {
      throw new Error(
        `Safe wallet not found for user ${userId} on chain ${chainId}. Create Safe first via /api/v1/relay/create-safe`,
      );
    }

    const delegateAddress = this.getDelegateAddress(delegateAddressOverride);
    const tradingContract = this.getTradingContract(network);

    const iface = new ethers.Interface(['function setDelegate(address delegate)']);
    const data = iface.encodeFunctionData('setDelegate', [delegateAddress]);

    const safeTxHash = await this.safeTxService.buildSafeTransactionHash(
      safeAddress,
      chainId,
      tradingContract,
      0n,
      data,
      0,
    );

    const safeTxData: SafeTxData = {
      to: tradingContract,
      value: '0',
      data,
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ethers.ZeroAddress,
      refundReceiver: ethers.ZeroAddress,
    };

    return this.upsertPending({
      userId,
      network,
      chainId,
      safeAddress,
      delegateAddress,
      tradingContract,
      safeTxHash,
      safeTxData,
    });
  }

  async executeApproval(userId: string, network: OstiumNetwork, signature: string, delegateAddressOverride?: string): Promise<DelegationStatus> {
    const delegateAddress = this.getDelegateAddress(delegateAddressOverride);
    const status = await this.getStatus(userId, network, delegateAddress);

    if (!status) {
      throw new Error('No pending delegation found. Call prepare endpoint first.');
    }

    if (!status.safeTxData || !status.safeTxHash) {
      throw new Error('Delegation record is missing safe transaction data/hash');
    }

    const execResult = await this.safeTxService.executeWithSignatures(
      status.safeAddress,
      status.chainId as NumericChainId,
      status.safeTxData.to,
      BigInt(status.safeTxData.value),
      status.safeTxData.data,
      status.safeTxData.operation,
      signature,
      status.safeTxHash,
      BigInt(status.safeTxData.safeTxGas),
      BigInt(status.safeTxData.baseGas),
      BigInt(status.safeTxData.gasPrice),
      status.safeTxData.gasToken,
      status.safeTxData.refundReceiver,
    );

    const result = await query(
      `
      UPDATE ostium_delegations
      SET status = 'ACTIVE',
          approval_tx_hash = $1,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
      `,
      [execResult.txHash, status.id],
    );

    return this.normalize(result.rows[0] as DelegationRow);
  }

  async prepareRevoke(userId: string, network: OstiumNetwork, delegateAddressOverride?: string): Promise<DelegationStatus> {
    const chainId = this.networkToChainId(network);
    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);

    if (!safeAddress) {
      throw new Error(`Safe wallet not found for user ${userId} on chain ${chainId}`);
    }

    const delegateAddress = this.getDelegateAddress(delegateAddressOverride);
    const tradingContract = this.getTradingContract(network);

    const iface = new ethers.Interface(['function setDelegate(address delegate)']);
    const data = iface.encodeFunctionData('setDelegate', [ethers.ZeroAddress]);

    const safeTxHash = await this.safeTxService.buildSafeTransactionHash(
      safeAddress,
      chainId,
      tradingContract,
      0n,
      data,
      0,
    );

    const safeTxData: SafeTxData = {
      to: tradingContract,
      value: '0',
      data,
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ethers.ZeroAddress,
      refundReceiver: ethers.ZeroAddress,
    };

    return this.upsertPending({
      userId,
      network,
      chainId,
      safeAddress,
      delegateAddress,
      tradingContract,
      safeTxHash,
      safeTxData,
    });
  }

  async executeRevoke(userId: string, network: OstiumNetwork, signature: string, delegateAddressOverride?: string): Promise<DelegationStatus> {
    const delegateAddress = this.getDelegateAddress(delegateAddressOverride);
    const status = await this.getStatus(userId, network, delegateAddress);

    if (!status) {
      throw new Error('No delegation found for revoke. Call prepare-revoke first.');
    }

    if (!status.safeTxData || !status.safeTxHash) {
      throw new Error('Delegation record is missing safe transaction data/hash');
    }

    const execResult = await this.safeTxService.executeWithSignatures(
      status.safeAddress,
      status.chainId as NumericChainId,
      status.safeTxData.to,
      BigInt(status.safeTxData.value),
      status.safeTxData.data,
      status.safeTxData.operation,
      signature,
      status.safeTxHash,
      BigInt(status.safeTxData.safeTxGas),
      BigInt(status.safeTxData.baseGas),
      BigInt(status.safeTxData.gasPrice),
      status.safeTxData.gasToken,
      status.safeTxData.refundReceiver,
    );

    const result = await query(
      `
      UPDATE ostium_delegations
      SET status = 'REVOKED',
          revoke_tx_hash = $1,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
      `,
      [execResult.txHash, status.id],
    );

    return this.normalize(result.rows[0] as DelegationRow);
  }

  async getStatus(userId: string, network: OstiumNetwork, delegateAddressOverride?: string): Promise<DelegationStatus | null> {
    const delegateAddress = delegateAddressOverride ? this.getDelegateAddress(delegateAddressOverride) : null;
    const text = delegateAddress
      ? `
        SELECT *
        FROM ostium_delegations
        WHERE user_id = $1 AND network = $2 AND delegate_address = $3
        ORDER BY updated_at DESC
        LIMIT 1;
      `
      : `
        SELECT *
        FROM ostium_delegations
        WHERE user_id = $1 AND network = $2
        ORDER BY updated_at DESC
        LIMIT 1;
      `;

    const values = delegateAddress ? [userId, network, delegateAddress] : [userId, network];
    const result = await query(text, values);
    if (result.rows.length === 0) {
      return null;
    }

    return this.normalize(result.rows[0] as DelegationRow);
  }
}

export const ostiumDelegationService = new OstiumDelegationService();
