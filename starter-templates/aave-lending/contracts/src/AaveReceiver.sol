// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IReceiver} from "./keystone/IReceiver.sol";
import {IERC165} from "./keystone/IERC165.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256);
}

uint8 constant OP_SUPPLY = 0;
uint8 constant OP_WITHDRAW = 1;
uint8 constant OP_BORROW = 2;
uint8 constant OP_REPAY = 3;

/// @title AaveReceiver - CRE receiver that executes Aave V3 Pool operations from report payload
/// @notice User must approve this contract for the relevant token
///         (underlying for supply/repay, aToken for withdraw) before the workflow runs.
/// @dev Report format:
///      (operation, poolAddress, asset, amount, walletAddress, onBehalfOf,
///       interestRateMode, referralCode, aTokenAddress)
contract AaveReceiver is IReceiver {
    function onReport(bytes calldata /* metadata */, bytes calldata report) external override {
        (
            uint8 operation,
            address poolAddress,
            address asset,
            uint256 amount,
            address walletAddress,
            address onBehalfOf,
            uint256 interestRateMode,
            uint16 referralCode,
            address aTokenAddress
        ) = abi.decode(
            report,
            (uint8, address, address, uint256, address, address, uint256, uint16, address)
        );

        address effectiveOnBehalfOf = onBehalfOf == address(0) ? walletAddress : onBehalfOf;
        IAavePool pool = IAavePool(poolAddress);

        if (operation == OP_SUPPLY) {
            require(
                IERC20(asset).transferFrom(walletAddress, address(this), amount),
                "AaveReceiver: supply transferFrom failed"
            );
            require(
                IERC20(asset).approve(poolAddress, amount),
                "AaveReceiver: supply approve failed"
            );
            pool.supply(asset, amount, effectiveOnBehalfOf, referralCode);
        } else if (operation == OP_WITHDRAW) {
            require(aTokenAddress != address(0), "AaveReceiver: aTokenAddress required for withdraw");
            require(
                IERC20(aTokenAddress).transferFrom(walletAddress, address(this), amount),
                "AaveReceiver: withdraw transferFrom failed"
            );
            pool.withdraw(asset, amount, walletAddress);
        } else if (operation == OP_BORROW) {
            pool.borrow(asset, amount, interestRateMode, referralCode, effectiveOnBehalfOf);
            require(
                IERC20(asset).transfer(walletAddress, amount),
                "AaveReceiver: borrow transfer failed"
            );
        } else if (operation == OP_REPAY) {
            require(
                IERC20(asset).transferFrom(walletAddress, address(this), amount),
                "AaveReceiver: repay transferFrom failed"
            );
            require(
                IERC20(asset).approve(poolAddress, amount),
                "AaveReceiver: repay approve failed"
            );
            pool.repay(asset, amount, interestRateMode, effectiveOnBehalfOf);
        } else {
            revert("AaveReceiver: unsupported operation");
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
