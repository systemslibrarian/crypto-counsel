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

const errors = [];
const fail = (msg) => errors.push(msg);

// Models we consider current/supported. Update intentionally when migrating.
const SUPPORTED_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
// Models Groq has retired — must never appear anywhere in the app.
const DEPRECATED_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

// crypto-compare's /labs index counts the unique crypto-lab demos reachable
// from its algorithm reference: `LABS.length` in src/components/LabsView.tsx,
// i.e. buildLabIndex() over src/data/demoResources.ts. The number is pinned
// here because CI has no crypto-compare checkout; when one IS present beside
// this repo, the check at the bottom re-derives it from that file and fails on
// disagreement rather than trusting this constant.
const COMPARE_LINKED_DEMOS = 192;
const COMPARE_DEMO_RESOURCES = '../crypto-compare/src/data/demoResources.ts';
const COMPARE_CATEGORIES = '../crypto-compare/src/data/categories.ts';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const sibling = (p) => new URL(p, root);

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
for (const [file, text] of [['index.html', html], ['README.md', readme]]) {
  const seen = new Set();
  for (const m of text.matchAll(/https:\/\/systemslibrarian\.github\.io\/[a-z0-9][a-z0-9.-]*\//g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    if (!validDemoUrls.has(m[0])) fail(`${file} links to ${m[0]}, which is not the live site of any corpus demo`);
  }
}

// --- the system prompt's vocabularies ---
// Both lists are generated from the corpus at runtime. If either is re-frozen
// as literal text, it is held to exact set equality with the corpus instead —
// a written-down list that is merely *close* is the failure mode here.
const listCheck = (label, line, expected, where) => {
  if (!line) {
    fail(`${where} has no "${label}" line`);
    return;
  }
  if (line.includes('${')) return; // generated at runtime from the corpus
  const got = line.split(',').map((s) => s.trim()).filter(Boolean);
  const gotSet = new Set(got);
  const missing = expected.filter((s) => !gotSet.has(s));
  const extra = got.filter((s) => !expected.includes(s));
  if (missing.length) fail(`${where} "${label}" is missing ${missing.length}: ${missing.join(', ')}`);
  if (extra.length) fail(`${where} "${label}" lists ${extra.length} unknown value(s): ${extra.join(', ')}`);
};

// The leading-character class lets the line be found whether it is prose inside
// a prompt template or a string literal inside the generator.
listCheck('category slugs', html.match(/^[\s'"`]*category slugs: (.+)$/m)?.[1], corpusCategories, 'index.html system prompt');
listCheck('demo slugs', html.match(/^[\s'"`]*demo slugs: (.+)$/m)?.[1], demoSlugs, 'index.html system prompt');

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

const numberCheck = (re, expected, what) => {
  const m = readme.match(re);
  if (!m) {
    fail(`README.md has no "${what}" line to check against the corpus`);
    return;
  }
  m.slice(1).forEach((got, i) => {
    if (Number(got) !== expected[i]) fail(`README.md "${what}" says ${got}, corpus has ${expected[i]}`);
  });
};

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
// They are a snapshot of a sibling repo, so they cannot be derived here — but
// they can be pinned to one constant and re-derived whenever that repo is
// checked out beside this one. A previous pass moved this figure from 97 to 123
// by hand and filed it as fixed; both were wrong.
const compareDoc = corpus.find((e) => e.id === 'crypto_compare_readme');
if (compareDoc) {
  const stated = [...compareDoc.text.matchAll(/(\d+) unique linked public demos/g)].map((m) => Number(m[1]));
  if (stated.length < 2) {
    fail(`crypto_compare_readme states its linked-demo count ${stated.length} time(s); expected 2 (Description and Coverage)`);
  }
  for (const n of stated) {
    if (n !== COMPARE_LINKED_DEMOS) {
      fail(`crypto_compare_readme says ${n} unique linked public demos; crypto-compare links ${COMPARE_LINKED_DEMOS}`);
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

// --- cross-repo re-derivation, when crypto-compare is checked out beside us ---
// Read-only. Absent in CI, which is why COMPARE_LINKED_DEMOS is pinned above;
// present locally, it is the only real oracle for these two facts.
if (existsSync(sibling(COMPARE_DEMO_RESOURCES))) {
  const src = readFileSync(sibling(COMPARE_DEMO_RESOURCES), 'utf8');
  const slugs = new Set(
    [...src.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1].match(/\/(crypto-lab-[a-z0-9-]+)\/?$/)?.[1]).filter(Boolean),
  );
  if (slugs.size !== COMPARE_LINKED_DEMOS) {
    fail(
      `crypto-compare now links ${slugs.size} unique demos, but COMPARE_LINKED_DEMOS is pinned at ${COMPARE_LINKED_DEMOS} ` +
        '— update the constant and the crypto_compare_readme prose together',
    );
  }
}
if (existsSync(sibling(COMPARE_CATEGORIES))) {
  const src = readFileSync(sibling(COMPARE_CATEGORIES), 'utf8');
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
