// Executes index.html's real front-end script headlessly, so scripts/validate.mjs
// can assert on what the app actually GENERATES rather than on what its source
// text looks like.
//
// Why this exists. The system prompt's two link vocabularies (category slugs,
// demo slugs) used to be frozen literals, and validate.mjs held them to set
// equality with the corpus. When they were replaced by buildLinkRules(), the
// lines that carried them became template literals containing `${`, and the
// checker's `if (line.includes('${')) return;` guard turned both assertions off
// permanently. Nothing then looked at the generator's OUTPUT, so reverting
// buildLinkRules()' corpus filter to `demo_crypto_lab_` — which silently drops
// snow2 from the prompt and sends the model back to emitting the 404ing
// `crypto-lab-snow2` URL — left the validator green. Same for sourceChipHref().
//
// The rule this module encodes: never reimplement the generator here. A second
// copy of the logic drifts from the first and then cheerfully asserts against
// itself. So the actual `<script>` block is lifted out of index.html verbatim
// and run under node:vm against a minimal DOM shim, and the callers below hand
// back the real functions and the real system-prompt template.
//
// Dependency-free, like validate.mjs — node's own vm module only.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// A DOM stub broad enough for the app's boot path. The script only ever reaches
// for document.getElementById / createElement, localStorage, window.location,
// navigator.clipboard, fetch and setTimeout (verified by grep over the block),
// so this stays deliberately small: anything the app starts using that is NOT
// here throws, which surfaces as a loud harness failure rather than a silent
// half-executed script.
function makeElement() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    children: [],
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    id: '',
    href: '',
    scrollTop: 0,
    scrollHeight: 0,
    disabled: false,
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    focus() {},
    remove() {},
    closest: () => null,
    scrollIntoView() {},
  };
  return el;
}

function makeContext() {
  const store = new Map();
  const doc = {
    getElementById: () => makeElement(),
    createElement: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeElement(),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: doc,
    // Never settles: the app's corpus fetch must not race the harness. The
    // corpus is injected synchronously by load() below instead.
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    URLSearchParams,
    TextDecoder,
    AbortController,
    URL,
    Promise,
    JSON,
    Math,
    Date,
    Object,
    Array,
    Set,
    Map,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.location = { search: '', href: 'https://crypto-counsel.systemslibrarian.dev/', hash: '' };
  ctx.window.location = ctx.location;
  return ctx;
}

// Every INLINE <script> block in the file, whatever attributes its opening tag
// carries. Group 1 is the attribute text, group 2 the body.
//
// It used to be `/<script>\n([\s\S]*?)\n<\/script>/g` — attribute-less only —
// and that was the escape. A second `<script type="module">` block, holding its
// own `const systemPrompt` template with a frozen list naming a retired demo,
// was invisible to it: the count guard below saw 1, the declaration regex ran
// over the attribute-less block alone and saw 1, the validator exited 0, and
// index.html shipped TWO live prompts, both of which a browser executes. That
// is fixture M18 in scripts/mutations.mjs.
//
// Blocks with a `src=` attribute are the one exclusion, because they have no
// inline body — nothing to run and nothing to search. Everything else counts.
//
// This is still a text match over HTML, not a parse, so: an attribute value
// containing a literal `>` truncates the opening tag, and `<script` written
// inside a comment or a JS string is counted. Both fail toward a wrong count,
// which is a loud error rather than a silent skip.
const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SCRIPT_SRC_ATTR_RE = /(?:^|\s)src\s*=/i;

// Identifiers may be spelled with unicode escapes: `const \u0073ystemPrompt`
// is legal JavaScript, binds the very same `systemPrompt`, and contains none of
// the literal characters SYSTEM_PROMPT_DECL_RE looks for. So the declaration
// count is taken over a decoded copy of the source as well as the raw text, and
// the LARGER of the two wins. That is fixture M19.
//
// Only the two identifier-legal forms are decoded (`\uXXXX` and `\u{...}`);
// `\xNN` is not valid in an identifier. Decoding is used for COUNTING only —
// what gets rendered is always the raw source — and it over-decodes, since a
// `\\u0073` inside a string literal is not an escape at all. That direction is
// deliberate: it can only invent an extra declaration, which fails closed.
const decodeIdentifierEscapes = (src) =>
  src
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, hex) => {
      const cp = parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));

