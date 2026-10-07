/**
 * The explorer's viewport: a pannable, zoomable surface with a base layer
 * and a windowed DOM overlay, driven by props.
 *
 * Internal. M5.6d wraps it with the root's context as the public
 * `ExplorerViewport` part, which is why everything here arrives as a prop.
 *
 * **React renders only when the visible set changes, or a prop does.**
 * `useExplorerCamera` writes the plane's transform on each frame and calls
 * back here. The callback computes the visible set and keeps the previous
 * one, by reference, when `sameVisibleSet` says nothing changed, so a pan
 * inside the overscan margin is a style write and no React work. A node
 * button is placed in world coordinates once, when it mounts, and the plane
 * carries it.
 *
 * **Most frames skip the scan.** The set was computed over the view plus a
 * margin on every side, so while the view stays inside half that margin, at
 * the same scale, every node it can show is already in the set. A frame
 * like that does not call `computeVisibleSet` at all.
 *
 * **One listener per gesture, on the viewport.** No node has a listener of
 * its own. A click on a button resolves to that node, a click anywhere else
 * resolves through the layout, so a base mark (which has no element the
 * overlay owns) is clickable at every tier.
 *
 * The plane is a composited layer only while the camera moves, which the
 * camera hook decides, and never through `translateZ`. A cached raster of
 * text enlarged by the camera goes blurry, so at rest there is none.
 *
 * **The graph is one tab stop.** Exactly one node button has `tabIndex` 0:
 * the selected node, else the last node focused from the keyboard, else the
 * node nearest the viewport center as of the last scan, else (before there
 * is a camera) the first node. It is pinned, so it is always mounted, and so
 * is the node that has focus and the node an arrow is moving focus to. An
 * arrow on a focused node moves focus to `nearestInDirection`: the target is
 * pinned, mounted, focused, and only then does the old node lose its pin, so
 * focus never falls to the page in between. A node focused from the keyboard
 * is revealed by the least pan; one focused by a pointer moves nothing.
 *
 * **Nothing reads the DOM in render,** so the surface renders on a server:
 * the base draws every mark, the plane is hidden, and no node has a button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, ReactElement, ReactNode } from 'react';
import type { ExplorerBase, ExplorerCameraSource, ExplorerEmphasis } from './base.js';
import { visibleWorld } from './camera.js';
import type { ExplorerCamera, ExplorerInset, ExplorerViewportSize } from './camera.js';
import type { ExplorerBox, ExplorerLayout } from './layout.js';
import { nearestInDirection } from './navigation.js';
import type { ExplorerDirection } from './navigation.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
import { svgBase } from './svg-base.js';
import type { ExplorerEdge, ExplorerGroup, ExplorerNode, ExplorerView } from './types.js';
import { useExplorerCamera } from './use-explorer-camera.js';
import type { CameraObstructions, ExplorerCameraControls } from './use-explorer-camera.js';
import {
  DEFAULT_MAX_OVERLAY_NODES,
  DEFAULT_TIERS,
  OVERSCAN,
  computeVisibleSet,
  indexLayout,
  nearestToCenter,
  nodeAtPoint,
  sameVisibleSet,
} from './visible-set.js';
import type {
  ExplorerTier,
  ExplorerTiers,
  ExplorerVisibleSet,
  LayoutIndex,
  VisibleSetOptions,
} from './visible-set.js';

export interface ViewportSurfaceProps<N extends ExplorerNode, E extends ExplorerEdge> {
  /** Accessible name of the region. */
  readonly label: string;
  readonly view: ExplorerView<N, E>;
  readonly layout: ExplorerLayout;
  readonly selectedId?: string | null | undefined;
  readonly dimmed?: ReadonlySet<string> | undefined;
  /** Always mounted. `selectedId` is pinned as well. */
  readonly pinned?: readonly string[] | undefined;
  readonly tiers?: ExplorerTiers | undefined;
  readonly maxOverlayNodes?: number | undefined;
  /** Default: the SVG base. */
  readonly base?: ExplorerBase | undefined;
  readonly renderNode?:
    | ((node: N, context: { tier: ExplorerTier; selected: boolean; dimmed: boolean }) => ReactNode)
    | undefined;
  readonly nodeAriaLabel?:
    | ((node: N, context: { groups: readonly ExplorerGroup[] }) => string)
    | undefined;
  /** One group in the default accessible name. Default: `in <group>`. */
  readonly inGroup?: ((groupLabel: string) => string) | undefined;
  /** Click, Enter, Space. `trigger` is the node's button, or `null` for a mark. */
  readonly onNodeActivate?: ((id: string, trigger: HTMLElement | null) => void) | undefined;
  /** Double click. */
  readonly onNodeZoom?: ((id: string) => void) | undefined;
  readonly controlsRef?: MutableRefObject<ExplorerCameraControls | null> | undefined;
  /**
   * The camera on screen and every drawn frame, the same source the base
   * gets, for a part outside the viewport that follows the camera without
   * re-rendering (the toolbar's zoom readout).
   */
  readonly cameraSourceRef?: MutableRefObject<ExplorerCameraSource | null> | undefined;
  /** The id of the element that describes the region. */
  readonly describedBy?: string | undefined;
  /** Overlays the camera frames around. */
  readonly obstructions?: CameraObstructions | undefined;
  /** CSS pixels the host's own overlays cover on each side. */
  readonly inset?: ExplorerInset | undefined;
  /** The fraction of the frame content may be panned past its edge. */
  readonly contentPadding?: number | undefined;
  readonly className?: string | undefined;
  /** Sizing and decoration pass through. `position`, `overflow` and `user-select` stay the viewport's own, because the graph needs them. */
  readonly style?: CSSProperties | undefined;
}

