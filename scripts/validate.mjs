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

// --- report ---
if (errors.length) {
  console.error(`✗ validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ validation passed — ${corpus.length} corpus entries, ${cryptoLabSlugs.length} crypto-lab demos, model ${modelMatch[1]}`,
);
