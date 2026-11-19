import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prepareDispatch, submitDispatch, readDispatchJournal, dispatchStatus, type DispatchRecord, type DispatchTransport, type Journal } from '../src/dispatch-protocol.js';
import { digest, type Proposal } from '../src/follow-up.js';

function setup() {
  const report = JSON.parse(readFileSync(new URL('../fixtures/day-1.json', import.meta.url), 'utf8'));
  const proposal: Proposal = { id: 'a'.repeat(64), payload: { repository: report.repository, date: report.date, nodeId: report.nodes[0].id, key: 'review', title: 'Review finding', scope: 'Inspect evidence', criteria: ['Record result'], sources: report.sources }, decision: 'accepted', acceptedAt: '2026-11-19T00:00:00Z', submission: 'none' };
  proposal.id = digest([proposal.payload.repository, proposal.payload.date, proposal.payload.nodeId, proposal.payload.key]);
  const binding = { proposalId: proposal.id, payloadHash: digest(proposal.payload), projectId: 'project', column: 'backlog', namespace: 'namespace', actorId: 'writer', approvalMessageId: 'original-user-message' };
  const journal = prepareDispatch(proposal, binding, () => true);
  let saved = structuredClone(journal);
  const records: DispatchRecord[] = [];
  let calls = 0;
  const record = (): DispatchRecord => ({ id: 'task-1', projectId: 'project', body: journal.body, createdBy: { kind: 'agent', agentId: 'writer' }, column: 'backlog', completedAt: null, archivedAt: null, launching: null, latestFailure: null, updatedAt: '2026-11-19T00:00:00Z' });
  const transport: DispatchTransport = {
    board: async () => ({ projectId: 'project', columns: [{ key: 'backlog', isDone: false, trigger: null }] }),
    scan: async () => ({ complete: true, records: structuredClone(records) }),
    create: async () => { calls++; records.push(record()); return { id: 'task-1' }; },
    get: async id => { const found = records.find(r => r.id === id); if (!found) throw new Error('missing'); return structuredClone(found); },
  };
  return { proposal, binding, journal, records, record, transport, calls: () => calls,
    saved: () => JSON.parse(JSON.stringify(saved)) as Journal,
    checkpoint: async (j: Journal) => { saved = JSON.parse(JSON.stringify(j)) as Journal; } };
}
it('requires an injected exact-scope approval capability and keeps other decisions inert', () => {
  const s = setup();
  for (const decision of ['draft', 'deferred', 'rejected'] as const) expect(() => prepareDispatch({ ...s.proposal, decision }, s.binding, () => true)).toThrow('approval');
  expect(() => prepareDispatch(s.proposal, s.binding, () => false)).toThrow('approval');
  expect(() => prepareDispatch(s.proposal, { ...s.binding, payloadHash: 'b'.repeat(64) }, () => true)).toThrow('approval');
  expect(s.calls()).toBe(0);
});
it('checkpoints before create and preserves a stable mapping on resubmit', async () => {
  const s = setup(); const create = s.transport.create;
  s.transport.create = async request => { expect(s.saved().phase).toBe('attempting'); return create(request); };
  const mapped = await submitDispatch(s.journal, s.transport, s.checkpoint);
  expect(mapped.taskId).toBe('task-1');
  await submitDispatch(s.saved(), s.transport, s.checkpoint);
  expect(s.calls()).toBe(1);
});
it('recovers a committed create after lost response and serialized restart, including archived tasks', async () => {
  const s = setup(); const create = s.transport.create;
  s.transport.create = async request => { await create(request); throw new Error('lost response'); };
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('lost');
  s.records[0]!.archivedAt = '2026-11-19T01:00:00Z';
  expect((await submitDispatch(s.saved(), s.transport, s.checkpoint)).taskId).toBe('task-1');
  expect(s.calls()).toBe(1);
});
it('never resubmits an uncertain zero-match call and can bind its late commit', async () => {
  const s = setup(); s.transport.create = async () => { throw new Error('disconnect'); };
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow();
  await expect(submitDispatch(s.saved(), s.transport, s.checkpoint)).rejects.toThrow('never resubmit');
  s.records.push(s.record());
  expect((await submitDispatch(s.saved(), s.transport, s.checkpoint)).phase).toBe('mapped');
});
it('does not create after checkpoint failure, incomplete scan, or unsafe board', async () => {
  const s = setup();
  await expect(submitDispatch(s.journal, s.transport, async () => { throw new Error('disk'); })).rejects.toThrow('disk');
  expect(s.calls()).toBe(0);
  s.transport.scan = async () => ({ complete: false, records: [] });
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('incomplete');
  s.transport.scan = async () => ({ complete: true, records: [] });
  s.transport.board = async () => ({ projectId: 'wrong', columns: [] });
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('Inert');
  s.transport.board = async () => ({ projectId: 'project', columns: [{ key: 'backlog', isDone: false, trigger: {} }] });
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('Inert');
  expect(s.calls()).toBe(0);
});
it('refuses copied markers, duplicate candidates and denied readback without recreating', async () => {
  const s = setup(); s.records.push({ ...s.record(), createdBy: { kind: 'agent', agentId: 'other' } });
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('conflicting');
  s.records.splice(0, 1, s.record(), { ...s.record(), id: 'copy' });
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('conflicting');
  s.records.length = 0;
  s.transport.get = async () => { throw new Error('denied'); };
  await expect(submitDispatch(s.journal, s.transport, s.checkpoint)).rejects.toThrow('denied');
  expect(s.saved().phase).toBe('attempting'); expect(s.calls()).toBe(1);
});
it('refuses missing and corrupt journals', () => {
  const s = setup();
  for (const value of [undefined, {}, { ...s.journal, body: '{}' }, { ...s.journal, phase: 'mapped' }]) expect(() => readDispatchJournal(value)).toThrow('journal');
});
it('projects board observations without inferring execution, cancellation or work failure', () => {
  const s = setup(); const j: Journal = { ...s.journal, phase: 'mapped', taskId: 'task-1' }; const r = s.record(); const at = '2026-11-19T01:00:00Z';
  expect(dispatchStatus(j, r, at, '2026-11-19')).toContain('queued');
  expect(dispatchStatus(j, { ...r, column: 'in_progress' }, at, '2026-11-19')).toContain('board in progress');
  expect(dispatchStatus(j, { ...r, column: 'in_review', archivedAt: at, latestFailure: {} }, at, '2026-11-19')).toContain('review pending; archived: true; launch pending: false; launch failure: true');
  expect(dispatchStatus(j, { ...r, column: 'done', completedAt: at }, at, '2026-11-19')).toContain('board completed');
  for (const column of ['blocked', 'failed', 'canceled']) expect(dispatchStatus(j, { ...r, column }, at, '2026-11-19')).toContain('unknown');
  expect(dispatchStatus(j, { ...r, column: 'done' }, at, '2026-11-19')).toContain('contradictory');
  expect(dispatchStatus(j, r, at, '2026-11-20')).toContain('stale');
  expect(dispatchStatus(j, r, at, '2026-11-19', true)).toContain('failed');
});

