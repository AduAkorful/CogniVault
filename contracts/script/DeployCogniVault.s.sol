// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockW0G} from "../src/MockW0G.sol";
import {MockLendingPool} from "../src/MockLendingPool.sol";
import {MockAMMPool} from "../src/MockAMMPool.sol";
import {AIGovernedVault} from "../src/AIGovernedVault.sol";
import {MockDAEntrance} from "../test/mocks/MockDAEntrance.sol";
import {MockPriceOracle} from "../src/MockPriceOracle.sol";

contract DeployCogniVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address teeSigner = vm.envOr("TEE_SIGNER", address(0x822B9030e8051cC296c5B76ad8B1Bcb9dbF8eB62));
        address daEntranceAddr = vm.envOr("DA_ENTRANCE", address(0));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy base tokens
        MockUSDC mockUSDC = new MockUSDC();
        MockW0G mockW0G = new MockW0G();

        // 2. Deploy mock yield pools
        MockLendingPool lendingPool = new MockLendingPool(address(mockUSDC), 550);
        MockAMMPool ammPool = new MockAMMPool(address(mockUSDC), 1200);

        // 3. Deploy AIGovernedVault
        AIGovernedVault vault = new AIGovernedVault(mockUSDC, teeSigner);

        // 4. Whitelist mock pools in the vault
        vault.setPoolWhitelist(address(lendingPool), true);
        vault.setPoolWhitelist(address(ammPool), true);

        // 5. Setup DA Entrance
        if (daEntranceAddr == address(0)) {
            MockDAEntrance mockDA = new MockDAEntrance();
            daEntranceAddr = address(mockDA);
        }
        vault.setDAEntrance(daEntranceAddr);
        vault.setDAVerification(true);

        // 6. Deploy and Setup Price Oracle
        MockPriceOracle priceOracle = new MockPriceOracle();
        priceOracle.setPrice(address(mockUSDC), 1e8); // $1.00
        vault.setPriceOracle(address(priceOracle));

        vm.stopBroadcast();

        console.log("Deployed MockUSDC at:", address(mockUSDC));
        console.log("Deployed MockW0G at:", address(mockW0G));
        console.log("Deployed MockLendingPool at:", address(lendingPool));
        console.log("Deployed MockAMMPool at:", address(ammPool));
        console.log("Deployed AIGovernedVault at:", address(vault));
        console.log("Deployed MockDAEntrance at:", daEntranceAddr);
        console.log("Deployed MockPriceOracle at:", address(priceOracle));
    }
}
