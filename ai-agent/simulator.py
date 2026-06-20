#!/usr/bin/env python3
import os
import json
import sys
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from storage_client import ZeroGStorageClient

TEE_PRIVATE_KEY = os.getenv("TEE_PRIVATE_KEY")
if not TEE_PRIVATE_KEY:
    print("[Error] TEE_PRIVATE_KEY not set. Add it to your .env file.")
    sys.exit(1)
TEE_ADDRESS = Account.from_key(TEE_PRIVATE_KEY).address

STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state.json")
DEPLOYMENTS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deployments.json")

def load_deployments():
    if os.path.exists(DEPLOYMENTS_FILE):
        try:
            with open(DEPLOYMENTS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return None

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    deployments = load_deployments()
    lending_addr = deployments["contracts"]["lendingPool"]["address"] if deployments else ""
    amm_addr = deployments["contracts"]["ammPool"]["address"] if deployments else ""
    return {
        "pools": {
            "lending": {
                "name": "Lending Pool",
                "address": lending_addr,
                "apy": 550,
                "risk": 1.2
            },
            "amm": {
                "name": "AMM Pool",
                "address": amm_addr,
                "apy": 1200,
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

    if amm_apy > lending_apy:
        if amm_risk <= lending_risk:
            alloc_amm = 1.0
        else:
            alloc_amm = (max_risk - lending_risk) / (amm_risk - lending_risk)
            alloc_amm = max(0.0, min(1.0, alloc_amm))
        alloc_lending = 1.0 - alloc_amm
    else:
        if lending_risk <= amm_risk:
            alloc_lending = 1.0
        else:
            alloc_lending = (max_risk - amm_risk) / (lending_risk - amm_risk)
            alloc_lending = max(0.0, min(1.0, alloc_lending))
        alloc_amm = 1.0 - alloc_lending

    alloc_lending_bps = int(round(alloc_lending * 10000))
    alloc_amm_bps = 10000 - alloc_lending_bps

    return alloc_lending_bps, alloc_amm_bps

def sign_strategy(allocations, targets, da_blob_hash, data_root, da_epoch=0, da_quorum_id=0):
    from eth_abi import encode

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
        ['uint256[]', 'address[]', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [allocations, targets, da_blob_hash, data_root, da_epoch, da_quorum_id]
    )

    message_hash = Web3.keccak(encoded)

    signable_message = encode_defunct(primitive=message_hash)
    signed_message = Account.sign_message(signable_message, TEE_PRIVATE_KEY)

    return message_hash.hex(), signed_message.signature.hex()

def main():
    print("=" * 60)
    print("🤖 COGNIVAULT OFF-CHAIN AI STRATEGY OPTIMIZER SIMULATOR")
    print(f"TEE Signer Address: {TEE_ADDRESS}")
    print("=" * 60)

    state = load_state()

    indexer_url = os.getenv("INDEXER_URL", "https://indexer-storage-testnet-turbo.0g.ai")

    if len(sys.argv) > 1 and sys.argv[1] == "run":
        print("[*] Retrieving historical context from 0G Storage...")
        latest_root = state.get("latest_storage_root")
        if not latest_root:
            print("[Error] No 'latest_storage_root' found in state.json. Run log_aggregator.js first.")
            sys.exit(1)

        try:
            client = ZeroGStorageClient(indexer_url=indexer_url)
            storage_data_bytes = client.download_file(latest_root)
            historical_data = json.loads(storage_data_bytes.decode('utf-8'))
            print(f"[✔] Successfully ingested {len(historical_data)} historical yield records from 0G Storage.")
            print(f"    - Merkle Root Verified: {latest_root}")
            if historical_data:
                latest_record = historical_data[-1]
                print(f"    - Ingested Context: Block #{latest_record['block']} | Lending APY: {latest_record['lending_apy']/100}% | AMM APY: {latest_record['amm_apy']/100}%")
        except Exception as e:
            print(f"[Error] Failed to ingest 0G Storage context: {e}")
            sys.exit(1)

        print("\n[*] Running portfolio optimization via 0G Compute...")
        import subprocess

        js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compute_client.js")

        result = subprocess.run(["node", js_path], capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)

        if result.returncode != 0:
            print("[Error] 0G Compute client execution failed.")
            sys.exit(1)

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
