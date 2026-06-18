// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC public usdc;
    address public owner = address(1);
    address public minter = address(2);
    address public user = address(3);

    function setUp() public {
        vm.prank(owner);
        usdc = new MockUSDC();
    }

    function testMockUSDC_Metadata() public view {
        assertEq(usdc.name(), "Mock USDC");
        assertEq(usdc.symbol(), "mUSDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.balanceOf(owner), 1_000_000 * 10**6);
    }

    function testMockUSDC_SetMinter() public {
        vm.prank(owner);
        usdc.setMinter(minter, true);
        assertTrue(usdc.isMinter(minter));

        vm.prank(owner);
        usdc.setMinter(minter, false);
        assertFalse(usdc.isMinter(minter));
    }

    function testMockUSDC_SetMinter_RevertIfNotOwner() public {
        vm.prank(user);
        vm.expectRevert(); // Ownable Unauthorized
        usdc.setMinter(user, true);
    }

    function testMockUSDC_MintByOwner() public {
        vm.prank(owner);
        usdc.mint(user, 500 * 10**6);
        assertEq(usdc.balanceOf(user), 500 * 10**6);
    }

    function testMockUSDC_MintByMinter() public {
        vm.prank(owner);
        usdc.setMinter(minter, true);

        vm.prank(minter);
        usdc.mint(user, 1000 * 10**6);
        assertEq(usdc.balanceOf(user), 1000 * 10**6);
    }

    function testMockUSDC_Mint_RevertIfNotOwnerOrMinter() public {
        vm.prank(user);
        vm.expectRevert("MockUSDC: caller is not minter or owner");
        usdc.mint(user, 100);
    }
}
