/** Manual OIDC release of preserved, reviewed pnpm tarballs. Never rebuild. */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGES = ['graph', 'layout', 'render', 'explorer', 'react', 'vdsl', 'chart', 'dagr']
  .map((name) => name === 'dagr' ? '@prnt/dagr' : `@prnt/dagr-${name}`);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REGISTRY = 'https://registry.npmjs.org';
const CHECKS = ['typecheck', 'test', 'lint', 'build', 'bench:gate', 'verify:tools', 'diff-review', 'tree-review'];
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function evidenceLink(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/prnt-design\/dagr\/(?:pull|issues|actions\/runs)\/\d+(?:[/?#].*)?$/.test(value);
}
export function validate(evidence, input) {
  requireValue(['publish', 'promote'].includes(input.mode), 'mode must be publish or promote');
  requireValue(typeof input.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(input.version), 'invalid exact version');
  requireValue(typeof input.tag === 'string' && /^[a-z][a-z0-9-]*$/.test(input.tag) && !/^v?\d/.test(input.tag), 'invalid dist-tag');
  const selected = typeof input.packages === 'string' ? input.packages.split(',') : [];
  requireValue(selected.length > 0 && new Set(selected).size === selected.length && selected.every((name) => PACKAGES.includes(name)), 'invalid or duplicate package scope');
  requireValue(evidence.version === input.version && evidence.mode === input.mode && evidence.tag === input.tag, 'evidence does not authorize mode/version/tag');
  requireValue(Array.isArray(evidence.scope) && evidence.scope.length === selected.length && new Set(evidence.scope).size === selected.length && evidence.scope.every((name) => selected.includes(name)), 'evidence does not authorize package scope');
  requireValue(evidenceLink(evidence.request), 'explicit release request evidence required');
  requireValue(typeof evidence.source === 'string' && /^[a-f0-9]{40}$/.test(evidence.source), 'exact source SHA required');
  requireValue(CHECKS.every((key) => evidenceLink(evidence.checks?.[key])), 'all local gate, external verifier and review evidence required');
  requireValue(evidence.packages && Object.keys(evidence.packages).length === PACKAGES.length && PACKAGES.every((name) => {
    const artifact = evidence.packages[name];
    if (!artifact || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(artifact.integrity)) return false;
    if (input.mode === 'promote') return true;
    try {
      const url = new URL(artifact.url);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
  }), 'all eight preserved artifact SHA-512 pins (and publish URLs) required');
  return PACKAGES.filter((name) => selected.includes(name));
}
export function hasGreenCI(runs, sha) {
  const latest = runs?.filter((job) => job.head_sha === sha && job.head_branch === 'main')
    .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  return latest?.status === 'completed' && latest.conclusion === 'success';
}
export function verifyBytes(bytes, integrity) {
  requireValue(`sha512-${createHash('sha512').update(bytes).digest('base64')}` === integrity, 'tarball integrity mismatch');
}
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
async function json(url, missing = false) {
  const response = await globalThis.fetch(url, { headers: { Accept: 'application/json' } });
  if (missing && response.status === 404) return null;
  requireValue(response.ok, `metadata request failed (${response.status})`);
  return response.json();
}
async function registry(name, version, missing = false) {
  return json(`${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, missing);
}
async function download(url, integrity) {
  const parsed = new URL(url);
  requireValue(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'HTTPS artifact URL required');
  const response = await globalThis.fetch(parsed);
  requireValue(response.ok, `artifact download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyBytes(bytes, integrity);
  return bytes;
}
export async function release(env = process.env) {
  requireValue(env.GITHUB_REPOSITORY === 'prnt-design/dagr' && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'release requires manual dispatch on trusted main');
  const evidencePath = env.RELEASE_EVIDENCE;
  requireValue(typeof evidencePath === 'string' && /^packaging\/release-evidence\/[a-zA-Z0-9._-]+\.json$/.test(evidencePath), 'evidence must be committed under packaging/release-evidence');
  const committed = run('git', ['show', `${env.GITHUB_SHA}:${evidencePath}`]);
  const evidence = JSON.parse(committed);
  const input = { mode: env.RELEASE_MODE, version: env.RELEASE_VERSION, tag: env.RELEASE_TAG, packages: env.RELEASE_PACKAGES };
  const selected = validate(evidence, input);
  run('git', ['merge-base', '--is-ancestor', evidence.source, env.GITHUB_SHA]);
  // Public read only API. No additional GitHub token permissions are needed.
  for (const sha of new Set([evidence.source, env.GITHUB_SHA])) {
    const ci = await json(`https://api.github.com/repos/prnt-design/dagr/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
    requireValue(hasGreenCI(ci.workflow_runs, sha), 'source and workflow commits need concluded green main CI');
  }
  const work = mkdtempSync(join(tmpdir(), 'dagr-npm-release-'));
  try {
    const paths = new Map();
    // Preflight the entire candidate before the first write, including resumed promotions.
    for (const name of PACKAGES) {
      const artifact = evidence.packages[name];
      const existing = await registry(name, input.version, true);
      if (input.mode === 'publish' && selected.includes(name)) requireValue(!existing, `immutable version already exists: ${name}`);
      if (input.mode === 'promote') requireValue(existing?.dist?.integrity === artifact.integrity, `registry integrity differs: ${name}`);
      const bytes = await download(input.mode === 'promote' ? existing.dist.tarball : artifact.url, artifact.integrity);
      const path = join(work, `${name.replace('@prnt/', 'prnt-')}-${input.version}.tgz`);
      writeFileSync(path, bytes);
      const manifest = JSON.parse(run('tar', ['-xOf', path, 'package/package.json']));
      requireValue(manifest.name === name && manifest.version === input.version && !manifest.private && manifest.publishConfig?.access === 'public', `incorrect packed manifest: ${name}`);
      requireValue(!Object.values({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).some((range) => String(range).startsWith('workspace:')), `unresolved workspace range: ${name}`);
      paths.set(name, path);
    }
    run('node', ['packaging/bin/verify-tools.mjs'], { stdio: 'inherit', env: { ...env, DAGR_TARBALL_DIR: work } });
    for (const name of selected) {
      if (input.mode === 'publish') {
        run('npm', ['publish', paths.get(name), '--access', 'public', '--tag', input.tag, '--ignore-scripts', '--registry', REGISTRY], { stdio: 'inherit' });
      } else {
        run('npm', ['dist-tag', 'add', `${name}@${input.version}`, input.tag, '--registry', REGISTRY], { stdio: 'inherit' });
      }
      const published = await registry(name, input.version);
      requireValue(published.dist?.integrity === evidence.packages[name].integrity, `published integrity differs: ${name}`);
      await download(published.dist.tarball, evidence.packages[name].integrity);
      const metadata = await json(`${REGISTRY}/${encodeURIComponent(name)}`);
      requireValue(metadata['dist-tags']?.[input.tag] === input.version, `tag verification failed: ${name}`);
      console.log(`Verified ${name}@${input.version} (${input.tag})`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  release().catch((error) => {
    // Avoid dumping child-process environments or artifact URLs on failure.
    console.error(error.status ? `Release command failed (exit ${error.status}). Inspect registry state before retrying.` : error.message);
    process.exitCode = 1;
  });
}
