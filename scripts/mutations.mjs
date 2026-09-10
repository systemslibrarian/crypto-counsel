// Mutation set for scripts/validate.mjs — no dependencies, run with
// `node scripts/mutations.mjs`.
//
// WHAT THIS IS. Every assertion in validate.mjs was justified, when it landed,
// by a defect fixture: a deliberate break that the check is supposed to catch.
// Those fixtures lived in commit messages and in agent transcripts, which is to
// say they were run once and then never again. A check that has stopped being
// able to fail still reads as coverage — that is the exact defect class this
// repo keeps hitting, one level up — so the fixtures live here now and get
// replayed.
//
// HOW IT WORKS. Each mutation is applied to a throwaway copy of the tree, and
// `node <copy>/scripts/validate.mjs` is run against it. A mutation is CAUGHT
// only if the validator exits non-zero AND its output matches that mutation's
// `expect` pattern — exit code alone is not enough, because a copied tree that
// cannot see crypto-compare fails everything for the wrong reason and would
// read as total coverage. An unmutated copy is run first and must PASS; if it
// does not, the run aborts rather than reporting a screenful of false positives.
//
// The copy is written under the OS temp directory. Nothing outside it is
// modified. crypto-compare is located once, on the real filesystem, and passed
// to each child as CRYPTO_COMPARE_DIR — read-only, exactly as validate.mjs
// already reads it.
//
// USAGE
//   node scripts/mutations.mjs                     # this tree
//   node scripts/mutations.mjs --tree /path/to/x   # some other checkout
//   node scripts/mutations.mjs --only M13,M14      # a subset
//   node scripts/mutations.mjs --keep              # leave the temp copies
//
// `--tree` is what makes this a matrix rather than a checklist: pointing a
// fixed tree's harness at an older checkout is how "PASSES on HEAD, FAILS on
// FIXED" gets demonstrated instead of asserted. Exit is non-zero if any
// selected mutation ESCAPED (validator passed) or was caught for the wrong
// reason.
//
// NUMBERING is historical and stable, and numbers are never reused. M1..M12 are
// the fixtures cited by the commits that introduced the checks, in commit order.
// M13..M17 are the five spellings an adversarial audit of d2415f0 walked
// through — two of them the audit's own (M13, M14), three more found while
// closing those (M15, M16, M17). M18..M21 are four escapes a later audit found
// in 59015a9: a second <script> block carrying its own prompt (M18), a
// declaration whose identifier is spelled with a unicode escape (M19), a slug
// label separated by a FULLWIDTH colon (M20), and a label with a suffix after
// "demo slugs" (M21). M22 is the same suffix hole on the category list, found
// while closing M21. All six passed 59015a9.
//
// NOT wired into CI. .github/workflows/pages.yml gates the deploy on
// validate.mjs, and this harness spawns a validator run per fixture against a
// full copy of the tree; it is a local gate you run when you touch a check, and
// saying otherwise here would be the same overclaim it exists to prevent.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- tiny edit helpers; each throws loudly if its anchor is gone ------------
// A mutation whose anchor has drifted must be a hard error. If it silently
// no-ops, the tree is unmutated, the validator passes, and the report says
// ESCAPED — pointing at the check instead of at this file.

