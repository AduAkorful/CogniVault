// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CogniDAVerifier} from "../src/CogniDAVerifier.sol";
import {AIGovernedVault} from "../src/AIGovernedVault.sol";
import {stdJson} from "forge-std/StdJson.sol";

/// @notice Deploy CogniDAVerifier and point the vault to it for on-chain DA checks.
contract DeployDAVerifier is Script {
    using stdJson for string;

    address constant UPSTREAM_DA_ENTRANCE = 0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        string memory root = vm.projectRoot();
        string memory deployments = vm.readFile(string.concat(root, "/../deployments.json"));
        address vaultProxy = deployments.readAddress(".contracts.vault.proxy");

        require(vaultProxy != address(0), "Vault proxy not found in deployments.json");

        vm.startBroadcast(deployerPrivateKey);

        CogniDAVerifier verifier = new CogniDAVerifier(UPSTREAM_DA_ENTRANCE);
        AIGovernedVault vault = AIGovernedVault(vaultProxy);
        vault.setDAEntrance(address(verifier));
        vault.setDAVerification(true);

        vm.stopBroadcast();

        string memory deploymentsPath = string.concat(root, "/../deployments.json");
        vm.writeJson(vm.toString(address(verifier)), deploymentsPath, ".contracts.daVerifier.address");

        console.log("Deployed CogniDAVerifier at:", address(verifier));
        console.log("Vault DA entrance updated to:", address(verifier));
        console.log("Upstream DAEntrance (delegates if deployed):", UPSTREAM_DA_ENTRANCE);
        console.log("Updated deployments.json with daVerifier address");
    }
}
