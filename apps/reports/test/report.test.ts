import { describe, expect, it } from 'vitest';
import day1 from '../fixtures/day-1.json';
import day2 from '../fixtures/day-2.json';
import invalid from '../fixtures/invalid-cases.json';
import { entityId, validateReport } from '../src/index.js';

// A single RFC 6902 replace/remove operation makes invalid fixtures readable and reusable.
function patch(input: unknown, operation: { op: string; path: string; value?: unknown }): unknown {
  const copy = structuredClone(input);
  const keys = operation.path.slice(1).split('/');
  let target = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const key = keys.at(-1)!;
  if (operation.op === 'remove') delete target[key];
  else target[key] = operation.value;
  return copy;
}

describe('report format v0', () => {
  it('accepts the first and consecutive daily briefing', () => {
    expect(validateReport(day1).ok).toBe(true);
    expect(validateReport(day2, day1).ok).toBe(true);
  });
  for (const fixture of invalid) it(`rejects ${fixture.name}`, () => {
    const result = validateReport(patch(day2, fixture.patch), day1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain(fixture.expected);
  });
  it.each([null, [], 5, {}, { ...day1, formatVersion: 1 }])('rejects malformed input %j', input => {
    expect(validateReport(input).ok).toBe(false);
  });
  it('requires unknown status when no comparison baseline is available', () => {
    expect(validateReport(day2).ok).toBe(false);
    const report = structuredClone(day2);
    report.nodes.forEach(n => { n.previousStatus = 'unknown'; });
    expect(validateReport(report).ok).toBe(true);
  });
  it('checks baseline identity and validates malformed baselines', () => {
    expect(validateReport(day2, { ...day1, repository: 'other/repo' }).ok).toBe(false);
    expect(validateReport(day2, { ...day1, date: '2026-10-27' }).ok).toBe(false);
    expect(validateReport(day2, {}).ok).toBe(false);
  });
  it('handles changed status and a third day without requiring the full archive', () => {
    const third = structuredClone(day2);
    third.date = '2026-10-30'; third.previousDate = day2.date;
    third.nodes.forEach(n => { n.previousStatus = 'unchanged'; });
    third.nodes[0]!.summary = 'Updated briefing text.';
    third.nodes[0]!.previousStatus = 'changed';
    expect(validateReport(third, day2).ok).toBe(true);
    third.nodes[0]!.previousStatus = 'unchanged';
    expect(validateReport(third, day2).ok).toBe(false);
  });
  it('ignores JSON object key order in cross-day comparisons', () => {
    const report = structuredClone(day2);
    report.nodes[0]!.content = [{ text: day2.nodes[0]!.summary, kind: 'paragraph' }];
    report.nodes[0]!.attention = { reason: 'No decision requested.', needed: false };
    expect(validateReport(report, day1).ok).toBe(true);
  });
  it('accepts an explicitly unknown blocked entity without evidence', () => {
    const report = structuredClone(day1);
    report.nodes[0]!.confidence = { level: 'unknown', reason: 'Synthetic fixture: blocker not verified.' };
    report.nodes[0]!.sourceIds = [];
    report.nodes[0]!.state = 'blocked';
    report.nodes[0]!.activity = 'unknown';
    expect(validateReport(report).ok).toBe(true);
    report.nodes[0]!.confidence.level = 'confirmed';
    expect(validateReport(report).ok).toBe(false);
  });
  it.each([
    ['/views/0/edgeIds', ['missing']],
    ['/tour/0/nodeIds', ['pr:172']],
    ['/nodes/1/content', [{ kind: 'node', label: 'Missing', nodeId: 'pr:999' }]],
    ['/nodes/0/content', [{ kind: 'link', label: 'Uncited', sourceId: 'pr172' }]],
    ['/sources/0/asOf', '2026-10-30'],
    ['/nodes/0/extra', true],
  ])('rejects invalid reference or field at %s', (path, value) => {
    expect(validateReport(patch(day1, { op: 'replace', path: path as string, value })).ok).toBe(false);
  });
  it('uses lossless stable names, not titles, dates or lossy slugs', () => {
    expect(entityId({ kind: 'pr', key: '181' })).toBe(day1.nodes[0]!.id);
    expect(entityId({ kind: 'package', key: '@dagr/living-stage' })).toBe(day1.nodes[1]!.id);
    expect(entityId({ kind: 'milestone', key: 'A/B' })).not.toBe(entityId({ kind: 'milestone', key: 'A-B' }));
    expect(() => entityId({ kind: 'pr', key: '0181' })).toThrow();
    expect(() => entityId({ kind: 'package', key: ' padded ' })).toThrow();
  });
});
