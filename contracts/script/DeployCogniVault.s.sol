// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {USDC} from "../src/USDC.sol";
import {W0G} from "../src/W0G.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {AMMPool} from "../src/AMMPool.sol";
import {AIGovernedVault} from "../src/AIGovernedVault.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployCogniVault is Script {
    // Real 0G DA Entrance on Galileo Testnet
    address constant DA_ENTRANCE = 0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address teeSigner = vm.envOr("TEE_SIGNER", address(0x78D1d675952c2d202D2d899ba3C1498C44cd3971));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy base tokens
        USDC usdc = new USDC();
        W0G w0g = new W0G();

        // 2. Deploy yield pools
        LendingPool lendingPool = new LendingPool(address(usdc), 550);
        AMMPool ammPool = new AMMPool(address(usdc), 1200);

        // 3. Deploy AIGovernedVault as UUPS upgradeable proxy
        AIGovernedVault impl = new AIGovernedVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(impl.initialize, (IERC20(address(usdc)), teeSigner))
        );
        AIGovernedVault vault = AIGovernedVault(address(proxy));

        // 4. Whitelist pools
        vault.setPoolWhitelist(address(lendingPool), true);
        vault.setPoolWhitelist(address(ammPool), true);

        // 5. Configure DA verification with real 0G DA Entrance
        vault.setDAEntrance(DA_ENTRANCE);
        vault.setDAVerification(true);

        // 6. Deploy and configure Price Oracle
        PriceOracle priceOracle = new PriceOracle();
        priceOracle.setPrice(address(usdc), 1e8);
        vault.setPriceOracle(address(priceOracle));

        // 7. Set pools as minters so they can mint yield
        usdc.setMinter(address(lendingPool), true);
        usdc.setMinter(address(ammPool), true);

        vm.stopBroadcast();

        console.log("Deployed USDC at:", address(usdc));
        console.log("Deployed W0G at:", address(w0g));
        console.log("Deployed LendingPool at:", address(lendingPool));
        console.log("Deployed AMMPool at:", address(ammPool));
        console.log("Deployed AIGovernedVault proxy at:", address(proxy));
        console.log("Deployed AIGovernedVault impl at:", address(impl));
        console.log("Deployed PriceOracle at:", address(priceOracle));
        console.log("Using 0G DA Entrance at:", DA_ENTRANCE);
    }
}
