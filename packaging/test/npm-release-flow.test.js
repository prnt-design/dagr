import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PACKAGES, release } from '../bin/npm-release.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function harness(mode, fail = '') {
  const source = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const link = 'https://github.com/prnt-design/dagr/pull/123';
  const events = [];
  const published = new Set(mode === 'promote' ? PACKAGES : []);
  const artifacts = Object.fromEntries(PACKAGES.map((name) => {
    const bytes = Buffer.from(`reviewed ${name}`);
    return [name, { bytes, url: `https://example.com/${name}`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }];
  }));
  const evidence = {
    mode, version: '0.2.0', tag: mode === 'publish' ? 'next' : 'latest', source,
    scope: PACKAGES, request: link, packages: artifacts,
    checks: Object.fromEntries(['typecheck', 'test', 'lint', 'build', 'bench:gate', 'verify:tools', 'diff-review', 'tree-review'].map((key) => [key, link])),
  };
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === 'git') return args[0] === 'show' ? JSON.stringify(evidence) : '';
    if (command === 'tar') {
      const name = PACKAGES.find((name) => args[1].includes(`${name.replace('@prnt/', 'prnt-')}-0.2.0.tgz`));
      return JSON.stringify({ name, version: '0.2.0', publishConfig: { access: 'public' } });
    }
    if (command === 'node') {
      events.push('verify');
      if (fail === 'consumer') throw new Error('consumer failed');
      return '';
    }
    if (command === 'npm') {
      expect(events).toContain('verify');
      events.push(args[0]);
      if (args[0] === 'publish') {
        const name = PACKAGES.find((name) => args[1].includes(`${name.replace('@prnt/', 'prnt-')}-0.2.0.tgz`));
        published.add(name);
      }
      return '';
    }
    throw new Error('unexpected command');
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const address = String(url);
    if (address.startsWith('https://api.github.com/')) {
      const sha = address.includes(head) ? head : source;
      return { ok: true, json: async () => ({ workflow_runs: [{ head_sha: sha, head_branch: 'main', run_number: 1, status: 'completed', conclusion: 'success' }] }) };
    }
    const name = PACKAGES.find((name) => address === artifacts[name].url || address === `https://registry.npmjs.org/${encodeURIComponent(name)}` || address === `https://registry.npmjs.org/${encodeURIComponent(name)}/0.2.0`);
    if (!name) throw new Error('unexpected URL');
    const artifact = artifacts[name];
    if (address === artifact.url) return { ok: true, arrayBuffer: async () => fail === 'bytes' ? Buffer.from('changed') : artifact.bytes };
    if (address.endsWith('/0.2.0')) {
      if (!published.has(name)) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ dist: { integrity: artifact.integrity, tarball: artifact.url } }) };
    }
    return { ok: true, json: async () => ({ 'dist-tags': { [evidence.tag]: '0.2.0' } }) };
  }));
  const env = { GITHUB_REPOSITORY: 'prnt-design/dagr', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: head, RELEASE_MODE: mode, RELEASE_VERSION: '0.2.0', RELEASE_TAG: evidence.tag, RELEASE_PACKAGES: PACKAGES.join(','), RELEASE_EVIDENCE: 'packaging/release-evidence/test.json' };
  return { env, events };
}
describe('release orchestration without registry mutations', () => {
  it('publishes only after the entire candidate passes the external verifier', async () => {
    const { env, events } = harness('publish');
    await release(env);
    expect(events).toEqual(['verify', ...PACKAGES.map(() => 'publish')]);
    expect(vi.mocked(execFileSync).mock.calls.filter(([command]) => command === 'npm').every(([, args]) => args.includes('--ignore-scripts'))).toBe(true);
  });
  it('promotion never publishes or rebuilds', async () => {
    const { env, events } = harness('promote');
    await release(env);
    expect(events).toEqual(['verify', ...PACKAGES.map(() => 'dist-tag')]);
    expect(vi.mocked(execFileSync).mock.calls.some(([command]) => command === 'pnpm')).toBe(false);
  });
  it.each(['bytes', 'consumer'])('does not mutate the registry when %s verification fails', async (fail) => {
    const { env, events } = harness('promote', fail);
    await expect(release(env)).rejects.toThrow();
    expect(events.filter((event) => event !== 'verify')).toEqual([]);
  });
});
