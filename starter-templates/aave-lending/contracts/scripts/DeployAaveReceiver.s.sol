// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {AaveReceiver} from "../src/AaveReceiver.sol";

contract DeployAaveReceiver is Script {
    function run() external {
        vm.startBroadcast();
        AaveReceiver receiver = new AaveReceiver();
        console.log("AaveReceiver deployed at:", address(receiver));
        vm.stopBroadcast();
    }
}
