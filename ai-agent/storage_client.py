import os
import json
import urllib.request
from web3 import Web3

def normalize_hash(h: str) -> str:
    """Normalize hex string by lowercasing and ensuring no 0x prefix."""
    if h.startswith("0x"):
        h = h[2:]
    return h.lower()

def compute_merkle_root_and_tree(data: bytes):
    """
    Computes the 0G Storage style Merkle root and returns (root, tree_levels).
    Data is divided into 1024-byte chunks, padded to 1024 bytes with zeros.
    """
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
    """
    Verifies that a leaf hash belongs to a Merkle tree with root_hash using the proof.
    """
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
    def __init__(self, indexer_url: str = None, mock_mode: bool = False):
        self.indexer_url = indexer_url or "https://indexer-storage-testnet-turbo.0g.ai"
        self.mock_mode = mock_mode
        self.mock_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_0g_storage")

    def download_file(self, root_hash: str) -> bytes:
        """
        Downloads the file identified by root_hash.
        - In Live mode: Queries indexer API /file?root=... and performs Merkle verification on data.
        - In Mock mode: Reads file from mock directory and performs full Merkle proof path validation.
        """
        if not root_hash:
            raise ValueError("Root hash cannot be empty")

        if self.mock_mode:
            # 1. Read mock file from local simulated directory
            metrics_path = os.path.join(self.mock_dir, "yield_metrics.json")
            metadata_path = os.path.join(self.mock_dir, "metadata.json")
            
            if not os.path.exists(metrics_path) or not os.path.exists(metadata_path):
                raise FileNotFoundError("Mock storage files not found. Run log_aggregator.js first.")
                
            with open(metrics_path, "rb") as f:
                data = f.read()
                
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
                
            # Verify root hash matches
            meta_root = metadata["rootHash"]
            if normalize_hash(meta_root) != normalize_hash(root_hash):
                raise ValueError(f"Root hash mismatch! Expected {root_hash}, found {meta_root} in mock storage.")
                
            # Compute Merkle root of downloaded content
            computed_root, tree = compute_merkle_root_and_tree(data)
            if normalize_hash(computed_root) != normalize_hash(root_hash):
                raise ValueError(f"Content Merkle verification failed! Computed {computed_root}, expected {root_hash}")
                
            # Verify all chunk inclusion proofs as a rigorous verification sanity test
            CHUNK_SIZE = 1024
            chunks = []
            for i in range(0, len(data), CHUNK_SIZE):
                chunk = data[i:i+CHUNK_SIZE]
                if len(chunk) < CHUNK_SIZE:
                    chunk = chunk + b'\x00' * (CHUNK_SIZE - len(chunk))
                chunks.append(chunk)
            if not chunks:
                chunks.append(b'\x00' * CHUNK_SIZE)
                
            for idx, chunk in enumerate(chunks):
                leaf_hash = Web3.keccak(chunk)
                proof = metadata["proofs"][idx]
                if not verify_chunk_proof(root_hash, leaf_hash, proof, idx):
                    raise ValueError(f"Merkle inclusion proof verification failed for chunk index {idx}!")
                    
            print(f"[✔] [0G Storage Mock] Downloaded and verified {len(chunks)} chunks with Merkle proof paths.")
            return data
        else:
            # Live production mode: call Indexer REST API
            query_url = f"{self.indexer_url}/file?root={root_hash}"
            print(f"[*] Downloading from 0G Storage Indexer: {query_url}")
            
            try:
                # Set request timeout to prevent hanging
                response = urllib.request.urlopen(query_url, timeout=15)
                data = response.read()
            except Exception as e:
                raise RuntimeError(f"Failed to download from 0G Storage Indexer: {e}")
                
            # Compute Merkle root of downloaded content and compare to expected root_hash
            computed_root, _ = compute_merkle_root_and_tree(data)
            if normalize_hash(computed_root) != normalize_hash(root_hash):
                raise ValueError(
                    f"Live 0G Storage Merkle verification failed!\n"
                    f"Expected root: {root_hash}\n"
                    f"Computed root: {computed_root}"
                )
                
            print(f"[✔] [0G Storage Live] Downloaded and verified file Merkle integrity (Root: {root_hash}).")
            return data
