// Repo health check — no dependencies, run with `node scripts/validate.mjs`.
// Gates the GitHub Pages deploy: catches a broken corpus, a deprecated/unknown
// model, and drift between the corpus and the demo-slug lists in index.html
// and README.md (the failure modes this project has actually hit).

import { readFileSync } from 'node:fs';

const errors = [];
const fail = (msg) => errors.push(msg);

// Models we consider current/supported. Update intentionally when migrating.
const SUPPORTED_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
// Models Groq has retired — must never appear anywhere in the app.
const DEPRECATED_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

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

const cryptoLabSlugs = corpus
  .filter((e) => typeof e.id === 'string' && e.id.startsWith('demo_crypto_lab_'))
  .map((e) => e.id.replace(/^demo_crypto_lab_/, '').replace(/_/g, '-'));

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

// --- corpus <-> slug-list consistency (index.html system prompt + README) ---
const readme = read('README.md');
const missingInHtml = cryptoLabSlugs.filter((s) => !html.includes(s));
const missingInReadme = cryptoLabSlugs.filter((s) => !readme.includes(`\`${s}\``));

if (missingInHtml.length) {
  fail(`index.html system prompt is missing ${missingInHtml.length} demo slug(s): ${missingInHtml.join(', ')}`);
}
if (missingInReadme.length) {
  fail(`README.md is missing ${missingInReadme.length} demo slug(s): ${missingInReadme.join(', ')}`);
}

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
const REFERENCE_DOCS = ['crypto_lab_readme', 'crypto_compare_readme'];
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
    const demoEntries = corpus.filter((e) => typeof e.id === 'string' && e.id.startsWith('demo_'));
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

// --- report ---
if (errors.length) {
  console.error(`✗ validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ validation passed — ${corpus.length} corpus entries, ${cryptoLabSlugs.length} crypto-lab demos, model ${modelMatch[1]}`,
);
