// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {AIGovernedVault} from "../src/AIGovernedVault.sol";
import {Upgrades} from "@openzeppelin/foundry-upgrades/Upgrades.sol";
import {stdJson} from "forge-std/StdJson.sol";
contract UpgradeVault is Script {
    using stdJson for string;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        // Read proxy address from deployments.json
        string memory root = vm.projectRoot();
        string memory deployments = vm.readFile(string.concat(root, "/../deployments.json"));
        address proxyAddr = deployments.readAddress(".contracts.vault.proxy");

        require(proxyAddr != address(0), "Vault proxy address not found in deployments.json");

        vm.startBroadcast(deployerPrivateKey);

        // Upgrade the proxy to the new implementation
        Upgrades.upgradeProxy(proxyAddr, "AIGovernedVault.sol:AIGovernedVault", "");

        vm.stopBroadcast();

        address newImpl = Upgrades.getImplementationAddress(proxyAddr);
        console.log("Vault upgraded. New implementation:", newImpl);

        // Update deployments.json with new implementation address
        string memory json = string(abi.encodePacked(
            '{"network":"0G-Galileo-Testnet","chainId":16602,"rpcUrl":"https://evmrpc-testnet.0g.ai","blockExplorer":"https://chainscan-galileo.0g.ai",',
            '"contracts":{',
            '"vault":{"proxy":"', vm.toString(proxyAddr), '","implementation":"', vm.toString(newImpl), '"}',
            '}}'
        ));
        vm.writeJson(json, "deployments.json");
        console.log("Updated deployments.json with new implementation address");
    }
}