const editFile = (dir, rel, fn) => {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

const replaceOnce = (text, find, repl, what) => {
  const i = text.indexOf(find);
  if (i === -1) throw new Error(`mutation anchor not found (${what}): ${JSON.stringify(find.slice(0, 80))}`);
  if (text.indexOf(find, i + find.length) !== -1) {
    throw new Error(`mutation anchor is ambiguous (${what}): ${JSON.stringify(find.slice(0, 80))} occurs more than once`);
  }
  return text.slice(0, i) + repl + text.slice(i + find.length);
};

const editCorpus = (dir, fn) => {
  const p = join(dir, 'corpus.json');
  const corpus = JSON.parse(readFileSync(p, 'utf8'));
  const out = fn(corpus);
  // Minified and newline-free, like the file it replaces.
  writeFileSync(p, JSON.stringify(out ?? corpus));
};

const doc = (corpus, id) => {
  const e = corpus.find((x) => x.id === id);
  if (!e) throw new Error(`mutation anchor not found: corpus entry ${id}`);
  return e;
};

// The `All Demos:` bullet lines of crypto_lab_readme, as [startIndex, lines].
const allDemoLines = (text) => {
  const head = 'All Demos:\n';
  const i = text.indexOf(head);
  if (i === -1) throw new Error('mutation anchor not found: "All Demos:" section of crypto_lab_readme');
  const body = text.slice(i + head.length);
  const end = body.indexOf('\n\n');
  const section = end === -1 ? body : body.slice(0, end);
  return { at: i + head.length, section, lines: section.split('\n').filter((l) => l.startsWith('- ')) };
};

// A retired demo: no card in the catalog, no corpus entry, and its site 404s.
// Every fixture that needs "a slug that must never reach the model" uses it.
const RETIRED = 'steg-arena';

// A second `const systemPrompt` code path, in its OWN function scope so the
// script still parses — a redeclaration in the same scope is a SyntaxError and
// would be caught by the vm rather than by the guard under test, which proves
// nothing about the guard. `decl` is the spelling of the declaration being
// tested; `tail` is whatever follows the closing `\`;`.
const secondTemplate = (decl, tail, list) => `

function askLegacy(question) {
  ${decl}\`You are Crypto Counsel, a cryptography advisor for systemslibrarian's education platform.

LINK RULES:
- crypto-lab format: https://systemslibrarian.github.io/crypto-lab-<demo-slug>/
  demo slugs: ${list}

FORMAT: One direct sentence first.\`;${tail}
  return systemPrompt;
}
`;

const FROZEN_LIST = `snow2, aes-modes, ${RETIRED}`;

// A SECOND <script> block, with attributes, holding its own prompt. `attrs` is
// whatever follows `<script` in the opening tag. Inserted before </body>, so it
// is a sibling of the app's own block rather than nested in it — two live
// `const systemPrompt` declarations, both of which a browser executes.
const secondScriptBlock = (html, attrs, body) => {
  const close = '\n</body>';
  const i = html.lastIndexOf(close);
  if (i === -1) throw new Error('mutation anchor not found: closing </body> in index.html');
  return `${html.slice(0, i)}\n<script${attrs}>${body}</script>${html.slice(i)}`;
};

// The reason every extra-template fixture must fail for: app-runtime.mjs's
// count guard fired and named 2. Deliberately not pinned to one wording of that
// sentence — d2415f0 says "templates", this tree says "declarations", and the
// point of `--tree` is to replay these fixtures against both. It still requires
// the guard by name and the count, so no unrelated failure satisfies it.
const EXTRA_TEMPLATE = /found 2 `const systemPrompt[^\n]*expected exactly 1/;

// Appends to the end of index.html's single <script> block.
const appendToScript = (html, code) => {
  const close = '\n</script>';
  const i = html.lastIndexOf(close);
  if (i === -1) throw new Error('mutation anchor not found: closing </script> in index.html');
  return html.slice(0, i) + code + html.slice(i);
};

// --- the fixtures ----------------------------------------------------------

const MUTATIONS = [
  // f4ee9a9 — "Gate the reference docs against the corpus, not against nothing"
  {
    id: 'M1',
    what: 'crypto_lab_readme loses one "All Demos" line',
    apply: (d) => editCorpus(d, (c) => {
      const e = doc(c, 'crypto_lab_readme');
      const { lines } = allDemoLines(e.text);
      e.text = replaceOnce(e.text, `${lines[0]}\n`, '', 'M1 first All Demos line');
    }),
    expect: /crypto_lab_readme lists \d+ demos .* but the corpus carries \d+ demo entries/,
  },
  {
    id: 'M2',
    what: 'crypto_lab_readme truncated to 96 listed demos — the shape of the stale doc 2d4a0db replaced',
    apply: (d) => editCorpus(d, (c) => {
      const e = doc(c, 'crypto_lab_readme');
      const { section, lines } = allDemoLines(e.text);
      const keep = Math.max(0, 96 - 4); // 4 featured + 92 = 96 listed
      e.text = replaceOnce(e.text, section, lines.slice(0, keep).join('\n'), 'M2 All Demos section');
    }),
    expect: /crypto_lab_readme lists 96 demos/,
  },
  {
    id: 'M3',
    what: 'crypto_lab_readme lists one demo name twice',
    apply: (d) => editCorpus(d, (c) => {
      const e = doc(c, 'crypto_lab_readme');
      const { lines } = allDemoLines(e.text);
      const dupName = lines[0].slice(2).split(': ')[0];
      const victim = lines[1];
      e.text = replaceOnce(e.text, victim, `- ${dupName}: ${victim.slice(2).split(': ').slice(1).join(': ')}`, 'M3 second All Demos line');
    }),
    expect: /crypto_lab_readme lists ".+" twice/,
  },
  {
    id: 'M4',
    what: `crypto_lab_readme features a slug with no corpus entry (${RETIRED})`,
    apply: (d) => editCorpus(d, (c) => {
      const e = doc(c, 'crypto_lab_readme');
      const m = /\(https:\/\/systemslibrarian\.github\.io\/(crypto-lab-[a-z0-9-]+)\/\)/.exec(e.text);
      if (!m) throw new Error('mutation anchor not found: a featured github.io URL in crypto_lab_readme');
      e.text = replaceOnce(e.text, m[1], `crypto-lab-${RETIRED}`, 'M4 featured slug');
    }),
    expect: new RegExp(`crypto_lab_readme features "crypto-lab-${RETIRED}" but corpus has no `),
  },
  {
    id: 'M5',
    what: 'corpus.json loses the crypto_compare_readme reference doc',
    apply: (d) => editCorpus(d, (c) => {
      doc(c, 'crypto_compare_readme');
      return c.filter((e) => e.id !== 'crypto_compare_readme');
    }),
    expect: /corpus\.json is missing reference doc "crypto_compare_readme"/,
  },

  // 3c2c457 — "Hold the corpus's own Live Demo links to the same rule"
  {
    id: 'M6',
    what: `one corpus entry's Live Demo link repointed at the retired ${RETIRED}`,
    apply: (d) => editCorpus(d, (c) => {
      const e = c.find((x) => x.id.startsWith('demo_') && /https:\/\/systemslibrarian\.github\.io\/crypto-lab-[a-z0-9-]+\//.test(x.text));
      if (!e) throw new Error('mutation anchor not found: a demo entry carrying a github.io live-demo URL');
      e.text = e.text.replace(
        /https:\/\/systemslibrarian\.github\.io\/crypto-lab-[a-z0-9-]+\//,
        `https://systemslibrarian.github.io/crypto-lab-${RETIRED}/`,
      );
    }),
    expect: new RegExp(`corpus\\.json links to https://systemslibrarian\\.github\\.io/crypto-lab-${RETIRED}/`),
  },

  // c9e6e34 — "Check the generator's output, not its source text"
  {
    id: 'M7',
    what: "buildLinkRules()' corpus filter reverted to demo_crypto_lab_, dropping snow2 from the prompt",
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      "corpus.filter(d => d.id.startsWith('demo_')).map(d => demoSlugFromId(d.id))",
      "corpus.filter(d => d.id.startsWith('demo_crypto_lab_')).map(d => demoSlugFromId(d.id))",
      'M7 buildLinkRules filter',
    )),
    expect: /generated system prompt "demo slugs" is missing 1: snow2/,
  },
  {
    id: 'M8',
    what: "sourceChipHref()'s branch reverted the same way, sending snow2's chip to the crypto-compare homepage",
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      "if (src.id.startsWith('demo_')) return demoSiteUrl(demoSlugFromId(src.id));",
      "if (src.id.startsWith('demo_crypto_lab_')) return demoSiteUrl(demoSlugFromId(src.id));",
      'M8 sourceChipHref branch',
    )),
    expect: /sourceChipHref\("demo_snow2"\) returns/,
  },
  {
    id: 'M9',
    what: "crypto_compare_readme's linked-demo figure drifts from crypto-compare's own source",
    apply: (d) => editCorpus(d, (c) => {
      const e = doc(c, 'crypto_compare_readme');
      const m = /(\d+) unique linked public demos/.exec(e.text);
      if (!m) throw new Error('mutation anchor not found: "N unique linked public demos"');
      e.text = e.text.split(m[0]).join(`${Number(m[1]) + 1} unique linked public demos`);
    }),
    expect: /crypto_compare_readme says \d+ unique linked public demos; .*demoResources\.ts links \d+/,
  },

  // d2415f0 — "Pin the prompt to one template, and read every slug list in it"
  {
    id: 'M10',
    what: 'a second `const systemPrompt` template appended below the real one, carrying a frozen slug list',
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(h, secondTemplate('const systemPrompt = ', '', FROZEN_LIST))),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M11',
    what: 'a decoy template ABOVE the real one, with the real one\'s slug list frozen',
    apply: (d) => editFile(d, 'index.html', (h) => {
      const frozen = replaceOnce(
        h,
        '${buildLinkRules()}',
        `LINK RULES:\n- crypto-lab format: https://systemslibrarian.github.io/crypto-lab-<demo-slug>/\n  demo slugs: ${FROZEN_LIST}`,
        'M11 real template link rules',
      );
      // Placed before ask(), so a first-match-only reader renders it instead.
      return replaceOnce(
        frozen,
        '\nasync function ask(question) {',
        `\nfunction askDecoy(question) {\n  const systemPrompt = \`You are Crypto Counsel, a cryptography advisor for systemslibrarian's education platform.\n\n\${buildLinkRules()}\n\nCONTEXT: \${question}\n\nFORMAT: One direct sentence first.\`;\n  return systemPrompt;\n}\n\nasync function ask(question) {`,
        'M11 ask() declaration',
      );
    }),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M12',
    what: `a "LEGACY demo slugs: " line (colon-SPACE) inside the real template, listing ${RETIRED}`,
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      '\n\nFORMAT: One direct sentence first.',
      `\n\nLEGACY demo slugs: ${FROZEN_LIST}\n\nFORMAT: One direct sentence first.`,
      'M12 FORMAT line of the real template',
    )),
    expect: /generated system prompt carries 2 lines whose label matches/,
  },

  // This commit — the escapes an adversarial audit found in d2415f0's guard.
  {
    id: 'M13',
    what: 'a second `const systemPrompt` template with a trailing `// frozen legacy copy` comment after the `;`',
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(
      h,
      secondTemplate('const systemPrompt = ', ' // frozen legacy copy', FROZEN_LIST),
    )),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M14',
    what: `a "LEGACY demo slugs:" line with NO space after the colon inside the real template, listing ${RETIRED}`,
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      '\n\nFORMAT: One direct sentence first.',
      `\n\nLEGACY demo slugs:${FROZEN_LIST}\n\nFORMAT: One direct sentence first.`,
      'M14 FORMAT line of the real template',
    )),
    expect: /generated system prompt carries 2 lines whose label matches/,
  },
  {
    id: 'M15',
    what: 'a second `const systemPrompt` template written with TWO spaces after `const`',
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(h, secondTemplate('const  systemPrompt = ', '', FROZEN_LIST))),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M16',
    what: 'a second `const systemPrompt` template with a line break between `=` and the backtick',
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(h, secondTemplate('const systemPrompt =\n    ', '', FROZEN_LIST))),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M17',
    what: 'a second `const systemPrompt` template with a line break between `const` and the identifier',
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(h, secondTemplate('const\n    systemPrompt = ', '', FROZEN_LIST))),
    expect: EXTRA_TEMPLATE,
  },

  // This commit — four more escapes, from an adversarial audit of 59015a9.
  // Every one of them PASSED that tree with a retired slug live in the code
  // path, so none is a regression; they are the holes that were there already.
  {
    id: 'M18',
    what: 'a second `<script type="module">` block holding its own `const systemPrompt` and a frozen slug list',
    apply: (d) => editFile(d, 'index.html', (h) => secondScriptBlock(
      h,
      ' type="module"',
      secondTemplate('const systemPrompt = ', '', FROZEN_LIST),
    )),
    // The harness's block count, naming 2. A reader that only sees the
    // attribute-less block counts 1, runs the declaration regex over that block
    // alone, and exits 0 while the page executes two prompts.
    expect: /expected exactly one[^\n]*<script> block[^\n]*found 2/,
  },
  {
    id: 'M19',
    what: 'a second `const systemPrompt` whose identifier is spelled with a unicode escape (`\\u0073ystemPrompt`)',
    // Legal JS: the escape binds the same name, so the page has two live
    // prompts, while the source text never contains the literal spelling the
    // declaration regex looks for.
    apply: (d) => editFile(d, 'index.html', (h) => appendToScript(
      h,
      secondTemplate('const \\u0073ystemPrompt = ', '', FROZEN_LIST),
    )),
    expect: EXTRA_TEMPLATE,
  },
  {
    id: 'M20',
    what: `a "LEGACY demo slugs\uFF1A" line (FULLWIDTH colon) inside the real template, listing ${RETIRED}`,
    // The list reaches the rendered prompt; listCheck's separator was an ASCII
    // colon, so the line matched no label pattern and was never read.
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      '\n\nFORMAT: One direct sentence first.',
      `\n\nLEGACY demo slugs\uFF1A${FROZEN_LIST}\n\nFORMAT: One direct sentence first.`,
      'M20 FORMAT line of the real template',
    )),
    expect: /generated system prompt carries 2 lines whose label matches/,
  },
  {
    id: 'M21',
    what: `a "demo slugs (legacy): " line inside the real template, listing ${RETIRED}`,
    // The label pattern required the colon IMMEDIATELY after "demo slugs", so a
    // label that STARTS with it but carries a suffix escaped.
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      '\n\nFORMAT: One direct sentence first.',
      `\n\ndemo slugs (legacy): ${FROZEN_LIST}\n\nFORMAT: One direct sentence first.`,
      'M21 FORMAT line of the real template',
    )),
    expect: /generated system prompt carries 2 lines whose label matches/,
  },
  {
    id: 'M22',
    what: 'a "LEGACY category slugs: " line inside the real template',
    // The same label-shape hole as M21, on the other vocabulary: the category
    // list was matched by its EXACT label, so any prefix or suffix escaped.
    apply: (d) => editFile(d, 'index.html', (h) => replaceOnce(
      h,
      '\n\nFORMAT: One direct sentence first.',
      '\n\nLEGACY category slugs: hash, kem, retired-category\n\nFORMAT: One direct sentence first.',
      'M22 FORMAT line of the real template',
    )),
    expect: /generated system prompt carries 2 lines whose label matches/,
  },
];

