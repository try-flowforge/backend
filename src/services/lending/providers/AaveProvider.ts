import { Contract, parseUnits, formatUnits } from 'ethers';
import {
  LendingProvider,
  SupportedChain,
  LendingInputConfig,
  LendingQuote,
  LendingTransaction,
  LendingPosition,
  AssetReserveData,
  LendingAccountData,
  LendingValidationResult,
  LendingOperation,
  InterestRateMode,
} from '../../../types/lending.types';
import { ILendingProvider } from '../interfaces/ILendingProvider';
import { getProvider } from '../../../config/providers';
import { getChainConfig } from '../../../config/chains';
import { logger } from '../../../utils/logger';

// Aave V3 Pool ABI (simplified - key functions only)
const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function setUserUseReserveAsCollateral(address asset, bool useAsCollateral)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
];

// Aave V3 Pool Data Provider ABI
const AAVE_DATA_PROVIDER_ABI = [
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveData(address asset) view returns (uint256 availableLiquidity, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])',
];

// ERC20 ABI for approvals (kept for future use when implementing token approvals)
// const ERC20_ABI = [
//   'function approve(address spender, uint256 amount) returns (bool)',
//   'function allowance(address owner, address spender) view returns (uint256)',
// ];

/**
 * Aave V3 Provider Implementation
 * Supports Arbitrum mainnet and Arbitrum Sepolia
 */
export class AaveProvider implements ILendingProvider {
  private readonly AAVE_CONFIGS: Record<string, any> = {
    [SupportedChain.ARBITRUM]: {
      poolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Aave V3 Pool on Arbitrum
      poolDataProviderAddress: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654', // Aave V3 Pool Data Provider
      wethGatewayAddress: '0xB5Ee21786D28c5Ba61661550879475976B707099', // WETH Gateway
      version: 'v3' as const,
    },
    [SupportedChain.ARBITRUM_SEPOLIA]: {
      poolAddress: '0x0', // Aave V3 not deployed on Arbitrum Sepolia
      poolDataProviderAddress: '0x0',
      wethGatewayAddress: '0x0',
      version: 'v3' as const,
    },
    [SupportedChain.ETHEREUM_SEPOLIA]: {
      poolAddress: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', // Aave V3 Pool on Ethereum Sepolia
      poolDataProviderAddress: '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31', // Aave V3 Pool Data Provider
      wethGatewayAddress: '0x387d311e47e80b498169e6fb51d3193167d89f7d', // WETH Gateway
      version: 'v3' as const,
    },
  };

  getName(): LendingProvider {
    return LendingProvider.AAVE;
  }

  supportsChain(chain: SupportedChain): boolean {
    return chain === SupportedChain.ARBITRUM || chain === SupportedChain.ETHEREUM_SEPOLIA;
  }

  async getQuote(
    chain: SupportedChain,
    config: LendingInputConfig
  ): Promise<LendingQuote> {
    logger.info({ chain, operation: config.operation }, 'Getting Aave quote');

    const provider = getProvider(chain);

    // Get reserve data
    const reserveData = await this.getAssetReserveData(chain, config.asset.address);

    // Get user account data
    const accountData = await this.getAccountData(chain, config.walletAddress);

    // Get current position
    const currentPosition = await this.getPosition(chain, config.walletAddress, config.asset.address) as LendingPosition;

    // Estimate gas
    let gasEstimate = '300000'; // Default estimate
    try {
      const tx = await this.buildTransaction(chain, config);
      const estimated = await provider.estimateGas({
        to: tx.to,
        from: tx.from,
        data: tx.data,
        value: tx.value,
      });
      gasEstimate = estimated.toString();
    } catch (error) {
      logger.warn({ error }, 'Failed to estimate gas, using default');
    }

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || parseUnits('0.1', 'gwei');
    const estimatedGasCost = (BigInt(gasEstimate) * gasPrice).toString();

    // Calculate health factor impact for borrow/withdraw operations
    let newHealthFactor: string | undefined;
    if (config.operation === LendingOperation.BORROW || config.operation === LendingOperation.WITHDRAW) {
      newHealthFactor = await this.calculateNewHealthFactor(
        chain,
        config.walletAddress,
        config.operation,
        config.asset.address,
        config.amount
      );
    }

    return {
      provider: LendingProvider.AAVE,
      chain,
      operation: config.operation,
      asset: config.asset,
      amount: config.amount,
      supplyAPY: reserveData.supplyAPY,
      borrowAPY: reserveData.variableBorrowAPY,
      availableLiquidity: reserveData.availableLiquidity,
      currentPosition,
      gasEstimate,
      estimatedGasCost,
      currentHealthFactor: accountData.healthFactor,
      newHealthFactor,
      validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      rawQuote: {
        reserveData,
        accountData,
      },
    };
  }

