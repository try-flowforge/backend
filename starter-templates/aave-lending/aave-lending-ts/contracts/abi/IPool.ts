/**
 * Aave V3 Pool interface — minimal ABI for supply, withdraw, borrow, repay.
 * interestRateMode: 1 = Stable, 2 = Variable
 */
export const IPool = [
  {
    type: 'function',
    name: 'supply',
    inputs: [
      { name: 'asset', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'onBehalfOf', type: 'address', internalType: 'address' },
      { name: 'referralCode', type: 'uint16', internalType: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'asset', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'to', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'borrow',
    inputs: [
      { name: 'asset', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'interestRateMode', type: 'uint256', internalType: 'uint256' },
      { name: 'referralCode', type: 'uint16', internalType: 'uint16' },
      { name: 'onBehalfOf', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'repay',
    inputs: [
      { name: 'asset', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'interestRateMode', type: 'uint256', internalType: 'uint256' },
      { name: 'onBehalfOf', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getReserveData',
    inputs: [{ name: 'asset', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct DataTypes.ReserveData',
        components: [
          { name: 'configuration', type: 'uint256', internalType: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128', internalType: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128', internalType: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128', internalType: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128', internalType: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128', internalType: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40', internalType: 'uint40' },
          { name: 'id', type: 'uint16', internalType: 'uint16' },
          { name: 'aTokenAddress', type: 'address', internalType: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address', internalType: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address', internalType: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address', internalType: 'address' },
          { name: 'accruedToTreasuryScaled', type: 'uint128', internalType: 'uint128' },
          { name: 'unbacked', type: 'uint128', internalType: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128', internalType: 'uint128' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;
