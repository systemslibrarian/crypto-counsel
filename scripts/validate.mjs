// Repo health check — no dependencies, run with `node scripts/validate.mjs`.
// Gates the GitHub Pages deploy: catches a broken corpus, a deprecated/unknown
// model, and drift between the corpus and everything in this repo that names a
// demo, a category, or a count (the failure modes this project has actually
// hit).
//
// The defect class this file exists to kill is the FROZEN SNAPSHOT: a slug, a
// URL or a number typed once into prose or into the system prompt, which then
// rots silently because nothing re-derives it. Every assertion below therefore
// compares a written-down thing against the corpus, never against another
// written-down thing.

import { existsSync, readFileSync } from 'node:fs';
import { loadApp } from './app-runtime.mjs';

const errors = [];
const fail = (msg) => errors.push(msg);

// Models we consider current/supported. Update intentionally when migrating.
const SUPPORTED_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
// Models Groq has retired — must never appear anywhere in the app.
const DEPRECATED_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

// crypto-compare's /labs index counts the unique crypto-lab demos reachable
// from its algorithm reference: `LABS.length` in src/components/LabsView.tsx,
// i.e. buildLabIndex() over src/data/demoResources.ts. `crypto_compare_readme`
// states that figure in prose, twice, and this file is the only thing that can
// contradict it.
//
// It used to be a typed constant, `COMPARE_LINKED_DEMOS = 192`, re-derived from
// the sibling checkout only `if (existsSync(...))`. That made the guard inert
// in the one place it runs unattended: CI has no crypto-compare checkout, so a
// drift to 193 sailed through green — a check that is skipped exactly where it
// matters is not a check. There is no constant now. The count is derived from
// crypto-compare's own source, and an absent checkout is a hard failure rather
// than a skip, because "we could not look" must never read as "it is fine".
// CI supplies the checkout (see .github/workflows/pages.yml); a different
// location can be pointed at with CRYPTO_COMPARE_DIR.
const COMPARE_DIRS = [
  process.env.CRYPTO_COMPARE_DIR,
  '../crypto-compare',
  'vendor/crypto-compare', // where CI checks it out
].filter(Boolean).map((d) => (d.endsWith('/') ? d : `${d}/`));
const COMPARE_DEMO_RESOURCES = 'src/data/demoResources.ts';
const COMPARE_CATEGORIES = 'src/data/categories.ts';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const sibling = (p) => new URL(p, root);

// --- crypto-compare, located and read before anything asserts against it ---
const compareRoot = COMPARE_DIRS.find((d) => existsSync(sibling(d + COMPARE_DEMO_RESOURCES)));
let compareLinkedDemos = null;
if (!compareRoot) {
  fail(
    'crypto-compare is not checked out anywhere this script can see, so its linked-demo count ' +
      'cannot be derived and the crypto_compare_readme prose is unverifiable. Looked in: ' +
      `${COMPARE_DIRS.join(', ')}. Clone it beside this repo, or set CRYPTO_COMPARE_DIR. ` +
      'This is deliberately fatal: skipping on absence is how the old pinned constant went inert in CI.',
  );
} else {
  const src = readFileSync(sibling(compareRoot + COMPARE_DEMO_RESOURCES), 'utf8');
  const slugs = new Set(
    [...src.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1].match(/\/(crypto-lab-[a-z0-9-]+)\/?$/)?.[1]).filter(Boolean),
  );
  if (slugs.size === 0) {
    fail(
      `${compareRoot}${COMPARE_DEMO_RESOURCES} parsed to 0 crypto-lab demo URLs — the extraction regex ` +
        'has stopped matching that file. Fix the regex; do not edit the prose to agree with 0.',
    );
  } else {
    compareLinkedDemos = slugs.size;
  }
}

// --- corpus.json ---
let corpus = [];
try {
  corpus = JSON.parse(read('corpus.json'));
} catch (e) {
  fail(`corpus.json is not valid JSON: ${e.message}`);
}

