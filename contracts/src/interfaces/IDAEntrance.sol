// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDAEntrance {
    function isDataRootConfirmed(bytes32 dataRoot) external view returns (bool);
}
