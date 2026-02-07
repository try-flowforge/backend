import { Contract, parseUnits } from 'ethers';
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
} from '../../../types/lending.types';
import { ILendingProvider } from '../interfaces/ILendingProvider';
import { getProvider } from '../../../config/providers';
import { getChainConfig } from '../../../config/chains';
import { logger } from '../../../utils/logger';

// Compound V3 Comet ABI (simplified)
const COMPOUND_COMET_ABI = [
  'function supply(address asset, uint amount)',
  'function withdraw(address asset, uint amount)',
  'function borrow(uint amount)',
  'function repay(uint amount)',
  'function supplyTo(address dst, address asset, uint amount)',
  'function withdrawTo(address to, address asset, uint amount)',
  'function getSupplyRate(uint utilization) view returns (uint64)',
  'function getBorrowRate(uint utilization) view returns (uint64)',
  'function getUtilization() view returns (uint)',
  'function balanceOf(address account) view returns (uint256)',
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function collateralBalanceOf(address account, address asset) view returns (uint128)',
  'function userCollateral(address account, address asset) view returns (uint128 balance, uint128 _reserved)',
  'function getAssetInfo(uint8 i) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
  'function numAssets() view returns (uint8)',
  'function baseToken() view returns (address)',
  'function getPrice(address priceFeed) view returns (uint128)',
];

// Compound V3 Configurator ABI - kept for future use
// const COMPOUND_CONFIGURATOR_ABI = [
//   'function getConfiguration(address comet) view returns (tuple(address governor, address pauseGuardian, address baseToken, address baseTokenPriceFeed, address extensionDelegate, uint64 supplyKink, uint64 supplyPerYearInterestRateSlopeLow, uint64 supplyPerYearInterestRateSlopeHigh, uint64 supplyPerYearInterestRateBase, uint64 borrowKink, uint64 borrowPerYearInterestRateSlopeLow, uint64 borrowPerYearInterestRateSlopeHigh, uint64 borrowPerYearInterestRateBase, uint64 storeFrontPriceFactor, uint64 trackingIndexScale, uint64 baseTrackingSupplySpeed, uint64 baseTrackingBorrowSpeed, uint104 baseMinForRewards, uint104 baseBorrowMin, uint104 targetReserves, tuple(address asset, address priceFeed, uint8 decimals, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap)[] assetConfigs))',
// ];

// ERC20 ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

/**
 * Compound V3 Provider Implementation
 * Supports Arbitrum mainnet and Arbitrum Sepolia
 */
export class CompoundProvider implements ILendingProvider {
  private readonly COMPOUND_CONFIGS: Record<string, any> = {
    [SupportedChain.ARBITRUM]: {
      // Compound V3 USDC market on Arbitrum
      cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', // cUSDCv3
      configuratorAddress: '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3', // Configurator
      baseAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
      version: 'v3' as const,
    },
    [SupportedChain.ARBITRUM_SEPOLIA]: {
      // Compound V3 on Arbitrum Sepolia (if available)
      cometAddress: '0x0', // Update with actual address when available
      configuratorAddress: '0x0',
      baseAsset: '0x0', // USDC on Arbitrum Sepolia
      version: 'v3' as const,
    },
    [SupportedChain.ETHEREUM_SEPOLIA]: {
      // Compound V3 on Ethereum Sepolia (not available)
      cometAddress: '0x0',
      configuratorAddress: '0x0',
      baseAsset: '0x0',
      version: 'v3' as const,
    },
  };

  getName(): LendingProvider {
    return LendingProvider.COMPOUND;
  }

  supportsChain(chain: SupportedChain): boolean {
    // Only Arbitrum mainnet is fully supported for now
    return chain === SupportedChain.ARBITRUM;
  }

