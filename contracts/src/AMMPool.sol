// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
}

contract AMMPool is Ownable {
    IMintableERC20 public immutable asset;
    uint256 public apy; // in basis points, e.g., 500 = 5% APY
    uint256 public constant BLOCKS_PER_YEAR = 10_512_000; // 3 seconds per block

    struct DepositInfo {
        uint256 principal;
        uint256 lastDepositBlock;
    }

    mapping(address => DepositInfo) public deposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 yield);
    event APYUpdated(uint256 newAPY);

    constructor(address _asset, uint256 _initialAPY) Ownable(msg.sender) {
        asset = IMintableERC20(_asset);
        apy = _initialAPY;
    }

    function setAPY(uint256 _apy) external onlyOwner {
        apy = _apy;
        emit APYUpdated(_apy);
    }

    function getAPY() external view returns (uint256) {
        return apy;
    }

    function getPendingYield(address user) public view returns (uint256) {
        DepositInfo storage dep = deposits[user];
        if (dep.principal == 0 || block.number <= dep.lastDepositBlock) {
            return 0;
        }
        uint256 deltaBlocks = block.number - dep.lastDepositBlock;
        return (dep.principal * apy * deltaBlocks) / (BLOCKS_PER_YEAR * 10000);
    }

    function balanceOf(address user) external view returns (uint256) {
        DepositInfo storage dep = deposits[user];
        return dep.principal + getPendingYield(user);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        DepositInfo storage dep = deposits[msg.sender];
        if (dep.principal > 0) {
            uint256 pendingYield = getPendingYield(msg.sender);
            dep.principal += pendingYield;
            if (pendingYield > 0) {
                asset.mint(address(this), pendingYield);
            }
        }

        dep.lastDepositBlock = block.number;
        dep.principal += amount;

        asset.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        DepositInfo storage dep = deposits[msg.sender];
        uint256 pendingYield = getPendingYield(msg.sender);
        uint256 totalBalance = dep.principal + pendingYield;

        require(amount > 0, "Amount must be > 0");
        require(totalBalance >= amount, "Insufficient balance");

        if (pendingYield > 0) {
            asset.mint(address(this), pendingYield);
        }

        dep.principal = totalBalance - amount;
        dep.lastDepositBlock = block.number;

        asset.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, pendingYield);
    }

    function withdrawAll() external {
        DepositInfo storage dep = deposits[msg.sender];
        uint256 pendingYield = getPendingYield(msg.sender);
        uint256 totalBalance = dep.principal + pendingYield;

        require(totalBalance > 0, "Nothing to withdraw");

        if (pendingYield > 0) {
            asset.mint(address(this), pendingYield);
        }

        dep.principal = 0;
        dep.lastDepositBlock = block.number;

        asset.transfer(msg.sender, totalBalance);
        emit Withdrawn(msg.sender, totalBalance, pendingYield);
    }
}
