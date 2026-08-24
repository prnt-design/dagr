import { Graph } from '@dagr/graph';
import { describe, expect, it, vi } from 'vitest';
import { InvalidSpecError, NodeKindMissingError, UnknownNodeKindError } from '../src/errors.js';
import { DEFAULT_KIND_KEY, defineRegistry } from '../src/registry.js';

/**
 * A registry with two kinds of genuinely different shape, used by most of the
 * cases below. `filter` reuses `out` as a port id on purpose: port ids are
 * unique within a node, not across a graph, and the same has to hold across
 * kinds or two kinds could never share a vocabulary.
 */
function twoKinds() {
  return defineRegistry({
    source: { ports: [{ id: 'out', direction: 'out' }] },
    filter: {
      ports: [
        { id: 'in', direction: 'in', maxEdges: 1 },
        { id: 'out', direction: 'out' },
      ],
    },
  });
}

describe('defineRegistry', () => {
  it('takes the kind from the key, once', () => {
    const registry = twoKinds();
    expect(registry.get('source').kind).toBe('source');
    expect(registry.get('filter').kind).toBe('filter');
  });

  it('lists its kinds in declaration order and freezes the list', () => {
    const registry = twoKinds();
    expect(registry.kinds).toEqual(['source', 'filter']);
    expect(Object.isFrozen(registry.kinds)).toBe(true);
  });

  it('gives a kind that declared no ports an empty frozen list', () => {
    const registry = defineRegistry({ note: {} });
    expect(registry.get('note').ports).toEqual([]);
    expect(Object.isFrozen(registry.get('note').ports)).toBe(true);
  });

  it('freezes each spec and returns the same one every time', () => {
    const registry = twoKinds();
    const first = registry.get('source');
    expect(registry.get('source')).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ports[0])).toBe(true);
  });

  it('copies the caller literal, so a later mutation of it changes nothing', () => {
    const ports = [{ id: 'out', direction: 'out' as const }];
    const registry = defineRegistry({ source: { ports } });
    ports.push({ id: 'sneaked', direction: 'out' as const });
    expect(registry.get('source').ports).toHaveLength(1);
  });

  it('reports its own kind key', () => {
    expect(twoKinds().kindKey).toBe(DEFAULT_KIND_KEY);
    expect(defineRegistry({ a: {} }, { kindKey: 'type' }).kindKey).toBe('type');
  });

  it('answers membership for an arbitrary string', () => {
    const registry = twoKinds();
    expect(registry.has('source')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    expect(registry.has('__proto__')).toBe(false);
    expect(registry.has('toString')).toBe(false);
  });

  it('holds no kinds when it was given none', () => {
    const registry = defineRegistry({});
    expect(registry.kinds).toEqual([]);
    expect(registry.has('anything')).toBe(false);
  });
});

