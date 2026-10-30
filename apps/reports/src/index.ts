import type { Entity, Report, ReportNode } from './types.js';
export type { Content, Entity, Report, ReportNode } from './types.js';

type Check = (value: unknown, path: string, errors: string[]) => void;
const fail = (path: string, errors: string[], message: string) => { errors.push(`${path}: ${message}`); };
const text: Check = (v, p, e) => {
  if (typeof v !== 'string' || !v.trim()) fail(p, e, 'expected nonempty string');
};
const choice = (...values: unknown[]): Check => (v, p, e) => {
  if (!values.includes(v)) fail(p, e, `expected ${values.join(' | ')}`);
};
const array = (check: Check, nonempty = false): Check => (v, p, e) => {
  if (!Array.isArray(v)) { fail(p, e, 'expected array'); return; }
  if (nonempty && !v.length) fail(p, e, 'expected at least one item');
  v.forEach((item, i) => check(item, `${p}[${i}]`, e));
};
const object = (fields: Record<string, Check>): Check => (v, p, e) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(p, e, 'expected object'); return; }
  const record = v as Record<string, unknown>;
  for (const [key, check] of Object.entries(fields)) check(record[key], `${p}.${key}`, e);
  for (const key of Object.keys(record)) if (!Object.hasOwn(fields, key)) fail(`${p}.${key}`, e, 'unknown field');
};
const date: Check = (v, p, e) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail(p, e, 'expected calendar date YYYY-MM-DD');
};
const url: Check = (v, p, e) => {
  try {
    const parsed = new URL(typeof v === 'string' ? v : '');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
  } catch { fail(p, e, 'expected absolute HTTPS URL without credentials'); }
};
const blocks: Record<string, Check> = {
  paragraph: object({ kind: choice('paragraph'), text }),
  list: object({ kind: choice('list'), items: array(text, true) }),
  code: object({ kind: choice('code'), language: text, text }),
  link: object({ kind: choice('link'), label: text, sourceId: text }),
  node: object({ kind: choice('node'), label: text, nodeId: text }),
};
const content: Check = (v, p, e) => {
  const kind = v && typeof v === 'object' && 'kind' in v ? v.kind : undefined;
  if (typeof kind !== 'string' || !Object.hasOwn(blocks, kind)) fail(p, e, 'unknown content kind');
  else blocks[kind]!(v, p, e);
};
const shape = object({
  formatVersion: choice(0), repository: text, date,
  previousDate: (v, p, e) => { if (v !== null) date(v, p, e); }, title: text,
  overview: object({ changed: text, blocked: text, attention: text, unknowns: array(text) }),
  sources: array(object({ id: text, label: text, url, asOf: date })),
  nodes: array(object({
    id: text, entity: object({ kind: choice('pr', 'package', 'milestone'), key: text }),
    label: text, summary: text, content: array(content, true), sourceIds: array(text),
    confidence: object({ level: choice('confirmed', 'inferred', 'unknown'), reason: text }),
    previousStatus: choice('new', 'changed', 'unchanged', 'unknown'),
    activity: choice('observed', 'proposed', 'unknown'), state: choice('open', 'blocked', 'done', 'unknown'),
    attention: object({ needed: choice(true, false), reason: text }),
  }), true),
  edges: array(object({ id: text, source: text, target: text, label: text })),
  views: array(object({ id: text, label: text, nodeIds: array(text, true), edgeIds: array(text) }), true),
  tour: array(object({ id: text, title: text, text, viewId: text, nodeIds: array(text, true) }), true),
});

/** Repository-scoped, lossless identity. Display titles and report dates never enter IDs. */
export function entityId(entity: Entity): string {
  if (entity.key !== entity.key.trim() || !entity.key ||
      (entity.kind === 'pr' && !/^[1-9]\d*$/.test(entity.key))) throw new Error('Invalid entity key');
  return `${entity.kind}:${encodeURIComponent(entity.key)}`;
}

function snapshot(node: ReportNode): string {
  // Evidence freshness, confidence and prose can change without changing entity status.
  return JSON.stringify([node.label, node.summary, node.content, node.activity, node.state, node.attention]);
}

export type Validation = { ok: true; report: Report } | { ok: false; errors: string[] };
/** Validate untrusted JSON. Supply the named previous report to verify cross-day claims. */
export function validateReport(input: unknown, previous?: unknown): Validation {
  return checkReport(input, previous, true);
}