const NODE = '[data-dagr-explorer="node"]';
const NO_DIMMED: ReadonlySet<string> = new Set();
const NO_GROUPS: readonly ExplorerGroup[] = [];
const ARROWS: Readonly<Record<string, ExplorerDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const usable = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

/**
 * A pair of gates with each bad or missing one replaced by its default. Per
 * gate rather than all or nothing, so one mistyped number does not discard
 * the other.
 */
function tiersOf(summary: number | undefined, rich: number | undefined): ExplorerTiers {
  return {
    summary: usable(summary) ? summary : DEFAULT_TIERS.summary,
    rich: usable(rich) ? rich : DEFAULT_TIERS.rich,
  };
}

/**
 * What the base draws before there is a camera: every node as a mark and
 * every routed edge, and no overlay. It is what a server can render, and on
 * the client it is replaced on the first frame. The plane is hidden until
 * then, so it is never seen unscaled. Once there is a camera, a new layout's
 * first render is windowed from it instead, so a swap to a large graph never
 * commits every node.
 */
function everythingAsMarks(index: LayoutIndex): ExplorerVisibleSet {
  return {
    overlay: new Map(),
    baseNodes: index.nodeIds,
    edges: index.edgeIds.filter((_, i) => index.edgeBounds[i] !== null),
  };
}

const IN_GROUP = (groupLabel: string): string => `in ${groupLabel}`;

function defaultName(
  node: ExplorerNode,
  groups: readonly ExplorerGroup[],
  inGroup: (groupLabel: string) => string,
): string {
  return [node.label, ...groups.map((group) => inGroup(group.label))].join(', ');
}

/**
 * What the last scan covered: the options and index it ran with, its scale,
 * and the world rect a later view may move within and need no new scan.
 */
interface Scan {
  readonly index: LayoutIndex;
  readonly options: VisibleSetOptions;
  readonly scale: number;
  readonly within: ExplorerBox;
}

/**
 * The world rect a view may move within without a scan: the view at scan
 * time, grown by half the overscan on each side. The scan itself covered the
 * full overscan, so a node in the actual view is a node the scan saw.
 */
function slack(world: ExplorerBox): ExplorerBox {
  const margin = OVERSCAN / 2;
  return {
    x: world.x - world.width * margin,
    y: world.y - world.height * margin,
    width: world.width * (1 + margin * 2),
    height: world.height * (1 + margin * 2),
  };
}

