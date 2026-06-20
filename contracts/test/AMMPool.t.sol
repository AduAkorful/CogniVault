// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AMMPool} from "../src/AMMPool.sol";
import {USDC} from "../src/USDC.sol";

contract AMMPoolTest is Test {
    AMMPool public pool;
    USDC public usdc;
    address public owner = address(1);
    address public user = address(2);

    function setUp() public {
        vm.startPrank(owner);
        usdc = new USDC();
        pool = new AMMPool(address(usdc), 1200); // 12% APY
        usdc.setMinter(address(pool), true);
        usdc.mint(user, 10_000 * 10**6);
        vm.stopPrank();

        vm.prank(user);
        usdc.approve(address(pool), type(uint256).max);
    }

    function testAMMPool_InitialState() public view {
        assertEq(address(pool.asset()), address(usdc));
        assertEq(pool.getAPY(), 1200);
        assertEq(pool.balanceOf(user), 0);
    }

    function testAMMPool_SetAPY() public {
        vm.prank(owner);
        pool.setAPY(1500);
        assertEq(pool.getAPY(), 1500);
    }

    function testAMMPool_SetAPY_RevertIfNotOwner() public {
        vm.prank(user);
        vm.expectRevert(); // Ownable Unauthorized
        pool.setAPY(1500);
    }

    function testAMMPool_Deposit_RevertIfZero() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        pool.deposit(0);
    }

    function testAMMPool_Deposit_Basic() public {
        uint256 amount = 1000 * 10**6;
        vm.prank(user);
        pool.deposit(amount);
        assertEq(pool.balanceOf(user), amount);
        assertEq(pool.getPendingYield(user), 0);
    }

    function testAMMPool_Deposit_AccruesInterest() public {
        uint256 amount = 1000 * 10**6;
        vm.prank(user);
        pool.deposit(amount);

        vm.roll(block.number + 100);

        uint256 pending = pool.getPendingYield(user);
        assertTrue(pending > 0);

        // Deposit again should accrue yield and add it to principal
        uint256 secondDeposit = 500 * 10**6;
        vm.prank(user);
        pool.deposit(secondDeposit);

        // Check new principal balance: original + pending + second deposit
        (uint256 principal, ) = pool.deposits(user);
        assertEq(principal, amount + pending + secondDeposit);
        assertEq(pool.getPendingYield(user), 0);
    }

    function testAMMPool_Withdraw_RevertIfZero() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        pool.withdraw(0);
    }

    function testAMMPool_Withdraw_RevertIfInsufficient() public {
        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        pool.withdraw(100);
    }

    function testAMMPool_Withdraw_Basic() public {
        uint256 amount = 1000 * 10**6;
        vm.prank(user);
        pool.deposit(amount);

        vm.roll(block.number + 100);
        uint256 balanceBefore = usdc.balanceOf(user);
        uint256 pending = pool.getPendingYield(user);

        // withdraw partial
        vm.prank(user);
        pool.withdraw(500 * 10**6);

        assertEq(usdc.balanceOf(user), balanceBefore + 500 * 10**6);
        assertEq(pool.balanceOf(user), amount + pending - 500 * 10**6);
    }

    function testAMMPool_WithdrawAll_RevertIfZero() public {
        vm.prank(user);
        vm.expectRevert("Nothing to withdraw");
        pool.withdrawAll();
    }

    function testAMMPool_WithdrawAll_Basic() public {
        uint256 amount = 1000 * 10**6;
        vm.prank(user);
        pool.deposit(amount);

        vm.roll(block.number + 100);
        uint256 pending = pool.getPendingYield(user);
        uint256 total = amount + pending;

        uint256 balanceBefore = usdc.balanceOf(user);
        
        vm.prank(user);
        pool.withdrawAll();

        assertEq(pool.balanceOf(user), 0);
        assertEq(usdc.balanceOf(user), balanceBefore + total);
    }
}
