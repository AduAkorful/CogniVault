// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IDAEntrance} from "./interfaces/IDAEntrance.sol";

interface IMockPool {
    function deposit(uint256 amount) external;
    function withdrawAll() external;
    function balanceOf(address user) external view returns (uint256);
    function asset() external view returns (address);
}

interface IMockPriceOracle {
    function latestRoundData(address token) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract AIGovernedVault is ERC4626, Ownable {
    using ECDSA for bytes32;

    uint256 public constant MAX_ACTIVE_POOLS = 10;

    address public teeSigner;
    mapping(address => bool) public isWhitelistedPool;
    address[] public activePools;

    // 0G DA Verification state
    address public daEntranceContract;
    bool public daVerificationEnabled;

    // Slippage Protection & Price Oracle state
    address public priceOracle;
    uint256 public maxSlippageBps = 50; // default: 0.5% (50 basis points)

    event Rebalanced(address[] targets, uint256[] allocations, bytes32 indexed daBlobHash);
    event PoolWhitelistUpdated(address indexed pool, bool status);
    event TeeSignerUpdated(address indexed teeSigner);
    event DAVerified(bytes32 indexed daBlobHash, bytes32 indexed dataRoot);
    event DAEntranceUpdated(address indexed daEntranceContract);
    event DAVerificationToggled(bool enabled);
    event PriceOracleUpdated(address indexed priceOracle);
    event MaxSlippageUpdated(uint256 maxSlippageBps);
    event SlippageCheckPassed(uint256 expectedValue, uint256 actualValue, uint256 slippageBps);

    constructor(IERC20 _asset, address _teeSigner)
        ERC4626(_asset)
        ERC20("CogniVault AI Shares", "cSHARES")
        Ownable(msg.sender)
    {
        teeSigner = _teeSigner;
    }

    function setPoolWhitelist(address pool, bool status) external onlyOwner {
        isWhitelistedPool[pool] = status;
        emit PoolWhitelistUpdated(pool, status);
    }

    function setTeeSigner(address _teeSigner) external onlyOwner {
        teeSigner = _teeSigner;
        emit TeeSignerUpdated(_teeSigner);
    }

    function setDAEntrance(address _entrance) external onlyOwner {
        daEntranceContract = _entrance;
        emit DAEntranceUpdated(_entrance);
    }

    function setDAVerification(bool _enabled) external onlyOwner {
        daVerificationEnabled = _enabled;
        emit DAVerificationToggled(_enabled);
    }

    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = _oracle;
        emit PriceOracleUpdated(_oracle);
    }

    function setMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        require(_maxSlippageBps <= 500, "Slippage limit too high"); // max 5%
        maxSlippageBps = _maxSlippageBps;
        emit MaxSlippageUpdated(_maxSlippageBps);
    }

    function getActivePools() external view returns (address[] memory) {
        return activePools;
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 12;
    }

    /**
     * @dev Overrides totalAssets to return the idle contract balance plus all assets currently in yield pools.
     */
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 deployed = 0;
        uint256 len = activePools.length;
        for (uint256 i = 0; i < len; i++) {
            deployed += IMockPool(activePools[i]).balanceOf(address(this));
        }
        return idle + deployed;
    }

    /**
     * @dev Helper to compute deployed value via oracle prices
     */
    function _computeDeployedValue() internal view returns (uint256) {
        uint256 totalVal = 0;
        uint256 len = activePools.length;
        for (uint256 i = 0; i < len; i++) {
            address pool = activePools[i];
            uint256 bal = IMockPool(pool).balanceOf(address(this));
            address token = IMockPool(pool).asset();

            if (priceOracle != address(0)) {
                (, int256 price, , , ) = IMockPriceOracle(priceOracle).latestRoundData(token);
                if (price > 0) {
                    totalVal += (bal * uint256(price)) / 1e8;
                } else {
                    totalVal += bal;
                }
            } else {
                totalVal += bal;
            }
        }
        return totalVal;
    }

    /**
     * @dev Executes an AI-defined asset reallocation strategy.
     * @param allocations The percentage allocations in basis points (sum must equal 10,000).
     * @param targets The target pool addresses.
     * @param signature The TEE signer signature of the strategy payload.
     * @param daBlobHash The 0G DA blob hash containing the raw logs.
     * @param dataRoot The 0G DA data root to verify.
     */
    function executeAIStrategy(
        uint256[] calldata allocations,
        address[] calldata targets,
        bytes calldata signature,
        bytes32 daBlobHash,
        bytes32 dataRoot
    ) external {
        uint256 len = targets.length;
        require(len == allocations.length, "Mismatched inputs");
        require(len > 0, "Empty strategy");
        require(len <= MAX_ACTIVE_POOLS, "Active pool limit exceeded");

        // 1. Verify TEE signature
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ethSignedMessageHash.recover(signature);
        require(recovered == teeSigner, "Invalid TEE signature");

        // 1.5. Verify DA root confirmation if enabled
        if (daVerificationEnabled && daEntranceContract != address(0)) {
            require(
                IDAEntrance(daEntranceContract).isDataRootConfirmed(dataRoot),
                "DA blob not confirmed"
            );
            emit DAVerified(daBlobHash, dataRoot);
        }

        // 2. Withdraw all assets from current active pools
        uint256 activeLen = activePools.length;
        for (uint256 i = 0; i < activeLen; i++) {
            uint256 bal = IMockPool(activePools[i]).balanceOf(address(this));
            if (bal > 0) {
                IMockPool(activePools[i]).withdrawAll();
            }
        }
        delete activePools;

        // 3. Verify allocations sum to 100% (10,000 basis points) and targets are whitelisted
        uint256 totalAlloc = 0;
        for (uint256 i = 0; i < len; i++) {
            require(isWhitelistedPool[targets[i]], "Target not whitelisted");
            totalAlloc += allocations[i];
            
            // Check for duplicate targets to prevent multiple deposits to the same pool
            for (uint256 j = 0; j < i; j++) {
                require(targets[i] != targets[j], "Duplicate targets not allowed");
            }
        }
        require(totalAlloc == 10000, "Allocations must sum to 100%");

        // 4. Deploy assets to the new target pools
        uint256 totalBalance = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < len; i++) {
            uint256 amountToDeposit = (totalBalance * allocations[i]) / 10000;
            if (amountToDeposit > 0) {
                IERC20(asset()).approve(targets[i], amountToDeposit);
                IMockPool(targets[i]).deposit(amountToDeposit);
                activePools.push(targets[i]);
            }
        }

        // 5. Slippage check
        if (priceOracle != address(0)) {
            uint256 expectedValue = totalBalance;
            uint256 actualValue = _computeDeployedValue();
            if (actualValue < expectedValue) {
                uint256 slippage = ((expectedValue - actualValue) * 10000) / expectedValue;
                require(slippage <= maxSlippageBps, "Slippage exceeds maximum");
                emit SlippageCheckPassed(expectedValue, actualValue, slippage);
            } else {
                emit SlippageCheckPassed(expectedValue, actualValue, 0);
            }
        }

        emit Rebalanced(targets, allocations, daBlobHash);
    }
}
