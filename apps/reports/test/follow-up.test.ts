import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { followUp, followUpContent, type Action } from '../src/follow-up.js';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function setup() {
  const directory = mkdtempSync(resolve(tmpdir(), 'dagr-follow-')); directories.push(directory);
  const report = JSON.parse(readFileSync(new URL('../fixtures/day-1.json', import.meta.url), 'utf8'));
  const draft: Action = { kind: 'draft', report, nodeId: report.nodes.find((n: { sourceIds: string[] }) => n.sourceIds.length).id, key: 'review', title: 'Review finding', scope: 'Inspect evidence only', criteria: ['Record evidence'] };
  return { directory, draft };
}
it('keeps decisions inert and completes a simulated cycle with honest later content', () => {
  const { directory, draft } = setup();
  const p = followUp(directory, draft);
  for (const decision of ['draft', 'deferred', 'rejected'] as const) {
    expect(followUp(directory, { kind: 'decision', id: p.id, decision }).decision).toBe(decision);
    expect(() => followUp(directory, { kind: 'submit', id: p.id })).toThrow('acceptance');
    expect(JSON.parse(readFileSync(resolve(directory, 'follow-ups.json'), 'utf8')).tasks).toEqual({});
  }
  followUp(directory, { kind: 'decision', id: p.id, decision: 'accepted' });
  const receipt = followUp(directory, { kind: 'submit', id: p.id });
  expect(followUpContent(receipt, '2026-11-18')[0]).toMatchObject({ text: expect.stringContaining('unknown') });
  for (const state of ['blocked', 'failed', 'canceled', 'unknown', 'completed'] as const) {
    followUp(directory, { kind: 'fixture-status', id: p.id, state });
    const observed = followUp(directory, { kind: 'observe', id: p.id });
    expect(observed.observation?.state).toBe(state);
    expect(followUpContent(observed, new Date().toISOString().slice(0, 10))[0]).toMatchObject({ text: expect.stringContaining(`Work: ${state}`) });
    expect(followUpContent(observed, '2099-01-01')[0]).toMatchObject({ text: expect.stringContaining('stale') });
  }
  expect(() => followUp(directory, { kind: 'decision', id: p.id, decision: 'draft' })).toThrow('frozen');
});
it('survives durable response loss and rejects conflicting same-key drafts', () => {
  const { directory, draft } = setup(); const p = followUp(directory, draft);
  followUp(directory, { kind: 'decision', id: p.id, decision: 'accepted' });
  expect(() => followUp(directory, { kind: 'submit', id: p.id, loseResponse: true })).toThrow('response lost');
  const disk = JSON.parse(readFileSync(resolve(directory, 'follow-ups.json'), 'utf8'));
  expect(disk.proposals[p.id].submission).toBe('failed');
  expect(disk.proposals[p.id].acceptedAt).toBeTruthy();
  const retried = followUp(directory, { kind: 'submit', id: p.id });
  expect(retried.taskId).toBe(Object.keys(disk.tasks)[0]);
  expect(Object.keys(JSON.parse(readFileSync(resolve(directory, 'follow-ups.json'), 'utf8')).tasks)).toHaveLength(1);
  expect(() => followUp(directory, { ...draft, title: 'Changed' } as Action)).toThrow('Conflicting');
});
it('refuses private-path violations, overlapping writers and invalid provenance', () => {
  const { directory, draft } = setup();
  expect(() => followUp('.', draft)).toThrow('absolute');
  expect(() => followUp(process.cwd(), draft)).toThrow('outside');
  expect(() => followUp(directory, { ...draft, nodeId: 'missing' } as Action)).toThrow('finding');
  mkdirSync(resolve(directory, '.follow-up-lock'));
  expect(() => followUp(directory, draft)).toThrow('lock unavailable');
});

it('rejects escaping ledger symlinks and mismatched task identities', () => {
  const { directory, draft } = setup(); const other = setup().directory;
  symlinkSync(resolve(other, 'ledger.json'), resolve(directory, 'follow-ups.json'));
  writeFileSync(resolve(other, 'ledger.json'), '{}');
  expect(() => followUp(directory, draft)).toThrow('symlink');
  rmSync(resolve(directory, 'follow-ups.json'));
  const p = followUp(directory, draft);
  followUp(directory, { kind: 'decision', id: p.id, decision: 'accepted' });
  const receipt = followUp(directory, { kind: 'submit', id: p.id });
  const path = resolve(directory, 'follow-ups.json');
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  ledger.tasks[receipt.taskId!].repository = 'other/repository';
  writeFileSync(path, JSON.stringify(ledger));
  expect(() => followUp(directory, { kind: 'observe', id: p.id })).toThrow('identity');
});