const inside = (inner: ExplorerBox, outer: ExplorerBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/**
 * A visible set, and the index it was computed over, so a stale one is never
 * drawn. `center` is the node nearest the viewport center at the same scan,
 * or `null` before there is a camera.
 */
interface Shown {
  readonly index: LayoutIndex;
  readonly set: ExplorerVisibleSet;
  readonly center: string | null;
}

/** The node button for `id` inside `viewport`, if it is mounted. */
function nodeButton(viewport: HTMLElement, id: string): HTMLElement | null {
  for (const element of viewport.querySelectorAll(NODE)) {
    if (element instanceof HTMLElement && element.dataset['nodeId'] === id) return element;
  }
  return null;
}

export function ViewportSurface<N extends ExplorerNode, E extends ExplorerEdge>(
  props: ViewportSurfaceProps<N, E>,
): ReactElement {
  const {
    label,
    view,
    layout,
    selectedId = null,
    dimmed = NO_DIMMED,
    pinned,
    tiers,
    maxOverlayNodes,
    base = svgBase,
    renderNode,
    nodeAriaLabel,
    inGroup = IN_GROUP,
    onNodeActivate,
    onNodeZoom,
    controlsRef,
    cameraSourceRef,
    describedBy,
    obstructions,
    inset,
    contentPadding,
    className,
    style,
  } = props;

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => indexLayout(layout), [layout]);

  const [shown, setShown] = useState<Shown>(() => ({ index, set: everythingAsMarks(index), center: null }));
  const shownRef = useRef(shown);
  const lastViewportRef = useRef<ExplorerViewportSize | null>(null);
  // The last drawn camera, read where the controls do not exist yet: the
  // pins decide the options, which `onFrame` and so the camera depend on.
  const lastCameraRef = useRef<ExplorerCamera | null>(null);
  const scanRef = useRef<Scan | null>(null);
  const [listeners] = useState(() => new Set<(camera: ExplorerCamera) => void>());

  // Focus. `focusedId` has focus now, by any means. `keyedId` last had focus
  // from the keyboard, and is the tab target's fallback. `movingTo` is where
  // an arrow is moving focus, until its button mounts and takes it.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [keyedId, setKeyedId] = useState<string | null>(null);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const movingRef = useRef<string | null>(null);

  // A layout the camera has not drawn yet. Its set comes from the camera on
  // screen, and the camera's own effect replaces it once it has placed the
  // new layout.
  const pending = shown.index !== index;
  const pendingCenter = useMemo(() => {
    if (!pending) return null;
    const camera = lastCameraRef.current;
    const viewport = lastViewportRef.current;
    return camera === null || viewport === null ? null : nearestToCenter(index, camera, viewport);
  }, [pending, index]);
  const center = pending ? pendingCenter : shown.center;

  const has = (id: string | null): id is string => id !== null && layout.boxes.has(id);
  const tabTarget = has(selectedId)
    ? selectedId
    : has(keyedId)
      ? keyedId
      : (center ?? index.nodeIds[0] ?? null);

  // The options, keyed by value, so a caller that re-creates `pinned` or
  // `tiers` on every render does not recompute the set on every render.
  const summary = tiers?.summary;
  const rich = tiers?.rich;
  const cap = usable(maxOverlayNodes) ? Math.floor(maxOverlayNodes) : DEFAULT_MAX_OVERLAY_NODES;
  const pins = [...(pinned ?? [])];
  for (const id of [selectedId, tabTarget, focusedId, movingTo]) {
    if (has(id) && !pins.includes(id)) pins.push(id);
  }
  const pinKey = JSON.stringify(pins);
  const options = useMemo<VisibleSetOptions>(
    () => ({
      tiers: tiersOf(summary, rich),
      maxOverlayNodes: cap,
      pinned: JSON.parse(pinKey) as string[],
    }),
    [summary, rich, cap, pinKey],
  );

  /**
   * Brings the visible set up to date with a camera, scanning only when it
   * can have changed. The node nearest the center is found at the same scan,
   * so between scans it can trail the camera by up to half the overscan.
   */
  const refresh = useCallback(
    (camera: ExplorerCamera, viewport: ExplorerViewportSize) => {
      const world = visibleWorld(camera, viewport);
      const scan = scanRef.current;
      if (
        scan !== null &&
        scan.index === index &&
        scan.options === options &&
        scan.scale === camera.scale &&
        inside(world, scan.within)
      ) {
        return;
      }
      const next = computeVisibleSet(index, camera, viewport, options);
      scanRef.current = { index, options, scale: camera.scale, within: slack(world) };
      const center = nearestToCenter(index, camera, viewport);
      const previous = shownRef.current;
      if (previous.index === index && previous.center === center && sameVisibleSet(previous.set, next)) return;
      const value = { index, set: next, center };
      shownRef.current = value;
      setShown(value);
    },
    [index, options],
  );

  const onFrame = useCallback(
    (camera: ExplorerCamera, viewport: ExplorerViewportSize) => {
      lastViewportRef.current = viewport;
      lastCameraRef.current = camera;
      // First, so a base that draws its own camera moves in step with the plane.
      for (const listener of [...listeners]) listener(camera);
      refresh(camera, viewport);
    },
    [refresh, listeners],
  );

  const selectedBoxRef = useRef<ExplorerBox | null>(null);
  useIsomorphicLayoutEffect(() => {
    selectedBoxRef.current = selectedId === null ? null : (layout.boxes.get(selectedId) ?? null);
  });
  const keepInView = useCallback(() => selectedBoxRef.current, []);

  const controls = useExplorerCamera({
    viewportRef,
    planeRef,
    layout,
    onFrame,
    obstructions,
    inset,
    contentPadding,
    keepInView,
  });
  const cameraSource = useMemo<ExplorerCameraSource>(
    () => ({
      get: () => controls.getCamera(),
      subscribe(listener) {
        // Wrapped, so one listener subscribed twice is two subscriptions,
        // each ended by its own unsubscribe.
        const own = (camera: ExplorerCamera): void => listener(camera);
        listeners.add(own);
        return () => {
          listeners.delete(own);
        };
      },
    }),
    [controls, listeners],
  );

  // A prop that changes the set without moving the camera: pins, tiers, the
  // cap. The camera's own effects have run by now, so a new layout has
  // already been placed and drawn through the new `onFrame`, and this finds
  // nothing to change. No frame was drawn, so the base's listeners hear
  // nothing.
  useEffect(() => {
    const camera = controls.getCamera();
    const viewport = lastViewportRef.current;
    if (camera !== null && viewport !== null) refresh(camera, viewport);
  }, [controls, refresh]);

  useEffect(() => {
    if (controlsRef === undefined) return undefined;
    controlsRef.current = controls;
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
    };
  }, [controls, controlsRef]);

  useEffect(() => {
    if (cameraSourceRef === undefined) return undefined;
    cameraSourceRef.current = cameraSource;
    return () => {
      if (cameraSourceRef.current === cameraSource) cameraSourceRef.current = null;
    };
  }, [cameraSource, cameraSourceRef]);

  // The click handlers read the latest props through a ref, so the listeners
  // are attached once per viewport and not on every render.
  const latest = useRef({ index, onNodeActivate, onNodeZoom });
  useEffect(() => {
    latest.current = { index, onNodeActivate, onNodeZoom };
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    const resolve = (event: MouseEvent): { id: string; trigger: HTMLElement | null } | null => {
      if (event.target instanceof Element) {
        const node = event.target.closest(NODE);
        const id = node instanceof HTMLElement ? node.dataset['nodeId'] : undefined;
        if (node instanceof HTMLElement && id !== undefined && viewport.contains(node)) {
          return { id, trigger: node };
        }
      }
      const box = viewport.getBoundingClientRect();
      const world = controls.screenToWorld({
        x: event.clientX - box.left - viewport.clientLeft,
        y: event.clientY - box.top - viewport.clientTop,
      });
      if (world === null) return null;
      const id = nodeAtPoint(latest.current.index, world);
      return id === null ? null : { id, trigger: null };
    };
    const onClick = (event: MouseEvent): void => {
      const hit = resolve(event);
      if (hit === null) {
        if (!viewport.contains(document.activeElement)) viewport.focus({ preventScroll: true });
        return;
      }
      latest.current.onNodeActivate?.(hit.id, hit.trigger);
    };
    const onDoubleClick = (event: MouseEvent): void => {
      const hit = resolve(event);
      if (hit !== null) latest.current.onNodeZoom?.(hit.id);
    };
    viewport.addEventListener('click', onClick);
    viewport.addEventListener('dblclick', onDoubleClick);
    return () => {
      viewport.removeEventListener('click', onClick);
      viewport.removeEventListener('dblclick', onDoubleClick);
    };
  }, [controls]);

  // Keys and focus. Whether a focus came from the keyboard is whether the
  // last input anywhere on the page was a key, heard in the capture phase on
  // the document, so a Tab pressed outside the graph counts.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    const doc = viewport.ownerDocument;
    let keyed = false;
    const onAnyKey = (): void => {
      keyed = true;
    };
    const onAnyPointer = (): void => {
      keyed = false;
    };
    const nodeOf = (target: EventTarget | null): { id: string; element: HTMLElement } | null => {
      if (!(target instanceof Element)) return null;
      const element = target.closest(NODE);
      const id = element instanceof HTMLElement ? element.dataset['nodeId'] : undefined;
      return element instanceof HTMLElement && id !== undefined && viewport.contains(element) ? { id, element } : null;
    };

    // Set only on a change, so focus moving about the graph costs no render
    // when the pins it decides are the same.
    let focused: string | null = null;
    let lastKeyed: string | null = null;
    const focus = (id: string | null): void => {
      if (id === focused) return;
      focused = id;
      setFocusedId(id);
    };

    const onFocusIn = (event: FocusEvent): void => {
      const hit = nodeOf(event.target);
      focus(hit === null ? null : hit.id);
      if (hit === null || !keyed) return;
      if (hit.id !== lastKeyed) {
        lastKeyed = hit.id;
        setKeyedId(hit.id);
      }
      const { index: current } = latest.current;
      const box = current.nodeBoxes[current.nodeIds.indexOf(hit.id)];
      if (box !== undefined) controls.revealBox(box);
    };
    const onFocusOut = (event: FocusEvent): void => {
      if (nodeOf(event.relatedTarget) === null) focus(null);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      // Modified keys are the browser's, and a key the camera took is taken.
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const hit = nodeOf(event.target);
      // Keys typed into content a host renders inside a node are the host's.
      if (hit === null || event.target !== hit.element) return;
      if (event.key === 'Enter' || event.key === ' ') {
        // Handled here rather than left to the button's own click, so a key
        // inspects exactly once and a held key inspects once.
        event.preventDefault();
        if (!event.repeat) latest.current.onNodeActivate?.(hit.id, hit.element);
        return;
      }
      const direction = ARROWS[event.key];
      // Shift with an arrow pans, which the camera does.
      if (direction === undefined || event.shiftKey) return;
      event.preventDefault();
      const next = nearestInDirection(latest.current.index, hit.id, direction);
      if (next === null) return;
      movingRef.current = next;
      setMovingTo(next);
    };

    // A button fires its Space click on keyup, and Firefox has not always
    // cancelled that click when only keydown was prevented. Keydown has
    // already activated, so the keyup is prevented too.
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ') return;
      const hit = nodeOf(event.target);
      if (hit !== null && event.target === hit.element) event.preventDefault();
    };

    // The viewport clips and never scrolls. A browser scrolls it anyway to
    // show a node that takes focus from Tab, which would offset everything
    // from the camera, so any scroll is put back.
    const onScroll = (): void => {
      if (viewport.scrollTop !== 0) viewport.scrollTop = 0;
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    };

    doc.addEventListener('keydown', onAnyKey, true);
    doc.addEventListener('pointerdown', onAnyPointer, true);
    doc.addEventListener('mousedown', onAnyPointer, true);
    viewport.addEventListener('focusin', onFocusIn);
    viewport.addEventListener('focusout', onFocusOut);
    viewport.addEventListener('keydown', onKeyDown);
    viewport.addEventListener('keyup', onKeyUp);
    viewport.addEventListener('scroll', onScroll);
    return () => {
      doc.removeEventListener('keydown', onAnyKey, true);
      doc.removeEventListener('pointerdown', onAnyPointer, true);
      doc.removeEventListener('mousedown', onAnyPointer, true);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
      viewport.removeEventListener('keydown', onKeyDown);
      viewport.removeEventListener('keyup', onKeyUp);
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [controls]);

  // An arrow's target takes focus in the first commit that mounts it. The
  // node it leaves stays pinned, because it still has focus, until then.
  useIsomorphicLayoutEffect(() => {
    const want = movingRef.current;
    const viewport = viewportRef.current;
    if (want === null || viewport === null) return;
    if (!layout.boxes.has(want) || !viewport.contains(viewport.ownerDocument.activeElement)) {
      // Gone from the data, or focus left the graph while it mounted.
      movingRef.current = null;
      setMovingTo(null);
      return;
    }
    const element = nodeButton(viewport, want);
    if (element === null) return;
    movingRef.current = null;
    element.focus({ preventScroll: true });
    setMovingTo(null);
  });

  const first = useMemo(() => {
    if (!pending) return null;
    const camera = controls.getCamera();
    const viewport = lastViewportRef.current;
    return camera === null || viewport === null
      ? everythingAsMarks(index)
      : computeVisibleSet(index, camera, viewport, options);
  }, [pending, controls, index, options]);
  const visible = first ?? shown.set;
  const emphasis = useMemo<ExplorerEmphasis>(() => ({ selectedId, dimmed }), [selectedId, dimmed]);
  const nodes = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view.nodes]);
  const groupsOf = useMemo(() => {
    const map = new Map<string, ExplorerGroup[]>();
    for (const group of view.groups ?? []) {
      for (const id of new Set(group.nodeIds)) {
        const list = map.get(id);
        if (list === undefined) map.set(id, [group]);
        else list.push(group);
      }
    }
    return map;
  }, [view.groups]);

  const overlay: ReactElement[] = [];
  for (const [id, tier] of visible.overlay) {
    const node = nodes.get(id);
    const box = layout.boxes.get(id);
    if (node === undefined || box === undefined) continue;
    const selected = id === selectedId;
    const isDimmed = dimmed.has(id);
    const groups = groupsOf.get(id) ?? NO_GROUPS;
    overlay.push(
      <button
        key={id}
        type="button"
        tabIndex={id === tabTarget ? 0 : -1}
        data-dagr-explorer="node"
        data-node-id={id}
        data-tier={tier}
        data-selected={selected ? 'true' : undefined}
        data-dimmed={isDimmed ? 'true' : undefined}
        aria-pressed={selected}
        aria-label={nodeAriaLabel === undefined ? defaultName(node, groups, inGroup) : nodeAriaLabel(node, { groups })}
        style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
      >
        {renderNode === undefined ? node.label : renderNode(node, { tier, selected, dimmed: isDimmed })}
      </button>,
    );
  }

  const Layer = base.Layer;
  const layer = (
    <Layer view={view} layout={layout} visible={visible} emphasis={emphasis} camera={cameraSource} />
  );

  return (
    <div
      ref={viewportRef}
      data-dagr-explorer="viewport"
      role="region"
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={className}
      style={{
        height: 'var(--dagr-explorer-height, 480px)',
        ...style,
        // Last, so a caller cannot break the graph: the plane and the nodes
        // are absolutely positioned against this element and clipped by it.
        // A browser starts a text selection on the press, before the camera
        // knows the press is a pan, so nothing in the graph is selectable.
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {base.space === 'viewport' ? layer : null}
      <div
        ref={planeRef}
        data-dagr-explorer="plane"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: layout.width,
          height: layout.height,
          transformOrigin: '0 0',
          visibility: 'hidden',
        }}
      >
        {base.space === 'plane' ? layer : null}
        {overlay}
      </div>
    </div>
  );
}
