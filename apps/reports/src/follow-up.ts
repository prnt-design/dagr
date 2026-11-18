import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, readFileSync, existsSync, writeFileSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateReport } from './index.js';
import type { Report, Content } from './types.js';

type Decision = 'draft' | 'deferred' | 'rejected' | 'accepted';
type WorkState = 'queued' | 'running' | 'blocked' | 'failed' | 'canceled' | 'completed' | 'unknown';
interface Payload { repository: string; date: string; nodeId: string; key: string; title: string; scope: string; criteria: string[]; sources: Report['sources'] }
interface Task { id: string; proposalId: string; repository: string; state: WorkState; observedAt: string }
interface Proposal { id: string; payload: Payload; decision: Decision; acceptedAt?: string; submission: 'none' | 'pending' | 'failed' | 'submitted'; error?: string; taskId?: string; observation?: Task }
interface Ledger { version: 0; adapter: 'simulated-fixture'; proposals: Record<string, Proposal>; tasks: Record<string, Task> }
export type Action =
  | { kind: 'draft'; report: unknown; previous?: unknown; nodeId: string; key: string; title: string; scope: string; criteria: string[] }
  | { kind: 'decision'; id: string; decision: Decision }
  | { kind: 'submit'; id: string; loseResponse?: boolean }
  | { kind: 'observe'; id: string }
  | { kind: 'fixture-status'; id: string; state: WorkState };
const states: WorkState[] = ['queued', 'running', 'blocked', 'failed', 'canceled', 'completed', 'unknown'];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = (s: string) => typeof s === 'string' && s.trim().length > 0;

/** All fixture operations share one writer lock, including task creation and readback. */
export function followUp(directory: string, action: Action): Proposal {
  if (!action || !['draft', 'decision', 'submit', 'observe', 'fixture-status'].includes(action.kind)) throw new Error('Invalid action');
  if (!isAbsolute(directory)) throw new Error('Private ledger path must be absolute');
  const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  directory = realpathSync(directory);
  if (!relative(root, directory).startsWith('../')) throw new Error('Private ledger must be outside checkout');
  const lock = resolve(directory, '.follow-up-lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Ledger writer lock unavailable; retry after writer finishes. Interrupted locks require manual recovery.'); }
  try {
    const path = resolve(directory, 'follow-ups.json');
    if (existsSync(path) && realpathSync(path) !== path) throw new Error('Ledger symlink refused');
    const ledger: Ledger = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Ledger : { version: 0, adapter: 'simulated-fixture', proposals: {}, tasks: {} };
    if (ledger.version !== 0 || ledger.adapter !== 'simulated-fixture') throw new Error('Unsupported ledger');
    const save = () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
    };
    let proposal: Proposal;
    if (action.kind === 'draft') {
      const checked = validateReport(action.report, action.previous);
      if (!checked.ok) throw new Error(`Invalid source report: ${checked.errors.join(', ')}`);
      const report = checked.report;
      if (typeof action.nodeId !== 'string') throw new Error('Invalid finding ID');
      const node = report.nodes.find(n => n.id === action.nodeId);
      if (!node || !node.sourceIds.length) throw new Error('Source-linked finding required');
      if (!Array.isArray(action.criteria) || !action.criteria.length || ![action.key, action.title, action.scope, ...action.criteria].every(nonempty)) throw new Error('Key, scope, title and acceptance criteria required');
      const payload: Payload = { repository: report.repository, date: report.date, nodeId: node.id, key: action.key, title: action.title, scope: action.scope, criteria: action.criteria, sources: report.sources.filter(s => node.sourceIds.includes(s.id)) };
      const id = digest([payload.repository, payload.date, payload.nodeId, payload.key]);
      const prior = ledger.proposals[id];
      if (prior && digest(prior.payload) !== digest(payload)) throw new Error('Conflicting proposal payload');
      proposal = prior ?? { id, payload, decision: 'draft', submission: 'none' };
      ledger.proposals[id] = proposal;
    } else {
      if (typeof action.id !== 'string' || !/^[a-f0-9]{64}$/.test(action.id)) throw new Error('Invalid proposal ID');
      proposal = ledger.proposals[action.id]!;
      if (!proposal || proposal.id !== action.id) throw new Error('Unknown proposal');
      if (action.kind === 'decision') {
        if (!['draft', 'deferred', 'rejected', 'accepted'].includes(action.decision)) throw new Error('Invalid decision');
        if (proposal.decision === 'accepted' && action.decision !== 'accepted') throw new Error('Accepted payload and authorization are frozen');
        proposal.decision = action.decision;
        if (action.decision === 'accepted') proposal.acceptedAt ??= new Date().toISOString();
      } else {
        if (proposal.decision !== 'accepted' || !proposal.acceptedAt) throw new Error('Explicit simulated acceptance required');
        const taskId = `fixture-${proposal.id}`;
        const task = ledger.tasks[taskId];
        if (task && (task.id !== taskId || task.proposalId !== proposal.id || task.repository !== proposal.payload.repository || !states.includes(task.state) || !Number.isFinite(Date.parse(task.observedAt)))) throw new Error('Task identity mismatch');
        if (action.kind === 'submit') {
          proposal.submission = 'pending'; save();
          ledger.tasks[taskId] ??= { id: taskId, proposalId: proposal.id, repository: proposal.payload.repository, state: 'queued', observedAt: new Date().toISOString() };
          save();
          if (action.loseResponse) { proposal.submission = 'failed'; proposal.error = 'Simulated response lost; retry same proposal'; save(); throw new Error(proposal.error); }
          proposal.taskId = taskId; proposal.submission = 'submitted'; delete proposal.error;
        } else {
          if (!task || proposal.taskId !== task.id) throw new Error('No submitted task receipt');
          if (action.kind === 'fixture-status') {
            if (!states.includes(action.state)) throw new Error('Invalid fixture status');
            task.state = action.state; task.observedAt = new Date().toISOString();
          } else proposal.observation = structuredClone(task);
        }
      }
    }
    save(); return structuredClone(proposal);
  } finally { rmdirSync(lock); }
}

export function followUpContent(proposal: Proposal, asOf: string): Content[] {
  const observed = proposal.observation;
  const fresh = observed && observed.id === proposal.taskId && observed.proposalId === proposal.id && observed.repository === proposal.payload.repository && observed.observedAt.slice(0, 10) === asOf;
  return [{ kind: 'paragraph', text: `SIMULATED FIXTURE follow-up ${proposal.id}: decision ${proposal.decision}; submission ${proposal.submission}; task ${proposal.taskId ?? 'none'}. Work: ${fresh ? observed.state : 'unknown (missing or stale observation)'}. Receipt is not completion. Source: ${proposal.payload.repository}/${proposal.payload.date}/${proposal.payload.nodeId}.` }];
}