if (!Array.isArray(corpus) || corpus.length === 0) {
  fail('corpus.json must be a non-empty array');
}

const ids = new Set();
for (const [i, e] of corpus.entries()) {
  if (!e || typeof e.id !== 'string' || typeof e.text !== 'string') {
    fail(`corpus entry ${i} must have string id and text`);
    continue;
  }
  if (ids.has(e.id)) fail(`duplicate corpus id: ${e.id}`);
  ids.add(e.id);
}

const REFERENCE_DOCS = ['crypto_lab_readme', 'crypto_compare_readme'];

// The corpus is the single source of truth for what demos exist. NOTE: every
// `demo_*` id counts, not just `demo_crypto_lab_*`. The old version of this
// file filtered on the longer prefix, which made `demo_snow2` invisible to
// every check below — snow2 was absent from the system prompt's slug list for
// as long as it has existed, and nothing went red.
const demoEntries = corpus.filter((e) => typeof e.id === 'string' && e.id.startsWith('demo_'));
const demoSlug = (id) => id.replace(/^demo_(?:crypto_lab_)?/, '').replace(/_/g, '-');
const demoSlugs = demoEntries.map((e) => demoSlug(e.id)).sort();
const demoSlugSet = new Set(demoSlugs);

// index.html's buildLinkRules() partitions the corpus by the same two rules
// (`demo_` prefix, `_readme` suffix). Pin that so the runtime derivation and
// this check cannot start disagreeing about what an algorithm entry is.
for (const id of REFERENCE_DOCS) {
  if (!id.endsWith('_readme')) fail(`reference doc "${id}" must end in _readme — index.html partitions the corpus on that suffix`);
}

const algorithmEntries = corpus.filter(
  (e) => typeof e.id === 'string' && !e.id.startsWith('demo_') && !REFERENCE_DOCS.includes(e.id),
);

// The category vocabulary crypto-compare accepts, derived from the corpus's own
// algorithm entries rather than retyped. A `?cat=` value outside this set lands
// on an unfiltered page while still returning HTTP 200, so status codes cannot
// police it — only set comparison can.
const corpusCategories = [...new Set(
  algorithmEntries.map((e) => e.text.match(/^Category:\s*(.+)$/m)?.[1].trim().toLowerCase()).filter(Boolean),
)].sort();

// --- index.html ---
const html = read('index.html');

const modelMatch = html.match(/const MODEL = '([^']+)'/);
if (!modelMatch) {
  fail('could not find `const MODEL` in index.html');
} else if (!SUPPORTED_MODELS.has(modelMatch[1])) {
  fail(`index.html MODEL "${modelMatch[1]}" is not in the supported set: ${[...SUPPORTED_MODELS].join(', ')}`);
}

for (const dep of DEPRECATED_MODELS) {
  if (html.includes(dep)) fail(`index.html still references deprecated model "${dep}"`);
}

// --- worker model allowlist must include the model the front-end sends ---
const worker = read('worker/index.js');
if (modelMatch && !worker.includes(`'${modelMatch[1]}'`)) {
  fail(`worker MODEL_ALLOWLIST is missing the front-end model "${modelMatch[1]}"`);
}

const readme = read('README.md');

// --- demo link resolution has exactly one table ---
// Source chips and the system prompt's link rule are both generated from
// DEMO_SITE_EXCEPTIONS in index.html. A second, hand-written exception
// elsewhere is how `steg-arena` survived its own deletion: the demo was gone
// from the catalog and from the corpus and its site 404'd, while two hardcoded
// branches and a README paragraph kept pointing at it.
const exceptions = new Map();
const exceptionsBlock = html.match(/const DEMO_SITE_EXCEPTIONS = \{([\s\S]*?)\};/);
if (!exceptionsBlock) {
  fail('index.html has no `const DEMO_SITE_EXCEPTIONS` map — demo link resolution must have exactly one table');
} else {
  for (const m of exceptionsBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) exceptions.set(m[1], m[2]);
  for (const [slug, url] of exceptions) {
    if (!demoSlugSet.has(slug)) {
      fail(`DEMO_SITE_EXCEPTIONS names "${slug}", which is not a demo in the corpus`);
    }
    if (url === `https://systemslibrarian.github.io/crypto-lab-${slug}/`) {
      fail(`DEMO_SITE_EXCEPTIONS entry "${slug}" is not an exception — it repeats the default pattern`);
    }
  }
}

