import { ethers } from 'ethers';
import { NUMERIC_CHAIN_IDS, type NumericChainId } from '../../config/chain-registry';
import { UserModel } from '../../models/users';
import { getSafeTransactionService } from '../safe-transaction.service';
import { ostiumDelegationService, type OstiumNetwork } from './ostium-delegation.service';
import { ostiumServiceClient } from './ostium-service-client';

interface SafeTxData {
  to: string;
  value: string;
  data: string;
  operation: number;
}

interface NetworkContracts {
  usdc: string;
  trading: string;
  tradingStorage: string;
}

interface ReadinessCheck {
  ok: boolean;
  message: string;
}

interface ReadinessResponse {
  network: OstiumNetwork;
  chainId: number;
  safeAddress: string | null;
  delegateAddress: string | null;
  contracts: NetworkContracts;
  checks: {
    safeWallet: ReadinessCheck & { address: string | null };
    delegation: ReadinessCheck & { status: string | null };
    usdcBalance: ReadinessCheck & { balance: string | null };
    allowance: ReadinessCheck & { amount: string | null; spender: string };
    delegateGas: ReadinessCheck & { balance: string | null; address: string | null };
  };
  readyForOpenPosition: boolean;
  readyForPositionManagement: boolean;
  refreshedAt: string;
}

interface AllowancePrepareResponse {
  network: OstiumNetwork;
  safeAddress: string;
  safeTxHash: string;
  safeTxData: SafeTxData;
  tokenAddress: string;
  spenderAddress: string;
  amount: string;
}

interface AllowanceExecuteResponse {
  network: OstiumNetwork;
  safeAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: string;
  txHash: string;
}

const DEFAULT_CONTRACTS: Record<OstiumNetwork, NetworkContracts> = {
  testnet: {
    usdc: '0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548',
    trading: '0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe',
    tradingStorage: '0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8',
  },
  mainnet: {
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    trading: '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411',
    tradingStorage: '0xcCd5891083A8acD2074690F65d3024E7D13d66E7',
  },
};

const MIN_SAFE_USDC_BALANCE = ethers.parseUnits('1', 6); // 1 USDC
const MIN_ALLOWANCE = ethers.parseUnits('1', 6); // 1 USDC
const MIN_DELEGATE_GAS = ethers.parseUnits('0.0001', 18); // 0.0001 ETH