describe('defineRegistry rejects a spec it cannot hand on', () => {
  it('rejects an empty kind', () => {
    expect(() => defineRegistry({ '': {} })).toThrow(InvalidSpecError);
  });

  it('rejects an empty port id', () => {
    expect(() => defineRegistry({ a: { ports: [{ id: '', direction: 'in' }] } })).toThrow(
      InvalidSpecError,
    );
  });

  it('rejects a port id declared twice in one kind', () => {
    expect(() =>
      defineRegistry({
        a: {
          ports: [
            { id: 'p', direction: 'in' },
            { id: 'p', direction: 'out' },
          ],
        },
      }),
    ).toThrow(InvalidSpecError);
  });

  it('allows the same port id in two different kinds', () => {
    expect(() =>
      defineRegistry({
        a: { ports: [{ id: 'p', direction: 'in' }] },
        b: { ports: [{ id: 'p', direction: 'in' }] },
      }),
    ).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects maxEdges %s',
    (maxEdges) => {
      expect(() =>
        defineRegistry({ a: { ports: [{ id: 'p', direction: 'in', maxEdges }] } }),
      ).toThrow(InvalidSpecError);
    },
  );

  it('accepts maxEdges 1', () => {
    expect(() =>
      defineRegistry({ a: { ports: [{ id: 'p', direction: 'in', maxEdges: 1 }] } }),
    ).not.toThrow();
  });

  it('names the kind and the problem it found', () => {
    try {
      defineRegistry({ filter: { ports: [{ id: '', direction: 'in' }] } });
      expect.unreachable('the empty port id should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSpecError);
      expect((error as InvalidSpecError).kind).toBe('filter');
      expect((error as InvalidSpecError).message).toContain('filter');
    }
  });
});

describe('resolving a node', () => {
  it('reads the kind off the node attributes', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'filter' } });
    expect(registry.resolve(node)).toBe(registry.get('filter'));
    expect(registry.kindOf(node)).toBe('filter');
  });

  it('reads the key it was configured with', () => {
    const registry = defineRegistry({ source: {} }, { kindKey: 'type' });
    const graph = new Graph();
    const node = graph.addNode({ attrs: { type: 'source', kind: 'filter' } });
    expect(registry.resolve(node).kind).toBe('source');
  });

  it('refuses a node with no kind attribute', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode('bare');
    expect(() => registry.resolve(node)).toThrow(NodeKindMissingError);
    expect(registry.kindOf(node)).toBeUndefined();
    expect(registry.tryResolve(node)).toBeUndefined();
  });

  it('refuses a kind attribute that is not a string, and says what was there', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 7 } });
    try {
      registry.resolve(node);
      expect.unreachable('a numeric kind should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NodeKindMissingError);
      expect((error as NodeKindMissingError).value).toBe(7);
    }
    expect(registry.kindOf(node)).toBeUndefined();
  });

  it('refuses a legible kind it does not declare, and says what it does', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'sink' } });
    try {
      registry.resolve(node);
      expect.unreachable('an undeclared kind should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownNodeKindError);
      expect((error as UnknownNodeKindError).kind).toBe('sink');
      expect((error as UnknownNodeKindError).kinds).toEqual(['source', 'filter']);
    }
    expect(registry.kindOf(node)).toBeUndefined();
    expect(registry.tryResolve(node)).toBeUndefined();
  });

  it('does not resolve an inherited property name', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'toString' } });
    expect(() => registry.resolve(node)).toThrow(UnknownNodeKindError);
  });

  it('finds a port on a kind', () => {
    const registry = twoKinds();
    expect(registry.port('filter', 'in')).toEqual({ id: 'in', direction: 'in', maxEdges: 1 });
    expect(registry.port('filter', 'absent')).toBeUndefined();
  });
});

describe('the config check the consumer supplies', () => {
  it('is called with the node attributes and its answer handed back', () => {
    const checkConfig = vi.fn(() => ['threshold must be a number']);
    const registry = defineRegistry({ filter: { checkConfig } });
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'filter', threshold: 'high' } });
    expect(registry.checkConfig(node)).toEqual(['threshold must be a number']);
    expect(checkConfig).toHaveBeenCalledWith(node.attrs);
  });

  it('reports no problems for a kind that declared no check', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'source' } });
    expect(registry.checkConfig(node)).toEqual([]);
  });

  it('resolves before it checks, so an unknown kind throws rather than passing', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode({ attrs: { kind: 'sink' } });
    expect(() => registry.checkConfig(node)).toThrow(UnknownNodeKindError);
  });
});

describe('building a node from a kind', () => {
  it('carries the kind and the declared ports', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode(registry.nodeInit('filter'));
    expect(node.attrs.kind).toBe('filter');
    expect(node.ports.map((port) => port.id)).toEqual(['in', 'out']);
    expect(node.ports.map((port) => port.direction)).toEqual(['in', 'out']);
  });

  it('takes an id and attributes from the caller', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode(registry.nodeInit('source', { id: 'src', attrs: { label: 'In' } }));
    expect(node.id).toBe('src');
    expect(node.attrs.label).toBe('In');
  });

  it('writes the kind last, so a caller cannot mislabel the node', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode(registry.nodeInit('source', { attrs: { kind: 'filter' } }));
    expect(node.attrs.kind).toBe('source');
  });

  it('writes the kind under the configured key', () => {
    const registry = defineRegistry({ source: {} }, { kindKey: 'type' });
    const graph = new Graph();
    const node = graph.addNode(registry.nodeInit('source'));
    expect(node.attrs.type).toBe('source');
    expect(node.attrs.kind).toBeUndefined();
  });

  it('produces a node the same registry resolves', () => {
    const registry = twoKinds();
    const graph = new Graph();
    const node = graph.addNode(registry.nodeInit('filter'));
    expect(registry.resolve(node)).toBe(registry.get('filter'));
  });
});
