import { digest as hash, type Proposal } from './follow-up.js';

export interface Binding {
  proposalId: string;
  payloadHash: string;
  projectId: string;
  column: string;
  namespace: string;
  actorId: string;
  approvalMessageId: string;
}
export interface DispatchRecord {
  id: string;
  projectId: string;
  body: string;
  createdBy: { kind: string; agentId?: string };
  column: string;
  completedAt: string | null;
  archivedAt: string | null;
  launching: unknown;
  latestFailure: unknown;
  updatedAt: string;
}
export interface BoardSnapshot {
  projectId: string;
  columns: { key: string; isDone: boolean; trigger: unknown }[];
}
export interface Journal {
  version: 1;
  binding: Binding;
  body: string;
  title: string;
  phase: 'prepared' | 'attempting' | 'mapped';
  taskId?: string;
}
const identity = (p: Proposal['payload']) => hash([p.repository, p.date, p.nodeId, p.key]);
const bindingKeys = ['proposalId', 'payloadHash', 'projectId', 'column', 'namespace', 'actorId', 'approvalMessageId'] as const;
const canonicalBinding = (b: Binding): Binding => Object.freeze({ proposalId: b.proposalId, payloadHash: b.payloadHash, projectId: b.projectId, column: b.column, namespace: b.namespace, actorId: b.actorId, approvalMessageId: b.approvalMessageId });
const validBinding = (b: Binding) => b && bindingKeys.every(key => typeof b[key as keyof Binding] === 'string' && b[key as keyof Binding].trim()) &&
  /^[a-f0-9]{64}$/.test(b.proposalId) && /^[a-f0-9]{64}$/.test(b.payloadHash);

/** The host verifies original user evidence. This callback is a capability, not JSON authentication. */
export function prepareDispatch(proposal: Proposal, binding: Binding, authorize: (binding: Readonly<Binding>) => boolean): Journal {
  if (!validBinding(binding)) throw new Error('Verified exact-scope approval required');
  const approved = canonicalBinding(binding);
  if (proposal.id !== identity(proposal.payload) || proposal.decision !== 'accepted' || !proposal.acceptedAt ||
      approved.proposalId !== proposal.id || approved.payloadHash !== hash(proposal.payload) || !authorize(approved)) {
    throw new Error('Verified exact-scope approval required');
  }
  return { version: 1, binding: approved, title: proposal.payload.title,
    body: JSON.stringify({ protocol: 'dagr-dispatch-v1', binding: approved, payload: proposal.payload }), phase: 'prepared' };
}

export function readDispatchJournal(value: unknown): Journal {
  if (!value || typeof value !== 'object') throw new Error('Missing or corrupt journal');
  const j = value as Journal;
  if (j.version !== 1 || !validBinding(j.binding) || Object.keys(j.binding).length !== bindingKeys.length || !['prepared', 'attempting', 'mapped'].includes(j.phase) ||
      typeof j.body !== 'string' || typeof j.title !== 'string' || !j.title.trim() ||
      (j.phase === 'mapped' ? typeof j.taskId !== 'string' || !j.taskId.trim() : j.taskId !== undefined)) throw new Error('Missing or corrupt journal');
  try {
    const body = JSON.parse(j.body);
    if (body.protocol !== 'dagr-dispatch-v1' || identity(body.payload) !== j.binding.proposalId || JSON.stringify(body.binding) !== JSON.stringify(j.binding) ||
        hash(body.payload) !== j.binding.payloadHash || body.payload.title !== j.title) throw new Error();
  } catch { throw new Error('Missing or corrupt journal'); }
  return structuredClone(j);
}

export interface DispatchTransport {
  board(): Promise<BoardSnapshot>;
  /** Must enumerate active and archived records completely, hydrating bodies with task_get. */
  scan(): Promise<{ complete: boolean; records: DispatchRecord[] }>;
  create(request: { projectId: string; column: string; title: string; body: string }): Promise<{ id: string }>;
  get(id: string): Promise<DispatchRecord>;
}
const matches = (j: Journal, r: DispatchRecord) => r.projectId === j.binding.projectId && r.body === j.body &&
  r.createdBy.kind === 'agent' && r.createdBy.agentId === j.binding.actorId && typeof r.id === 'string' && !!r.id.trim();

/** Host holds a single-writer lock throughout and durably checkpoints before create. No create retries. */
export async function submitDispatch(value: unknown, transport: DispatchTransport, checkpoint: (journal: Journal) => Promise<void>): Promise<Journal> {
  const j = readDispatchJournal(value);
  if (j.phase === 'mapped') {
    const record = await transport.get(j.taskId!);
    if (record.id !== j.taskId || !matches(j, record)) throw new Error('Mapped identity mismatch');
    return j;
  }
  const scan = await transport.scan();
  if (!scan.complete) throw new Error('Reconciliation required: incomplete scan');
  // An exact body is the marker; a copied marker with another creator is also ambiguity.
  const candidates = scan.records.filter(r => r.body === j.body);
  if (candidates.length) {
    if (candidates.length !== 1 || !matches(j, candidates[0]!)) throw new Error('Reconciliation required: conflicting candidates');
    j.taskId = candidates[0]!.id; j.phase = 'mapped';
    await checkpoint(structuredClone(j)); return j;
  }
  if (j.phase === 'attempting') throw new Error('Reconciliation required: uncertain create, never resubmit');
  const board = await transport.board();
  const column = board.columns.find(c => c.key === j.binding.column);
  if (board.projectId !== j.binding.projectId || !column || column.isDone || column.trigger !== null) throw new Error('Inert target column required');
  j.phase = 'attempting';
  await checkpoint(structuredClone(j));
  // Any error after the checkpoint leaves durable attempting, even before a request is sent.
  const receipt = await transport.create({ projectId: j.binding.projectId, column: j.binding.column, title: j.title, body: j.body });
  const record = await transport.get(receipt.id);
  if (record.id !== receipt.id || !matches(j, record)) throw new Error('Reconciliation required: receipt identity mismatch');
  j.phase = 'mapped'; j.taskId = record.id;
  await checkpoint(structuredClone(j)); return j;
}

export function dispatchStatus(journal: Journal, record: DispatchRecord | undefined, retrievedAt: string, asOf: string, refreshFailed = false): string {
  const j = readDispatchJournal(journal);
  if (!record || j.phase !== 'mapped' || record.id !== j.taskId || !matches(j, record)) return 'unknown (unverified identity)';
  if (refreshFailed || !Number.isFinite(Date.parse(retrievedAt)) || retrievedAt.slice(0, 10) !== asOf || !Number.isFinite(Date.parse(record.updatedAt))) return 'unknown (missing, failed or stale observation)';
  if ((record.column === 'done') !== !!record.completedAt || (record.completedAt && !Number.isFinite(Date.parse(record.completedAt)))) return 'unknown (contradictory completion)';
  const state = ({ backlog: 'queued', ready: 'queued', in_progress: 'board in progress', in_review: 'review pending', done: 'board completed' } as Record<string, string>)[record.column] ?? 'unknown (unsupported column)';
  return `${state}; archived: ${!!record.archivedAt}; launch pending: ${!!record.launching}; launch failure: ${!!record.latestFailure}; observed: ${retrievedAt}; task: ${record.id}; project: ${record.projectId}`;
}