// --- runner ----------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const here = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tree = resolve(flag('--tree') || here);
const keep = args.includes('--keep');
const only = (flag('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!existsSync(join(tree, 'scripts', 'validate.mjs'))) {
  console.error(`✗ ${tree} does not look like a crypto-counsel checkout (no scripts/validate.mjs)`);
  process.exit(2);
}

// crypto-compare, resolved on the real filesystem and handed to every child.
// The temp copy has no sibling, so without this every run would fail on the
// absent checkout and every mutation would read as caught.
const compare = [
  process.env.CRYPTO_COMPARE_DIR,
  join(tree, '..', 'crypto-compare'),
  join(tree, 'vendor', 'crypto-compare'),
].filter(Boolean).map((d) => resolve(d)).find((d) => existsSync(join(d, 'src', 'data', 'demoResources.ts')));

if (!compare) {
  console.error(
    '✗ crypto-compare is not checked out anywhere this harness can see, so every child run would fail ' +
      'on the absent checkout and every mutation would read as caught. Clone it beside the tree, or set ' +
      'CRYPTO_COMPARE_DIR. Deliberately fatal, for the same reason it is fatal in validate.mjs.',
  );
  process.exit(2);
}

const SKIP = new Set(['.git', 'node_modules', 'vendor', '.github']);
const stage = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `crypto-counsel-mut-${label}-`));
  cpSync(tree, dir, {
    recursive: true,
    filter: (src) => !SKIP.has(src.slice(tree.length + 1).split(/[\\/]/)[0]),
  });
  return dir;
};