it('retains uncertainty after a persisted checkpoint interruption before send', async () => {
  const s = setup();
  await expect(submitDispatch(s.journal, s.transport, async j => { await s.checkpoint(j); throw new Error('interrupted'); })).rejects.toThrow('interrupted');
  await expect(submitDispatch(s.saved(), s.transport, s.checkpoint)).rejects.toThrow('never resubmit');
  expect(s.calls()).toBe(0);
});
it('does not recreate when mapped identity changes or receipt verification fails', async () => {
  const s = setup();
  const mapped = await submitDispatch(s.journal, s.transport, s.checkpoint);
  s.records[0]!.projectId = 'other';
  await expect(submitDispatch(mapped, s.transport, s.checkpoint)).rejects.toThrow('identity');
  expect(s.calls()).toBe(1);
  const t = setup();
  t.transport.get = async () => ({ ...t.record(), id: 'wrong' });
  await expect(submitDispatch(t.journal, t.transport, t.checkpoint)).rejects.toThrow('identity');
  expect(t.saved().phase).toBe('attempting');
});

it('rechecks derived proposal identity during preparation and journal read', () => {
  const s = setup(); const wrong = 'b'.repeat(64);
  expect(() => prepareDispatch({ ...s.proposal, id: wrong }, { ...s.binding, proposalId: wrong }, () => true)).toThrow('approval');
  const binding = { ...s.binding, proposalId: wrong };
  const body = JSON.parse(s.journal.body); body.binding = binding;
  expect(() => readDispatchJournal({ ...s.journal, binding, body: JSON.stringify(body) })).toThrow('journal');
});
it('approves one canonical frozen binding and excludes extra host fields', () => {
  const s = setup(); const host = { secret: 'do-not-publish', ...s.binding };
  let approved: unknown;
  const j = prepareDispatch(s.proposal, host, binding => {
    approved = binding;
    expect(Object.isFrozen(binding)).toBe(true);
    host.projectId = 'changed-after-approval';
    return true;
  });
  expect(j.binding).toBe(approved);
  expect(j.binding.projectId).toBe('project');
  expect(j.body).not.toContain('do-not-publish');
  expect(JSON.parse(j.body).binding).toEqual(j.binding);
  expect(Object.keys(j.binding)).toEqual(['proposalId', 'payloadHash', 'projectId', 'column', 'namespace', 'actorId', 'approvalMessageId']);
  const binding = { ...j.binding, secret: 'extra' };
  const body = JSON.parse(j.body); body.binding = binding;
  expect(() => readDispatchJournal({ ...j, binding, body: JSON.stringify(body) })).toThrow('journal');
});
it('projects unknown for unmapped or mismatched observations without invented source', () => {
  const s = setup(); const j: Journal = { ...s.journal, phase: 'mapped', taskId: 'task-1' };
  const at = '2026-11-19T01:00:00Z';
  for (const r of [{ ...s.record(), id: 'wrong' }, { ...s.record(), projectId: 'wrong' }, { ...s.record(), body: 'changed' }, { ...s.record(), createdBy: { kind: 'agent', agentId: 'wrong' } }]) {
    expect(dispatchStatus(j, r, at, '2026-11-19')).toContain('unknown');
  }
  expect(dispatchStatus(s.journal, s.record(), at, '2026-11-19')).toContain('unknown');
  expect(dispatchStatus(j, s.record(), at, '2026-11-19')).not.toContain('source:');
});
