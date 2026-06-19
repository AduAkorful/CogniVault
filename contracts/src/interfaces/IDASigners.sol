// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDASigners {
    function epochNumber() external view returns (uint256);
    function isSigner(address _account) external view returns (bool);
    function quorumCount(uint256 _epoch) external view returns (uint256);
    function getQuorum(uint256 _epoch, uint256 _quorumId) external view returns (address[] memory);
}