const demoUrl = (slug) => exceptions.get(slug) || `https://systemslibrarian.github.io/crypto-lab-${slug}/`;
const validDemoUrls = new Set(demoSlugs.map(demoUrl));

// --- every hardcoded demo URL must resolve to a demo that exists ---
// Template forms (`crypto-lab-${slug}/`, `crypto-lab-<demo-slug>/`) are skipped
// because the trailing `/` cannot follow an interpolation marker.
// The corpus's own prose counts too: every entry carries a "Live Demo" link,
// and that is the other place a retired demo's URL would sit unnoticed.
const corpusProse = corpus.map((e) => (typeof e.text === 'string' ? e.text : '')).join('\n');
for (const [file, text] of [['index.html', html], ['README.md', readme], ['corpus.json', corpusProse]]) {
  const seen = new Set();
  for (const m of text.matchAll(/https:\/\/systemslibrarian\.github\.io\/[a-z0-9][a-z0-9.-]*\//g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    if (!validDemoUrls.has(m[0])) fail(`${file} links to ${m[0]}, which is not the live site of any corpus demo`);
  }
}

// --- the system prompt the model is ACTUALLY sent ---
// These two vocabularies used to be frozen literals in the prompt, checked
// here against the corpus. Replacing them with buildLinkRules() was the right
// fix and it turned the check off: the lines became template literals holding
// `${`, and this block's `if (line.includes('${')) return;` early-return skipped
// them from that day on. Nothing looked at the generator's output, so reverting
// buildLinkRules()' filter to `demo_crypto_lab_` — which drops snow2 from the
// prompt and sends the model back to the 404ing `crypto-lab-snow2` URL — left
// the validator green and the deploy shipping.
//
// So the source text is no longer what gets read. index.html's script is
// executed headlessly (scripts/app-runtime.mjs) and the assertions below run
// against the rendered prompt string — the one `const systemPrompt` template
// index.html is allowed to hold, with a placeholder standing in for the
// retrieved context. What that buys: a frozen list re-added to THAT template
// outside buildLinkRules() lands in the rendered string, so the set equality
// below reads it. What it does not buy: a list assembled anywhere else. A
// second template is kept out by app-runtime.mjs failing on the count, not by
// anything here; text concatenated onto systemPrompt after the assignment is
// not covered at all.
// Checks EVERY occurrence of the line, and requires there to be exactly one.
// Taking only the first match would let a second, frozen copy be appended below
// the generated one and never be read — which is the same class of hole as the
// `${` early-return this replaces, just one layer in.
//
// `labelPattern` is a regex source matched, case-insensitively, against the
// whole colon-terminated label — not the literal label text. Anchoring on the
// exact label was the remaining hole one layer further in: `LEGACY demo slugs:
// snow2, aes-modes, steg-arena` inserted a line above FORMAT sits in the string
// the model is sent, and `^\s*demo slugs: ` cannot see it, so the model was
// handed a retired slug with the validator green. Every line whose label
// matches is held to the same set equality, and there must still be exactly one
// of them.
//
// The separator is a colon followed by any amount of space or tab, including
// none — `demo slugs:snow2, …` and a tab after the colon are both read. It used
// to demand a literal colon-SPACE, which an audit walked through by deleting one
// character: the no-space form is in the rendered prompt the model is sent, and
// was matched by nothing. The line must still be one line — `[ \t]*`, not `\s*`,
// so a value on the NEXT line is not swept up as if it were on this one, and a
// label with an empty value still reads as "no such line".
const listCheck = (labelPattern, text, expected, where) => {
  const matches = [...text.matchAll(new RegExp(`^[ \\t]*(${labelPattern}):[ \\t]*(.+)$`, 'gmi'))];
  if (matches.length === 0) {
    fail(`${where} has no line whose label matches /${labelPattern}/i`);
    return;
  }
  if (matches.length > 1) {
    fail(
      `${where} carries ${matches.length} lines whose label matches /${labelPattern}/i ` +
        `(${matches.map((m) => m[1].trim()).join(' | ')}) — there must be exactly one, generated from the corpus`,
    );
  }
  for (const m of matches) {
    const label = m[1].trim();
    const got = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const gotSet = new Set(got);
    const missing = expected.filter((s) => !gotSet.has(s));
    const extra = got.filter((s) => !expected.includes(s));
    if (missing.length) fail(`${where} "${label}" is missing ${missing.length}: ${missing.join(', ')}`);
    if (extra.length) fail(`${where} "${label}" lists ${extra.length} unknown value(s): ${extra.join(', ')}`);
  }
};

let app = null;
try {
  app = loadApp(sibling('index.html'));
  app.load(corpus);
} catch (e) {
  fail(`could not run index.html's script headlessly: ${e.message}`);
}

if (app) {
  let prompt = null;
  try {
    prompt = app.renderSystemPrompt('RETRIEVED CONTEXT PLACEHOLDER');
  } catch (e) {
    fail(`index.html's system prompt template threw when rendered: ${e.message}`);
  }

  if (prompt) {
    // A literal `${` surviving into the rendered prompt means a template was
    // nested into a plain string somewhere and the model is being handed
    // source code instead of a vocabulary.
    if (prompt.includes('${')) {
      fail('the generated system prompt contains an uninterpolated "${" — the model would be sent template source');
    }

    listCheck('category slugs', prompt, corpusCategories, 'generated system prompt');
    // Any label ending in "demo slugs", whatever precedes it: `LEGACY demo
    // slugs:`, `OLD demo slugs:`, `Demo slugs:`. A second slug list under a
    // different name is still a slug list the model reads.
    listCheck('[^:]*demo slugs', prompt, demoSlugs, 'generated system prompt');

    // Every deviating demo must be spelled out to the model. Listing a slug
    // whose site is NOT the default pattern, without also telling the model
    // where it really lives, is exactly the snow2 defect.
    for (const [slug, url] of exceptions) {
      if (!prompt.includes(`exception: ${slug} → ${url}`)) {
        fail(
          `the generated system prompt never tells the model that "${slug}" lives at ${url} — ` +
            'without that line the model builds the default crypto-lab URL, which 404s',
        );
      }
    }

    // And every concrete URL the prompt hands the model must be a demo that
    // exists. Template forms (`crypto-lab-<demo-slug>/`) do not match: `<` is
    // outside the character class.
    const seenPromptUrls = new Set();
    for (const m of prompt.matchAll(/https:\/\/systemslibrarian\.github\.io\/[a-z0-9][a-z0-9.-]*\//g)) {
      if (seenPromptUrls.has(m[0])) continue;
      seenPromptUrls.add(m[0]);
      if (!validDemoUrls.has(m[0])) {
        fail(`the generated system prompt tells the model to link ${m[0]}, which is not the live site of any corpus demo`);
      }
    }
  }

  // --- source chips resolve through the same one table ---
  // sourceChipHref() is the other consumer of DEMO_SITE_EXCEPTIONS, and it had
  // the same defect independently: with the branch filtering on
  // `demo_crypto_lab_`, demo_snow2 fell through to the algorithm branch and its
  // chip pointed at the crypto-compare homepage. Assert the real function's
  // return value for every entry, not the shape of its source.
  //
  // First confirm the regex-parsed exception table above IS the map the app
  // uses — if that parse ever yields nothing, `demoUrl` silently returns the
  // default for everything and this whole section would agree with itself.
  const realExceptions = new Map(Object.entries(app.DEMO_SITE_EXCEPTIONS || {}));
  for (const [slug, url] of realExceptions) {
    if (exceptions.get(slug) !== url) {
      fail(`DEMO_SITE_EXCEPTIONS at runtime maps ${slug} → ${url}, but this script parsed ${exceptions.get(slug) ?? '(nothing)'}`);
    }
  }
  for (const slug of exceptions.keys()) {
    if (!realExceptions.has(slug)) fail(`this script parsed an exception for "${slug}" that the running app does not have`);
  }

  for (const e of demoEntries) {
    const want = demoUrl(demoSlug(e.id));
    const got = app.sourceChipHref({ id: e.id });
    if (got !== want) fail(`index.html sourceChipHref("${e.id}") returns ${got}; that demo's live site is ${want}`);
  }

  const COMPARE_BASE = 'https://crypto-compare.systemslibrarian.dev/';
  for (const e of [...algorithmEntries, ...corpus.filter((c) => REFERENCE_DOCS.includes(c.id))]) {
    const got = app.sourceChipHref({ id: e.id });
    if (!got.startsWith(COMPARE_BASE)) {
      fail(`index.html sourceChipHref("${e.id}") returns ${got}; a non-demo entry must link to crypto-compare`);
      continue;
    }
    const cat = new URL(got).searchParams.get('cat');
    if (cat !== null && !corpusCategories.includes(cat)) {
      fail(`index.html sourceChipHref("${e.id}") links ?cat=${cat}, which is not a category the corpus uses`);
    }
  }
}

// --- README bookkeeping ---
// Substring matching used to stand in for membership here. It cannot tell a
// listed slug from an incidental word: `vdf`, `shor`, `grover`, `e91`, `fte`,
// `hawk` and `kerberos` all read as "present" out of ordinary prose, so the
// list could lose entries without the check noticing.
const readmeCategoryLine = readme.match(/^\*\*Category slugs:\*\*\s*(.+)$/m);
if (!readmeCategoryLine) {
  fail('README.md has no "**Category slugs:**" line');
} else {
  const listed = [...readmeCategoryLine[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const listedSet = new Set(listed);
  const missing = corpusCategories.filter((c) => !listedSet.has(c));
  const extra = listed.filter((c) => !corpusCategories.includes(c));
  if (missing.length) fail(`README.md category slugs missing ${missing.length}: ${missing.join(', ')}`);
  if (extra.length) fail(`README.md category slugs list ${extra.length} unknown value(s): ${extra.join(', ')}`);
}

const readmeSlugHeading = readme.match(/^\*\*Demo slugs\*\* \((\d+)\):\s*(.+)$/m);
if (!readmeSlugHeading) {
  fail('README.md has no "**Demo slugs** (N):" line');
} else {
  const listed = [...readmeSlugHeading[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const listedSet = new Set(listed);
  const missing = demoSlugs.filter((s) => !listedSet.has(s));
  const extra = listed.filter((s) => !demoSlugSet.has(s));
  if (missing.length) fail(`README.md demo slugs missing ${missing.length}: ${missing.join(', ')}`);
  if (extra.length) fail(`README.md demo slugs list ${extra.length} unknown slug(s): ${extra.join(', ')}`);
  if (Number(readmeSlugHeading[1]) !== listed.length) {
    fail(`README.md says "Demo slugs (${readmeSlugHeading[1]})" but lists ${listed.length}`);
  }
}

// Every count in the README is a snapshot of the corpus. Assert each against
// the corpus so none of them can drift on its own.
const counts = {
  total: corpus.length,
  algorithms: algorithmEntries.length,
  demos: demoEntries.length,
  cryptoLab: demoEntries.filter((e) => e.id.startsWith('demo_crypto_lab_')).length,
  referenceDocs: REFERENCE_DOCS.length,
};
counts.standalone = counts.demos - counts.cryptoLab;

// `where` names the file so the same helper can police counts wherever they
// are written down; README.md is merely the commonest place. `occurrences`
// pins how many times the line must appear, because a count duplicated across
// two live-served copies can drift in one of them (index.html states its
// algorithm total twice — once in the static welcome block, once in the
// rehydrate template — and only the first was ever visible to a reader).
const countIn = (where, text, re, expected, what, occurrences = 1) => {
  const found = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))];
  if (found.length !== occurrences) {
    fail(`${where} has ${found.length} "${what}" line(s) to check against the corpus; expected ${occurrences}`);
    return;
  }
  for (const m of found) {
    m.slice(1).forEach((got, i) => {
      if (Number(got) !== expected[i]) fail(`${where} "${what}" says ${got}, corpus has ${expected[i]}`);
    });
  }
};

const numberCheck = (re, expected, what) => countIn('README.md', readme, re, expected, what);

numberCheck(/RAG corpus of (\d+) algorithms/, [counts.algorithms], 'RAG corpus of N algorithms');
numberCheck(
  /`corpus\.json` \((\d+) entries: (\d+) algorithms, (\d+) demo cards, (\d+) reference docs\)/,
  [counts.total, counts.algorithms, counts.demos, counts.referenceDocs],
  'corpus.json (N entries: ...)',
);
numberCheck(/RAG corpus — (\d+) entries:/, [counts.total], 'architecture: RAG corpus — N entries');
numberCheck(/^\s*(\d+) algorithm entries$/m, [counts.algorithms], 'architecture: N algorithm entries');
numberCheck(
  /^\s*(\d+) crypto-lab demo cards \+ (\d+) standalone demo/m,
  [counts.cryptoLab, counts.standalone],
  'architecture: N crypto-lab demo cards + N standalone',
);
numberCheck(/^\s*(\d+) reference docs \(/m, [counts.referenceDocs], 'architecture: N reference docs');

// --- algorithms.ts describes itself, and the description must be true ---
// Its header claimed "PARTIAL SNAPSHOT … currently covers only 59 of those
// algorithms" and README.md repeated the 59. The file holds 97 ids, unique, an
// exact set match against the corpus's 97 algorithm entries, every rich field
// populated — so both the adjective and the digits were wrong, from the day
// they were written, on a file GitHub Pages serves. No regex here matched
// either sentence, which is why it survived three passes over this repo.
//
// Both numbers are now derived twice over: against the ids in algorithms.ts
// itself and against corpus.json. The word "complete" is not taken on trust
// either — the set comparison below is what makes it a claim rather than an
// adjective.
const algorithmsTs = read('algorithms.ts');
const tsAlgorithmIds = [...algorithmsTs.matchAll(/^\s*\{\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
const tsIdSet = new Set(tsAlgorithmIds);

if (tsAlgorithmIds.length === 0) {
  fail('algorithms.ts parsed to 0 algorithm entries — the id extraction has broken; fix it, do not restate the count');
} else {
  if (tsIdSet.size !== tsAlgorithmIds.length) {
    fail(`algorithms.ts holds ${tsAlgorithmIds.length} entries but only ${tsIdSet.size} unique ids`);
  }
  const corpusAlgIds = new Set(algorithmEntries.map((e) => e.id));
  const notInCorpus = [...tsIdSet].filter((id) => !corpusAlgIds.has(id));
  const notInTs = [...corpusAlgIds].filter((id) => !tsIdSet.has(id));
  if (notInCorpus.length) {
    fail(`algorithms.ts defines ${notInCorpus.length} algorithm(s) the corpus does not carry: ${notInCorpus.join(', ')}`);
  }
  if (notInTs.length) {
    fail(
      `algorithms.ts is missing ${notInTs.length} of the corpus's algorithms (${notInTs.join(', ')}) — ` +
        'it is described as a complete mirror in its own header and in README.md; either restore them or reword both',
    );
  }
  // Every entry must carry the rich fields, or "richly-typed reference" is the
  // next adjective quietly going false.
  for (const field of ['name', 'category', 'useCases', 'recommendationRationale', 'whyNotThis', 'assumptions', 'bestAttack']) {
    const n = [...algorithmsTs.matchAll(new RegExp(`\\b${field}\\s*:`, 'g'))].length;
    if (n !== tsAlgorithmIds.length) {
      fail(`algorithms.ts has ${n} "${field}" fields for ${tsAlgorithmIds.length} entries — it is not the complete mirror it claims to be`);
    }
  }
}

countIn('algorithms.ts', algorithmsTs, /reads corpus\.json \((\d+) algorithms\)/, [counts.algorithms], 'header: corpus.json (N algorithms)');
countIn('algorithms.ts', algorithmsTs, /covers all (\d+) of them/, [tsAlgorithmIds.length], 'header: covers all N of them');
numberCheck(/reference mirror \(all (\d+) algorithms/, [tsAlgorithmIds.length], 'architecture: algorithms.ts mirror of all N');

// index.html states its algorithm total to the visitor, twice: the static
// welcome block and the rehydrate template that rebuilds it. Both are served.
countIn('index.html', html, /trained on (\d+) cryptographic algorithms/, [counts.algorithms], 'welcome: trained on N cryptographic algorithms', 2);

// --- reference docs must list every demo the corpus carries ---
// corpus.json holds two prose reference docs alongside the per-demo entries.
// `crypto_lab_readme` is a SNAPSHOT of the catalog's demo list, and nothing
// checked it: on 2026-09-09 it described 96 demos while the corpus carried 193
// and the catalog carded 193. The catalog's own tools/corpus-sync.js cannot see
// this -- it only diffs `demo_crypto_lab_*` ids against the cards -- so the
// chatbot could answer from a per-demo entry it had while its overview of the
// catalog described a smaller, older lab. These assertions are the only thing
// standing between that doc and the next silent divergence, and they run
// offline: they compare the doc against this repo's own demo entries, not
// against a sibling checkout that CI does not have.
for (const id of REFERENCE_DOCS) {
  if (!ids.has(id)) fail(`corpus.json is missing reference doc "${id}"`);
}

const labDoc = corpus.find((e) => e.id === 'crypto_lab_readme');
if (labDoc) {
  const section = (name) => {
    const i = labDoc.text.indexOf(`${name}:\n`);
    if (i === -1) return null;
    const body = labDoc.text.slice(i + name.length + 2);
    const end = body.indexOf('\n\n');
    return (end === -1 ? body : body.slice(0, end)).split('\n').filter((l) => l.startsWith('- '));
  };
  const featured = section('Featured Projects');
  const allDemos = section('All Demos');

  if (!featured || !allDemos) {
    fail('crypto_lab_readme is missing its "Featured Projects:" or "All Demos:" section');
  } else {
    // Every demo entry in the corpus must be listed exactly once, in one
    // section or the other. Featured demos are listed only under Featured.
    const listed = featured.length + allDemos.length;
    if (listed !== demoEntries.length) {
      fail(
        `crypto_lab_readme lists ${listed} demos (${featured.length} featured + ${allDemos.length} all) ` +
          `but the corpus carries ${demoEntries.length} demo entries — regenerate the reference doc from the catalog README`,
      );
    }

    const names = [...featured, ...allDemos].map((l) => l.slice(2).split(/ \(https|: /)[0].trim());
    const seen = new Set();
    for (const n of names) {
      if (seen.has(n)) fail(`crypto_lab_readme lists "${n}" twice`);
      seen.add(n);
    }

    // Featured lines carry a live URL; each must resolve to a demo entry that
    // actually exists, so a featured swap cannot point the chatbot at nothing.
    for (const l of featured) {
      const m = /\(https:\/\/systemslibrarian\.github\.io\/([^/)]+)\//.exec(l);
      if (!m) {
        fail(`crypto_lab_readme featured line has no github.io URL: ${l}`);
        continue;
      }
      const slug = m[1];
      const entryId = `demo_${slug.replace(/-/g, '_')}`;
      if (!ids.has(entryId)) fail(`crypto_lab_readme features "${slug}" but corpus has no "${entryId}" entry`);
    }
  }
}

// `crypto_compare_readme` states crypto-compare's own totals in prose, twice.
// Both are now compared against the count derived from crypto-compare's own
// source above — never against a number typed into this file. A previous pass
// moved this figure from 97 to 123 by hand and filed it as fixed; both were
// wrong, and a typed constant could not have told anyone.
const compareDoc = corpus.find((e) => e.id === 'crypto_compare_readme');
if (compareDoc) {
  const stated = [...compareDoc.text.matchAll(/(\d+) unique linked public demos/g)].map((m) => Number(m[1]));
  if (stated.length < 2) {
    fail(`crypto_compare_readme states its linked-demo count ${stated.length} time(s); expected 2 (Description and Coverage)`);
  }
  if (compareLinkedDemos !== null) {
    for (const n of stated) {
      if (n !== compareLinkedDemos) {
        fail(
          `crypto_compare_readme says ${n} unique linked public demos; ${compareRoot}${COMPARE_DEMO_RESOURCES} ` +
            `links ${compareLinkedDemos}`,
        );
      }
    }
  }
  for (const m of compareDoc.text.matchAll(/(\d+) categories/g)) {
    if (Number(m[1]) !== corpusCategories.length) {
      fail(`crypto_compare_readme says ${m[1]} categories; the corpus uses ${corpusCategories.length}`);
    }
  }
  for (const m of compareDoc.text.matchAll(/(\d+) algorithms/g)) {
    if (Number(m[1]) !== counts.algorithms) {
      fail(`crypto_compare_readme says ${m[1]} algorithms; the corpus carries ${counts.algorithms} algorithm entries`);
    }
  }
}

// --- cross-repo re-derivation against crypto-compare's category vocabulary ---
// Read-only. Like the linked-demo count above, an absent checkout is fatal
// rather than skipped: a `?cat=` value crypto-compare does not define returns
// HTTP 200 and silently filters nothing, so this comparison is the only thing
// that can catch it, and it has to actually run.
if (!compareRoot) {
  fail(
    'crypto-compare is not checked out, so the corpus category vocabulary cannot be checked against ' +
      'the one crypto-compare actually defines — an unknown ?cat= returns 200 and filters nothing, ' +
      'so nothing else can catch it',
  );
} else if (!existsSync(sibling(compareRoot + COMPARE_CATEGORIES))) {
  fail(`${compareRoot}${COMPARE_CATEGORIES} is missing from the crypto-compare checkout`);
} else {
  const src = readFileSync(sibling(compareRoot + COMPARE_CATEGORIES), 'utf8');
  const real = [...src.matchAll(/\{\s*id:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const realSet = new Set(real);
  const bogus = corpusCategories.filter((c) => !realSet.has(c));
  const unused = real.filter((c) => !corpusCategories.includes(c));
  if (bogus.length) fail(`corpus uses ${bogus.length} category slug(s) crypto-compare does not define: ${bogus.join(', ')}`);
  if (unused.length) fail(`crypto-compare defines ${unused.length} category slug(s) no corpus entry uses: ${unused.join(', ')}`);
}

// --- report ---
if (errors.length) {
  console.error(`✗ validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ validation passed — ${corpus.length} corpus entries, ${demoEntries.length} demos ` +
    `(${counts.cryptoLab} crypto-lab + ${counts.standalone} standalone), ` +
    `${corpusCategories.length} categories, model ${modelMatch[1]}`,
);