  async buildTransaction(
    chain: SupportedChain,
    config: LendingInputConfig,
    _quote?: LendingQuote // Quote available for future use
  ): Promise<LendingTransaction> {
    logger.info({ chain, operation: config.operation }, 'Building Aave transaction');

    const provider = getProvider(chain);
    const aaveConfig = this.AAVE_CONFIGS[chain as keyof typeof this.AAVE_CONFIGS];
    const chainConfig = getChainConfig(chain);

    const poolContract = new Contract(aaveConfig.poolAddress, AAVE_POOL_ABI, provider);

    let data: string;
    let to: string = aaveConfig.poolAddress;
    let value = '0';

    const interestRateModeValue = config.interestRateMode === InterestRateMode.STABLE ? 1 : 2;
    const onBehalfOf = config.onBehalfOf || config.walletAddress;
    const referralCode = config.referralCode || 0;

    switch (config.operation) {
      case LendingOperation.SUPPLY:
        // For native ETH, use WETH Gateway
        if (config.asset.address.toLowerCase() === chainConfig.contracts?.weth?.toLowerCase()) {
          // Supply ETH through WETH Gateway
          value = config.amount;
          // Note: Implement WETH Gateway logic if needed
        }
        data = poolContract.interface.encodeFunctionData('supply', [
          config.asset.address,
          config.amount,
          onBehalfOf,
          referralCode,
        ]);
        break;

      case LendingOperation.WITHDRAW:
        data = poolContract.interface.encodeFunctionData('withdraw', [
          config.asset.address,
          config.amount,
          config.walletAddress,
        ]);
        break;

      case LendingOperation.BORROW:
        data = poolContract.interface.encodeFunctionData('borrow', [
          config.asset.address,
          config.amount,
          interestRateModeValue,
          referralCode,
          onBehalfOf,
        ]);
        break;

      case LendingOperation.REPAY:
        data = poolContract.interface.encodeFunctionData('repay', [
          config.asset.address,
          config.amount,
          interestRateModeValue,
          onBehalfOf,
        ]);
        break;

      case LendingOperation.ENABLE_COLLATERAL:
        data = poolContract.interface.encodeFunctionData('setUserUseReserveAsCollateral', [
          config.asset.address,
          true,
        ]);
        break;

      case LendingOperation.DISABLE_COLLATERAL:
        data = poolContract.interface.encodeFunctionData('setUserUseReserveAsCollateral', [
          config.asset.address,
          false,
        ]);
        break;

      default:
        throw new Error(`Unsupported operation: ${config.operation}`);
    }

    // Get gas estimates
    const feeData = await provider.getFeeData();
    const gasLimit = config.gasLimit || '500000';

    return {
      to,
      from: config.walletAddress,
      data,
      value,
      gasLimit,
      maxFeePerGas: config.maxFeePerGas || feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: config.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas?.toString(),
      chainId: chainConfig.chainId,
    };
  }

  async simulateTransaction(
    chain: SupportedChain,
    transaction: LendingTransaction
  ): Promise<{ success: boolean; gasEstimate?: string; error?: string }> {
    try {
      const provider = getProvider(chain);

      const gasEstimate = await provider.estimateGas({
        to: transaction.to,
        from: transaction.from,
        data: transaction.data,
        value: transaction.value,
      });

      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error: any) {
      logger.error({ error, chain }, 'Aave transaction simulation failed');
      return {
        success: false,
        error: error.message || 'Simulation failed',
      };
    }
  }

  async validateConfig(
    chain: SupportedChain,
    config: LendingInputConfig
  ): Promise<LendingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Chain support
    if (!this.supportsChain(chain)) {
      errors.push(`Aave does not support chain: ${chain}`);
    }

    // Asset address validation
    if (!config.asset.address || config.asset.address.length !== 42) {
      errors.push('Invalid asset address');
    }

