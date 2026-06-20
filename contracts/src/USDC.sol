// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract USDC is ERC20, Ownable {
    mapping(address => bool) public isMinter;

    event MinterStatusUpdated(address indexed minter, bool status);

    modifier onlyMinterOrOwner() {
        require(msg.sender == owner() || isMinter[msg.sender], "USDC: caller is not minter or owner");
        _;
    }

    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 * 10**decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setMinter(address minter, bool status) external onlyOwner {
        isMinter[minter] = status;
        emit MinterStatusUpdated(minter, status);
    }

    function mint(address to, uint256 amount) external onlyMinterOrOwner {
        _mint(to, amount);
    }
}
