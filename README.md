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
corpus.json         RAG corpus — 97 algorithm entries
worker/             Cloudflare Worker proxy for Groq API
  index.js
  wrangler.toml
```

## Companion site links

The system prompt instructs the model to include links to these sites when relevant:

| Site | URL pattern | Example |
|------|-------------|---------|
| crypto-compare | `https://crypto-compare.systemslibrarian.dev/?cat={category}` | `?cat=symmetric` |
| crypto-lab | `https://systemslibrarian.github.io/crypto-lab-{slug}/` | `aes-modes` |

**Category slugs:** `symmetric`, `kem`, `signatures`, `hash`, `kdf`, `mac`, `secret-sharing`, `zkp`, `steganography`, `csprng`, `password-hashing`, `homomorphic`, `mpc`, `asymmetric`, `threshold`

**Demo slugs:** `aes-modes`, `kyber-vault`, `dilithium-seal`, `sphincs-ledger`, `ratchet-wire`, `shamir-gate`, `hybrid-wire`, `zk-proof-lab`, `shadow-vault`, `phantom-vault`, `blind-oracle`, `patron-shield`, `padding-oracle`, `rsa-forge`, `mac-race`, `kdf-chain`, `timing-oracle`, `falcon-seal`, `hqc-vault`, `mceliece-gate`, `bike-vault`, `bcrypt-forge`, `pki-chain`, `ring-sign`, `threshold-decrypt`, `blind-sign`, `commit-gate`, `protocol-compose`, `format-ward`, `noise-pipe`, `curve-lens`, `frost-threshold`, `x3dh-wire`, `babel-hash`, `silent-tally`, `dead-sea-cipher`, `iron-serpent`, `biham-lens`, `corrupted-oracle`, `quantum-vault-kpqc`, `iron-letter`, `steg-arena`

## Development

The front-end is a single `index.html` file — no build step required. Open it directly or serve with any static file server. The Cloudflare Worker in `worker/` proxies requests to the Groq API.

## License

See repository for license details.

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*