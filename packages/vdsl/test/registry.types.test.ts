import { Graph } from '@dagr/graph';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { NodeRegistry, NodeSpec, NodeSpecInit } from '../src/index.js';
import { defineRegistry } from '../src/index.js';

/**
 * Type-level coverage of the one promise this package makes about types: the
 * consumer's kind union survives the boundary.
 *
 * These assertions are checked by `tsc --noEmit`, which covers this directory,
 * so the file failing to compile is the failure this suite exists to catch.
 * The runtime bodies are here because a vitest file has to hold at least one
 * test, and because a type promise no execution exercises is worth doubting.
 * This is `@dagr/graph`'s arrangement in `graph.types.test.ts`, for its reason.
 */

const registry = defineRegistry({
  source: { ports: [{ id: 'out', direction: 'out' }] },
  filter: { ports: [{ id: 'in', direction: 'in', maxEdges: 1 }] },
});

type Kind = 'source' | 'filter';

describe('the kind union survives the boundary', () => {
  it('infers the union from the object literal keys', () => {
    expectTypeOf(registry).toEqualTypeOf<NodeRegistry<Kind>>();
    expectTypeOf(registry.kinds).toEqualTypeOf<readonly Kind[]>();
    expect(registry.kinds).toHaveLength(2);
  });

  it('threads it through every spec it hands out', () => {
    expectTypeOf(registry.get('source')).toEqualTypeOf<NodeSpec<Kind>>();
    expectTypeOf(registry.get('source').kind).toEqualTypeOf<Kind>();
    expectTypeOf(registry.resolve).returns.toEqualTypeOf<NodeSpec<Kind>>();
    expectTypeOf(registry.tryResolve).returns.toEqualTypeOf<NodeSpec<Kind> | undefined>();
    expectTypeOf(registry.kindOf).returns.toEqualTypeOf<Kind | undefined>();
    expect(registry.get('source').kind).toBe('source');
  });

  it('refuses a kind the registry never declared', () => {
    // @ts-expect-error 'sink' is not one of the declared kinds.
    expect(() => registry.get('sink')).toThrow();
    // @ts-expect-error the same, on the other kind-taking methods. JavaScript
    // still reaches them with any string, so the runtime answer is the throw
    // rather than `undefined`: an undeclared kind has no ports to be absent
    // from.
    expect(() => registry.port('sink', 'out')).toThrow();
  });

  it('narrows an arbitrary string through the membership test', () => {
    const fromSomewhereElse: string = 'source';
    if (registry.has(fromSomewhereElse)) {
      expectTypeOf(fromSomewhereElse).toEqualTypeOf<Kind>();
      expect(registry.get(fromSomewhereElse).kind).toBe('source');
    } else {
      expect.unreachable('source is a declared kind');
    }
  });

  it('builds an init the caller\'s own typed graph accepts', () => {
    // The attribute type comes from the caller, inferred from the graph the
    // init is handed to, so their own keys are checked. This is the case that
    // says the registry composes with a typed `Graph` rather than only with
    // the default attribute bag.
    type NodeAttrs = { kind: Kind; label: string };
    const graph = new Graph<NodeAttrs>();
    const node = graph.addNode(registry.nodeInit('filter', { attrs: { label: 'Threshold' } }));
    expectTypeOf(node.attrs.kind).toEqualTypeOf<Kind | undefined>();
    expect(node.attrs.kind).toBe('filter');
    expect(node.attrs.label).toBe('Threshold');
    expect(registry.resolve(node)).toBe(registry.get('filter'));
  });

  it('checks the caller\'s attributes against the caller\'s own type', () => {
    type NodeAttrs = { kind: Kind; label: string };
    const graph = new Graph<NodeAttrs>();
    // @ts-expect-error `label` is a string in this consumer's attribute type.
    expect(() => graph.addNode(registry.nodeInit('source', { attrs: { label: 7 } }))).not.toThrow();
  });

  it('gives a canConnect written inline the consumer\'s own union at both ends', () => {
    let seen: string | undefined;
    const typed = defineRegistry({
      source: { ports: [{ id: 'out', direction: 'out' }] },
      filter: {
        ports: [{ id: 'in', direction: 'in' }],
        canConnect: (ends) => {
          expectTypeOf(ends.source.kind).toEqualTypeOf<'source' | 'filter'>();
          expectTypeOf(ends.target.kind).toEqualTypeOf<'source' | 'filter'>();
          seen = ends.source.kind;
          return undefined;
        },
      },
    });
    expect(typed.checkPorts({ kind: 'source', portId: 'out' }, { kind: 'filter', portId: 'in' })).toEqual({ ok: true });
    expect(seen).toBe('source');
  });

  it('infers the kinds from the keys alone, so a pre-declared spec init does not widen them', () => {
    // `NodeSpecInit` is `NodeSpecInit<string>`, and it sits in a position `K`
    // also appears in. Without `NoInfer` on that position, `K` would come out
    // as `string` here and every kind downstream with it.
    const init: NodeSpecInit = { ports: [{ id: 'out', direction: 'out' }] };
    const held = defineRegistry({ source: init, filter: init });
    expectTypeOf(held.kinds).toEqualTypeOf<readonly ('source' | 'filter')[]>();
    expect(held.kinds).toEqual(['source', 'filter']);
  });

  it('leaves an unparameterised registry meaning what it always did', () => {
    // A consumer annotating a field that holds any registry writes this, and
    // it has to keep accepting one built from a literal.
    const held: NodeRegistry = registry;
    expectTypeOf(held.kinds).toEqualTypeOf<readonly string[]>();
    expect(held.has('filter')).toBe(true);
  });
});