// The `const systemPrompt = \`…\`;` assignment inside ask(). Lifted verbatim so
// the harness renders the same string the model is sent, not a paraphrase of
// it.
//
// Both regexes below are matches over index.html's <script> SOURCE TEXT, not
// over a parsed AST, so what they can and cannot see is a property of spelling
// and is spelled out here rather than described in the abstract.
//
// Why two, and why the count is asserted: a non-global non-greedy regex renders
// the FIRST such template and only that one, and both directions of that were
// exploitable — a second `const systemPrompt` code path appended BELOW the real
// one, carrying a frozen slug list with a retired demo in it, was never read at
// all, and a decoy template placed ABOVE the real one was rendered in its place,
// leaving the string the model is actually sent unexamined. Neither turned
// anything red.
//
// The earlier fix for that anchored the match to a whole LINE — `\n`, then
// `[ \t]*const systemPrompt = \`` verbatim, and a closing `\`;` that had to be
// followed immediately by a newline or EOF. An audit walked straight through it,
// because each of these is a different spelling of the same declaration and the
// line anchor saw none of them: a trailing comment after the `;`
// (`\`; // frozen legacy copy`), two spaces after `const`, and a line break
// between `=` and the backtick. Each left the second template uncounted and the
// validator green, with a frozen slug list naming a retired demo in live code.
// They are fixtures M13, M15 and M16 in scripts/mutations.mjs now.
//
// So the anchor is the DECLARATION now, not the line.
//
// SYSTEM_PROMPT_DECL_RE is what the count comes from. It matches, in source
// text: the keyword `const`, one or more WHITESPACE characters (spaces, tabs or
// a line break), and the identifier `systemPrompt` — with `const` not preceded
// by an identifier character or a `.`, and `systemPrompt` not followed by one.
// It looks at nothing after the identifier, so a second declaration counts
// however it is assigned and whatever trails the statement: a comment, more
// code on the same line, or nothing at all.
//
// What it does NOT match, stated because a text match's blind spots are the
// whole risk: a prompt bound any other way — `let`/`var systemPrompt`, a
// reassignment of the existing one, a destructuring binding, or a second prompt
// under a different identifier; a comment sitting between `const` and the name
// (`const /*x*/ systemPrompt`); and text concatenated onto systemPrompt after
// the assignment, which is inside the one declaration and so is not a second
// template at all — nothing here or in validate.mjs reads it.
//
// It over-matches in one direction, on purpose: `const systemPrompt` written
// inside a comment or a string literal is counted, because a text match cannot
// tell the difference. That fails closed — a spurious 2 is a loud error, never
// a silent skip.
const SYSTEM_PROMPT_DECL_RE = /(?<![$\w.])const\s+systemPrompt(?![$\w])/g;

// SYSTEM_PROMPT_RE is what gets RENDERED: the whole statement, from the `const`
// keyword to the first `\`;` at or after the opening backtick. `\s*` on both
// sides of the `=` tolerates any spacing, line breaks included, and nothing
// whatsoever is required after the `;`. Its count is asserted separately from
// the declaration count, so a lone `const systemPrompt` that is NOT assigned a
// backtick-delimited literal closed by `\`;` — a string concatenation, a
// function call, a template closed on a later line by something else — is a
// hard failure rather than a silently unrendered prompt.
const SYSTEM_PROMPT_RE = /(?<![$\w.])const\s+systemPrompt\s*=\s*`[\s\S]*?`;/g;

/**
 * Boot index.html's script under a DOM shim and hand back its real internals.
 * Throws on anything that would leave the harness asserting against a stub.
 */
export function loadApp(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');

  const blocks = [...html.matchAll(SCRIPT_TAG_RE)]
    .filter((m) => !SCRIPT_SRC_ATTR_RE.test(m[1]))
    .map((m) => m[2]);
  if (blocks.length !== 1) {
    throw new Error(
      `expected exactly one inline <script> block in ${htmlPath}, found ${blocks.length} — ` +
        'every <script> is counted whatever attributes it carries, and only blocks with a src= ' +
        '(which have no inline body) are skipped, because a second block executes in the browser ' +
        'and would be a prompt nothing here reads. The harness must run the whole app script, ' +
        'so update app-runtime.mjs deliberately',
    );
  }
  const source = blocks[0];

  const countDecls = (text) => [...text.matchAll(SYSTEM_PROMPT_DECL_RE)].length;
  const declCount = Math.max(countDecls(source), countDecls(decodeIdentifierEscapes(source)));
  if (declCount === 0) {
    throw new Error(
      `found 0 \`const systemPrompt\` declarations in ${htmlPath} — ` +
        'the system prompt must stay a single template literal so it can be rendered and checked',
    );
  }
  if (declCount > 1) {
    throw new Error(
      `found ${declCount} \`const systemPrompt\` declarations in ${htmlPath}, expected exactly 1 — ` +
        'the harness can only render one, so every extra one is a prompt nobody checked. ' +
        'Delete the extras, or make the harness pick deliberately',
    );
  }

  const promptMatches = [...source.matchAll(SYSTEM_PROMPT_RE)];
  if (promptMatches.length !== 1) {
    throw new Error(
      `${htmlPath} holds 1 \`const systemPrompt\` declaration but ${promptMatches.length} ` +
        '`const systemPrompt = `…`;` template-literal statement(s), expected exactly 1 — ' +
        'the prompt must be assigned a template literal closed by "`;" so it can be lifted out and rendered',
    );
  }
  // [0] is the whole `const systemPrompt = `…`;` statement: SYSTEM_PROMPT_RE
  // carries no capture group, because the leading indentation the old one
  // captured was never used for anything.
  const promptStatement = promptMatches[0][0];

  // Appended to the SAME script source, so it shares the top-level lexical
  // scope and can see `let corpus`, buildIndex(), buildLinkRules() and friends
  // (vm does not expose top-level let/const as context properties).
  // renderSystemPrompt embeds the assignment verbatim, with `context` as a
  // parameter — the identifier the real template already interpolates.
  const epilogue = `
;globalThis.__app = {
  DEMO_SITE_EXCEPTIONS: DEMO_SITE_EXCEPTIONS,
  demoSlugFromId: demoSlugFromId,
  demoSiteUrl: demoSiteUrl,
  sourceChipHref: sourceChipHref,
  buildLinkRules: buildLinkRules,
  renderSystemPrompt: function (context) {
${promptStatement}
    return systemPrompt;
  },
  load: function (data) { corpus = data; buildIndex(); }
};
`;

  const ctx = createContext(makeContext());
  runInContext(source + epilogue, ctx, { filename: `${htmlPath}#script`, timeout: 30000 });

  const app = ctx.__app;
  if (!app || typeof app.buildLinkRules !== 'function') {
    throw new Error('index.html script ran but did not expose buildLinkRules — harness epilogue is out of date');
  }
  return app;
}
