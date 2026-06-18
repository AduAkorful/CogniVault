// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockW0G} from "../src/MockW0G.sol";

contract MockW0GTest is Test {
    MockW0G public w0g;
    address public owner = address(1);
    address public minter = address(2);
    address public user = address(3);

    function setUp() public {
        vm.prank(owner);
        w0g = new MockW0G();
    }

    function testMockW0G_Metadata() public view {
        assertEq(w0g.name(), "Mock Wrapped 0G");
        assertEq(w0g.symbol(), "mW0G");
        assertEq(w0g.decimals(), 18);
        assertEq(w0g.balanceOf(owner), 1_000_000 * 10**18);
    }

    function testMockW0G_SetMinter() public {
        vm.prank(owner);
        w0g.setMinter(minter, true);
        assertTrue(w0g.isMinter(minter));

        vm.prank(owner);
        w0g.setMinter(minter, false);
        assertFalse(w0g.isMinter(minter));
    }

    function testMockW0G_SetMinter_RevertIfNotOwner() public {
        vm.prank(user);
        vm.expectRevert(); // Ownable Unauthorized
        w0g.setMinter(user, true);
    }

    function testMockW0G_MintByOwner() public {
        vm.prank(owner);
        w0g.mint(user, 500 * 10**18);
        assertEq(w0g.balanceOf(user), 500 * 10**18);
    }

    function testMockW0G_MintByMinter() public {
        vm.prank(owner);
        w0g.setMinter(minter, true);

        vm.prank(minter);
        w0g.mint(user, 1000 * 10**18);
        assertEq(w0g.balanceOf(user), 1000 * 10**18);
    }

    function testMockW0G_Mint_RevertIfNotOwnerOrMinter() public {
        vm.prank(user);
        vm.expectRevert("MockW0G: caller is not minter or owner");
        w0g.mint(user, 100);
    }
}
