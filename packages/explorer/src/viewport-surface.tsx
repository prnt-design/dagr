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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, ReactElement, ReactNode } from 'react';
import type { ExplorerBase, ExplorerCameraSource, ExplorerEmphasis } from './base.js';
import { visibleWorld } from './camera.js';
import type { ExplorerCamera, ExplorerViewportSize } from './camera.js';
import type { ExplorerBox, ExplorerLayout } from './layout.js';
import { svgBase } from './svg-base.js';
import type { ExplorerEdge, ExplorerGroup, ExplorerNode, ExplorerView } from './types.js';
import { useExplorerCamera } from './use-explorer-camera.js';
import type { ExplorerCameraControls } from './use-explorer-camera.js';
import {
  DEFAULT_MAX_OVERLAY_NODES,
  DEFAULT_TIERS,
  OVERSCAN,
  computeVisibleSet,
  indexLayout,
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
  /** Click, Enter, Space. `trigger` is the node's button, or `null` for a mark. */
  readonly onNodeActivate?: ((id: string, trigger: HTMLElement | null) => void) | undefined;
  /** Double click. */
  readonly onNodeZoom?: ((id: string) => void) | undefined;
  readonly controlsRef?: MutableRefObject<ExplorerCameraControls | null> | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

const NODE = '[data-dagr-explorer="node"]';
const NO_DIMMED: ReadonlySet<string> = new Set();
const NO_GROUPS: readonly ExplorerGroup[] = [];

const usable = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

/**
 * A pair of gates with each bad one replaced by its default. Per gate rather
 * than all or nothing, so one mistyped number does not discard the other.
 */
function tiersOf(tiers: ExplorerTiers | undefined): ExplorerTiers {
  const summary = tiers?.summary;
  const rich = tiers?.rich;
  if (usable(summary) && usable(rich)) return tiers ?? DEFAULT_TIERS;
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

function defaultName(node: ExplorerNode, groups: readonly ExplorerGroup[]): string {
  return [node.label, ...groups.map((group) => `in ${group.label}`)].join(', ');
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

/** A visible set, and the index it was computed over, so a stale one is never drawn. */
interface Shown {
  readonly index: LayoutIndex;
  readonly set: ExplorerVisibleSet;
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
    onNodeActivate,
    onNodeZoom,
    controlsRef,
    className,
    style,
  } = props;

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => indexLayout(layout), [layout]);

  // The options, keyed by value, so a caller that re-creates `pinned` or
  // `tiers` on every render does not recompute the set on every render.
  const summary = tiers?.summary;
  const rich = tiers?.rich;
  const cap = usable(maxOverlayNodes) ? Math.floor(maxOverlayNodes) : DEFAULT_MAX_OVERLAY_NODES;
  const pins = [...(pinned ?? [])];
  if (selectedId !== null && layout.boxes.has(selectedId)) pins.push(selectedId);
  const pinKey = JSON.stringify(pins);
  const options = useMemo<VisibleSetOptions>(
    () => ({
      tiers: tiersOf(summary === undefined || rich === undefined ? undefined : { summary, rich }),
      maxOverlayNodes: cap,
      pinned: JSON.parse(pinKey) as string[],
    }),
    [summary, rich, cap, pinKey],
  );

  const [shown, setShown] = useState<Shown>(() => ({ index, set: everythingAsMarks(index) }));
  const shownRef = useRef(shown);
  const lastViewportRef = useRef<ExplorerViewportSize | null>(null);
  const scanRef = useRef<Scan | null>(null);
  const [listeners] = useState(() => new Set<(camera: ExplorerCamera) => void>());

  const onFrame = useCallback(
    (camera: ExplorerCamera, viewport: ExplorerViewportSize) => {
      lastViewportRef.current = viewport;
      // First, so a base that draws its own camera moves in step with the plane.
      for (const listener of [...listeners]) listener(camera);
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
      const previous = shownRef.current;
      if (previous.index === index && sameVisibleSet(previous.set, next)) return;
      const value = { index, set: next };
      shownRef.current = value;
      setShown(value);
    },
    [index, options, listeners],
  );

  const controls = useExplorerCamera({ viewportRef, planeRef, layout, onFrame });
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
  // nothing to change.
  useEffect(() => {
    const camera = controls.getCamera();
    const viewport = lastViewportRef.current;
    if (camera !== null && viewport !== null) onFrame(camera, viewport);
  }, [controls, onFrame]);

  useEffect(() => {
    if (controlsRef === undefined) return undefined;
    controlsRef.current = controls;
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
    };
  }, [controls, controlsRef]);

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

  // A layout the camera has not drawn yet. Its set comes from the camera on
  // screen, and the camera's own effect replaces it once it has placed the
  // new layout.
  const pending = shown.index !== index;
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
        tabIndex={-1}
        data-dagr-explorer="node"
        data-node-id={id}
        data-tier={tier}
        data-selected={selected ? 'true' : undefined}
        data-dimmed={isDimmed ? 'true' : undefined}
        aria-pressed={selected}
        aria-label={nodeAriaLabel === undefined ? defaultName(node, groups) : nodeAriaLabel(node, { groups })}
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
      tabIndex={-1}
      className={className}
      style={{
        ...style,
        position: 'relative',
        overflow: 'hidden',
        height: 'var(--dagr-explorer-height, 480px)',
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