  async getQuote(
    chain: SupportedChain,
    config: LendingInputConfig
  ): Promise<LendingQuote> {
    logger.info({ chain, operation: config.operation }, 'Getting Compound quote');

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

    return {
      provider: LendingProvider.COMPOUND,
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
    logger.info({ chain, operation: config.operation }, 'Building Compound transaction');

    const provider = getProvider(chain);
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];
    const chainConfig = getChainConfig(chain);

    const cometContract = new Contract(compoundConfig.cometAddress, COMPOUND_COMET_ABI, provider);

    let data: string;
    const to: string = compoundConfig.cometAddress;
    const value = '0';

    const isBaseAsset = config.asset.address.toLowerCase() === compoundConfig.baseAsset.toLowerCase();

    switch (config.operation) {
      case LendingOperation.SUPPLY:
        if (isBaseAsset) {
          // Supply base asset (e.g., USDC)
          data = cometContract.interface.encodeFunctionData('supply', [
            config.asset.address,
            config.amount,
          ]);
        } else {
          // Supply collateral asset
          data = cometContract.interface.encodeFunctionData('supply', [
            config.asset.address,
            config.amount,
          ]);
        }
        break;

      case LendingOperation.WITHDRAW:
        if (isBaseAsset) {
          // Withdraw base asset
          data = cometContract.interface.encodeFunctionData('withdraw', [
            config.asset.address,
            config.amount,
          ]);
        } else {
          // Withdraw collateral
          data = cometContract.interface.encodeFunctionData('withdraw', [
            config.asset.address,
            config.amount,
          ]);
        }
        break;

      case LendingOperation.BORROW:
        // In Compound V3, borrowing is done by withdrawing base asset
        if (!isBaseAsset) {
          throw new Error('Can only borrow base asset in Compound V3');
        }
        data = cometContract.interface.encodeFunctionData('withdraw', [
          config.asset.address,
          config.amount,
        ]);
        break;

      case LendingOperation.REPAY:
        // Repay is done by supplying base asset
        if (!isBaseAsset) {
          throw new Error('Can only repay base asset in Compound V3');
        }
        data = cometContract.interface.encodeFunctionData('supply', [
          config.asset.address,
          config.amount,
        ]);
        break;

      case LendingOperation.ENABLE_COLLATERAL:
      case LendingOperation.DISABLE_COLLATERAL:
        // Compound V3 automatically uses supplied collateral
        // No explicit enable/disable needed
        throw new Error('Collateral management is automatic in Compound V3');

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
      logger.error({ error, chain }, 'Compound transaction simulation failed');
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
      errors.push(`Compound V3 does not support chain: ${chain}`);
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

    // Compound V3 specific validations
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];
    const isBaseAsset = config.asset.address.toLowerCase() === compoundConfig.baseAsset.toLowerCase();

    if (config.operation === LendingOperation.BORROW && !isBaseAsset) {
      errors.push('Can only borrow base asset (USDC) in Compound V3');
    }

    if (config.operation === LendingOperation.REPAY && !isBaseAsset) {
      errors.push('Can only repay base asset (USDC) in Compound V3');
    }

    if (config.operation === LendingOperation.ENABLE_COLLATERAL ||
      config.operation === LendingOperation.DISABLE_COLLATERAL) {
      errors.push('Collateral management is automatic in Compound V3');
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
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];

    const cometContract = new Contract(compoundConfig.cometAddress, COMPOUND_COMET_ABI, provider);

    if (asset) {
      const isBaseAsset = asset.toLowerCase() === compoundConfig.baseAsset.toLowerCase();

      if (isBaseAsset) {
        // Get base asset position (supply/borrow)
        const supplyBalance = await cometContract.balanceOf(walletAddress);
        const borrowBalance = await cometContract.borrowBalanceOf(walletAddress);

        const utilization = await cometContract.getUtilization();
        const supplyRate = await cometContract.getSupplyRate(utilization);
        const borrowRate = await cometContract.getBorrowRate(utilization);

        return {
          asset: {
            address: asset,
          },
          supplied: supplyBalance.toString(),
          borrowed: borrowBalance.toString(),
          availableToBorrow: '0', // Would need to calculate based on collateral
          availableToWithdraw: supplyBalance.toString(),
          supplyAPY: this.rateToAPY(supplyRate.toString()),
          borrowAPY: this.rateToAPY(borrowRate.toString()),
          isCollateral: false, // Base asset is not collateral in Compound V3
        };
      } else {
        // Get collateral position
        const collateralBalance = await cometContract.collateralBalanceOf(walletAddress, asset);

        return {
          asset: {
            address: asset,
          },
          supplied: collateralBalance.toString(),
          borrowed: '0',
          availableToBorrow: '0',
          availableToWithdraw: collateralBalance.toString(),
          supplyAPY: '0', // Collateral doesn't earn interest in Compound V3
          borrowAPY: '0',
          isCollateral: true,
        };
      }
    } else {
      // Get all positions
      const positions: LendingPosition[] = [];

      // Get base asset position
      const basePosition = await this.getPosition(chain, walletAddress, compoundConfig.baseAsset) as LendingPosition;
      positions.push(basePosition);

      // Get collateral positions
      const numAssets = await cometContract.numAssets();
      for (let i = 0; i < numAssets; i++) {
        try {
          const assetInfo = await cometContract.getAssetInfo(i);
          const collateralBalance = await cometContract.collateralBalanceOf(walletAddress, assetInfo.asset);

          if (collateralBalance > 0) {
            positions.push({
              asset: {
                address: assetInfo.asset,
              },
              supplied: collateralBalance.toString(),
              borrowed: '0',
              availableToBorrow: '0',
              availableToWithdraw: collateralBalance.toString(),
              supplyAPY: '0',
              borrowAPY: '0',
              isCollateral: true,
            });
          }
        } catch (error) {
          logger.warn({ error, index: i }, 'Failed to get collateral position');
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
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];

    const cometContract = new Contract(compoundConfig.cometAddress, COMPOUND_COMET_ABI, provider);

    // Get supply and borrow balances
    // const supplyBalance = await cometContract.balanceOf(walletAddress); // For future use
    const borrowBalance = await cometContract.borrowBalanceOf(walletAddress);

    // Calculate collateral value (simplified - would need oracle prices)
    const numAssets = await cometContract.numAssets();
    let totalCollateral = BigInt(0);

    for (let i = 0; i < numAssets; i++) {
      try {
        const assetInfo = await cometContract.getAssetInfo(i);
        const collateralBalance = await cometContract.collateralBalanceOf(walletAddress, assetInfo.asset);
        // Would need to convert to USD using price feeds
        totalCollateral += BigInt(collateralBalance);
      } catch (error) {
        logger.warn({ error, index: i }, 'Failed to calculate collateral');
      }
    }

    // Simplified health factor calculation
    const healthFactor = borrowBalance > 0
      ? (Number(totalCollateral) / Number(borrowBalance)).toFixed(2)
      : '999999';

    return {
      totalCollateralBase: totalCollateral.toString(),
      totalDebtBase: borrowBalance.toString(),
      availableBorrowsBase: '0', // Would need proper calculation
      currentLiquidationThreshold: '0',
      ltv: '0',
      healthFactor,
    };
  }

  async getAssetReserveData(
    chain: SupportedChain,
    asset: string
  ): Promise<AssetReserveData> {
    const provider = getProvider(chain);
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];

    const cometContract = new Contract(compoundConfig.cometAddress, COMPOUND_COMET_ABI, provider);

    const isBaseAsset = asset.toLowerCase() === compoundConfig.baseAsset.toLowerCase();

    if (isBaseAsset) {
      const utilization = await cometContract.getUtilization();
      const supplyRate = await cometContract.getSupplyRate(utilization);
      const borrowRate = await cometContract.getBorrowRate(utilization);

      // Get token info
      const tokenContract = new Contract(asset, ERC20_ABI, provider);
      const decimals = await tokenContract.decimals();
      const symbol = await tokenContract.symbol();

      return {
        asset,
        symbol,
        decimals,
        supplyAPY: this.rateToAPY(supplyRate.toString()),
        variableBorrowAPY: this.rateToAPY(borrowRate.toString()),
        availableLiquidity: '0', // Would need to query
        totalSupplied: '0',
        totalBorrowed: '0',
        utilizationRate: (Number(utilization) / 1e18 * 100).toFixed(2),
        ltv: '0',
        liquidationThreshold: '0',
        liquidationBonus: '0',
        isActive: true,
        isFrozen: false,
        canBorrow: true,
        canSupply: true,
        canBeCollateral: false,
      };
    } else {
      // Get collateral asset info
      const numAssets = await cometContract.numAssets();

      for (let i = 0; i < numAssets; i++) {
        const assetInfo = await cometContract.getAssetInfo(i);

        if (assetInfo.asset.toLowerCase() === asset.toLowerCase()) {
          const tokenContract = new Contract(asset, ERC20_ABI, provider);
          const symbol = await tokenContract.symbol();

          return {
            asset,
            symbol,
            decimals: Number(assetInfo.scale),
            supplyAPY: '0', // Collateral doesn't earn in Compound V3
            variableBorrowAPY: '0',
            availableLiquidity: '0',
            totalSupplied: '0',
            totalBorrowed: '0',
            utilizationRate: '0',
            ltv: (Number(assetInfo.borrowCollateralFactor) / 1e18 * 100).toFixed(2),
            liquidationThreshold: (Number(assetInfo.liquidateCollateralFactor) / 1e18 * 100).toFixed(2),
            liquidationBonus: '0',
            isActive: true,
            isFrozen: false,
            canBorrow: false,
            canSupply: true,
            canBeCollateral: true,
          };
        }
      }

      throw new Error(`Asset ${asset} not found in Compound V3`);
    }
  }

  async getAvailableAssets(chain: SupportedChain): Promise<AssetReserveData[]> {
    const provider = getProvider(chain);
    const compoundConfig = this.COMPOUND_CONFIGS[chain as keyof typeof this.COMPOUND_CONFIGS];

    const cometContract = new Contract(compoundConfig.cometAddress, COMPOUND_COMET_ABI, provider);
    const assets: AssetReserveData[] = [];

    // Add base asset
    try {
      const baseAssetData = await this.getAssetReserveData(chain, compoundConfig.baseAsset);
      assets.push(baseAssetData);
    } catch (error) {
      logger.warn({ error }, 'Failed to get base asset data');
    }

    // Add collateral assets
    const numAssets = await cometContract.numAssets();
    for (let i = 0; i < numAssets; i++) {
      try {
        const assetInfo = await cometContract.getAssetInfo(i);
        const assetData = await this.getAssetReserveData(chain, assetInfo.asset);
        assets.push(assetData);
      } catch (error) {
        logger.warn({ error, index: i }, 'Failed to get collateral asset data');
      }
    }

    return assets;
  }

  // Helper methods

  /**
   * Convert Compound rate to APY percentage
   */
  private rateToAPY(rate: string): string {
    const SECONDS_PER_YEAR = 31536000;
    const ratePerSecond = Number(rate) / 1e18;
    const apy = (Math.pow(1 + ratePerSecond, SECONDS_PER_YEAR) - 1) * 100;
    return apy.toFixed(2);
  }
}

