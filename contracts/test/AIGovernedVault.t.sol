// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {AIGovernedVault} from "../src/AIGovernedVault.sol";
import {USDC} from "../src/USDC.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {AMMPool} from "../src/AMMPool.sol";
import {W0G} from "../src/W0G.sol";
import {TestDAEntrance} from "./mocks/TestDAEntrance.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract AIGovernedVaultTest is Test {
    using ECDSA for bytes32;

    AIGovernedVault public vault;
    USDC public usdc;
    LendingPool public lendingPool;
    AMMPool public ammPool;
    TestDAEntrance public testDAEntrance;
    PriceOracle public oracle;

    address public owner = address(1);
    address public user = address(2);
    
    // TEE key setup
    uint256 public teePrivateKey = 0x5de4111afa73d9b5c2c6b3e407d36fd5d2f47055c1798317e0892c2cf80ed3d1;
    address public teeSigner;

    function setUp() public {
        teeSigner = vm.addr(teePrivateKey);

        vm.startPrank(owner);
        // 1. Deploy Assets (USDC)
        usdc = new USDC();

        // 2. Deploy Pools (with initial APYs: Lending 5.50%, AMM 12.00%)
        lendingPool = new LendingPool(address(usdc), 550);
        ammPool = new AMMPool(address(usdc), 1200);

        // 2.5 Deploy DA Entrance
        testDAEntrance = new TestDAEntrance();

        // 3. Deploy Vault as UUPS upgradeable proxy
        AIGovernedVault impl = new AIGovernedVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(impl.initialize, (IERC20(address(usdc)), teeSigner))
        );
        vault = AIGovernedVault(address(proxy));

        // 3.5 Deploy and configure Oracle
        oracle = new PriceOracle();
        oracle.setPrice(address(usdc), 1e8);
        vault.setPriceOracle(address(oracle));

        // 4. Whitelist Pools in Vault using setPoolWhitelist
        vault.setPoolWhitelist(address(lendingPool), true);
        vault.setPoolWhitelist(address(ammPool), true);

        // Set APYs for testing: Lending Pool 5.50%, AMM Pool 12.00%
        lendingPool.setAPY(550);
        ammPool.setAPY(1200);

        // Set pools as minters so they can mint accrued yield
        usdc.setMinter(address(lendingPool), true);
        usdc.setMinter(address(ammPool), true);

        // Mint USDC to user (done by owner/minter)
        usdc.mint(user, 100_000 * 10**6);

        vm.stopPrank();

        // Approve vault to spend user USDC
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);
    }

    function testDepositAndWithdraw() public {
        uint256 depositAmount = 10_000 * 10**6; // 10,000 USDC (6 decimals)
        
        vm.startPrank(user);
        
        // Deposit
        uint256 shares = vault.deposit(depositAmount, user);
        assertEq(shares, depositAmount * 10**12); // Vault shares have 18 decimals
        assertEq(vault.balanceOf(user), shares);
        
        // Withdraw
        uint256 sharesBurned = vault.withdraw(depositAmount, user, user);
        assertEq(sharesBurned, shares);
        assertEq(vault.balanceOf(user), 0);
        
        vm.stopPrank();
    }

    function testWhitelistPool() public {
        address nonWhitelisted = address(3);
        
        // Verify only owner can whitelist
        vm.prank(user);
        vm.expectRevert(); // Should revert since sender is not owner
        vault.setPoolWhitelist(nonWhitelisted, true);

        vm.prank(owner);
        vault.setPoolWhitelist(nonWhitelisted, true);
        assertTrue(vault.isWhitelistedPool(nonWhitelisted));
    }

    function testInvalidSignature() public {
        uint256 depositAmount = 10_000 * 10**6;
        
        vm.prank(user);
        vault.deposit(depositAmount, user);

        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 6000; // 60%
        allocations[1] = 4000; // 40%

        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);

        bytes32 daBlobHash = keccak256("da-blob");
        bytes32 dataRoot = bytes32(0);
        
        // Sign with invalid private key (e.g. user key instead of TEE key)
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(999, ethSignedMessageHash);
        bytes memory badSignature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid TEE signature");
        vault.executeAIStrategy(allocations, targets, badSignature, daBlobHash, dataRoot);
    }

    function testRebalanceAndInterestAccrual() public {
        uint256 depositAmount = 10_000 * 10**6; // 10,000 USDC
        
        vm.prank(user);
        vault.deposit(depositAmount, user);

        // Vault is whitelisted and has idle USDC balance of 10,000 USDC
        assertEq(usdc.balanceOf(address(vault)), depositAmount);

        // Prepare Rebalance Payload: 60% Lending, 40% AMM
        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 6000; // 60%
        allocations[1] = 4000; // 40%

        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);

        bytes32 daBlobHash = keccak256("da-blob-run-1");
        bytes32 dataRoot = bytes32(0);

        // Sign with correct TEE key
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Execute Strategy
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);

        // Verify deposits into pools (60% to lending, 40% to AMM)
        assertEq(lendingPool.balanceOf(address(vault)), 6_000 * 10**6);
        assertEq(ammPool.balanceOf(address(vault)), 4_000 * 10**6);
        assertEq(usdc.balanceOf(address(vault)), 0);

        // Advance 1,000 blocks to accrue yield
        // APY Lending: 5.5% (550) -> Yield = (6000 * 550 * 1000) / (10512000 * 10000) = 31390
        // APY AMM: 12% (1200) -> Yield = (4000 * 1200 * 1000) / (10512000 * 10000) = 45662
        vm.roll(block.number + 1000);

        uint256 principalLending = 6_000 * 10**6;
        uint256 principalAmm = 4_000 * 10**6;
        uint256 expectedLendingYield = (principalLending * 550 * 1000) / (10512000 * 10000);
        uint256 expectedAmmYield = (principalAmm * 1200 * 1000) / (10512000 * 10000);
        
        assertEq(lendingPool.getPendingYield(address(vault)), expectedLendingYield);
        assertEq(ammPool.getPendingYield(address(vault)), expectedAmmYield);

        // Verify totalAssets increases
        uint256 totalAssetsBeforeRebalance = vault.totalAssets();
        assertEq(totalAssetsBeforeRebalance, 10_000 * 10**6 + expectedLendingYield + expectedAmmYield);

        // Rotate allocations: 30% Lending, 70% AMM
        allocations[0] = 3000;
        allocations[1] = 7000;
        daBlobHash = keccak256("da-blob-run-2");

        messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (v, r, s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        signature = abi.encodePacked(r, s, v);

        // Rebalance
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);

        // All yield should be harvested and folded into new pools
        uint256 newTotalAUM = 10_000 * 10**6 + expectedLendingYield + expectedAmmYield;
        assertEq(lendingPool.balanceOf(address(vault)), (newTotalAUM * 3000) / 10000);
        assertEq(ammPool.balanceOf(address(vault)), (newTotalAUM * 7000) / 10000);
    }

    function testDuplicateTargetsRevert() public {
        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;

        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(lendingPool); // Duplicate

        bytes32 daBlobHash = keccak256("da-blob-duplicate");
        bytes32 dataRoot = bytes32(0);

        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Duplicate targets not allowed");
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);
    }

    // New tests to reach 100% coverage
    function testW0G_Basic() public {
        // Deploy W0G
        vm.prank(owner);
        W0G w0g = new W0G();
        
        assertEq(w0g.name(), "Wrapped 0G");
        assertEq(w0g.symbol(), "W0G");
        assertEq(w0g.decimals(), 18);
        assertEq(w0g.balanceOf(owner), 1_000_000 * 10**18);
        
        address minter = address(0x123);
        vm.prank(owner);
        w0g.setMinter(minter, true);
        assertTrue(w0g.isMinter(minter));
        
        vm.prank(minter);
        w0g.mint(address(0x456), 500 * 10**18);
        assertEq(w0g.balanceOf(address(0x456)), 500 * 10**18);

        // Expect reverts
        vm.prank(address(0x456));
        vm.expectRevert("W0G: caller is not minter or owner");
        w0g.mint(address(0x456), 100);

        vm.prank(address(0x456));
        vm.expectRevert(); // Ownable Unauthorized
        w0g.setMinter(address(0x456), true);
    }

    function testUSDC_Reverts() public {
        vm.prank(user);
        vm.expectRevert("USDC: caller is not minter or owner");
        usdc.mint(user, 100);
        
        vm.prank(user);
        vm.expectRevert(); // Ownable Unauthorized
        usdc.setMinter(user, true);
    }

    function testPool_RevertsAndYield() public {
        // Test setAPY owner check
        vm.prank(user);
        vm.expectRevert(); // Ownable Unauthorized
        lendingPool.setAPY(600);
        
        // Zero deposit revert
        vm.startPrank(user);
        vm.expectRevert("Amount must be > 0");
        lendingPool.deposit(0);
        
        // Withdraw checks
        vm.expectRevert("Amount must be > 0");
        lendingPool.withdraw(0);
        
        vm.expectRevert("Insufficient balance");
        lendingPool.withdraw(100);
        
        vm.expectRevert("Nothing to withdraw");
        lendingPool.withdrawAll();
        vm.stopPrank();
        
        // APY getter
        assertEq(lendingPool.getAPY(), 550);
        
        // Zero balance / block check for getPendingYield
        assertEq(lendingPool.getPendingYield(user), 0);
    }

    function testPools_Full() public {
        // We will test both lendingPool and ammPool to ensure 100% coverage
        for (uint256 idx = 0; idx < 2; idx++) {
            if (idx == 0) {
                LendingPool pool = lendingPool;
                
                // setAPY
                vm.prank(owner);
                pool.setAPY(800);
                assertEq(pool.getAPY(), 800);
                
                // deposit
                uint256 depositAmt = 1000 * 10**6;
                vm.startPrank(owner);
                usdc.approve(address(pool), depositAmt);
                pool.deposit(depositAmt);
                vm.stopPrank();
                
                // check balances
                assertEq(pool.balanceOf(owner), depositAmt);
                // check same-block pending yield is 0
                assertEq(pool.getPendingYield(owner), 0);
                
                // deposit again in the same block to test principal > 0 and pendingYield == 0
                vm.startPrank(owner);
                usdc.approve(address(pool), 10**6);
                pool.deposit(10**6);
                vm.stopPrank();
                
                // wait blocks and check yield
                vm.roll(block.number + 100);
                uint256 pending = pool.getPendingYield(owner);
                assertTrue(pending > 0);
                
                // deposit again to accrue yield
                uint256 secondDeposit = 500 * 10**6;
                vm.startPrank(owner);
                usdc.approve(address(pool), secondDeposit);
                pool.deposit(secondDeposit);
                vm.stopPrank();
                
                // wait blocks to accumulate yield before partial withdraw
                vm.roll(block.number + 50);

                // withdraw partial
                vm.prank(owner);
                pool.withdraw(200 * 10**6);
                
                // wait blocks to accumulate yield before withdraw all
                vm.roll(block.number + 50);
                
                // withdraw all
                vm.prank(owner);
                pool.withdrawAll();
                assertEq(pool.balanceOf(owner), 0);
            } else {
                AMMPool pool = ammPool;
                
                // setAPY
                vm.prank(owner);
                pool.setAPY(800);
                assertEq(pool.getAPY(), 800);
                
                // deposit
                uint256 depositAmt = 1000 * 10**6;
                vm.startPrank(owner);
                usdc.approve(address(pool), depositAmt);
                pool.deposit(depositAmt);
                vm.stopPrank();
                
                // check balances
                assertEq(pool.balanceOf(owner), depositAmt);
                // check same-block pending yield is 0
                assertEq(pool.getPendingYield(owner), 0);
                
                // deposit again in the same block to test principal > 0 and pendingYield == 0
                vm.startPrank(owner);
                usdc.approve(address(pool), 10**6);
                pool.deposit(10**6);
                vm.stopPrank();
                
                // wait blocks and check yield
                vm.roll(block.number + 100);
                uint256 pending = pool.getPendingYield(owner);
                assertTrue(pending > 0);
                
                // deposit again to accrue yield
                uint256 secondDeposit = 500 * 10**6;
                vm.startPrank(owner);
                usdc.approve(address(pool), secondDeposit);
                pool.deposit(secondDeposit);
                vm.stopPrank();
                
                // wait blocks to accumulate yield before partial withdraw
                vm.roll(block.number + 50);

                // withdraw partial
                vm.prank(owner);
                pool.withdraw(200 * 10**6);
                
                // wait blocks to accumulate yield before withdraw all
                vm.roll(block.number + 50);
                
                // withdraw all
                vm.prank(owner);
                pool.withdrawAll();
                assertEq(pool.balanceOf(owner), 0);
            }
        }
    }

    function testStrategy_ZeroBalancesAndAllocations() public {
        uint256 depositAmount = 10_000 * 10**6;
        vm.prank(user);
        vault.deposit(depositAmount, user);
        
        // Initially getActivePools should be empty
        assertEq(vault.getActivePools().length, 0);

        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 10000;
        allocations[1] = 0; // 0% allocation
        
        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);
        
        bytes32 daBlobHash = keccak256("da-blob-zero");
        bytes32 dataRoot = bytes32(0);
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);
        
        assertEq(lendingPool.balanceOf(address(vault)), depositAmount);
        assertEq(ammPool.balanceOf(address(vault)), 0);
        
        // Check active pools (should only contain targets[0] since targets[1] had 0 allocation)
        address[] memory active = vault.getActivePools();
        assertEq(active.length, 1);
        assertEq(active[0], address(lendingPool));
        
        // Execute again to trigger 0 balance withdrawal check for ammPool and > 0 for lendingPool
        allocations[0] = 0;
        allocations[1] = 10000;
        
        messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (v, r, s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        signature = abi.encodePacked(r, s, v);
        
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);
        
        assertEq(lendingPool.balanceOf(address(vault)), 0);
        assertEq(ammPool.balanceOf(address(vault)), depositAmount);

        // Check active pools (should only contain targets[1] since targets[0] had 0 allocation)
        active = vault.getActivePools();
        assertEq(active.length, 1);
        assertEq(active[0], address(ammPool));
    }

    function testVault_OwnerActions() public {
        vm.startPrank(user);
        vm.expectRevert(); // Ownable Unauthorized
        vault.setTeeSigner(user);
        vm.stopPrank();
        
        vm.prank(owner);
        vault.setTeeSigner(address(0x999));
        assertEq(vault.teeSigner(), address(0x999));
    }

    function testStrategy_Reverts() public {
        uint256[] memory emptyAlloc;
        address[] memory emptyTargets;
        bytes memory sig;
        
        vm.expectRevert("Empty strategy");
        vault.executeAIStrategy(emptyAlloc, emptyTargets, sig, bytes32(0), bytes32(0));
        
        uint256[] memory allocMismatch = new uint256[](2);
        address[] memory targetsMismatch = new address[](1);
        vm.expectRevert("Mismatched inputs");
        vault.executeAIStrategy(allocMismatch, targetsMismatch, sig, bytes32(0), bytes32(0));
        
        // Allocate to non-whitelisted target
        uint256[] memory alloc = new uint256[](1);
        alloc[0] = 10000;
        address[] memory targets = new address[](1);
        targets[0] = address(0x888); // Not whitelisted
        
        bytes32 daBlobHash = keccak256("da-blob-test");
        bytes32 dataRoot = bytes32(0);
        bytes32 messageHash = keccak256(abi.encode(alloc, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.expectRevert("Target not whitelisted");
        vault.executeAIStrategy(alloc, targets, signature, daBlobHash, dataRoot);
        
        // Whitelist the target but fail allocation sum
        vm.prank(owner);
        vault.setPoolWhitelist(address(0x888), true);
        
        alloc[0] = 9999; // 99.99% instead of 100%
        
        messageHash = keccak256(abi.encode(alloc, targets, daBlobHash, dataRoot));
        ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (v, r, s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        signature = abi.encodePacked(r, s, v);
        
        vm.expectRevert("Allocations must sum to 100%");
        vault.executeAIStrategy(alloc, targets, signature, daBlobHash, dataRoot);

        // Test MAX_ACTIVE_POOLS limit
        uint256 maxLimitPlusOne = vault.MAX_ACTIVE_POOLS() + 1;
        uint256[] memory tooManyAllocs = new uint256[](maxLimitPlusOne);
        address[] memory tooManyTargets = new address[](maxLimitPlusOne);
        for (uint256 i = 0; i < maxLimitPlusOne; i++) {
            tooManyTargets[i] = address(uint160(i + 1000));
        }
        vm.expectRevert("Active pool limit exceeded");
        vault.executeAIStrategy(tooManyAllocs, tooManyTargets, sig, bytes32(0), bytes32(0));
    }

    function testERC4626_LimitsAndPreviews() public view {
        assertEq(vault.maxDeposit(user), type(uint256).max);
        assertEq(vault.maxMint(user), type(uint256).max);
        
        uint256 assets = 1000 * 10**6;
        assertEq(vault.previewDeposit(assets), assets * 10**12);
        assertEq(vault.previewWithdraw(assets), assets * 10**12);
        
        uint256 shares = 1000 * 10**18;
        assertEq(vault.previewMint(shares), shares / 10**12);
        assertEq(vault.previewRedeem(shares), shares / 10**12);
    }

    function testFuzz_DepositAndWithdraw(uint256 amount) public {
        // Bound amount between 1 USDC and 1,000,000,000 USDC
        amount = bound(amount, 10**6, 1_000_000_000 * 10**6);
        
        // Mint and approve for fuzz user
        address fuzzUser = address(uint160(uint256(keccak256(abi.encode(amount)))));
        vm.assume(fuzzUser != address(0) && fuzzUser != address(vault));
        
        vm.startPrank(owner);
        usdc.mint(fuzzUser, amount);
        vm.stopPrank();
        
        vm.startPrank(fuzzUser);
        usdc.approve(address(vault), amount);
        
        uint256 shares = vault.deposit(amount, fuzzUser);
        assertEq(shares, amount * 10**12);
        assertEq(vault.balanceOf(fuzzUser), shares);
        
        uint256 sharesBurned = vault.withdraw(amount, fuzzUser, fuzzUser);
        assertEq(sharesBurned, shares);
        assertEq(vault.balanceOf(fuzzUser), 0);
        vm.stopPrank();
    }

    function testFuzz_RebalanceAllocations(uint256 alloc1) public {
        alloc1 = bound(alloc1, 0, 10000);
        uint256 alloc2 = 10000 - alloc1;
        
        uint256 depositAmount = 10_000 * 10**6; // 10,000 USDC
        vm.prank(user);
        vault.deposit(depositAmount, user);
        
        uint256[] memory allocations = new uint256[](2);
        allocations[0] = alloc1;
        allocations[1] = alloc2;
        
        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);
        
        bytes32 daBlobHash = keccak256("da-blob-fuzz-alloc");
        bytes32 dataRoot = bytes32(0);
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);
        
        // Verify split
        uint256 expectedLending = (depositAmount * alloc1) / 10000;
        uint256 expectedAmm = (depositAmount * alloc2) / 10000;
        
        assertEq(lendingPool.balanceOf(address(vault)), expectedLending);
        assertEq(ammPool.balanceOf(address(vault)), expectedAmm);
    }

    function testDAVerification() public {
        // Setup owner prank to configure DA
        vm.startPrank(owner);
        vault.setDAEntrance(address(testDAEntrance));
        vault.setDAVerification(true);
        vm.stopPrank();

        uint256 depositAmount = 10_000 * 10**6;
        vm.prank(user);
        vault.deposit(depositAmount, user);

        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);

        bytes32 daBlobHash = keccak256("da-blob-verification");
        bytes32 testRoot = keccak256("data-root-confirmed");

        // 1. Set root confirmation status to false in mock
        testDAEntrance.setConfirmed(testRoot, false);

        // Sign with correct TEE key but with dataRoot
        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, testRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Rebalance should fail because data root is not confirmed
        vm.expectRevert("DA blob not confirmed");
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, testRoot);

        // 2. Set root confirmation status to true in mock
        testDAEntrance.setConfirmed(testRoot, true);

        // Should now succeed
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, testRoot);
        assertEq(lendingPool.balanceOf(address(vault)), 5_000 * 10**6);
        assertEq(ammPool.balanceOf(address(vault)), 5_000 * 10**6);
    }

    function testSlippage_WithinThreshold() public {
        uint256 depositAmount = 10_000 * 10**6;
        vm.prank(user);
        vault.deposit(depositAmount, user);

        // Depeg USDC slightly to $0.999 (0.999 * 1e8 = 99,900_000)
        // With default maxSlippageBps = 50 (0.5%), a 0.1% depeg is within the threshold.
        vm.prank(owner);
        oracle.setPrice(address(usdc), 99_900_000);

        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);

        bytes32 daBlobHash = keccak256("da-blob-slippage-ok");
        bytes32 testRoot = bytes32(0);

        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, testRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should succeed
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, testRoot);
    }

    function testSlippage_ExceedsThreshold() public {
        uint256 depositAmount = 10_000 * 10**6;
        vm.prank(user);
        vault.deposit(depositAmount, user);

        // Depeg USDC to $0.990 (0.990 * 1e8 = 99,000_000)
        // With default maxSlippageBps = 50 (0.5%), a 1.0% depeg exceeds the threshold.
        vm.prank(owner);
        oracle.setPrice(address(usdc), 99_000_000);

        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 5000;
        allocations[1] = 5000;
        address[] memory targets = new address[](2);
        targets[0] = address(lendingPool);
        targets[1] = address(ammPool);

        bytes32 daBlobHash = keccak256("da-blob-slippage-fail");
        bytes32 testRoot = bytes32(0);

        bytes32 messageHash = keccak256(abi.encode(allocations, targets, daBlobHash, testRoot));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teePrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should revert because slippage exceeds maximum
        vm.expectRevert("Slippage exceeds maximum");
        vault.executeAIStrategy(allocations, targets, signature, daBlobHash, testRoot);
    }

    function testSlippage_OwnerControls() public {
        // Test max slippage threshold validation capped at 500 (5%)
        vm.startPrank(owner);
        vault.setMaxSlippage(300); // 3%
        assertEq(vault.maxSlippageBps(), 300);

        vm.expectRevert("Slippage limit too high");
        vault.setMaxSlippage(600); // 6% - should fail

        vault.setPriceOracle(address(0));
        assertEq(vault.priceOracle(), address(0));
        vm.stopPrank();
    }

    function testUpgrade_PreservesState() public {
        // Deposit and rebalance to create state
        uint256 depositAmount = 10_000 * 10**6;
        vm.prank(user);
        vault.deposit(depositAmount, user);

        assertEq(vault.balanceOf(user), depositAmount * 10**12);
        assertEq(vault.totalAssets(), depositAmount);

        // Deploy new implementation and upgrade
        AIGovernedVault newImpl = new AIGovernedVault();
        vm.prank(owner);
        vault.upgradeToAndCall(address(newImpl), "");

        // Verify state preserved after upgrade
        assertEq(vault.balanceOf(user), depositAmount * 10**12);
        assertEq(vault.totalAssets(), depositAmount);
        assertEq(vault.teeSigner(), teeSigner);
        assertEq(vault.owner(), owner);
    }

    function testUpgrade_RevertIfNotOwner() public {
        AIGovernedVault newImpl = new AIGovernedVault();
        vm.prank(user);
        vm.expectRevert();
        vault.upgradeToAndCall(address(newImpl), "");
    }

    function testReinitialize_Reverts() public {
        vm.expectRevert();
        vault.initialize(IERC20(address(usdc)), teeSigner);
    }
}
