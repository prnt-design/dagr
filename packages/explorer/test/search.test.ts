import { describe, expect, it } from 'vitest';
import { defaultSearchText, searchNodes } from '../src/index.js';
import type { ExplorerNode } from '../src/index.js';

interface Service extends ExplorerNode {
  readonly team: string;
}

const nodes: Service[] = [
  { id: 'api', label: 'Public API', team: 'platform' },
  { id: 'auth', label: 'Auth service', team: 'identity' },
  { id: 'db', label: 'Orders (v2.*)', team: 'platform' },
];

const ids = (found: readonly ExplorerNode[]): string[] => found.map((node) => node.id);

describe('searchNodes', () => {
  it('matches the id and the label by default', () => {
    expect(defaultSearchText({ id: 'api', label: 'Public API' })).toBe('api Public API');
    expect(ids(searchNodes(nodes, 'auth'))).toEqual(['auth']);
    expect(ids(searchNodes(nodes, 'public'))).toEqual(['api']);
  });

  it('ignores case in the query and in the text', () => {
    expect(ids(searchNodes(nodes, 'PUBLIC api'))).toEqual(['api']);
  });

  it('requires every token, in any order', () => {
    expect(ids(searchNodes(nodes, 'service auth'))).toEqual(['auth']);
    expect(ids(searchNodes(nodes, 'auth orders'))).toEqual([]);
  });

  it('matches nothing for an empty or blank query', () => {
    expect(searchNodes(nodes, '')).toEqual([]);
    expect(searchNodes(nodes, '   \t\n')).toEqual([]);
  });

  it('tolerates extra whitespace around and between tokens', () => {
    expect(ids(searchNodes(nodes, '  auth    service  '))).toEqual(['auth']);
  });

  it('keeps the order of the data', () => {
    expect(ids(searchNodes(nodes, 'a'))).toEqual(['api', 'auth']);
  });

  it('searches what the accessor returns, with the node typed', () => {
    const byTeam = (node: Service): string => node.team;
    expect(ids(searchNodes(nodes, 'platform', byTeam))).toEqual(['api', 'db']);
    expect(ids(searchNodes(nodes, 'auth', byTeam))).toEqual([]);
  });

  it('treats regex metacharacters in the query as text', () => {
    expect(ids(searchNodes(nodes, '(v2.*)'))).toEqual(['db']);
    expect(ids(searchNodes(nodes, '.*'))).toEqual(['db']);
    expect(searchNodes(nodes, '[')).toEqual([]);
  });

  it('does not throw when the accessor returns something that is not a string', () => {
    const broken = (() => undefined) as unknown as (node: Service) => string;
    expect(searchNodes(nodes, 'api', broken)).toEqual([]);
    const numeric = (() => 42) as unknown as (node: Service) => string;
    expect(ids(searchNodes(nodes, '42', numeric))).toEqual(['api', 'auth', 'db']);
  });

  it('returns a new array and leaves the input alone', () => {
    const found = searchNodes(nodes, 'a');
    expect(found).not.toBe(nodes);
    expect(nodes).toHaveLength(3);
  });
});
