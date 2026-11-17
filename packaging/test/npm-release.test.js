import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGES, validate, verifyBytes, release, hasGreenCI, hasEquivalentGreenCI } from '../bin/npm-release.mjs';

const link = 'https://github.com/prnt-design/dagr/pull/123';
const integrity = `sha512-${createHash('sha512').update('preserved bytes').digest('base64')}`;
function fixture(mode = 'publish') {
  const input = { mode, version: '0.2.0', tag: 'next', packages: PACKAGES.join(',') };
  const evidence = {
    mode, version: input.version, tag: input.tag, source: 'a'.repeat(40),
    scope: [...PACKAGES], request: link,
    checks: Object.fromEntries(['typecheck', 'test', 'lint', 'build', 'bench:gate', 'verify:tools', 'diff-review', 'tree-review', 'registry-consumers'].map((key) => [key, link])),
    packages: Object.fromEntries(PACKAGES.map((name) => [name, { integrity, url: 'https://example.com/preserved.tgz' }])),
  };
  return { input, evidence };
}
describe('manual release boundary', () => {
  it('orders an exact allowed subset by dependency order', () => {
    const { input, evidence } = fixture();
    evidence.scope = ['@prnt/dagr', '@prnt/dagr-graph'];
    input.packages = evidence.scope.join(',');
    expect(validate(evidence, input)).toEqual(['@prnt/dagr-graph', '@prnt/dagr']);
  });
  it.each(['@evil/dagr', '@prnt/dagr,@prnt/dagr', '', '@prnt/dagr;echo nope'])('rejects invalid scope %s', (packages) => {
    const { input, evidence } = fixture();
    expect(() => validate(evidence, { ...input, packages })).toThrow();
  });
  it.each(['latest;whoami', '--otp', '1.2.3', ''])('rejects unsafe tag %s', (tag) => {
    const { input, evidence } = fixture();
    expect(() => validate(evidence, { ...input, tag })).toThrow();
  });
  it.each(['^0.2.0', '0.2', '01.2.0', '--help'])('requires exact versions %s', (version) => {
    const { input, evidence } = fixture();
    expect(() => validate(evidence, { ...input, version })).toThrow();
  });
  it('requires explicit promotion scope and every release check', () => {
    const { input, evidence } = fixture('promote');
    expect(validate(evidence, input)).toEqual(PACKAGES);
    expect(() => validate(evidence, { ...input, tag: 'latest' })).toThrow();
    delete evidence.checks['bench:gate'];
    expect(() => validate(evidence, input)).toThrow();
  });
  it('rejects duplicate evidence scope that omits an authorized package', () => {
    const { input, evidence } = fixture();
    evidence.scope[1] = evidence.scope[0];
    expect(() => validate(evidence, input)).toThrow();
  });
  it('requires all eight pins and safe download URLs before publishing', () => {
    const { input, evidence } = fixture();
    evidence.packages[PACKAGES[0]].url = 'https://user:secret@example.com/file';
    expect(() => validate(evidence, input)).toThrow();
    delete evidence.packages[PACKAGES[0]];
    expect(() => validate(evidence, input)).toThrow();
  });
  it('detects altered tarball bytes', () => {
    expect(() => verifyBytes('preserved bytes', integrity)).not.toThrow();
    expect(() => verifyBytes('rebuilt bytes', integrity)).toThrow('integrity mismatch');
  });
  it('rejects PRs, forks and non-main before reading evidence or network access', async () => {
    const base = { GITHUB_REPOSITORY: 'prnt-design/dagr', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
    for (const env of [{ ...base, GITHUB_REF: 'refs/heads/feature' }, { ...base, GITHUB_EVENT_NAME: 'pull_request' }, { ...base, GITHUB_REPOSITORY: 'fork/dagr' }]) {
      await expect(release(env)).rejects.toThrow('trusted main');
    }
  });
  it('requires the latest main CI run to conclude successfully for the exact SHA', () => {
    const green = { head_sha: 'source', head_branch: 'main', status: 'completed', conclusion: 'success', run_number: 1, run_attempt: 1 };
    expect(hasGreenCI([green], 'source')).toBe(true);
    expect(hasGreenCI([green], 'different')).toBe(false);
    expect(hasGreenCI([{ ...green, head_branch: 'feature' }], 'source')).toBe(false);
    for (const newer of [{ status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }]) {
      expect(hasGreenCI([green, { ...green, run_number: 2, ...newer }], 'source')).toBe(false);
    }
    expect(hasGreenCI([{ ...green, run_attempt: 2, conclusion: 'failure' }, green], 'source')).toBe(false);
  });
  it('checks exact same-repository PR CI identity and tree, rather than asserting main CI', () => {
    const head = 'a'.repeat(40);
    const tree = 'b'.repeat(40);
    const ci = { status: 'completed', conclusion: 'success', event: 'pull_request', path: '.github/workflows/ci.yml', head_repository: { full_name: 'prnt-design/dagr' }, head_sha: head, head_commit: { id: head, tree_id: tree } };
    expect(hasEquivalentGreenCI(ci, head, tree)).toBe(true);
    for (const changed of [{ conclusion: 'failure' }, { status: 'in_progress' }, { event: 'workflow_dispatch' }, { path: '.github/workflows/other.yml' }, { head_sha: 'c'.repeat(40) }, { head_repository: { full_name: 'fork/dagr' } }, { head_commit: { id: head, tree_id: 'c'.repeat(40) } }]) {
      expect(hasEquivalentGreenCI({ ...ci, ...changed }, head, tree)).toBe(false);
    }
  });
  it('requires registry consumer evidence before promotion can reuse validated bytes', () => {
    const { input, evidence } = fixture('promote');
    evidence.request = { dispatchMessage: '41ec4a5d-7fdf-4c3d-8cab-e80a02815e49' };
    expect(validate(evidence, input)).toEqual(PACKAGES);
    delete evidence.checks['registry-consumers'];
    expect(() => validate(evidence, input)).toThrow('registry consumer evidence');
  });
  it('restricts the prepared 0.2.0 handoff to vdsl and umbrella promotion', () => {
    const evidence = JSON.parse(readFileSync(new URL('../release-evidence/0.2.0-latest.json', import.meta.url), 'utf8'));
    const input = { mode: 'promote', version: '0.2.0', tag: 'latest', packages: '@prnt/dagr-vdsl,@prnt/dagr' };
    expect(validate(evidence, input)).toEqual(['@prnt/dagr-vdsl', '@prnt/dagr']);
    expect(() => validate(evidence, { ...input, mode: 'publish' })).toThrow();
    expect(() => validate(evidence, { ...input, packages: PACKAGES.join(',') })).toThrow();
  });
  it('keeps the workflow manual, serialized, and free of npm credentials', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/npm-release.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/pull_request:|\n {2}push:|NODE_AUTH_TOKEN|NPM_TOKEN/);
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('npm@11.21.0');
  });
});