export class OstiumSetupService {
  private readonly safeTxService = getSafeTransactionService();
  private readonly approveIface = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);

  private networkToChainId(network: OstiumNetwork): NumericChainId {
    return network === 'testnet' ? NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA : NUMERIC_CHAIN_IDS.ARBITRUM;
  }

  private getSafeAddressByNetwork(userId: string, network: OstiumNetwork): Promise<string | null> {
    return UserModel.getSafeAddressByChain(userId, this.networkToChainId(network));
  }

  private getDelegateAddress(): string | null {
    const value = process.env.OSTIUM_DELEGATE_ADDRESS;
    if (!value || !value.startsWith('0x') || value.length !== 42) {
      return null;
    }
    try {
      return ethers.getAddress(value);
    } catch {
      return null;
    }
  }

  private envByNetwork(network: OstiumNetwork, key: 'TRADING' | 'TRADING_STORAGE' | 'USDC'): string | undefined {
    if (network === 'testnet') {
      if (key === 'TRADING') return process.env.OSTIUM_TRADING_CONTRACT_TESTNET;
      if (key === 'TRADING_STORAGE') return process.env.OSTIUM_TRADING_STORAGE_CONTRACT_TESTNET;
      return process.env.OSTIUM_USDC_CONTRACT_TESTNET;
    }
    if (key === 'TRADING') return process.env.OSTIUM_TRADING_CONTRACT_MAINNET;
    if (key === 'TRADING_STORAGE') return process.env.OSTIUM_TRADING_STORAGE_CONTRACT_MAINNET;
    return process.env.OSTIUM_USDC_CONTRACT_MAINNET;
  }

  private resolveAddress(value: string | undefined, fallback: string, label: string): string {
    const candidate = value && value.trim().length > 0 ? value : fallback;
    if (!candidate.startsWith('0x') || candidate.length !== 42) {
      throw new Error(`Invalid ${label} address configuration`);
    }
    return ethers.getAddress(candidate);
  }

  private getContracts(network: OstiumNetwork): NetworkContracts {
    const defaults = DEFAULT_CONTRACTS[network];
    return {
      trading: this.resolveAddress(this.envByNetwork(network, 'TRADING'), defaults.trading, 'Ostium trading contract'),
      tradingStorage: this.resolveAddress(
        this.envByNetwork(network, 'TRADING_STORAGE'),
        defaults.tradingStorage,
        'Ostium trading storage contract',
      ),
      usdc: this.resolveAddress(this.envByNetwork(network, 'USDC'), defaults.usdc, 'Ostium USDC contract'),
    };
  }

  private parseDecimalBalanceToBigInt(value: string | undefined | null, decimals: number): bigint {
    if (!value) return 0n;
    try {
      return ethers.parseUnits(value, decimals);
    } catch {
      return 0n;
    }
  }

  private buildApproveSafeTxData(contracts: NetworkContracts): { safeTxData: SafeTxData; amount: bigint } {
    const amount = ethers.MaxUint256;
    return {
      amount,
      safeTxData: {
        to: contracts.usdc,
        value: '0',
        data: this.approveIface.encodeFunctionData('approve', [contracts.tradingStorage, amount]),
        operation: 0,
      },
    };
  }

  private validateApproveSafeTxData(safeTxData: SafeTxData, contracts: NetworkContracts): { spender: string; amount: bigint } {
    if (safeTxData.operation !== 0) {
      throw new Error('Allowance Safe transaction operation must be CALL (0)');
    }

    const to = ethers.getAddress(safeTxData.to);
    if (to !== ethers.getAddress(contracts.usdc)) {
      throw new Error('Allowance Safe transaction token does not match Ostium USDC contract');
    }

    const value = BigInt(safeTxData.value);
    if (value !== 0n) {
      throw new Error('Allowance Safe transaction value must be 0');
    }

    let decoded: ethers.Result;
    try {
      decoded = this.approveIface.decodeFunctionData('approve', safeTxData.data);
    } catch {
      throw new Error('Allowance Safe transaction data is not a valid ERC20 approve call');
    }

    const spender = ethers.getAddress(String(decoded[0]));
    const amount = BigInt(decoded[1].toString());
    if (spender !== ethers.getAddress(contracts.tradingStorage)) {
      throw new Error('Allowance spender must match Ostium trading storage contract');
    }
    if (amount <= 0n) {
      throw new Error('Allowance amount must be greater than 0');
    }
    return { spender, amount };
  }

  async getReadiness(userId: string, network: OstiumNetwork): Promise<ReadinessResponse> {
    const contracts = this.getContracts(network);
    const chainId = this.networkToChainId(network);

    const [safeAddress, delegateAddress, delegationStatus] = await Promise.all([
      this.getSafeAddressByNetwork(userId, network),
      Promise.resolve(this.getDelegateAddress()),
      ostiumDelegationService.getStatus(userId, network).catch(() => null),
    ]);

    const checks: ReadinessResponse['checks'] = {
      safeWallet: {
        ok: Boolean(safeAddress),
        message: safeAddress ? 'Safe wallet found for selected network' : 'Safe wallet not found for selected network',
        address: safeAddress,
      },
      delegation: {
        ok: delegationStatus?.status === 'ACTIVE',
        message:
          delegationStatus?.status === 'ACTIVE'
            ? 'Delegation is active'
            : 'Delegation is not active. Approve delegation before write actions.',
        status: delegationStatus?.status || null,
      },
      usdcBalance: {
        ok: false,
        message: safeAddress ? 'Unable to fetch Safe USDC balance' : 'Safe wallet required before balance check',
        balance: null,
      },
      allowance: {
        ok: false,
        message: safeAddress ? 'Unable to fetch Safe USDC allowance' : 'Safe wallet required before allowance check',
        amount: null,
        spender: contracts.tradingStorage,
      },
      delegateGas: {
        ok: false,
        message: delegateAddress ? 'Unable to fetch delegate gas balance' : 'Delegate address is not configured',
        balance: null,
        address: delegateAddress,
      },
    };

    if (safeAddress) {
      try {
        const balanceData = await ostiumServiceClient.getBalance({ network, address: safeAddress });
        const usdcBalanceRaw = this.parseDecimalBalanceToBigInt(balanceData?.balances?.usdc, 6);
        checks.usdcBalance = {
          ok: usdcBalanceRaw >= MIN_SAFE_USDC_BALANCE,
          message:
            usdcBalanceRaw >= MIN_SAFE_USDC_BALANCE
              ? 'Safe has enough USDC for trading'
              : 'Safe USDC balance is low. Fund your Safe before opening positions.',
          balance: balanceData?.balances?.usdc ?? null,
        };
      } catch (error) {
        checks.usdcBalance = {
          ok: false,
          message: `Failed to read Safe USDC balance: ${error instanceof Error ? error.message : String(error)}`,
          balance: null,
        };
      }

      try {
        const allowance = await this.safeTxService.checkTokenAllowance(
          contracts.usdc,
          safeAddress,
          contracts.tradingStorage,
          chainId,
        );
        checks.allowance = {
          ok: allowance >= MIN_ALLOWANCE,
          message:
            allowance >= MIN_ALLOWANCE
              ? 'Safe USDC allowance is configured'
              : 'Safe USDC allowance is missing. Approve allowance for Ostium trading storage.',
          amount: allowance.toString(),
          spender: contracts.tradingStorage,
        };
      } catch (error) {
        checks.allowance = {
          ok: false,
          message: `Failed to read Safe allowance: ${error instanceof Error ? error.message : String(error)}`,
          amount: null,
          spender: contracts.tradingStorage,
        };
      }
    }

    if (delegateAddress) {
      try {
        const delegateBalanceData = await ostiumServiceClient.getBalance({
          network,
          address: delegateAddress,
        });
        const nativeBalanceRaw = this.parseDecimalBalanceToBigInt(delegateBalanceData?.balances?.native, 18);
        checks.delegateGas = {
          ok: nativeBalanceRaw >= MIN_DELEGATE_GAS,
          message:
            nativeBalanceRaw >= MIN_DELEGATE_GAS
              ? 'Delegate wallet has enough gas'
              : 'Delegate wallet gas is low. Fund delegate wallet with ETH.',
          balance: delegateBalanceData?.balances?.native ?? null,
          address: delegateAddress,
        };
      } catch (error) {
        checks.delegateGas = {
          ok: false,
          message: `Failed to read delegate gas balance: ${error instanceof Error ? error.message : String(error)}`,
          balance: null,
          address: delegateAddress,
        };
      }
    }

    const readyForPositionManagement = checks.safeWallet.ok && checks.delegation.ok && checks.delegateGas.ok;
    const readyForOpenPosition = readyForPositionManagement && checks.usdcBalance.ok && checks.allowance.ok;

    return {
      network,
      chainId,
      safeAddress,
      delegateAddress,
      contracts,
      checks,
      readyForOpenPosition,
      readyForPositionManagement,
      refreshedAt: new Date().toISOString(),
    };
  }

  async prepareAllowance(userId: string, network: OstiumNetwork): Promise<AllowancePrepareResponse> {
    const safeAddress = await this.getSafeAddressByNetwork(userId, network);
    if (!safeAddress) {
      throw new Error(`Safe wallet not found for ${network}. Create Safe first.`);
    }

    const contracts = this.getContracts(network);
    const chainId = this.networkToChainId(network);
    const { safeTxData, amount } = this.buildApproveSafeTxData(contracts);
    const safeTxHash = await this.safeTxService.buildSafeTransactionHash(
      safeAddress,
      chainId,
      safeTxData.to,
      BigInt(safeTxData.value),
      safeTxData.data,
      safeTxData.operation,
    );

    return {
      network,
      safeAddress,
      safeTxHash,
      safeTxData,
      tokenAddress: contracts.usdc,
      spenderAddress: contracts.tradingStorage,
      amount: amount.toString(),
    };
  }

  async executeAllowance(
    userId: string,
    network: OstiumNetwork,
    signature: string,
    safeTxHash: string,
    safeTxData: SafeTxData,
  ): Promise<AllowanceExecuteResponse> {
    const safeAddress = await this.getSafeAddressByNetwork(userId, network);
    if (!safeAddress) {
      throw new Error(`Safe wallet not found for ${network}. Create Safe first.`);
    }

    const contracts = this.getContracts(network);
    const chainId = this.networkToChainId(network);
    const { spender, amount } = this.validateApproveSafeTxData(safeTxData, contracts);

    const result = await this.safeTxService.executeWithSignatures(
      safeAddress,
      chainId,
      safeTxData.to,
      BigInt(safeTxData.value),
      safeTxData.data,
      safeTxData.operation,
      signature,
      safeTxHash,
      0n,
      0n,
      0n,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
    );

    return {
      network,
      safeAddress,
      tokenAddress: contracts.usdc,
      spenderAddress: spender,
      amount: amount.toString(),
      txHash: result.txHash,
    };
  }
}

export const ostiumSetupService = new OstiumSetupService();
