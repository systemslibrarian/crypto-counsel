# crypto-counsel

**AI Cryptography Advisor** — ask questions about cryptographic algorithms and get concise, expert answers powered by Groq (Llama 3.1 8B Instant) with a local RAG corpus of 97 algorithms.

**Live site:** <https://crypto-counsel.systemslibrarian.dev>

## Features

- **RAG-powered answers** — a local `corpus.json` of 97 cryptographic algorithms is searched at query time and injected into the system prompt for grounded responses.
- **Streaming chat UI** — single-file `index.html` app with real-time token streaming via the Groq API (proxied through a Cloudflare Worker).
- **Inline ecosystem links** — AI responses include clickable links to two companion sites:
  - [**crypto-compare**](https://crypto-compare.systemslibrarian.dev/) — reference catalog filtered by category (`?cat=symmetric`, `?cat=kem`, etc.)
  - [**crypto-lab**](https://systemslibrarian.github.io/crypto-lab-aes-modes/) — live browser demos for specific algorithms (e.g. `aes-modes`, `kyber-vault`)
- **Markdown rendering** — bold, italic, inline code, lists, and `[text](url)` links are rendered in AI responses.
- **URL query support** — link to the app with a pre-filled question via `?q=your+question`.

## Architecture

```
index.html          Single-file front-end
corpus.json         RAG corpus — 97 algorithm entries + crypto-lab demo cards
algorithms.ts       Canonical, richly-typed algorithm metadata (source of truth
                    behind the algorithm slice of corpus.json; not imported at
                    runtime)
worker/             Cloudflare Worker proxy for Groq API
  index.js          Streams Groq responses through to the client; rate-limited
                    per IP via a Cloudflare Rate Limiting binding
  wrangler.toml
```

## Companion site links

The system prompt instructs the model to include links to these sites when relevant:

| Site | URL pattern | Example |
|------|-------------|---------|
| crypto-compare | `https://crypto-compare.systemslibrarian.dev/?cat={category}` | `?cat=symmetric` |
| crypto-lab | `https://systemslibrarian.github.io/crypto-lab-{slug}/` | `aes-modes` |

**Category slugs:** `symmetric`, `kem`, `signatures`, `hash`, `kdf`, `mac`, `secret-sharing`, `zkp`, `steganography`, `csprng`, `password-hashing`, `homomorphic`, `mpc`, `asymmetric`, `threshold`

**Demo slugs:** `aegis-gate`, `aes-modes`, `ascon`, `babel-hash`, `bb84`, `bcrypt-forge`, `biham-lens`, `bike-vault`, `blind-oracle`, `blind-sign`, `bulletproofs`, `chacha20-stream`, `ckks-lab`, `commit-gate`, `corrupted-oracle`, `curve-lens`, `curve448`, `dead-sea-cipher`, `dilithium-reject`, `dilithium-seal`, `drbg-arena`, `ecdsa-forge`, `ed25519-forge`, `elgamal-plain`, `envelope-kms`, `falcon-seal`, `fhe-arena`, `format-ward`, `frodo-vault`, `frost-threshold`, `garbled-gate`, `gg20-wallet`, `grover`, `harvest-timeline`, `harvest-vault`, `hash-zoo`, `hawk`, `hqc-timing-break`, `hqc-vault`, `hybrid-sign`, `hybrid-wire`, `ibe-gate`, `iron-letter`, `iron-serpent`, `isogeny-gate`, `j-uniward`, `kdf-arena`, `kdf-chain`, `kerberos`, `kyber-vault`, `kyberslash`, `lattice-fault`, `lll-break`, `lms-ledger`, `lms-xmss`, `mac-race`, `mceliece-gate`, `merkle-vault`, `mls-group`, `model-breach`, `mpcith-sign`, `noise-pipe`, `nonce-guard`, `nonce-lattice`, `ntru-classic`, `oblivious-shelf`, `opaque-gate`, `oram-vault`, `ot-gate`, `padding-oracle`, `paillier-gate`, `pairing-gate`, `patron-shield`, `phantom-vault`, `pki-chain`, `poly1305-mac`, `pq-rotation`, `pq-tls-handshake`, `protocol-compose`, `psi-gate`, `quantum-vault-kpqc`, `ratchet-wire`, `ring-sign`, `rsa-forge`, `scloud-vault`, `shadow-vault`, `shamir-gate`, `shor`, `silent-tally`, `snark-arena`, `sphincs-ledger`, `stark-tower`, `steg-arena`, `stego-suite`, `threshold-decrypt`, `threshold-mldsa`, `timing-oracle`, `vrf-gate`, `vss-gate`, `world-ciphers`, `world-hashes`, `x3dh-wire`, `zk-proof-lab`

## Development

The front-end is a single `index.html` file — no build step required. Open it directly or serve with any static file server. The Cloudflare Worker in `worker/` proxies requests to the Groq API.

## License

See repository for license details.

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*