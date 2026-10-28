import type { GraphHit, GraphHitProvider, GraphHitQuery } from './interaction.js';

/** Options for {@link createPickedNodeHitProvider}. */
export interface PickedNodeHitOptions {
  /**
   * Resolves the id of the node drawn under a CSS point, or `null` for none.
   * `Renderer.pickNode` has this shape, and it must read the camera and nodes
   * at call time: the provider calls it synchronously from the query it is
   * answering.
   */
  readonly pick: (css: { readonly x: number; readonly y: number }) => Promise<string | null>;
  /** Called after a pick's answer has been stored, so a caller can query its pointer again. */
  readonly onPicked?: (() => void) | undefined;
}

/** A synchronous hit provider answered from asynchronous picks. */
export interface PickedNodeHitProvider<Revision> {
  readonly hitTarget: GraphHitProvider<Revision>;
  /** Picks requested and not yet settled: zero or one. */
  readonly pending: number;
}

interface Key<Revision> {
  readonly revision: Revision;
  readonly css: { readonly x: number; readonly y: number };
  readonly world: { readonly x: number; readonly y: number };
}

function sameKey<Revision>(a: Key<Revision>, b: Key<Revision>): boolean {
  return (
    Object.is(a.revision, b.revision) &&
    a.world.x === b.world.x &&
    a.world.y === b.world.y
  );
}

/** Never `Object.is` to a caller's revision, so the interaction machine reads it as stale. */
const UNANSWERED: unique symbol = Symbol('unanswered');

/**
 * Adapts an asynchronous pick, such as `Renderer.pickNode`, to the synchronous
 * {@link GraphHitProvider} contract.
 *
 * A query is answered only from a pick that has settled for the same world
 * point and the same displayed revision. Anything else starts a pick and is
 * answered as stale, which the interaction machine ignores rather than reading
 * as a miss. Keying on the world point rather than the CSS point is what makes
 * a pan or a zoom away from the pointer a new question. A pick that settles
 * after its revision left the screen is stored under that revision, so no later
 * query can match it.
 *
 * At most one pick is in flight, and a query arriving meanwhile is answered
 * stale without starting one. A query is never picked later on its behalf,
 * because the camera may have moved since its world point was taken, so a
 * caller that wants the point under a resting pointer queries again from
 * `onPicked`. A pick that rejects stores nothing and calls nothing; the point
 * is asked again on its next query.
 *
 * A press is answered only if its point was picked before the press, so a
 * caller primes picks from hover (`pointermove`) by querying the provider. The
 * release is a query of its own, and must land on the same world point.
 */
export function createPickedNodeHitProvider<Revision>(
  options: PickedNodeHitOptions,
): PickedNodeHitProvider<Revision> {
  let answered: (Key<Revision> & { readonly nodeId: string | null }) | null = null;
  let inFlight = false;

  const start = (key: Key<Revision>): void => {
    let settled: Promise<string | null>;
    try {
      settled = options.pick(key.css);
    } catch {
      return;
    }
    inFlight = true;
    settled.then(
      (nodeId) => {
        answered = { ...key, nodeId };
        inFlight = false;
        options.onPicked?.();
      },
      () => {
        inFlight = false;
      },
    );
  };

  return {
    get pending() {
      return inFlight ? 1 : 0;
    },
    hitTarget(query: GraphHitQuery<Revision>): GraphHit<Revision> {
      const key: Key<Revision> = {
        revision: query.displayedRevision,
        css: query.css,
        world: query.world,
      };
      if (answered !== null && sameKey(answered, key)) {
        return {
          target: answered.nodeId === null ? null : { kind: 'node', nodeId: answered.nodeId },
          displayedRevision: query.displayedRevision,
        };
      }
      if (!inFlight) start(key);
      return { target: null, displayedRevision: UNANSWERED as Revision };
    },
  };
}