    // Amount validation
    if (!config.amount || BigInt(config.amount) <= 0) {
      errors.push('Amount must be greater than 0');
    }

    // Wallet address validation
    if (!config.walletAddress || config.walletAddress.length !== 42) {
      errors.push('Invalid wallet address');
    }

    // Operation-specific validation
    if (config.operation === LendingOperation.BORROW) {
      try {
        const accountData = await this.getAccountData(chain, config.walletAddress);
        const healthFactor = parseFloat(accountData.healthFactor);

        if (healthFactor < 1.5) {
          warnings.push('Health factor is low. Borrowing may increase liquidation risk.');
        }

        // Check if user has enough collateral
        if (BigInt(accountData.availableBorrowsBase) === BigInt(0)) {
          errors.push('Insufficient collateral to borrow');
        }
      } catch (error) {
        logger.warn({ error }, 'Could not validate borrow requirements');
      }
    }

    if (config.operation === LendingOperation.WITHDRAW) {
      try {
        const position = await this.getPosition(chain, config.walletAddress, config.asset.address) as LendingPosition;

        if (BigInt(position.availableToWithdraw) < BigInt(config.amount)) {
          errors.push('Insufficient balance to withdraw');
        }
      } catch (error) {
        logger.warn({ error }, 'Could not validate withdraw requirements');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async getPosition(
    chain: SupportedChain,
    walletAddress: string,
    asset?: string
  ): Promise<LendingPosition | LendingPosition[]> {
    const provider = getProvider(chain);
    const aaveConfig = this.AAVE_CONFIGS[chain as keyof typeof this.AAVE_CONFIGS];

    const dataProviderContract = new Contract(
      aaveConfig.poolDataProviderAddress,
      AAVE_DATA_PROVIDER_ABI,
      provider
    );

    if (asset) {
      // Get position for specific asset
      const userData = await dataProviderContract.getUserReserveData(asset, walletAddress);
      const reserveConfig = await dataProviderContract.getReserveConfigurationData(asset);
      const reserveData = await dataProviderContract.getReserveData(asset);

      // Convert rates from ray (1e27) to APY percentage
      const supplyAPY = this.rayToAPY(reserveData.liquidityRate.toString());
      const borrowAPY = this.rayToAPY(reserveData.variableBorrowRate.toString());

      return {
        asset: {
          address: asset,
          decimals: Number(reserveConfig.decimals),
        },
        supplied: userData.currentATokenBalance.toString(),
        borrowed: userData.currentVariableDebt.toString(),
        availableToBorrow: '0', // Calculate based on collateral
        availableToWithdraw: userData.currentATokenBalance.toString(),
        supplyAPY,
        borrowAPY,
        isCollateral: userData.usageAsCollateralEnabled,
        ltv: (Number(reserveConfig.ltv) / 100).toString(),
        liquidationThreshold: (Number(reserveConfig.liquidationThreshold) / 100).toString(),
      };
    } else {
      // Get all positions
      const allReserves = await dataProviderContract.getAllReservesTokens();
      const positions: LendingPosition[] = [];

      for (const reserve of allReserves) {
        const position = await this.getPosition(chain, walletAddress, reserve.tokenAddress) as LendingPosition;
        if (BigInt(position.supplied) > 0 || BigInt(position.borrowed) > 0) {
          positions.push(position);
        }
      }

      return positions;
    }
  }

  async getAccountData(
    chain: SupportedChain,
    walletAddress: string
  ): Promise<LendingAccountData> {
    const provider = getProvider(chain);
    const aaveConfig = this.AAVE_CONFIGS[chain as keyof typeof this.AAVE_CONFIGS];

    const poolContract = new Contract(aaveConfig.poolAddress, AAVE_POOL_ABI, provider);

    const accountData = await poolContract.getUserAccountData(walletAddress);

    return {
      totalCollateralBase: accountData.totalCollateralBase.toString(),
      totalDebtBase: accountData.totalDebtBase.toString(),
      availableBorrowsBase: accountData.availableBorrowsBase.toString(),
      currentLiquidationThreshold: (Number(accountData.currentLiquidationThreshold) / 100).toString(),
      ltv: (Number(accountData.ltv) / 100).toString(),
      healthFactor: formatUnits(accountData.healthFactor, 18),
    };
  }

  async getAssetReserveData(
    chain: SupportedChain,
    asset: string
  ): Promise<AssetReserveData> {
    const provider = getProvider(chain);
    const aaveConfig = this.AAVE_CONFIGS[chain as keyof typeof this.AAVE_CONFIGS];

    const dataProviderContract = new Contract(
      aaveConfig.poolDataProviderAddress,
      AAVE_DATA_PROVIDER_ABI,
      provider
    );

    const reserveConfig = await dataProviderContract.getReserveConfigurationData(asset);
    const reserveData = await dataProviderContract.getReserveData(asset);

    const supplyAPY = this.rayToAPY(reserveData.liquidityRate.toString());
    const variableBorrowAPY = this.rayToAPY(reserveData.variableBorrowRate.toString());
    const stableBorrowAPY = this.rayToAPY(reserveData.stableBorrowRate.toString());

    const totalSupplied = BigInt(reserveData.availableLiquidity) +
      BigInt(reserveData.totalStableDebt) +
      BigInt(reserveData.totalVariableDebt);

    const totalBorrowed = BigInt(reserveData.totalStableDebt) + BigInt(reserveData.totalVariableDebt);

    const utilizationRate = totalSupplied > 0
      ? ((Number(totalBorrowed) / Number(totalSupplied)) * 100).toFixed(2)
      : '0';

    return {
      asset,
      symbol: '', // Would need token contract to get symbol
      decimals: Number(reserveConfig.decimals),
      supplyAPY,
      variableBorrowAPY,
      stableBorrowAPY,
      availableLiquidity: reserveData.availableLiquidity.toString(),
      totalSupplied: totalSupplied.toString(),
      totalBorrowed: totalBorrowed.toString(),
      utilizationRate,
      ltv: (Number(reserveConfig.ltv) / 100).toString(),
      liquidationThreshold: (Number(reserveConfig.liquidationThreshold) / 100).toString(),
      liquidationBonus: (Number(reserveConfig.liquidationBonus) / 100).toString(),
      isActive: reserveConfig.isActive,
      isFrozen: reserveConfig.isFrozen,
      canBorrow: reserveConfig.borrowingEnabled,
      canSupply: !reserveConfig.isFrozen,
      canBeCollateral: reserveConfig.usageAsCollateralEnabled,
    };
  }

  async getAvailableAssets(chain: SupportedChain): Promise<AssetReserveData[]> {
    const provider = getProvider(chain);
    const aaveConfig = this.AAVE_CONFIGS[chain as keyof typeof this.AAVE_CONFIGS];

    const dataProviderContract = new Contract(
      aaveConfig.poolDataProviderAddress,
      AAVE_DATA_PROVIDER_ABI,
      provider
    );

    const allReserves = await dataProviderContract.getAllReservesTokens();
    const assets: AssetReserveData[] = [];

    for (const reserve of allReserves) {
      try {
        const assetData = await this.getAssetReserveData(chain, reserve.tokenAddress);
        assets.push({
          ...assetData,
          symbol: reserve.symbol,
        });
      } catch (error) {
        logger.warn({ error, asset: reserve.tokenAddress }, 'Failed to get asset reserve data');
      }
    }

    return assets;
  }

  // Helper methods

  /**
   * Convert Aave ray rate (1e27) to APY percentage
   */
  private rayToAPY(rayRate: string): string {
    const RAY = 1e27;
    const SECONDS_PER_YEAR = 31536000;

    const rate = Number(rayRate) / RAY;
    const apy = (Math.pow(1 + rate / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1) * 100;

    return apy.toFixed(2);
  }

  /**
   * Calculate new health factor after an operation
   */
  private async calculateNewHealthFactor(
    chain: SupportedChain,
    walletAddress: string,
    _operation: LendingOperation, // Operation type for future enhanced calculations
    _asset: string, // Asset address for future oracle price lookups
    _amount: string // Amount for future precise calculations
  ): Promise<string> {
    try {
      const accountData = await this.getAccountData(chain, walletAddress);
      // Simplified calculation - in production, would need oracle prices
      // and more complex math using operation, asset, and amount
      return accountData.healthFactor;
    } catch (error) {
      logger.warn({ error }, 'Could not calculate new health factor');
      return '0';
    }
  }
}

