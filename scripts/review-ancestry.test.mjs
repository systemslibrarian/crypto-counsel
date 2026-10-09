import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reviewAncestry } from './review-ancestry.mjs';

test('review ancestry distinguishes reachable, unrelated, missing and shallow evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'counsel-ancestry-'));
  const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    execFileSync('git', ['init', '--initial-branch=main', root], { stdio: 'ignore' });
    git(root, 'config', 'user.name', 'Counsel test fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    const commit = (text) => {
      writeFileSync(join(root, 'source.txt'), text);
      git(root, 'add', 'source.txt');
      git(root, 'commit', '-m', text);
      return git(root, 'rev-parse', 'HEAD');
    };
    const pin = commit('reviewed source');
    const current = commit('current source');
    git(root, 'update-ref', 'refs/remotes/origin/main', current);
    assert.equal(reviewAncestry(root, pin).status, 'verified');
    assert.equal(reviewAncestry(root, current).status, 'verified');

    git(root, 'checkout', '--orphan', 'unrelated');
    const unrelated = commit('unrelated source');
    assert.equal(reviewAncestry(root, unrelated).status, 'not-ancestor');
    assert.equal(reviewAncestry(root, '1'.repeat(40)).status, 'unverifiable');

    // Reproduce a depth-1 current-head boundary while retaining the pinned
    // object: absence of a traversable path is no longer proof of divergence.
    writeFileSync(join(root, '.git', 'shallow'), `${current}\n`);
    assert.equal(reviewAncestry(root, pin).status, 'unverifiable');
    assert.equal(reviewAncestry(root, current).status, 'verified');
    rmSync(join(root, '.git', 'shallow'));
    assert.equal(reviewAncestry(root, pin).status, 'verified');
    assert.equal(reviewAncestry(root, unrelated).status, 'not-ancestor');
    assert.equal(reviewAncestry(join(root, 'missing'), pin).status, 'unverifiable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
