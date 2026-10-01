/** A stable graph identity returned by an interaction hit provider. */
export type GraphHitTarget =
  | { readonly kind: 'node'; readonly nodeId: string }
  | {
      readonly kind: 'port';
      readonly nodeId: string;
      readonly portId: string;
    };

/** One caller-supplied hit query against the geometry currently on screen. */
export interface GraphHitQuery<Revision> {
  /** CSS pixels from the interaction surface's top-left border box. */
  readonly css: { readonly x: number; readonly y: number };
  /** The same point converted by the camera displaying this revision. */
  readonly world: { readonly x: number; readonly y: number };
  /** Reported separately because CSS points are not device-pixel points. */
  readonly devicePixelRatio: number;
  /** Opaque identity of the displayed geometry and target membership. */
  readonly displayedRevision: Revision;
}

/** A hit stamped with the displayed geometry the provider actually queried. */
export interface GraphHit<Revision> {
  readonly target: GraphHitTarget;
  readonly displayedRevision: Revision;
}

/** A synchronous hit provider owned by the caller. */
export type GraphHitProvider<Revision> = (
  query: GraphHitQuery<Revision>,
) => GraphHit<Revision> | null;

/** A pointer sample after browser coordinates have been made surface-relative. */
export interface GraphPointer {
  readonly pointerId: number;
  readonly button: number;
  readonly isPrimary: boolean;
  readonly css: GraphHitQuery<unknown>['css'];
  readonly world: GraphHitQuery<unknown>['world'];
  readonly devicePixelRatio: number;
}

/** DOM work requested by the framework-independent state machine. */
export type GraphInteractionEffect =
  | { readonly kind: 'focus' }
  | { readonly kind: 'capture'; readonly pointerId: number }
  | { readonly kind: 'release'; readonly pointerId: number }
  | { readonly kind: 'dragging'; readonly active: boolean }
  | { readonly kind: 'suppress-click' };

/** Callbacks and policy used for one interaction machine. */
export interface GraphInteractionOptions<Revision> {
  readonly thresholdCssPixels?: number | undefined;
  readonly hitTarget: GraphHitProvider<Revision>;
  readonly onSelectionChange: (target: GraphHitTarget | null) => void;
  readonly onPanBy: (delta: { readonly x: number; readonly y: number }) => void;
  readonly onPanStart?: (() => void) | undefined;
  readonly onPanEnd?: ((cancelled: boolean) => void) | undefined;
}

/** One active-pointer interaction state machine. */
export interface GraphInteractionMachine<Revision> {
  pointerDown(pointer: GraphPointer, displayedRevision: Revision): readonly GraphInteractionEffect[];
  pointerMove(pointer: GraphPointer, displayedRevision: Revision): readonly GraphInteractionEffect[];
  pointerUp(pointer: GraphPointer, displayedRevision: Revision): readonly GraphInteractionEffect[];
  pointerCancel(pointerId: number): readonly GraphInteractionEffect[];
  lostPointerCapture(pointerId: number): readonly GraphInteractionEffect[];
}

/** Whether two hit results name the same stable graph object. */
export function sameGraphHitTarget(a: GraphHitTarget, b: GraphHitTarget): boolean {
  if (a.kind !== b.kind || a.nodeId !== b.nodeId) return false;
  return a.kind === 'node' || (b.kind === 'port' && a.portId === b.portId);
}

type PressHit = GraphHitTarget | null | undefined;

interface Press<Revision> {
  readonly pointerId: number;
  readonly start: GraphPointer['css'];
  readonly revision: Revision;
  readonly hit: PressHit;
  last: GraphPointer['css'];
  panning: boolean;
}

function queryHit<Revision>(
  options: GraphInteractionOptions<Revision>,
  pointer: GraphPointer,
  displayedRevision: Revision,
): PressHit {
  const hit = options.hitTarget({
    css: pointer.css,
    world: pointer.world,
    devicePixelRatio: pointer.devicePixelRatio,
    displayedRevision,
  });
  if (hit === null) return null;
  return Object.is(hit.displayedRevision, displayedRevision) ? hit.target : undefined;
}

/**
 * Create the DOM-free click-versus-pan state machine used by the React hook.
 *
 * `undefined` is a stale provider result and `null` is a fresh miss. Keeping
 * those separate is what lets empty-to-empty clear selection without allowing
 * a stale cache to do the same.
 */
export function createGraphInteraction<Revision>(
  options: GraphInteractionOptions<Revision>,
): GraphInteractionMachine<Revision> {
  let press: Press<Revision> | null = null;
  const threshold = options.thresholdCssPixels ?? 5;

  function cancel(pointerId: number, captured: boolean): readonly GraphInteractionEffect[] {
    if (press === null || press.pointerId !== pointerId) return [];
    const panning = press.panning;
    press = null;
    if (!panning) return [];
    options.onPanEnd?.(true);
    return [
      ...(captured ? [{ kind: 'release' as const, pointerId }] : []),
      { kind: 'dragging', active: false },
    ];
  }

  return {
    pointerDown(pointer, displayedRevision) {
      if (press !== null || pointer.button !== 0 || !pointer.isPrimary) return [];
      press = {
        pointerId: pointer.pointerId,
        start: pointer.css,
        revision: displayedRevision,
        hit: queryHit(options, pointer, displayedRevision),
        last: pointer.css,
        panning: false,
      };
      return [];
    },
    pointerMove(pointer) {
      if (press === null || pointer.pointerId !== press.pointerId) return [];
      const delta = {
        x: pointer.css.x - press.last.x,
        y: pointer.css.y - press.last.y,
      };
      if (!press.panning) {
        const fromStart = Math.hypot(
          pointer.css.x - press.start.x,
          pointer.css.y - press.start.y,
        );
        if (fromStart < threshold) return [];
        press.panning = true;
        options.onPanStart?.();
        options.onPanBy({
          x: pointer.css.x - press.start.x,
          y: pointer.css.y - press.start.y,
        });
        press.last = pointer.css;
        return [
          { kind: 'focus' },
          { kind: 'capture', pointerId: pointer.pointerId },
          { kind: 'dragging', active: true },
          { kind: 'suppress-click' },
        ];
      }
      press.last = pointer.css;
      options.onPanBy(delta);
      return [];
    },
    pointerUp(pointer, displayedRevision) {
      if (press === null || pointer.pointerId !== press.pointerId) return [];
      const down = press;
      press = null;
      if (down.panning) {
        options.onPanEnd?.(false);
        return [
          { kind: 'release', pointerId: pointer.pointerId },
          { kind: 'dragging', active: false },
        ];
      }
      if (!Object.is(down.revision, displayedRevision)) return [];
      const up = queryHit(options, pointer, displayedRevision);
      if (down.hit === undefined || up === undefined) return [];
      if (down.hit === null && up === null) {
        options.onSelectionChange(null);
      } else if (down.hit !== null && up !== null && sameGraphHitTarget(down.hit, up)) {
        options.onSelectionChange(up);
      }
      return [];
    },
    pointerCancel(pointerId) {
      return cancel(pointerId, true);
    },
    lostPointerCapture(pointerId) {
      return cancel(pointerId, false);
    },
  };
}
