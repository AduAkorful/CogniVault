// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IDAEntrance} from "./interfaces/IDAEntrance.sol";

interface IPool {
    function deposit(uint256 amount) external;
    function withdrawAll() external;
    function balanceOf(address user) external view returns (uint256);
    function asset() external view returns (address);
}

interface IPriceOracle {
    function latestRoundData(address token) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract AIGovernedVault is
    Initializable,
    ERC4626Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;

    uint256 public constant MAX_ACTIVE_POOLS = 10;

    address public teeSigner;
    mapping(address => bool) public isWhitelistedPool;
    address[] public activePools;

    address public daEntranceContract;
    bool public daVerificationEnabled;

    address public priceOracle;
    uint256 public maxSlippageBps;

    event Rebalanced(address[] targets, uint256[] allocations, bytes32 indexed daBlobHash);
    event PoolWhitelistUpdated(address indexed pool, bool status);
    event TeeSignerUpdated(address indexed teeSigner);
    event DAVerified(bytes32 indexed daBlobHash, bytes32 indexed dataRoot);
    event DAEntranceUpdated(address indexed daEntranceContract);
    event DAVerificationToggled(bool enabled);
    event PriceOracleUpdated(address indexed priceOracle);
    event MaxSlippageUpdated(uint256 maxSlippageBps);
    event SlippageCheckPassed(uint256 expectedValue, uint256 actualValue, uint256 slippageBps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IERC20 _asset, address _teeSigner) external initializer {
        __ERC4626_init(_asset);
        __ERC20_init("CogniVault AI Shares", "cSHARES");
        __Ownable_init(msg.sender);

        teeSigner = _teeSigner;
        maxSlippageBps = 50;
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
        require(_maxSlippageBps <= 500, "Slippage limit too high");
        maxSlippageBps = _maxSlippageBps;
        emit MaxSlippageUpdated(_maxSlippageBps);
    }

    function getActivePools() external view returns (address[] memory) {
        return activePools;
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 12;
    }

    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 deployed = 0;
        uint256 len = activePools.length;
        for (uint256 i = 0; i < len; i++) {
            deployed += IPool(activePools[i]).balanceOf(address(this));
        }
        return idle + deployed;
    }

    function _computeDeployedValue() internal view returns (uint256) {
        uint256 totalVal = 0;
        uint256 len = activePools.length;
        for (uint256 i = 0; i < len; i++) {
            address pool = activePools[i];
            uint256 bal = IPool(pool).balanceOf(address(this));
            address token = IPool(pool).asset();

            if (priceOracle != address(0)) {
                (, int256 price, , , ) = IPriceOracle(priceOracle).latestRoundData(token);
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

        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ethSignedMessageHash.recover(signature);
        require(recovered == teeSigner, "Invalid TEE signature");

        if (daVerificationEnabled && daEntranceContract != address(0)) {
            require(
                IDAEntrance(daEntranceContract).isDataRootConfirmed(dataRoot),
                "DA blob not confirmed"
            );
            emit DAVerified(daBlobHash, dataRoot);
        }

        uint256 activeLen = activePools.length;
        for (uint256 i = 0; i < activeLen; i++) {
            uint256 bal = IPool(activePools[i]).balanceOf(address(this));
            if (bal > 0) {
                IPool(activePools[i]).withdrawAll();
            }
        }
        delete activePools;

        uint256 totalAlloc = 0;
        for (uint256 i = 0; i < len; i++) {
            require(isWhitelistedPool[targets[i]], "Target not whitelisted");
            totalAlloc += allocations[i];
            for (uint256 j = 0; j < i; j++) {
                require(targets[i] != targets[j], "Duplicate targets not allowed");
            }
        }
        require(totalAlloc == 10000, "Allocations must sum to 100%");

        uint256 totalBalance = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < len; i++) {
            uint256 amountToDeposit = (totalBalance * allocations[i]) / 10000;
            if (amountToDeposit > 0) {
                IERC20(asset()).approve(targets[i], amountToDeposit);
                IPool(targets[i]).deposit(amountToDeposit);
                activePools.push(targets[i]);
            }
        }

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

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[44] private __gap;
}
