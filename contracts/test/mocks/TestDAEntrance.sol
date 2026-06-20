// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDAEntrance} from "../../src/interfaces/IDAEntrance.sol";

contract TestDAEntrance is IDAEntrance {
    mapping(bytes32 => bool) public confirmedRoots;

    function setConfirmed(bytes32 dataRoot, uint256 epoch, uint256 quorumId, bool status) external {
        confirmedRoots[keccak256(abi.encode(dataRoot, epoch, quorumId))] = status;
    }

    function commitmentExists(bytes32 dataRoot, uint256 epoch, uint256 quorumId) external view override returns (bool) {
        return confirmedRoots[keccak256(abi.encode(dataRoot, epoch, quorumId))];
    }
}
