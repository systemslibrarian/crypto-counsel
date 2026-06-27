# crypto-counsel

**AI Cryptography Advisor** — ask questions about cryptographic algorithms and get concise, expert answers powered by Groq (`openai/gpt-oss-20b`) with a local RAG corpus of 97 algorithms plus 100+ live-demo cards.

**Live site:** <https://crypto-counsel.systemslibrarian.dev>

## Features

- **RAG-powered answers** — a local `corpus.json` (224 entries: 97 algorithms, 125 demo cards, 2 reference docs) is searched at query time with TF-IDF scoring and hand-tuned synonym expansion; the top matches are injected into the system prompt for grounded responses.
- **Source citations** — each AI answer lists the corpus entries that informed it, so responses are traceable to their grounding data.
- **Streaming chat UI** — single-file `index.html` app with real-time token streaming via the Groq API (proxied through a Cloudflare Worker).
- **Conversation persistence** — chat history is saved in `localStorage` and restored on reload; a **Clear** button wipes both the display and the model-facing history.
- **Resilient proxy** — the front-end calls a primary proxy on a custom domain and automatically falls back to the `workers.dev` URL if it's unreachable.
- **Inline ecosystem links** — AI responses include clickable links to two companion sites:
  - [**crypto-compare**](https://crypto-compare.systemslibrarian.dev/) — reference catalog filtered by category (`?cat=symmetric`, `?cat=kem`, etc.)
  - [**crypto-lab**](https://systemslibrarian.github.io/crypto-lab-aes-modes/) — live browser demos for specific algorithms (e.g. `aes-modes`, `kyber-vault`)
- **Markdown rendering** — bold, italic, inline code, lists, and `[text](url)` links are rendered in AI responses (HTML is escaped first to prevent XSS from model output).
- **URL query support** — link to the app with a pre-filled question via `?q=your+question`.

## Architecture

```
index.html          Single-file front-end (UI, RAG retrieval, streaming client)
corpus.json         RAG corpus — 224 entries:
                      97 algorithm entries
                      123 crypto-lab demo cards + 2 standalone demos (snow2, dad-mode-morse2)
                      2 reference docs (crypto-compare, crypto-lab)
algorithms.ts       Partial, richly-typed reference snapshot (59 of the 97
                    algorithms) carried over from the crypto-compare project.
                    NOT the source of truth and not imported at runtime; it
                    references a type that doesn't exist in this repo, so it
                    does not compile here. The maintained source of truth lives
                    in the crypto-compare repository.
worker/             Cloudflare Worker proxy for Groq API
  index.js          Streams Groq responses through to the client; CORS-locked
                    and rate-limited per IP via a Cloudflare Rate Limiting binding
  wrangler.toml
CNAME               GitHub Pages custom domain
```

The front-end reaches the Worker at two endpoints, primary first with automatic fallback:

| Role | URL |
|------|-----|
| Primary | `https://api.crypto-counsel.systemslibrarian.dev` |
| Fallback | `https://crypto-counsel-proxy.systemslibrarian.workers.dev` |

## Companion site links

The system prompt instructs the model to include links to these sites when relevant:

| Site | URL pattern | Example |
|------|-------------|---------|
| crypto-compare | `https://crypto-compare.systemslibrarian.dev/?cat={category}` | `?cat=symmetric` |
| crypto-lab | `https://systemslibrarian.github.io/crypto-lab-{slug}/` | `aes-modes` |

**Category slugs:** `symmetric`, `kem`, `signatures`, `hash`, `kdf`, `mac`, `secret-sharing`, `zkp`, `steganography`, `csprng`, `password-hashing`, `homomorphic`, `mpc`, `asymmetric`, `threshold`

**Demo slugs** (123): `aegis-gate`, `aes-modes`, `ascon`, `babel-hash`, `bb84`, `bcrypt-forge`, `biham-lens`, `bike-vault`, `bitcoin-wallet`, `blind-oracle`, `blind-sign`, `broken-trust`, `bulletproofs`, `chacha20-stream`, `ciphertext-mirror`, `ckks-lab`, `collision-vault`, `commit-gate`, `corrupted-oracle`, `curve-lens`, `curve448`, `dead-sea-cipher`, `dilithium-reject`, `dilithium-seal`, `drbg-arena`, `e91`, `ecdsa-forge`, `ed25519-forge`, `elgamal-plain`, `enigma-forge`, `envelope-kms`, `falcon-seal`, `fhe-arena`, `format-ward`, `frodo-vault`, `frost-threshold`, `garbled-gate`, `gg20-wallet`, `grover`, `harvest-timeline`, `harvest-vault`, `hash-zoo`, `hawk`, `hqc-timing`, `hqc-timing-break`, `hqc-vault`, `hybrid-guide`, `hybrid-sign`, `hybrid-wire`, `ibe-gate`, `iron-letter`, `iron-serpent`, `isogeny-gate`, `j-uniward`, `jevil`, `jwt-forge`, `kdf-arena`, `kdf-chain`, `kerberos`, `key-exchange`, `kyber-vault`, `kyberslash`, `lattice-fault`, `lll-break`, `lms-ledger`, `lms-xmss`, `lwe-hints`, `mac-race`, `mceliece-gate`, `merkle-vault`, `mls-group`, `model-breach`, `mpcith-sign`, `multivariate`, `noise-pipe`, `nonce-guard`, `nonce-lattice`, `ntru-classic`, `oblivious-shelf`, `opaque-gate`, `oram-vault`, `ot-gate`, `otp-vault`, `padding-oracle`, `paillier-gate`, `pairing-gate`, `patron-shield`, `phantom-vault`, `pki-chain`, `poly1305-mac`, `pq-families`, `pq-rotation`, `pq-tls-handshake`, `protocol-compose`, `psi-gate`, `quantum-vault-kpqc`, `ratchet-wire`, `ring-sign`, `rsa-forge`, `scloud-vault`, `shadow-vault`, `shamir-gate`, `shor`, `silent-tally`, `snark-arena`, `sphincs-ledger`, `ssh-handshake`, `stark-tower`, `stego-suite`, `syndrome-drain`, `threshold-decrypt`, `threshold-mldsa`, `timing-oracle`, `vigenere-break`, `vrf-gate`, `vss-gate`, `web-of-trust`, `webauthn`, `world-ciphers`, `world-hashes`, `x3dh-wire`, `zk-arena`, `zk-proof-lab`

**Exception:** `steg-arena` is hosted at its own root — `https://systemslibrarian.github.io/steg-arena/` — not under the `crypto-lab-{slug}` pattern.

## Development

The front-end is a single `index.html` file — no build step required. Open it directly or serve with any static file server. The Cloudflare Worker in `worker/` proxies requests to the Groq API; deploy it with `wrangler deploy` from the `worker/` directory (set the `GROQ_API_KEY` secret and bind a `RATE_LIMITER` rate-limiting namespace).

## License

See repository for license details.

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
