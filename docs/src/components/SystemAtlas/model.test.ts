import { describe, expect, it } from 'vitest';
import {
  buildSystem,
  neighbors,
  nodes,
  registry,
  searchNodes,
  wires,
} from './model';

describe('commerce language example', () => {
  it('builds a connected, validated graph with finite, nonoverlapping node boxes', () => {
    const system = buildSystem();
    expect(nodes.length).toBeGreaterThan(40);
    expect(wires.length).toBeGreaterThan(60);
    expect(system.boxes.size).toBe(nodes.length);
    expect(system.routes.size).toBe(wires.length);
    const reached = new Set(['web']);
    let size = 0;
    while (size !== reached.size) {
      size = reached.size;
      for (const id of reached)
        for (const other of neighbors(id)) reached.add(other);
    }
    expect(reached.size).toBe(nodes.length);
    const boxes = [...system.boxes.values()];
    for (const [i, a] of boxes.entries()) {
      expect(Object.values(a).every(Number.isFinite)).toBe(true);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(system.width);
      expect(a.y + a.height).toBeLessThanOrEqual(system.height);
      for (const b of boxes.slice(i + 1)) {
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
    }
    for (const route of system.routes.values()) {
      expect(route.length).toBeGreaterThan(1);
      expect(
        route.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ).toBe(true);
    }
  });
  it('finds nodes by name, schema, route, and combined tokens', () => {
    expect(searchNodes(' CHECKOUT ')[0].id).toBe('checkout');
    expect(searchNodes('PostgreSQL orders').map((n) => n.id)).toEqual([
      'orders-db',
    ]);
    expect(searchNodes('tracking_id').map((n) => n.id)).toEqual(['carrier']);
    expect(searchNodes('PUT /carts').map((n) => n.id)).toEqual(['cart']);
    expect(searchNodes('nonexistent')).toEqual([]);
    expect(searchNodes('   ')).toHaveLength(nodes.length);
  });
  it('checks proposals against real port contracts without inserting an edge', () => {
    const { graph } = buildSystem();
    const proposal = {
      source: 'checkout',
      sourcePort: 'event',
      target: 'shipping-events',
      targetPort: 'publish',
    };
    expect(registry.checkConnection(graph, proposal)).toEqual({ ok: true });
    expect(
      registry.checkConnection(graph, {
        ...proposal,
        target: 'orders-db',
        targetPort: 'write',
      }),
    ).toMatchObject({ ok: false, code: 'incompatible' });
    expect(neighbors('checkout').has('shipping-events')).toBe(false);
    expect(
      registry.checkConfig(
        graph.addNode(
          registry.nodeInit('service', {
            id: 'invalid',
            attrs: { replicas: 0 },
          }),
        ),
      ),
    ).toEqual(['replicas must be positive']);
  });
});
