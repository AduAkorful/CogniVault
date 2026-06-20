// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDAEntrance} from "../../src/interfaces/IDAEntrance.sol";

contract TestDAEntrance is IDAEntrance {
    mapping(bytes32 => bool) public confirmedRoots;

    function setConfirmed(bytes32 dataRoot, bool status) external {
        confirmedRoots[dataRoot] = status;
    }

    function isDataRootConfirmed(bytes32 dataRoot) external view override returns (bool) {
        return confirmedRoots[dataRoot];
    }
}
