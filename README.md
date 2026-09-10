# crypto-counsel

**AI Cryptography Advisor** — ask questions about cryptographic algorithms and get concise, expert answers powered by Groq (`openai/gpt-oss-120b`) with a local RAG corpus of 97 algorithms plus 100+ live-demo cards.

**Live site:** <https://crypto-counsel.systemslibrarian.dev>

## Features

- **RAG-powered answers** — a local `corpus.json` (292 entries: 97 algorithms, 193 demo cards, 2 reference docs) is searched at query time with TF-IDF scoring and hand-tuned synonym expansion; the top matches are injected into the system prompt for grounded responses.
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
corpus.json         RAG corpus — 292 entries:
                      97 algorithm entries
                      192 crypto-lab demo cards + 1 standalone demo (snow2)
                      2 reference docs (crypto-compare, crypto-lab)
algorithms.ts       Complete, richly-typed reference mirror (all 97 algorithms,
                    an exact id match against corpus.json) carried over from the
                    crypto-compare project. NOT the source of truth and not
                    imported at runtime; it references a type that doesn't exist
                    in this repo, so it does not compile here. The maintained
                    source of truth lives in the crypto-compare repository.
worker/             Cloudflare Worker proxy for Groq API
  index.js          Streams Groq responses through to the client. Hardened:
                    CORS-locked, rate-limited per IP, and the request is
                    validated + rebuilt server-side (model allowlist, max_tokens
                    cap, message-count/size limits) so the funded Groq key can't
                    be abused as an open LLM proxy.
  wrangler.toml
scripts/
  validate.mjs      Dependency-free repo health check (corpus parses, model is
                    current, every slug/URL/count written down anywhere matches
                    the corpus, and the reference docs list every demo the
                    corpus carries). Gates the deploy. Requires a crypto-compare
                    checkout — see "Running the validator" below.
  app-runtime.mjs   Boots index.html's real script under node:vm and a DOM stub,
                    so validate.mjs can assert on the system prompt the model is
                    actually sent rather than on what index.html's source looks
                    like. The generator is never reimplemented here; a second
                    copy would drift and then assert against itself.
.github/workflows/
  pages.yml         Validates then deploys the front-end to GitHub Pages
CNAME               GitHub Pages custom domain
```

The front-end reaches the Worker at two endpoints, primary first with automatic fallback:

| Role | URL |
|------|-----|
| Primary | `https://api.crypto-counsel.systemslibrarian.dev` |
| Fallback | `https://crypto-counsel-proxy.systemslibrarian.workers.dev` |

### Running the validator

```
node scripts/validate.mjs
```

It needs a **crypto-compare checkout** to be present, and it fails if there isn't one:

```
git clone https://github.com/systemslibrarian/crypto-compare.git ../crypto-compare
# or point it anywhere:  CRYPTO_COMPARE_DIR=/path/to/crypto-compare node scripts/validate.mjs
```

That is deliberate. Two facts stated in `corpus.json` prose — how many unique
crypto-lab demos crypto-compare links, and which `?cat=` slugs it defines — can
only be settled by reading that repo. The check used to derive them *when the
sibling happened to be there* and trust a pinned constant otherwise, which meant
it did nothing in CI, the one place it runs unattended: a drift from 192 to 193
passed green. An unknown `?cat=` returns HTTP 200 and simply filters nothing, so
no status-code check can stand in for this. "We could not look" must not read as
"it is fine", so absence is now an error, and the CI job checks the repo out.

## How it works (Cloudflare + Groq)

The app has three independent pieces. **Cloudflare** is the secure middle layer; **Groq** is the LLM inference provider. The front-end itself is *not* on Cloudflare — it's static files on GitHub Pages.

```
 ┌─────────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
 │  Browser (front-end)    │     │  Cloudflare Worker        │     │  Groq API           │
 │  GitHub Pages —         │     │  (the proxy)              │     │  api.groq.com       │
 │  crypto-counsel...dev   │     │  api.crypto-counsel...dev │     │                     │
 │                         │     │                           │     │                     │
 │ 1. client-side RAG over │     │ 3. CORS check             │     │ 5. runs inference   │
 │    corpus.json, builds  │ ──▶ │ 4. per-IP rate limit      │ ──▶ │    on               │
 │    the system prompt    │POST │    validate + sanitize    │POST │    gpt-oss-120b      │
 │                         │     │    (model allowlist,      │     │                     │
 │ 7. renders streamed     │ ◀── │     max_tokens cap, size) │ ◀── │ 6. streams tokens    │
 │    markdown + citations │ SSE │    inject GROQ_API_KEY     │ SSE │    back (SSE)        │
 └─────────────────────────┘     └──────────────────────────┘     └─────────────────────┘
```

