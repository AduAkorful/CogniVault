// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDAEntrance} from "./interfaces/IDAEntrance.sol";

/// @title CogniDAVerifier
/// @notice On-chain DA commitment registry for CogniVault.
/// @dev When the canonical 0G DAEntrance is unavailable on testnet, the relayer
///      registers commitments here after the disperser reports CONFIRMED status.
///      If an upstream DAEntrance is deployed and has code, queries delegate to it first.
contract CogniDAVerifier is IDAEntrance, Ownable {
    address public upstreamEntrance;

    mapping(bytes32 => bool) public localCommitments;

    event UpstreamEntranceUpdated(address indexed upstream);
    event CommitmentConfirmed(bytes32 indexed dataRoot, uint256 epoch, uint256 quorumId, bytes32 identifier);

    constructor(address _upstreamEntrance) Ownable(msg.sender) {
        upstreamEntrance = _upstreamEntrance;
    }

    function setUpstreamEntrance(address _upstream) external onlyOwner {
        upstreamEntrance = _upstream;
        emit UpstreamEntranceUpdated(_upstream);
    }

    function identifier(bytes32 dataRoot, uint256 epoch, uint256 quorumId) public pure returns (bytes32) {
        return keccak256(abi.encode(dataRoot, epoch, quorumId));
    }

    /// @notice Register a DA commitment after off-chain disperser confirmation.
    function confirmCommitment(bytes32 dataRoot, uint256 epoch, uint256 quorumId) external onlyOwner {
        bytes32 id = identifier(dataRoot, epoch, quorumId);
        localCommitments[id] = true;
        emit CommitmentConfirmed(dataRoot, epoch, quorumId, id);
    }

    function commitmentExists(bytes32 dataRoot, uint256 epoch, uint256 quorumId) external view returns (bool) {
        if (upstreamEntrance != address(0) && upstreamEntrance.code.length > 0) {
            try IDAEntrance(upstreamEntrance).commitmentExists(dataRoot, epoch, quorumId) returns (bool exists) {
                if (exists) return true;
            } catch {}
        }
        return localCommitments[identifier(dataRoot, epoch, quorumId)];
    }
}
