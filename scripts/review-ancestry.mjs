import { spawnSync } from 'node:child_process';

export function reviewAncestry(directory, commit, reference = 'origin/main') {
  const probe = spawnSync('git', ['-C', directory, 'merge-base', '--is-ancestor', commit, reference], { encoding: 'utf8' });
  if (probe.error || probe.status === null || probe.status > 1) {
    return { status: 'unverifiable', reason: 'Missing or unreadable commit/reference evidence' };
  }
  if (probe.status === 0) return { status: 'verified' };
  const shallow = spawnSync('git', ['-C', directory, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' });
  if (shallow.status !== 0 || shallow.stdout.trim() === 'true') {
    return { status: 'unverifiable', reason: 'Incomplete Git ancestry; fetch/deepen origin/main and rerun' };
  }
  return { status: 'not-ancestor' };
}
