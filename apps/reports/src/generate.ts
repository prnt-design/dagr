import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { entityId, validateReport, snapshot } from './index.js';
import type { Report, ReportNode } from './types.js';

export interface Capture { repository: string; revision: string; commitSubject: string; capturedAt: string; prs: { number: number; title: string; state: string; url: string }[] }
export function generate(capture: Capture, previous?: Report): Report {
  const date = capture.capturedAt.slice(0, 10);
  const nodes: ReportNode[] = capture.prs.map(pr => ({
    id: entityId({ kind: 'pr', key: String(pr.number) }), entity: { kind: 'pr', key: String(pr.number) },
    label: pr.title, summary: `GitHub state: ${pr.state}.`, content: [{ kind: 'paragraph', text: `GitHub state: ${pr.state}.` }],
    sourceIds: [`pr-${pr.number}`], confidence: { level: 'confirmed', reason: 'Read from GitHub PR record.' },
    previousStatus: previous ? 'new' : 'unknown', activity: 'observed', state: pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'done' : 'unknown',
    attention: { needed: false, reason: 'No decision inferred from PR metadata.' },
  }));
  if (!nodes.length) throw new Error('No PR records available; no report saved.');
  for (const node of nodes) {
    const prior = previous?.nodes.find(n => n.id === node.id);
    if (prior) node.previousStatus = snapshot(prior) === snapshot(node) ? 'unchanged' : 'changed';
  }
  const report: Report = { formatVersion: 0, repository: capture.repository, date, previousDate: previous?.date ?? null,
    title: `Repository briefing ${date}`, overview: { changed: `${nodes.length} recent PR records observed.`, blocked: 'No blocker inferred from PR metadata.', attention: 'No decision inferred from PR metadata.', unknowns: [`Partial coverage: latest 50 PRs only. Git revision ${capture.revision}. Captured ${capture.capturedAt}. HEAD subject: ${capture.commitSubject}. Remote changes after capture are unknown.`] },
    sources: [{ id: 'git-head', label: 'Captured git HEAD', url: `https://github.com/${capture.repository}/commit/${capture.revision}`, asOf: date }, ...capture.prs.map(pr => ({ id: `pr-${pr.number}`, label: `PR #${pr.number}`, url: pr.url, asOf: date }))],
    nodes, edges: [], views: [{ id: 'prs', label: 'Recent PRs', nodeIds: nodes.map(n => n.id), edgeIds: [] }],
    tour: [{ id: 'overview', title: 'Recent PR records', text: 'Observed PR metadata. Coverage is partial; no roadmap progress is inferred.', viewId: 'prs', nodeIds: nodes.map(n => n.id) }] };
  const result = validateReport(report, previous);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.report;
}

export function save(directory: string, capture: Capture): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const date = capture.capturedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid capture date');
  const files = readdirSync(directory).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const path = resolve(directory, `${date}.json`);
  const priorFile = files.filter(f => f < `${date}.json`).at(-1);
  const previous = priorFile ? JSON.parse(readFileSync(resolve(directory, priorFile), 'utf8')) as Report : undefined;
  if (files.includes(`${date}.json`)) {
    const existing = JSON.parse(readFileSync(path, 'utf8')) as Report;
    const checked = validateReport(existing, previous);
    if (!checked.ok || existing.repository !== capture.repository) throw new Error('Existing report invalid');
    return path;
  }
  if (files.some(f => f > `${date}.json`)) throw new Error('Cannot insert historical report');
  const report = generate(capture, previous);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    linkSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch { /* A failed write may leave no temporary file. */ } }
  return path;
}

export function run(directory: string): string {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const root = realpathSync(git('rev-parse', '--show-toplevel'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rel = relative(root, realpathSync(directory));
  if (!rel.startsWith('../')) throw new Error('Output must be outside the repository');
  const repository = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  const prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', repository, '--state', 'all', '--limit', '50', '--json', 'number,title,state,url'], { encoding: 'utf8' })) as Capture['prs'];
  return save(directory, { repository, revision: git('rev-parse', 'HEAD'), commitSubject: git('log', '-1', '--format=%s'), capturedAt: new Date().toISOString(), prs });
}