const runValidator = (dir) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CRYPTO_COMPARE_DIR: compare },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

console.log(`tree:           ${tree}`);
console.log(`crypto-compare: ${compare}\n`);

// Baseline. An unmutated copy must PASS, or nothing below means anything.
const baseDir = stage('baseline');
const base = runValidator(baseDir);
if (!keep) rmSync(baseDir, { recursive: true, force: true });
if (base.code !== 0) {
  console.error('✗ BASELINE FAILED — the unmutated copy does not pass, so every mutation below would');
  console.error('  read as caught for the wrong reason. Fix the tree first.\n');
  console.error(base.out);
  process.exit(2);
}
console.log('baseline: unmutated copy PASSES\n');

const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;
const unknown = only.filter((id) => !MUTATIONS.some((m) => m.id === id));
if (unknown.length) {
  console.error(`✗ no such mutation: ${unknown.join(', ')}`);
  process.exit(2);
}

let bad = 0;
for (const m of selected) {
  const dir = stage(m.id);
  let verdict;
  let detail = '';
  try {
    m.apply(dir);
    const r = runValidator(dir);
    if (r.code === 0) {
      verdict = 'ESCAPED';
      detail = 'validator PASSED on a mutated tree';
      bad += 1;
    } else if (!m.expect.test(r.out)) {
      verdict = 'WRONG-REASON';
      detail = `validator failed, but not with /${m.expect.source}/`;
      bad += 1;
    } else {
      verdict = 'CAUGHT';
      detail = (r.out.split('\n').find((l) => m.expect.test(l)) || '').trim();
    }
  } catch (e) {
    verdict = 'BROKEN-FIXTURE';
    detail = e.message;
    bad += 1;
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });
  console.log(`${verdict === 'CAUGHT' ? '✓' : '✗'} ${m.id.padEnd(4)} ${verdict.padEnd(14)} ${m.what}`);
  if (detail) console.log(`       ${detail}`);
}

console.log('');
if (bad) {
  console.error(`✗ ${bad} of ${selected.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`✓ all ${selected.length} mutation(s) caught`);
