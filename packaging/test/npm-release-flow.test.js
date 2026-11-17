import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PACKAGES, release } from '../bin/npm-release.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function harness(mode, fail = '', scope = PACKAGES) {
  const source = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const link = 'https://github.com/prnt-design/dagr/pull/123';
  const events = [];
  const registryDownloads = new Set();
  const published = new Set(mode === 'promote' ? PACKAGES : PACKAGES.filter((name) => !scope.includes(name)));
  const artifacts = Object.fromEntries(PACKAGES.map((name) => {
    const bytes = Buffer.from(`reviewed ${name}`);
    return [name, { bytes, url: `https://example.com/${name}`, registryUrl: `https://registry.npmjs.org/${name}/-/preserved.tgz`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }];
  }));
  const evidence = {
    mode, version: '0.2.0', tag: mode === 'publish' ? 'next' : 'latest', source,
    scope, request: link, packages: artifacts,
    checks: Object.fromEntries(['typecheck', 'test', 'lint', 'build', 'bench:gate', 'verify:tools', 'diff-review', 'tree-review', 'registry-consumers'].map((key) => [key, link])),
  };
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === 'git') return args[0] === 'show' ? JSON.stringify(evidence) : args[0] === 'rev-parse' ? 'c'.repeat(40) : '';
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
      if (mode === 'publish') expect(events).toContain('verify');
      else expect(registryDownloads.size).toBe(PACKAGES.length);
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
      if (address.includes('/actions/runs/')) return { ok: true, json: async () => ({ status: 'completed', conclusion: 'success', event: 'pull_request', path: '.github/workflows/ci.yml', head_repository: { full_name: 'prnt-design/dagr' }, head_sha: source, head_commit: { id: source, tree_id: fail === 'ci-tree' ? 'd'.repeat(40) : 'c'.repeat(40) } }) };
      const sha = address.includes(head) ? head : source;
      return { ok: true, json: async () => ({ workflow_runs: [{ head_sha: sha, head_branch: 'main', run_number: 1, status: 'completed', conclusion: 'success' }] }) };
    }
    const name = PACKAGES.find((name) => address === artifacts[name].url || address === artifacts[name].registryUrl || address === `https://registry.npmjs.org/${encodeURIComponent(name)}` || address === `https://registry.npmjs.org/${encodeURIComponent(name)}/0.2.0`);
    if (!name) throw new Error('unexpected URL');
    const artifact = artifacts[name];
    if (address === artifact.registryUrl) {
      registryDownloads.add(name);
      return { ok: true, arrayBuffer: async () => ['bytes', 'registry-bytes'].includes(fail) ? Buffer.from('changed registry bytes') : artifact.bytes };
    }
    if (address === artifact.url) return { ok: true, arrayBuffer: async () => fail === 'bytes' ? Buffer.from('changed') : artifact.bytes };
    if (address.endsWith('/0.2.0')) {
      if (!published.has(name)) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ dist: { integrity: fail === 'registry-metadata' ? 'sha512-wrong' : artifact.integrity, tarball: artifact.registryUrl } }) };
    }
    return { ok: true, json: async () => ({ 'dist-tags': { [evidence.tag]: '0.2.0' } }) };
  }));
  const env = { GITHUB_REPOSITORY: 'prnt-design/dagr', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: head, RELEASE_MODE: mode, RELEASE_VERSION: '0.2.0', RELEASE_TAG: evidence.tag, RELEASE_PACKAGES: scope.join(','), RELEASE_EVIDENCE: 'packaging/release-evidence/test.json' };
  return { env, events, evidence };
}
describe('release orchestration without registry mutations', () => {
  it('publishes only after the entire candidate passes the external verifier', async () => {
    const { env, events } = harness('publish');
    await release(env);
    expect(events).toEqual(['verify', ...PACKAGES.map(() => 'publish')]);
    expect(vi.mocked(execFileSync).mock.calls.filter(([command]) => command === 'npm').every(([, args]) => args.includes('--ignore-scripts'))).toBe(true);
  });
  it('resumes publication using pinned registry bytes for unselected existing versions', async () => {
    const { env, events } = harness('publish', '', ['@prnt/dagr']);
    await release(env);
    expect(events).toEqual(['verify', 'publish']);
    for (const name of PACKAGES.filter((name) => name !== '@prnt/dagr')) {
      expect(globalThis.fetch).toHaveBeenCalledWith(new URL(`https://registry.npmjs.org/${name}/-/preserved.tgz`));
      expect(globalThis.fetch).not.toHaveBeenCalledWith(new URL(`https://example.com/${name}`));
    }
  });
  it.each(['registry-metadata', 'registry-bytes'])('stops resumed publication before any write on unselected %s mismatch', async (fail) => {
    const { env, events } = harness('publish', fail, ['@prnt/dagr']);
    await expect(release(env)).rejects.toThrow();
    expect(events).toEqual([]);
    expect(vi.mocked(execFileSync).mock.calls.some(([command]) => command === 'npm')).toBe(false);
  });
  it('accepts exact PR CI only when its tree equals the main source tree', async () => {
    const { env, evidence } = harness('promote');
    evidence.sourceCI = { run: 123, head: 'a'.repeat(40), tree: 'c'.repeat(40) };
    await expect(release(env)).resolves.toBeUndefined();
  });
  it('rejects different PR CI trees before any registry writes', async () => {
    const { env, evidence, events } = harness('promote', 'ci-tree');
    evidence.sourceCI = { run: 123, head: 'a'.repeat(40), tree: 'c'.repeat(40) };
    await expect(release(env)).rejects.toThrow('identical reviewed Git tree');
    expect(events).toEqual([]);
  });
  it('promotion never publishes or rebuilds', async () => {
    const { env, events } = harness('promote');
    await release(env);
    expect(events).toEqual(PACKAGES.map(() => 'dist-tag'));
    expect(vi.mocked(execFileSync).mock.calls.some(([command]) => command === 'node')).toBe(false);
    expect(vi.mocked(execFileSync).mock.calls.some(([command]) => command === 'pnpm')).toBe(false);
  });
  it.each(['bytes', 'consumer'])('does not mutate the registry when %s verification fails', async (fail) => {
    const { env, events } = harness('publish', fail);
    await expect(release(env)).rejects.toThrow();
    expect(events.filter((event) => event !== 'verify')).toEqual([]);
  });
});
