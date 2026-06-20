// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PriceOracle is Ownable {
    struct PriceFeed {
        uint80 roundId;
        int256 answer;       // price in 8-decimal USD (e.g., 1e8 = $1.00)
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(address => PriceFeed) public feeds;
    uint80 public latestRoundId;

    event PriceUpdated(address indexed token, int256 price, uint256 timestamp);

    constructor() Ownable(msg.sender) {}

    function setPrice(address token, int256 price) external onlyOwner {
        latestRoundId++;
        feeds[token] = PriceFeed({
            roundId: latestRoundId,
            answer: price,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: latestRoundId
        });
        emit PriceUpdated(token, price, block.timestamp);
    }

    function latestRoundData(address token) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        PriceFeed memory feed = feeds[token];
        require(feed.updatedAt > 0, "No price feed for token");
        return (
            feed.roundId,
            feed.answer,
            feed.startedAt,
            feed.updatedAt,
            feed.answeredInRound
        );
    }
}