function checkReport(input: unknown, previous: unknown, compare: boolean): Validation {
  const errors: string[] = [];
  shape(input, '$', errors);
  if (errors.length) return { ok: false, errors };
  const report = input as Report;
  const check = (condition: boolean, path: string, message: string) => { if (!condition) fail(path, errors, message); };
  const unique = (ids: string[], path: string) => check(new Set(ids).size === ids.length, path, 'duplicate ID');
  const refs = (ids: string[], allowed: Set<string>, path: string) => {
    unique(ids, path);
    ids.forEach(id => check(allowed.has(id), path, `dangling reference ${id}`));
  };
  const nodes = new Set(report.nodes.map(n => n.id));
  const sources = new Set(report.sources.map(s => s.id));
  const edges = new Set(report.edges.map(e => e.id));
  const views = new Map(report.views.map(v => [v.id, v]));
  for (const key of ['nodes', 'sources', 'edges', 'views', 'tour'] as const) unique(report[key].map(x => x.id), `$.${key}`);
  check(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(report.repository), '$.repository', 'expected owner/repo');
  check(report.previousDate === null || report.previousDate < report.date, '$.previousDate', 'must precede date');
  report.sources.forEach((s, i) => check(s.asOf <= report.date, `$.sources[${i}].asOf`, 'source is from the future'));
  report.nodes.forEach((n, i) => {
    const p = `$.nodes[${i}]`;
    try { check(n.id === entityId(n.entity), `${p}.id`, 'must match canonical entity ID'); }
    catch { fail(`${p}.entity`, errors, 'invalid entity key'); }
    refs(n.sourceIds, sources, `${p}.sourceIds`);
    check(n.confidence.level === 'unknown' || n.sourceIds.length > 0, `${p}.sourceIds`, 'known or inferred claims need evidence');
    check(n.activity !== 'proposed' || n.state !== 'done', p, 'a proposal cannot be completed activity');
    check(report.previousDate !== null || n.previousStatus === 'unknown', `${p}.previousStatus`, 'no baseline, status must be unknown');
    n.content.forEach((b, j) => {
      if (b.kind === 'link') refs([b.sourceId], new Set(n.sourceIds), `${p}.content[${j}]`);
      if (b.kind === 'node') refs([b.nodeId], nodes, `${p}.content[${j}]`);
    });
  });
  report.edges.forEach((e, i) => refs([e.source, e.target], nodes, `$.edges[${i}]`));
  report.views.forEach((v, i) => {
    refs(v.nodeIds, nodes, `$.views[${i}].nodeIds`);
    refs(v.edgeIds, edges, `$.views[${i}].edgeIds`);
    for (const edge of report.edges.filter(e => v.edgeIds.includes(e.id)))
      check(v.nodeIds.includes(edge.source) && v.nodeIds.includes(edge.target), `$.views[${i}]`, 'edge endpoints must belong to view');
  });
  report.tour.forEach((step, i) => {
    const view = views.get(step.viewId);
    check(!!view, `$.tour[${i}].viewId`, 'dangling view');
    refs(step.nodeIds, new Set(view?.nodeIds), `$.tour[${i}].nodeIds`);
  });
  if (previous !== undefined) {
    const result = checkReport(previous, undefined, false);
    if (!result.ok) errors.push(...result.errors.map(e => `previous: ${e}`));
    else {
      const old = result.report;
      check(old.repository === report.repository && old.date === report.previousDate, '$.previousDate', 'baseline repository/date mismatch');
      const oldNodes = new Map(old.nodes.map(n => [n.id, n]));
      report.nodes.forEach((n, i) => {
        const prior = oldNodes.get(n.id);
        const expected = !prior ? 'new' : snapshot(prior) === snapshot(n) ? 'unchanged' : 'changed';
        check(n.previousStatus === expected, `$.nodes[${i}].previousStatus`, `expected ${expected}`);
      });
    }
  } else if (compare && report.previousDate !== null) {
    report.nodes.forEach((n, i) => check(n.previousStatus === 'unknown', `$.nodes[${i}].previousStatus`, 'baseline not supplied, status must be unknown'));
  }
  return errors.length ? { ok: false, errors } : { ok: true, report };
}
