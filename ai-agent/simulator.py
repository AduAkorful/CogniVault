#!/usr/bin/env python3
import os
import json
import sys
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# TEE Private Key (for simulation purposes)
TEE_PRIVATE_KEY = "0x5de4111afa73d9b5c2c6b3e407d36fd5d2f47055c1798317e0892c2cf80ed3d1"
TEE_ADDRESS = Account.from_key(TEE_PRIVATE_KEY).address

STATE_FILE = "state.json"

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    # Default state if file doesn't exist or is invalid
    return {
        "pools": {
            "lending": {
                "name": "Mock Lending Pool",
                "address": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
                "apy": 550, # 5.5%
                "risk": 1.2
            },
            "amm": {
                "name": "Mock AMM Pool",
                "address": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
                "apy": 1200, # 12.0%
                "risk": 3.0
            }
        },
        "max_risk_limit": 2.0,
        "blocks_fast_forwarded": 0,
        "history": []
    }

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=4)

def optimize_portfolio(state):
    lending_apy = state["pools"]["lending"]["apy"]
    lending_risk = state["pools"]["lending"]["risk"]
    amm_apy = state["pools"]["amm"]["apy"]
    amm_risk = state["pools"]["amm"]["risk"]
    max_risk = state["max_risk_limit"]

    # Basic LP formulation to maximize APY subject to risk limit:
    # Max: alloc_lending * lending_apy + alloc_amm * amm_apy
    # Subject to:
    # 1. alloc_lending * lending_risk + alloc_amm * amm_risk <= max_risk
    # 2. alloc_lending + alloc_amm = 1.0
    # 3. alloc_lending >= 0, alloc_amm >= 0
    # Since there are only 2 pools, we can solve this algebraically.
    
    # Check if AMM pool has higher yield
    if amm_apy > lending_apy:
        # We want to allocate as much as possible to AMM
        # Constraint: alloc_lending * lending_risk + alloc_amm * amm_risk <= max_risk
        # (1 - alloc_amm) * lending_risk + alloc_amm * amm_risk <= max_risk
        # lending_risk + alloc_amm * (amm_risk - lending_risk) <= max_risk
        # alloc_amm <= (max_risk - lending_risk) / (amm_risk - lending_risk)
        if amm_risk <= lending_risk:
            alloc_amm = 1.0
        else:
            alloc_amm = (max_risk - lending_risk) / (amm_risk - lending_risk)
            alloc_amm = max(0.0, min(1.0, alloc_amm))
        alloc_lending = 1.0 - alloc_amm
    else:
        # We want to allocate as much as possible to Lending
        if lending_risk <= amm_risk:
            alloc_lending = 1.0
        else:
            alloc_lending = (max_risk - amm_risk) / (lending_risk - amm_risk)
            alloc_lending = max(0.0, min(1.0, alloc_lending))
        alloc_amm = 1.0 - alloc_lending

    # Convert to basis points (out of 10,000)
    alloc_lending_bps = int(round(alloc_lending * 10000))
    alloc_amm_bps = 10000 - alloc_lending_bps

    return alloc_lending_bps, alloc_amm_bps

def sign_strategy(allocations, targets, da_blob_hash):
    # Prepare data for ABI encoding
    # allocations: uint256[]
    # targets: address[]
    # da_blob_hash: bytes32
    
    # Solidity: keccak256(abi.encode(allocations, targets, daBlobHash))
    # In web3.py: Web3.solidity_keccak or encoding using eth_abi
    from eth_abi import encode
    
    encoded = encode(
        ['uint256[]', 'address[]', 'bytes32'],
        [allocations, targets, da_blob_hash]
    )
    
    message_hash = Web3.keccak(encoded)
    
    # Sign message
    signable_message = encode_defunct(primitive=message_hash)
    signed_message = Account.sign_message(signable_message, TEE_PRIVATE_KEY)
    
    return message_hash.hex(), signed_message.signature.hex()

def main():
    print("=" * 60)
    print("🤖 COGNIVAULT OFF-CHAIN AI STRATEGY OPTIMIZER SIMULATOR")
    print(f"TEE Signer Address: {TEE_ADDRESS}")
    print("=" * 60)

    state = load_state()
    
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        # Read args or perform optimization directly
        print("[*] Running portfolio optimization...")
        lending_bps, amm_bps = optimize_portfolio(state)
        
        lending_addr = state["pools"]["lending"]["address"]
        amm_addr = state["pools"]["amm"]["address"]
        
        allocations = [lending_bps, amm_bps]
        targets = [lending_addr, amm_addr]
        
        # Simulated 0G DA Blob Hash
        da_blob_hash_bytes = Web3.keccak(text=f"da-blob-payload-{len(state['history'])}")
        da_blob_hash = da_blob_hash_bytes.hex()
        
        msg_hash, signature = sign_strategy(allocations, targets, da_blob_hash_bytes)
        
        print("\n[✔] Optimization complete:")
        print(f"  - Lending Allocation: {lending_bps / 100:.2f}% ({lending_bps} bps) -> Pool: {lending_addr}")
        print(f"  - AMM Allocation: {amm_bps / 100:.2f}% ({amm_bps} bps) -> Pool: {amm_addr}")
        print(f"  - Calculated Risk Score: {lending_bps/10000 * state['pools']['lending']['risk'] + amm_bps/10000 * state['pools']['amm']['risk']:.2f}")
        print(f"  - 0G DA Blob Hash: {da_blob_hash}")
        print(f"  - TEE Signature: {signature[:32]}...{signature[-32:]}")
        
        # Save run history
        run_record = {
            "timestamp": len(state["history"]),
            "allocations": allocations,
            "targets": targets,
            "da_blob_hash": da_blob_hash,
            "signature": signature,
            "message_hash": msg_hash
        }
        state["history"].append(run_record)
        save_state(state)
        print("\n[✔] Optimization results saved to state.json")
    else:
        print("[i] Available commands:")
        print("  python3 simulator.py run     - Compute optimization, sign strategy, and save state")
        print("  python3 simulator.py status  - Display current state parameters")
        print("\nCurrent APYs:")
        print(f"  - Lending Pool: {state['pools']['lending']['apy'] / 100:.2f}%")
        print(f"  - AMM Pool: {state['pools']['amm']['apy'] / 100:.2f}%")

if __name__ == "__main__":
    main()
