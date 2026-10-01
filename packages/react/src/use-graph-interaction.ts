import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { createGraphInteraction } from './interaction.js';
import type {
  GraphHitProvider,
  GraphHitTarget,
  GraphInteractionEffect,
  GraphPointer,
} from './interaction.js';

const NATIVE_CONTROL =
  'button, [role="button"], a, input, select, textarea, [contenteditable]';
const GRAPH_TARGET_ATTRIBUTE = 'data-dagr-interaction-target';

/** Options for controlled graph selection and click-versus-pan gestures. */
export interface UseGraphInteractionOptions<Revision> {
  /** The element whose border box defines CSS hit coordinates. */
  readonly surfaceRef: RefObject<HTMLElement | null>;
  /** Identity of the target geometry currently displayed. */
  readonly displayedRevision: Revision;
  /** Convert a surface-relative CSS point through the currently displayed camera. */
  readonly screenToWorld: (css: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  };
  /** Synchronously query caller-owned hit geometry. */
  readonly hitTarget: GraphHitProvider<Revision>;
  /** The caller-controlled current selection. */
  readonly selection: GraphHitTarget | null;
  /** Receive a pointer selection or fresh empty-space clear. */
  readonly onSelectionChange: (target: GraphHitTarget | null) => void;
  /** Move the caller-owned camera by an incremental CSS-pixel delta. */
  readonly onPanBy: (delta: { readonly x: number; readonly y: number }) => void;
  /** Called once when movement first reaches the drag threshold. */
  readonly onPanStart?: (() => void) | undefined;
  /** Called on release or cancellation after a pan began. */
  readonly onPanEnd?: ((cancelled: boolean) => void) | undefined;
  /** CSS-pixel drag threshold. Default 5. */
  readonly thresholdCssPixels?: number | undefined;
}

function nativeControl(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(NATIVE_CONTROL) : null;
}

/**
 * Attach controlled selection and click-versus-pan gestures to one surface.
 *
 * Native controls are excluded unless the closest control carries
 * `data-dagr-interaction-target`. Keyboard events are not handled here.
 */
export function useGraphInteraction<Revision>(
  options: UseGraphInteractionOptions<Revision>,
): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const surface = options.surfaceRef.current;
    if (surface === null) return;
    let suppressPointerClick = false;

    const machine = createGraphInteraction<Revision>({
      thresholdCssPixels: options.thresholdCssPixels,
      hitTarget: (query) => latest.current.hitTarget(query),
      onSelectionChange: (target) => latest.current.onSelectionChange(target),
      onPanBy: (delta) => latest.current.onPanBy(delta),
      onPanStart: () => latest.current.onPanStart?.(),
      onPanEnd: (cancelled) => latest.current.onPanEnd?.(cancelled),
    });

    const pointer = (event: PointerEvent): GraphPointer => {
      const rect = surface.getBoundingClientRect();
      const css = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      return {
        pointerId: event.pointerId,
        button: event.button,
        isPrimary: event.isPrimary,
        css,
        get world() {
          return latest.current.screenToWorld(css);
        },
        get devicePixelRatio() {
          return globalThis.devicePixelRatio || 1;
        },
      };
    };

    const apply = (effects: readonly GraphInteractionEffect[]): void => {
      for (const effect of effects) {
        switch (effect.kind) {
          case 'focus':
            surface.focus({ preventScroll: true });
            break;
          case 'capture':
            surface.setPointerCapture?.(effect.pointerId);
            break;
          case 'release':
            if (surface.hasPointerCapture?.(effect.pointerId)) {
              surface.releasePointerCapture(effect.pointerId);
            }
            break;
          case 'dragging':
            if (effect.active) surface.dataset.dagrDragging = 'true';
            else delete surface.dataset.dagrDragging;
            break;
          case 'suppress-click':
            suppressPointerClick = true;
            break;
        }
      }
    };

    const down = (event: PointerEvent): void => {
      suppressPointerClick = false;
      const control = nativeControl(event.target);
      if (control !== null && !control.hasAttribute(GRAPH_TARGET_ATTRIBUTE)) return;
      apply(machine.pointerDown(pointer(event), latest.current.displayedRevision));
    };
    const move = (event: PointerEvent): void => {
      apply(machine.pointerMove(pointer(event), latest.current.displayedRevision));
    };
    const up = (event: PointerEvent): void => {
      apply(machine.pointerUp(pointer(event), latest.current.displayedRevision));
    };
    const cancel = (event: PointerEvent): void => {
      apply(machine.pointerCancel(event.pointerId));
    };
    const lost = (event: PointerEvent): void => {
      if (event.target === surface) apply(machine.lostPointerCapture(event.pointerId));
    };
    const suppress = (event: MouseEvent): void => {
      if (!suppressPointerClick || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    };

    surface.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    surface.addEventListener('lostpointercapture', lost);
    surface.addEventListener('click', suppress, true);
    surface.addEventListener('dblclick', suppress, true);
    return () => {
      surface.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      surface.removeEventListener('lostpointercapture', lost);
      surface.removeEventListener('click', suppress, true);
      surface.removeEventListener('dblclick', suppress, true);
      delete surface.dataset.dagrDragging;
    };
  }, [options.surfaceRef, options.thresholdCssPixels]);
}
