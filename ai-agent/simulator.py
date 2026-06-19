#!/usr/bin/env python3
import os
import json
import sys
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from storage_client import ZeroGStorageClient

# TEE Private Key (for simulation purposes)
TEE_PRIVATE_KEY = "0x5de4111afa73d9b5c2c6b3e407d36fd5d2f47055c1798317e0892c2cf80ed3d1"
TEE_ADDRESS = Account.from_key(TEE_PRIVATE_KEY).address

STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state.json")

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
                "address": "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
                "apy": 550, # 5.5%
                "risk": 1.2
            },
            "amm": {
                "name": "Mock AMM Pool",
                "address": "0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03",
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

def sign_strategy(allocations, targets, da_blob_hash, data_root):
    # Prepare data for ABI encoding
    # allocations: uint256[]
    # targets: address[]
    # da_blob_hash: bytes32
    # data_root: bytes32
    
    # Solidity: keccak256(abi.encode(allocations, targets, daBlobHash, dataRoot))
    # In web3.py: Web3.solidity_keccak or encoding using eth_abi
    from eth_abi import encode
    
    # Convert string hex to bytes if needed
    if isinstance(da_blob_hash, str):
        if da_blob_hash.startswith("0x"):
            da_blob_hash = bytes.fromhex(da_blob_hash[2:])
        else:
            da_blob_hash = bytes.fromhex(da_blob_hash)
            
    if isinstance(data_root, str):
        if data_root.startswith("0x"):
            data_root = bytes.fromhex(data_root[2:])
        else:
            data_root = bytes.fromhex(data_root)

    encoded = encode(
        ['uint256[]', 'address[]', 'bytes32', 'bytes32'],
        [allocations, targets, da_blob_hash, data_root]
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
    
    # 0G Storage Integration
    mock_mode = (os.getenv("MOCK_STORAGE", "false").lower() == "true")
    indexer_url = os.getenv("INDEXER_URL", "https://indexer-storage-testnet-turbo.0g.ai")
    
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        print("[*] Retrieving historical context from 0G Storage...")
        latest_root = state.get("latest_storage_root")
        if not latest_root:
            print("[Warning] No 'latest_storage_root' found in state.json.")
            latest_root = "0xe1b0defd92d2277d7a8239f648207fca3e731205a925f3dc740449280b9255f3"
            print(f"[*] Using fallback simulation root hash: {latest_root}")
            
        try:
            client = ZeroGStorageClient(indexer_url=indexer_url, mock_mode=mock_mode)
            storage_data_bytes = client.download_file(latest_root)
            historical_data = json.loads(storage_data_bytes.decode('utf-8'))
            print(f"[✔] Successfully ingested {len(historical_data)} historical yield records from 0G Storage.")
            print(f"    - Merkle Root Verified: {latest_root}")
            if historical_data:
                latest_record = historical_data[-1]
                print(f"    - Ingested Context: Block #{latest_record['block']} | Lending APY: {latest_record['lending_apy']/100}% | AMM APY: {latest_record['amm_apy']/100}%")
        except Exception as e:
            print(f"[Error] Failed to ingest 0G Storage context: {e}")
            if not mock_mode:
                print("[!] Production safety violation: Exiting process due to 0G Storage download/verification failure.")
                sys.exit(1)
            print("[*] Proceeding with offline fallback simulator state.")

        print("\n[*] Running portfolio optimization via 0G Compute...")
        import subprocess
        
        # Determine path to compute_client.js in the same directory as simulator.py
        js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compute_client.js")
        
        result = subprocess.run(["node", js_path], capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
            
        if result.returncode != 0:
            print("[Error] 0G Compute client execution failed.")
            sys.exit(1)

        # Reload state after JS updates it
        state = load_state()
        if not state.get("history"):
            print("[Error] No execution history found in state.json after running Compute client.")
            sys.exit(1)
            
        latest_record = state["history"][-1]
        lending_bps, amm_bps = latest_record["allocations"]
        lending_addr = state["pools"]["lending"]["address"]
        amm_addr = state["pools"]["amm"]["address"]
        da_blob_hash = latest_record["da_blob_hash"]
        signature = latest_record["signature"]
        
        print("\n[✔] 0G Compute optimization execution complete:")
        print(f"  - Lending Allocation: {lending_bps / 100:.2f}% ({lending_bps} bps) -> Pool: {lending_addr}")
        print(f"  - AMM Allocation: {amm_bps / 100:.2f}% ({amm_bps} bps) -> Pool: {amm_addr}")
        print(f"  - Calculated Risk Score: {lending_bps/10000 * state['pools']['lending']['risk'] + amm_bps/10000 * state['pools']['amm']['risk']:.2f}")
        print(f"  - 0G DA Blob Hash: 0x{da_blob_hash}")
        print(f"  - TEE Signature: 0x{signature[:32]}...{signature[-32:]}")
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
