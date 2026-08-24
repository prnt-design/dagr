/**
 * React content in world coordinates, over the canvas.
 *
 * This is the sugar M4.11 shipped the machinery for. `createHtmlOverlay` takes
 * a `create` returning an `HTMLElement`, which is the right shape for a caller
 * building DOM by hand and the wrong one for React, where the content is a tree
 * somebody else owns and rebuilding it from an imperative callback throws away
 * every reason to use React at all.
 *
 * **The portal is the whole idea, and it inverts the overlay's lifecycle.** The
 * component owns one host `<div>` for its whole life, `create` hands the
 * overlay that same div every time, `release` does nothing, and the children go
 * into it through `createPortal`. So the overlay attaches and detaches an
 * element whose contents React has been maintaining all along, rather than
 * asking for a fresh one it would have to fill.
 *
 * That has one cost and it is the reason this component is for the tens rather
 * than the thousands. The overlay's `create` is LAZY precisely so that a scene
 * with 2,800 nodes builds DOM for the few dozen on screen; a portal is not
 * lazy, so an `<Html>` that is culled still has its subtree mounted and still
 * re-renders when its props change. Ten labels and a card or two is nothing.
 * One per node on a big graph gives up the cap that makes the overlay work, and
 * the thing to reach for there is `createRichNodes`, which is pooled and
 * imperative on purpose.
 *
 * **An entry is registered once and MOVED afterwards.** Re-registering on every
 * layout would detach and reattach the element on each edit, which is a flicker
 * and a lost scroll position inside any content that has one, so the placement
 * arrives through `place()` instead. The registration effect is therefore keyed
 * on whether there is a placement at all, and never on what it is.
 *
 * A relayout re-places EVERY entry, including the ones that did not move, so
 * the overlay rewrites one transform per entry on the next sync. That is a
 * deliberate non-optimisation: holding the previous placement and comparing
 * four numbers to skip a style write would be worth writing for the thousands
 * of entries the overlay is built for, and this component is for the tens.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { NodeId } from '@dagr/graph';
import type { OverlayEntry, OverlayPlacement } from '@dagr/render';
import { useDagrCanvas } from './canvas-context.js';
import { nodeWorldBounds } from './scene.js';

/** What both forms of `<Html>` take. */
interface HtmlCommon {
  /** The content. Rendered into an element the overlay positions. */
  readonly children?: ReactNode;

  /**
   * Whether the element takes pointer events. Default false.
   *
   * Read once, when the entry is registered, because it decides how the element
   * is attached. Worth knowing before turning it on: an interactive element
   * swallows the wheel and the drag over its own area, so panning with the
   * cursor over it does nothing. The pattern that works is an inert card with
   * interactive controls inside it.
   */
  readonly interactive?: boolean;

  /** Put on the host element, so a stylesheet can reach the whole entry. */
  readonly className?: string;
}

/** The common case: sit over a node, sized to the box the layout gave it. */
interface HtmlOnNode extends HtmlCommon {
  /** The node to sit over. Nothing is registered while the layout has no such node. */
  readonly node: NodeId;
  readonly placement?: never;
  /** The smallest screen width, in CSS pixels, at which this shows. Inclusive. */
  readonly minScreenWidth?: number;
  /** The width at which it stops showing, in CSS pixels. Exclusive. */
  readonly maxScreenWidth?: number;
}

/** Anything else: a legend, a marker, a label between two nodes. */
interface HtmlAtPlacement extends HtmlCommon {
  /** Where it sits, in the renderer's y-up world coordinates. */
  readonly placement: OverlayPlacement;
  readonly node?: never;
  // The gates belong to the `node` form alone, because a placement written out
  // in full already carries its own, and the union has a point in it: a point
  // has no extent, so "how big is it on screen" has no answer that is not
  // invented, which is why `OverlayPlacement` gives a point no gate either.
  readonly minScreenWidth?: never;
  readonly maxScreenWidth?: never;
}

/**
 * Exactly one of `node` and `placement`, enforced by the type.
 *
 * The `never` on each side is what makes it exclusive rather than merely
 * suggestive: a union of two optional fields would accept both at once and
 * leave this file picking a winner at runtime, which is a rule a caller can
 * only learn by reading it.
 */
export type HtmlProps = HtmlOnNode | HtmlAtPlacement;

export function Html(props: HtmlProps): ReactNode {
  const { children, className, interactive = false } = props;
  const { overlay, result, requestDraw } = useDagrCanvas();

  // One element for the life of the component, created lazily so a render that
  // never commits does not leave one behind. `useState`'s initialiser is the
  // form that runs once; a bare `document.createElement` in the body would
  // build one per render and portal into the newest.
  const [host] = useState(() => document.createElement('div'));

  const placement = useMemo<OverlayPlacement | null>(() => {
    if (props.placement !== undefined) return props.placement;
    const box = result.nodes.get(props.node);
    if (box === undefined) return null;
    return {
      kind: 'box',
      bounds: nodeWorldBounds(box),
      ...(props.minScreenWidth === undefined ? {} : { minScreenWidth: props.minScreenWidth }),
      ...(props.maxScreenWidth === undefined ? {} : { maxScreenWidth: props.maxScreenWidth }),
    };
  }, [props.placement, props.node, props.minScreenWidth, props.maxScreenWidth, result]);

  const entryRef = useRef<OverlayEntry | null>(null);
  const placementRef = useRef<OverlayPlacement | null>(placement);

  useEffect(() => {
    host.className = className ?? '';
  }, [host, className]);

  // Declared BEFORE the registration effect, and the order is load bearing:
  // effects in one component run in declaration order, so on the render that
  // first produces a placement this one has already put it in the ref by the
  // time the registration below reads it.
  useEffect(() => {
    placementRef.current = placement;
    if (placement === null) return;
    const entry = entryRef.current;
    if (entry === null) return;
    entry.place(placement);
    requestDraw();
  }, [placement, requestDraw]);

  const placed = placement !== null;
  useEffect(() => {
    const at = placementRef.current;
    if (!placed || at === null) return;
    const entry = overlay.add({
      placement: at,
      create: () => host,
      // The element belongs to React for the whole life of the component, so
      // there is nothing to hand back and nothing to drop. The overlay takes
      // its own inline styles off it before calling this, which is what makes
      // the same element safe to reuse on the next attach.
      release: () => undefined,
      interactive,
    });
    entryRef.current = entry;
    requestDraw();
    return () => {
      entry.remove();
      entryRef.current = null;
      requestDraw();
    };
  }, [overlay, host, placed, interactive, requestDraw]);

  return createPortal(children, host);
}
