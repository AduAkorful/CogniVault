// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CogniDAVerifier} from "../src/CogniDAVerifier.sol";

contract CogniDAVerifierTest is Test {
    CogniDAVerifier public verifier;
    address public owner = address(1);

    bytes32 constant DATA_ROOT = keccak256("test-root");
    uint256 constant EPOCH = 55;
    uint256 constant QUORUM_ID = 0;

    function setUp() public {
        vm.prank(owner);
        verifier = new CogniDAVerifier(address(0));
    }

    function testCommitmentLifecycle() public {
        assertFalse(verifier.commitmentExists(DATA_ROOT, EPOCH, QUORUM_ID));

        vm.prank(owner);
        verifier.confirmCommitment(DATA_ROOT, EPOCH, QUORUM_ID);

        assertTrue(verifier.commitmentExists(DATA_ROOT, EPOCH, QUORUM_ID));
    }

    function testOnlyOwnerCanConfirm() public {
        vm.prank(address(2));
        vm.expectRevert();
        verifier.confirmCommitment(DATA_ROOT, EPOCH, QUORUM_ID);
    }
}
