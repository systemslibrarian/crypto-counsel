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

const SCRIPT_RE = /<script>\n([\s\S]*?)\n<\/script>/g;

// The `const systemPrompt = \`…\`;` assignment inside ask(). Lifted verbatim so
// the harness renders the same string the model is sent, not a paraphrase of
// it — a frozen list re-added to the prompt template OUTSIDE buildLinkRules()
// would otherwise be invisible to every assertion.
const SYSTEM_PROMPT_RE = /\n(\s*const systemPrompt = `[\s\S]*?`;)\n/;

/**
 * Boot index.html's script under a DOM shim and hand back its real internals.
 * Throws on anything that would leave the harness asserting against a stub.
 */
export function loadApp(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');

  const blocks = [...html.matchAll(SCRIPT_RE)].map((m) => m[1]);
  if (blocks.length !== 1) {
    throw new Error(
      `expected exactly one <script> block in ${htmlPath}, found ${blocks.length} — ` +
        'the harness must run the whole app script, so update app-runtime.mjs deliberately',
    );
  }
  const source = blocks[0];

  const promptMatch = SYSTEM_PROMPT_RE.exec(source);
  if (!promptMatch) {
    throw new Error(
      'could not find the `const systemPrompt = `…`;` template in index.html — ' +
        'the system prompt must stay a single template literal so it can be rendered and checked',
    );
  }

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
${promptMatch[1]}
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