**Why the Worker exists at all:** the Groq API key is a *secret tied to a funded account*. It cannot live in the browser — anyone could view-source a static site and steal it. So the browser never talks to Groq directly. Instead it calls the Cloudflare Worker, which is the only place that holds the key (stored as a Worker **secret**, `GROQ_API_KEY`, never in the repo) and attaches it server-side.

**What each Cloudflare feature does here:**
- **Worker** (`worker/index.js`) — a serverless function that receives the browser's chat request, enforces safety, adds the Groq key, forwards to Groq, and streams the answer back.
- **Custom domain** (`api.crypto-counsel.systemslibrarian.dev`) — a Cloudflare-managed route + TLS certificate that points at the Worker. (The `*.workers.dev` URL is the same Worker's built-in address, used as the automatic fallback.)
- **Rate Limiting binding** (`RATE_LIMITER`) — Cloudflare platform feature; caps each IP to 20 requests / 60s so the funded key can't be drained.

**What Groq does:** Groq exposes an OpenAI-compatible chat-completions endpoint and runs the open `openai/gpt-oss-120b` model on its hardware. The Worker sends a standard `{model, messages, stream}` payload to `https://api.groq.com/openai/v1/chat/completions` and relays the streamed response.

**End-to-end request flow:**
1. Browser loads the static app from GitHub Pages and fetches `corpus.json`.
2. On each question it runs **RAG locally** (TF-IDF + synonyms), retrieves the top matches, and builds the system prompt (context + link rules).
3. It POSTs `{model, messages, stream:true}` to the Worker (primary custom domain, falling back to `workers.dev` on failure).
4. The Worker checks CORS, applies the per-IP rate limit, and **validates + rebuilds** the payload (model allowlist, `max_tokens` cap, message-count/size limits).
5. The Worker adds `Authorization: Bearer <GROQ_API_KEY>` and forwards to Groq.
6. Groq runs inference and streams tokens back (Server-Sent Events).
7. The Worker pipes that stream straight back to the browser, which renders markdown + citations and persists the conversation to `localStorage`.

> Note: deploying the Worker is a **manual** step (`wrangler deploy`) — there is no CI/CD wired to Cloudflare. The GitHub Pages front-end, by contrast, auto-deploys on push to `main` (gated by `scripts/validate.mjs`).

## Companion site links

The system prompt instructs the model to include links to these sites when relevant. Both
vocabularies below are **generated from `corpus.json` at runtime**, not typed into the prompt —
the copies here are documentation, and `scripts/validate.mjs` fails if they drift from the corpus:

| Site | URL pattern | Example |
|------|-------------|---------|
| crypto-compare | `https://crypto-compare.systemslibrarian.dev/?cat={category}` | `?cat=symmetric` |
| crypto-lab | `https://systemslibrarian.github.io/crypto-lab-{slug}/` | `aes-modes` |

**Category slugs:** `asymmetric`, `csprng`, `curve`, `hash`, `he`, `kdf`, `kem`, `mac`, `mpc`, `ot_pir`, `password`, `sharing`, `signature`, `steganography`, `symmetric`, `threshold_sig`, `zkp`

**Demo slugs** (193): `ablation-wire`, `accumulator`, `aegis-gate`, `aes-modes`, `ascon`, `attestation-gate`, `attribute-gate`, `babel-hash`, `bb84`, `bcrypt-forge`, `beacon-lock`, `biham-lens`, `bike-vault`, `bitcoin-script`, `bitcoin-wallet`, `blind-hello`, `blind-oracle`, `blind-relay`, `blind-sign`, `broken-trust`, `bulletproofs`, `card-trick`, `chacha20-stream`, `chain-of-trust`, `ciphertext-mirror`, `ckks-lab`, `collision-vault`, `commit-gate`, `context-ward`, `corrupted-oracle`, `covert-channel-studio`, `credential-veil`, `curve-lens`, `curve448`, `dead-sea-cipher`, `diffie-hellman-mitm`, `dilithium-reject`, `dilithium-seal`, `dkg-gate`, `dnssec-chain`, `downgrade-wire`, `dp-noise`, `drbg-arena`, `e91`, `ec-point-arithmetic`, `ecdsa-forge`, `ed25519-forge`, `elgamal-plain`, `encrochat`, `enigma-forge`, `entropy-collapse`, `envelope-kms`, `factor-forge`, `falcon-seal`, `feistel-forge`, `fhe-arena`, `format-ward`, `frodo-vault`, `frost-threshold`, `frozen-heart`, `fte`, `garbled-gate`, `gg20-wallet`, `ggh-trapdoor`, `grover`, `harvest-timeline`, `harvest-vault`, `hash-zoo`, `hawk`, `hpke-envelope`, `hqc-timing`, `hqc-timing-break`, `hqc-vault`, `hybrid-guide`, `hybrid-pqc`, `hybrid-sign`, `hybrid-wire`, `ibe-gate`, `icy-dvrf`, `iron-letter`, `iron-serpent`, `isogeny-atlas`, `isogeny-gate`, `j-uniward`, `jevil`, `jwt-forge`, `kdf-arena`, `kdf-chain`, `kem-trap`, `kerberos`, `key-exchange`, `key-mirror`, `kmac-gate`, `kyber-vault`, `kyberslash`, `lattice-builder`, `lattice-fault`, `lattice-gentle`, `lll-break`, `lms-ledger`, `lms-xmss`, `lwe-hints`, `mac-race`, `masked-core`, `matsui-line`, `mayo-seal`, `mceliece-gate`, `merkle-proofs`, `merkle-vault`, `mls-group`, `model-breach`, `mpcith-sign`, `multivariate`, `musig-gate`, `noise-pipe`, `nonce-collision`, `nonce-guard`, `nonce-lattice`, `ntru-classic`, `oblivious-shelf`, `opaque-gate`, `oram-vault`, `ot-gate`, `otp-vault`, `padding-oracle`, `paillier-gate`, `pairing-gate`, `pake-gate`, `patron-shield`, `phantom-vault`, `pki-chain`, `poly1305-mac`, `polynomial-forge`, `power-trace`, `pq-families`, `pq-rotation`, `pq-tls-handshake`, `protocol-checker`, `protocol-compose`, `psi-gate`, `quantum-entropy`, `quantum-vault-kpqc`, `ratchet-wire`, `rekey-relay`, `reshare-circle`, `ring-sign`, `rsa-educational`, `rsa-forge`, `salamander`, `schnorr-forge`, `scloud-vault`, `search-vault`, `sector-vault`, `shadow-vault`, `shamir-gate`, `shamir-vs-frost`, `shelf-oracle`, `shor`, `signed-bytes`, `silent-tally`, `simon-period`, `snark-arena`, `snow2`, `spake-gate`, `spdz-forge`, `sphincs-ledger`, `sphinx-mix`, `ssh-handshake`, `stark-tower`, `stego-suite`, `stream-ward`, `syndrome-drain`, `syndrome-hints`, `threshold-decrypt`, `threshold-mldsa`, `time-lock-puzzle`, `time-trust`, `timing-oracle`, `timing-sidechannel`, `tls-handshake`, `token-tell`, `traitor-trace`, `vdf`, `vigenere-break`, `vrf-gate`, `vss-gate`, `web-of-trust`, `webauthn`, `world-ciphers`, `world-hashes`, `x3dh-wire`, `zk-arena`, `zk-proof-lab`

**Exception:** `snow2` is hosted at its own root — `https://systemslibrarian.github.io/snow2/` — not under the `crypto-lab-{slug}` pattern. It is the only one, and it is declared once, in `DEMO_SITE_EXCEPTIONS` in `index.html`; the source chips and the prompt's link rule are both generated from that map. The exception this paragraph used to name, `steg-arena`, was a demo that no longer exists: its site 404s, the catalog has no card for it, and the corpus has no entry — the surviving steganography demo is `stego-suite`, a normal `crypto-lab-` slug that needs no exception.

## Development

The front-end is a single `index.html` file — no build step required. Open it directly or serve with any static file server. The Cloudflare Worker in `worker/` proxies requests to the Groq API; deploy it with `wrangler deploy` from the `worker/` directory (set the `GROQ_API_KEY` secret and bind a `RATE_LIMITER` rate-limiting namespace).

Before pushing, run the health check:

```
node scripts/validate.mjs
```

It verifies `corpus.json` parses and the front-end model is current (and matches the Worker allowlist). Everything else it checks is one defect class: a **frozen snapshot** — a slug, a URL or a count typed once and never re-derived. So it holds each of these against the corpus by exact set or value comparison, never by substring:

- every `demo_*` id — not just `demo_crypto_lab_*`, the filter that hid `demo_snow2` from every check for as long as it has existed;
- every hardcoded `systemslibrarian.github.io/<slug>/` URL in `index.html` and this README, which must be the live site of a demo that exists (this is what a dead `steg-arena` reference trips on, and an HTTP status check would not: `?cat=` typos on the static-export crypto-compare return 200 while filtering nothing);
- `DEMO_SITE_EXCEPTIONS`, the single table demo links resolve through — every key must be a real demo, and none may restate the default pattern;
- the category and demo-slug lists in this README;
- every corpus count quoted in this README's prose and architecture block, in `algorithms.ts`'s own header, and in the welcome copy `index.html` shows the visitor;
- `algorithms.ts` calls itself a complete mirror, so its ids are held to exact set equality with the corpus's algorithm entries and every entry must carry the full field set. It spent its whole life labelled "PARTIAL SNAPSHOT … only 59 of those algorithms" while holding all 97, and README.md repeated the 59, because no check had ever read either sentence.

**The system prompt is checked by running it, not by reading it.** Its two link
vocabularies are generated from the corpus by `buildLinkRules()`, so there is no
literal list to compare — and when they stopped being literals, the old
`if (line.includes('${')) return;` skipped both assertions and left them inert.
`scripts/app-runtime.mjs` now boots `index.html`'s real script under `node:vm`
and renders the actual prompt string. Exactly what that covers:

- **Exactly one inline `const systemPrompt` declaration, counted across every
  `<script>` block in the file.** Two regexes over `index.html`'s *source text*,
  not a parse, so what they catch is a matter of spelling — stated here rather
  than implied.

  *Which blocks are read.* Every `<script …>` element, whatever attributes its
  opening tag carries; only blocks with a `src=` are skipped, because they have
  no inline body. It used to match the attribute-less `<script>` alone, and that
  was an escape: a second `<script type="module">` block holding its own
  `const systemPrompt` with a frozen list naming a retired demo was counted zero
  times, so the guard saw one block, ran the declaration regex over that block
  only, saw one declaration and exited 0 — while `index.html` shipped two live
  prompts, both of which a browser executes.

  *How a declaration is spelled.* The keyword `const`, one or more whitespace
  characters (space, tab or line break), the identifier `systemPrompt`. Nothing
  after the identifier is looked at, so a second declaration counts whatever it
  is assigned and whatever trails the statement — a `// frozen legacy copy`
  comment after the `;`, two spaces after `const`, a line break before the
  backtick. The match is run twice, over the source and over a copy with every
  `\uXXXX` / `\u{…}` escape decoded, and the larger count wins, because
  `const \u0073ystemPrompt` is legal JavaScript binding the same name while
  containing none of the literal characters. Decoding is used for counting only;
  what gets rendered is always the raw source.

  Any count other than one is a hard failure naming the count, and so is a
  declaration whose value is not a backtick-delimited literal closed by
  `` `; ``, because that one cannot be rendered. A second template appended
  below the real one is a prompt nobody renders; one placed above it is rendered
  *instead of* the real one.
- In the rendered string, **every** line whose colon-terminated label contains
  `category slugs` or `demo slugs` — any prefix, any suffix, any case, so
  `LEGACY demo slugs:` and `demo slugs (legacy):` both count — is held to exact
  set equality with the corpus, and there must be exactly one line of each. The
  separator is a colon followed by any amount of space or tab **including
  none**, so `demo slugs:snow2, …` and a tab after the colon are both read, and
  a colon written as one of a known set of colon-shaped confusables (fullwidth
  `：` among them) is folded to ASCII first. The label must begin the line
  (after indentation) and contain no colon of its own.
- Every `exception:` line that `DEMO_SITE_EXCEPTIONS` requires is present, and
  every concrete `systemslibrarian.github.io/<slug>/` URL in the rendered string
  is the live site of a demo the corpus carries.

The generator is never reimplemented for the check — a second copy of the logic
drifts from the first and then agrees with itself. The same execution asserts
`sourceChipHref()`'s return value for every corpus entry, which is the other
consumer of that table.

### Known blind spots in the prompt check

**This is the known set, not the complete set.** Every entry below was found by
walking through a version of this prose that claimed more than its mechanism
delivered. The previous version of this section presented its enumeration as
*the* list of what escapes; a single adversarial pass then found four escapes it
did not name — a second `<script>` block with attributes, a unicode-escaped
identifier, a fullwidth colon, and a label with a suffix — all four of which
were live. So the honest claim is that these are the holes someone has looked
for and found, not that no others exist. A new one belongs on this list the day
it is found, whether or not it is closed the same day.

Not covered, and each of these currently escapes:

- **A prompt bound some other way** — `let`/`var systemPrompt`, a reassignment
  of the existing binding, a destructuring binding, or a second prompt under a
  different identifier entirely. Only `const systemPrompt` is counted.
- **A comment between the keyword and the name** — `const /*x*/ systemPrompt`.
  The whitespace class does not span a comment.
- **Text concatenated onto `systemPrompt` after the assignment.** That is inside
  the one declaration, so it is not a second template at all, and nothing reads
  it.
- **A second prompt in an external script.** `<script src="…">` blocks are
  skipped by design — they have no inline body to read. If the *only*
  `const systemPrompt` moved into a `.js` file the zero-declaration guard fires,
  so that much is caught; a second one added there alongside the inline one is
  not, because the block count still reads one and the declaration count still
  reads one. This repo ships no external script today.
- **A slug list assembled outside that template** — built into the request
  payload, or added as a second `messages` entry. Only the one rendered template
  is read.
- **The retrieved context**, which is rendered as a placeholder.
- **A slug list introduced mid-line after another colon** — `Note: LEGACY demo
  slugs: …` — or one whose values sit on the following line. The label must
  start the line and hold no colon of its own.
- **A colon confusable outside the known set**, or a homoglyph inside the words
  `demo slugs` themselves. The fold covers eight colon-shaped characters; it is
  not a general Unicode-confusables normalisation.
- **An attribute value containing a literal `>`**, which truncates the opening
  `<script` tag for the block matcher.

Two over-matches are deliberate, and both fail closed — a spurious count is a
loud error, never a silent skip: `const systemPrompt` written inside a comment
or a string literal is counted, and so is a `\\u0073` inside a string literal
that the decoder treats as an escape.

Everything named above as *closed* is closed by mechanism, not by memory:
`node scripts/mutations.mjs` replays each one. See
[Mutation set](#mutation-set).

It also holds the two reference docs to the corpus: `crypto_lab_readme` must list every demo entry exactly once, and each demo it features must have an entry — that doc is a prose snapshot of the catalog, and nothing checked it until it had fallen 97 demos behind. `crypto_compare_readme` quotes a sibling repo's totals, so the check reads that repo: see [Running the validator](#running-the-validator) for why an absent checkout is an error rather than a skip. CI runs the same check and **the GitHub Pages deploy will not run unless it passes**.

## Mutation set

```
node scripts/mutations.mjs
```

Every assertion in `scripts/validate.mjs` was justified, when it landed, by a
defect fixture: a deliberate break the check is supposed to catch. Those
fixtures used to live in commit messages, which is to say they were run once and
then never again — and a check that has quietly stopped being able to fail still
reads as coverage, which is this project's recurring failure one level up. So
they live in `scripts/mutations.mjs` and get replayed.

Each fixture is applied to a throwaway copy of the tree under the OS temp
directory, and the copy's own `scripts/validate.mjs` is run against it. A
fixture counts as caught only if the validator exits non-zero **and** its output
matches that fixture's expected reason — exit code alone would let a copy that
cannot see crypto-compare fail everything for the wrong reason and read as total
coverage. An unmutated copy runs first and must pass, or the whole run aborts
rather than reporting a screenful of false positives. Nothing outside the temp
copy is written; crypto-compare is located once and read exactly as the
validator reads it.

`--tree <path>` points the harness at another checkout, which is what makes it a
matrix rather than a checklist: a fixture that fails on both an old tree and a
new one proves nothing about the change, and running both is the only way to
tell that apart from one that genuinely flips. `--only M13,M14` selects a
subset; `--keep` leaves the copies behind to inspect.

M1–M9 are the fixtures from the commits that built the reference-doc,
live-link, generator-output and cross-repo-count checks. M10–M12 are the two
extra-template defects and the alternate-label slug list that `d2415f0` closed.
M13–M17 are the five spellings an adversarial audit of `d2415f0` walked through:
a second template with a trailing comment; a `LEGACY demo slugs:` list with no
space after the colon; and three more ways to space a declaration — two spaces
after `const`, a line break before the backtick, and a line break between
`const` and the identifier. All five passed `d2415f0` with a retired slug live
in the code path, and all five fail now.

M18–M21 are four escapes a later audit found in `59015a9`: a second
`<script type="module">` block carrying its own prompt (M18); a declaration
whose identifier is spelled `\u0073ystemPrompt` (M19); a `LEGACY demo slugs`
label separated by a fullwidth colon (M20); and a `demo slugs (legacy):` label,
which starts with the matched words but carries a suffix (M21). M22 is that same
suffix hole on the category list, found while closing M21. All five passed
`59015a9`. M20 and M21 were verified by rendering the prompt on that tree: the
retired slug is in the string the model is sent. M18 puts it in a second prompt
the page also executes, and M19 in a second prompt appended to the same block.
All five fail now.

## License

See repository for license details.

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
