/** JSON-only format. Text is plain text, never trusted HTML or Markdown. */
export type Entity = { kind: 'pr' | 'package' | 'milestone'; key: string };
export type Content =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'link'; label: string; sourceId: string }
  | { kind: 'node'; label: string; nodeId: string };
export interface ReportNode {
  id: string;
  entity: Entity;
  label: string;
  summary: string;
  content: Content[];
  sourceIds: string[];
  confidence: { level: 'confirmed' | 'inferred' | 'unknown'; reason: string };
  previousStatus: 'new' | 'changed' | 'unchanged' | 'unknown';
  activity: 'observed' | 'proposed' | 'unknown';
  state: 'open' | 'blocked' | 'done' | 'unknown';
  attention: { needed: boolean; reason: string };
}
export interface Report {
  formatVersion: 0;
  repository: string;
  date: string;
  previousDate: string | null;
  title: string;
  overview: { changed: string; blocked: string; attention: string; unknowns: string[] };
  sources: { id: string; label: string; url: string; asOf: string }[];
  nodes: ReportNode[];
  edges: { id: string; source: string; target: string; label: string }[];
  views: { id: string; label: string; nodeIds: string[]; edgeIds: string[] }[];
  tour: { id: string; title: string; text: string; viewId: string; nodeIds: string[] }[];
}
