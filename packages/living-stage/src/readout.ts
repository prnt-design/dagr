/**
 * What an edit did, as numbers a visitor can read beside the picture.
 *
 * THIS IS THE PART THAT MAKES THE DEMO A DEMONSTRATION. An animation of a graph
 * rearranging itself is a nice animation; "6 nodes moved, 29 stayed put" beside
 * a picture where those 29 visibly do not budge is the claim
 * `docs/docs/incremental-layout.md` publishes, made legible. The corpus numbers
 * were measured over six sessions and are not reproduced here: this says what
 * happened on the edit the visitor just caused, which is a different and
 * smaller thing to claim.
 *
 * ONLY WHAT THE DELTA SUPPORTS. Every field below is a length of one of the
 * delta's own arrays, or one subtraction over them. There is no running total,
 * no average and no "percentage of the drawing disturbed", because a delta is a
 * statement about ONE difference and anything accumulated across several is a
 * number this file would have no way to keep honest.
 *
 * AND NOTHING AT ALL WHEN IT CANNOT BE SUPPORTED. `<DagrCanvas>` calls
 * `onLayout` once per COMMIT rather than once per layout, because React renders
 * the latest snapshot of an external store rather than every one. Two mutating
 * calls in one task are therefore two deltas and one call, carrying the second
 * delta, which is a difference from a drawing that never reached a frame.
 * Counting it would put a wrong number on screen beside a drawing that is
 * right, silently, which is the exact defect M5.3a shipped and then fixed. The
 * fix on this side is an identity comparison, and {@link readEdit} makes it.
 */

import type { LayoutDelta, LayoutResult } from '@dagr/layout';

/** What every readout says, whatever else it can or cannot say. */
export interface ReadoutBase {
  /** Nodes in the drawing now. */
  readonly nodes: number;
  /** Edges in the drawing now. */
  readonly edges: number;
}

/** The first layout of a graph, which is not a difference from anything. */
export interface InitialReadout extends ReadoutBase {
  readonly kind: 'initial';
}

/**
 * More than one edit reached the engine between two drawings, so the delta in
 * hand is measured from one of them rather than from what is on screen.
 *
 * The demo batches every edit, so this is not a state it reaches by design. It
 * is here because the alternative to detecting it is showing a number that is
 * wrong, and because a consumer copying this file into an application that does
 * not batch needs the case to exist rather than to be discovered.
 */
export interface CoalescedReadout extends ReadoutBase {
  readonly kind: 'coalesced';
}

/** One edit, counted. */
export interface CountedReadout extends ReadoutBase {
  readonly kind: 'counted';
  /** Nodes in the drawing now that were not in the one before. */
  readonly added: number;
  /** Nodes in the drawing before that are not in this one. */
  readonly removed: number;
  /** Nodes in both, whose box is not where it was. */
  readonly moved: number;
  /**
   * Nodes in the drawing now that are exactly where they were: the headline.
   *
   * `nodes - moved - added`, and the two subtractions are the only ones
   * available. `removed` names ids of the PREVIOUS result and is therefore not
   * in `nodes` to be taken out of it, so subtracting it as well would undercount
   * what stayed put by exactly the number of nodes that went away. It cannot go
   * negative: `moved` and `added` are disjoint and both are subsets of the
   * result being counted.
   */
  readonly stayedPut: number;
  /** Edges in both, whose polyline is not what it was. */
  readonly rerouted: number;
}

/** What {@link readEdit} says about the drawing now on screen. */
export type Readout = InitialReadout | CoalescedReadout | CountedReadout;

/**
 * Reads one call to `onLayout` into something displayable.
 *
 * `counted` is the result this readout last counted an edit against, which the
 * caller records after each call. Comparing it with `from` BY IDENTITY is the
 * whole continuity check: `useDagr` hands over the previous state's `result`,
 * the same object, so there is no counter to keep and nothing to get wrong.
 */
export function readEdit(
  result: LayoutResult,
  delta: LayoutDelta | null,
  from: LayoutResult | null,
  counted: LayoutResult | null,
): Readout {
  const size = { nodes: result.nodes.size, edges: result.edges.size };

  // A cold run: a new graph, a changed config, or a recovered engine. There is
  // no previous drawing, so there is nothing this edit can be said to have left
  // alone. Saying so is the honest answer and it is also the first thing the
  // demo shows, before anything has been edited.
  if (delta === null || from === null) return { kind: 'initial', ...size };

  if (from !== counted) return { kind: 'coalesced', ...size };

  const added = delta.nodes.added.length;
  const moved = delta.nodes.moved.length;
  return {
    kind: 'counted',
    ...size,
    added,
    removed: delta.nodes.removed.length,
    moved,
    stayedPut: result.nodes.size - moved - added,
    rerouted: delta.edges.rerouted.length,
  };
}
