#!/usr/bin/env python3
"""Fetch README.md from all crypto-lab demo repos and append to corpus.json."""

import json
import subprocess
import base64
import time
import sys

REPOS = [
    "crypto-lab-iron-letter",
    "crypto-lab-x3dh-wire",
    "crypto-lab-corrupted-oracle",
    "crypto-lab-blind-sign",
    "crypto-lab-iron-serpent",
    "crypto-lab-world-ciphers",
    "crypto-lab-aes-modes",
    "crypto-lab-padding-oracle",
    "crypto-lab-bike-vault",
    "crypto-lab-hqc-vault",
    "crypto-lab-commit-gate",
    "crypto-lab-drbg-arena",
    "crypto-lab-bb84",
    "crypto-lab-shadow-vault",
    "crypto-lab-biham-lens",
    "crypto-lab-ed25519-forge",
    "crypto-lab-curve-lens",
    "dad-mode-morse2",
    "crypto-lab-format-ward",
    "crypto-lab-ratchet-wire",
    "crypto-lab-babel-hash",
    "crypto-lab-world-hashes",
    "crypto-lab-hash-zoo",
    "crypto-lab-sphincs-ledger",
    "crypto-lab-dead-sea-cipher",
    "crypto-lab-blind-oracle",
    "crypto-lab-ckks-lab",
    "crypto-lab-fhe-arena",
    "crypto-lab-hybrid-wire",
    "crypto-lab-harvest-vault",
    "crypto-lab-oblivious-shelf",
    "crypto-lab-kdf-arena",
    "crypto-lab-kdf-chain",
    "crypto-lab-patron-shield",
    "crypto-lab-poly1305-mac",
    "crypto-lab-merkle-vault",
    "crypto-lab-mac-race",
    "crypto-lab-model-breach",
    "crypto-lab-noise-pipe",
    "crypto-lab-nonce-guard",
    "crypto-lab-ot-gate",
    "crypto-lab-pairing-gate",
    "crypto-lab-bcrypt-forge",
    "crypto-lab-pki-chain",
    "crypto-lab-quantum-vault-kpqc",
    "crypto-lab-frodo-vault",
    "crypto-lab-kyber-vault",
    "crypto-lab-mceliece-gate",
    "crypto-lab-dilithium-seal",
    "crypto-lab-falcon-seal",
    "crypto-lab-grover",
    "crypto-lab-protocol-compose",
    "crypto-lab-rsa-forge",
    "crypto-lab-ring-sign",
    "crypto-lab-shor",
    "crypto-lab-shamir-gate",
    "crypto-lab-garbled-gate",
    "crypto-lab-silent-tally",
    "crypto-lab-lms-ledger",
    "crypto-lab-phantom-vault",
    "crypto-lab-j-uniward",
    "crypto-lab-stego-suite",
    "crypto-lab-chacha20-stream",
    "snow2",
    "crypto-lab-threshold-decrypt",
    "crypto-lab-gg20-wallet",
    "crypto-lab-frost-threshold",
    "crypto-lab-timing-oracle",
    "crypto-lab-isogeny-gate",
    "crypto-lab-lattice-fault",
    "crypto-lab-lll-break",
    "crypto-lab-mpcith-sign",
    "crypto-lab-opaque-gate",
    "crypto-lab-vrf-gate",
    "crypto-lab-vss-gate",
    "crypto-lab-snark-arena",
    "crypto-lab-stark-tower",
    "crypto-lab-zk-proof-lab",
]

OWNER = "systemslibrarian"
CORPUS_PATH = "/workspaces/crypto-counsel/corpus.json"

def fetch_readme(repo):
    result = subprocess.run(
        ["gh", "api", f"repos/{OWNER}/{repo}/contents/README.md"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  SKIP {repo}: {result.stderr.strip()[:80]}", file=sys.stderr)
        return None
    try:
        data = json.loads(result.stdout)
        content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return content
    except Exception as e:
        print(f"  ERROR {repo}: {e}", file=sys.stderr)
        return None

def make_corpus_entry(repo, readme_text):
    corpus_id = repo.replace("-", "_")
    # Clean up the text: strip excessive blank lines
    lines = [l.rstrip() for l in readme_text.splitlines()]
    text = "\n".join(lines).strip()
    return {"id": f"demo_{corpus_id}", "text": f"Demo Repository: {repo}\nGitHub: https://github.com/{OWNER}/{repo}\n\n{text}\n"}

def main():
    with open(CORPUS_PATH, "r") as f:
        corpus = json.load(f)

    existing_ids = {entry["id"] for entry in corpus}
    added = 0

    for repo in REPOS:
        corpus_id = f"demo_{repo.replace('-', '_')}"
        if corpus_id in existing_ids:
            print(f"  already exists: {corpus_id}")
            continue

        print(f"Fetching {repo}...")
        readme = fetch_readme(repo)
        if readme:
            entry = make_corpus_entry(repo, readme)
            corpus.append(entry)
            existing_ids.add(corpus_id)
            added += 1
            print(f"  added ({len(readme)} chars)")
        # Small delay to be polite to the API
        time.sleep(0.3)

    print(f"\nAdded {added} entries. Writing corpus.json...")
    with open(CORPUS_PATH, "w") as f:
        json.dump(corpus, f, separators=(",", ":"))
    print("Done.")

if __name__ == "__main__":
    main()
