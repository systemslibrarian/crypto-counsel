import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadApp } from './app-runtime.mjs';

const corpus = JSON.parse(readFileSync(new URL('../corpus.json', import.meta.url), 'utf8'));
const html = process.env.COUNSEL_APP_HTML || fileURLToPath(new URL('../index.html', import.meta.url));

test('named WEP retrieval preserves source-backed attack distinctions and teaching limits', () => {
  const app = loadApp(html);
  app.load(corpus);
  const doc = corpus.find((entry) => entry.id === 'demo_crypto_lab_wep_crack');
  const context = app.getContext('What does WEP Crack teach?');
  assert.ok(context.text.includes(doc.text), 'complete WEP teaching evidence must reach the model');
  assert.ok(context.sources.find((source) => source.id === doc.id)?.complete);
  assert.match(context.text, /FMS and KoreK are different attacks and are not implemented/);
  assert.match(context.text, /200,000-candidate and 30-second budget/);
  assert.match(context.text, /not a guarantee for this browser/);
});

test('source chips cite the actual README, algorithm category and standalone demo', () => {
  const app = loadApp(html);
  app.load(corpus);
  assert.equal(app.sourceChipHref({ id: 'crypto_lab_readme' }), 'https://github.com/systemslibrarian/crypto-lab/blob/main/README.md');
  assert.equal(app.sourceChipHref({ id: 'crypto_compare_readme' }), 'https://github.com/systemslibrarian/crypto-compare/blob/main/README.md');
  assert.equal(app.sourceChipHref({ id: 'demo_crypto_lab_wep_crack' }), 'https://systemslibrarian.github.io/crypto-lab-wep-crack/');
  const algorithm = corpus.find((entry) => /^Algorithm:/m.test(entry.text));
  assert.ok(app.sourceChipHref({ id: algorithm.id }).startsWith('https://crypto-compare.systemslibrarian.dev/'));
});

test('oversized evidence stays bounded and explicitly reports omitted text', () => {
  const app = loadApp(html);
  app.load(Array.from({ length: 5 }, (_, i) => ({ id: `demo_long_${i}`, text: `Demo Repository: Long Evidence ${i}\n${'long evidence '.repeat(2400)}END_OF_DOCUMENT_${i}` })));
  const context = app.getContext('long evidence');
  assert.ok(context.text.length <= 24000, 'context must remain within the total budget');
  assert.match(context.text, /Incomplete excerpt/);
  assert.match(context.text, /omitted text may contain teaching limits/);
  assert.ok(context.sources.length > 0);
  for (const source of context.sources) {
    assert.equal(source.complete, false);
    assert.ok(context.text.includes(source.id), 'only included excerpts are cited');
  }
});

test('unloaded corpus provides no invented sources', () => {
  const app = loadApp(html);
  app.load([]);
  const context = app.getContext('What does WEP Crack teach?');
  assert.equal(context.text, '');
  assert.equal(context.sources.length, 0);
});
