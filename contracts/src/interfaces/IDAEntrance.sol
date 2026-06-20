// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface matching the 0G DAEntrance commitmentExists query.
interface IDAEntrance {
    function commitmentExists(bytes32 dataRoot, uint256 epoch, uint256 quorumId) external view returns (bool);
}
