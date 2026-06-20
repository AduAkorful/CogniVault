import os
import json
import urllib.request
from web3 import Web3

def normalize_hash(h: str) -> str:
    if h.startswith("0x"):
        h = h[2:]
    return h.lower()

def compute_merkle_root_and_tree(data: bytes):
    CHUNK_SIZE = 1024
    chunks = []
    for i in range(0, len(data), CHUNK_SIZE):
        chunk = data[i:i+CHUNK_SIZE]
        if len(chunk) < CHUNK_SIZE:
            chunk = chunk + b'\x00' * (CHUNK_SIZE - len(chunk))
        chunks.append(chunk)

    if not chunks:
        chunks.append(b'\x00' * CHUNK_SIZE)

    leaves = [Web3.keccak(c) for c in chunks]

    tree = [leaves]
    while len(tree[-1]) > 1:
        current_level = tree[-1]
        next_level = []
        for i in range(0, len(current_level), 2):
            if i + 1 < len(current_level):
                parent = Web3.keccak(current_level[i] + current_level[i+1])
            else:
                parent = Web3.keccak(current_level[i] + current_level[i])
            next_level.append(parent)
        tree.append(next_level)

    root_hash = "0x" + tree[-1][0].hex()
    return root_hash, tree

def verify_chunk_proof(root_hash: str, leaf_hash: bytes, proof: list[str], leaf_index: int) -> bool:
    curr = leaf_hash
    curr_idx = leaf_index

    for sibling_str in proof:
        sibling = bytes.fromhex(normalize_hash(sibling_str))
        if curr_idx % 2 == 0:
            curr = Web3.keccak(curr + sibling)
        else:
            curr = Web3.keccak(sibling + curr)
        curr_idx = curr_idx // 2

    normalized_root = normalize_hash(root_hash)
    normalized_computed = normalize_hash(curr.hex())
    return normalized_root == normalized_computed

class ZeroGStorageClient:
    def __init__(self, indexer_url: str = None):
        self.indexer_url = indexer_url or "https://indexer-storage-testnet-turbo.0g.ai"

    def download_file(self, root_hash: str) -> bytes:
        if not root_hash:
            raise ValueError("Root hash cannot be empty")

        query_url = f"{self.indexer_url}/file?root={root_hash}"
        print(f"[*] Downloading from 0G Storage Indexer: {query_url}")

        try:
            response = urllib.request.urlopen(query_url, timeout=15)
            data = response.read()
        except Exception as e:
            raise RuntimeError(f"Failed to download from 0G Storage Indexer: {e}")

        computed_root, _ = compute_merkle_root_and_tree(data)
        if normalize_hash(computed_root) != normalize_hash(root_hash):
            raise ValueError(
                f"Live 0G Storage Merkle verification failed!\n"
                f"Expected root: {root_hash}\n"
                f"Computed root: {computed_root}"
            )

        print(f"[✔] [0G Storage Live] Downloaded and verified file Merkle integrity (Root: {root_hash}).")
        return data
