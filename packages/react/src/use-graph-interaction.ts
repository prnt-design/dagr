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
  'button, a, input, select, textarea, summary, label, audio[controls], video[controls], ' +
  '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], ' +
  '[role="slider"], [role="spinbutton"], [role="textbox"], [role="combobox"], ' +
  '[role="listbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], ' +
  '[role="option"], [role="tab"], [role="treeitem"], ' +
  '[contenteditable]:not([contenteditable="false"])';
const GRAPH_TARGET_ATTRIBUTE = 'data-dagr-interaction-target';

/** Options for controlled graph selection and click-versus-pan gestures. */
export interface UseGraphInteractionOptions<Revision> {
  /** The element whose border box defines CSS hit coordinates. */
  readonly surfaceRef: RefObject<HTMLElement | SVGElement | null>;
  /** Identity of the target geometry currently displayed. */
  readonly displayedRevision: Revision;
  /** CSS-to-device ratio used to render the displayed revision. */
  readonly devicePixelRatio: number;
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

function nativeControl(event: PointerEvent, surface: Element): Element | null {
  for (const target of event.composedPath()) {
    if (target instanceof Element && target.matches(NATIVE_CONTROL)) return target;
    if (target === surface) break;
  }
  return null;
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
    let activePointerId: number | null = null;

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
          return latest.current.devicePixelRatio;
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
      const control = nativeControl(event, surface);
      if (control !== null && !control.hasAttribute(GRAPH_TARGET_ATTRIBUTE)) return;
      if (activePointerId !== null || event.button !== 0 || !event.isPrimary) return;
      suppressPointerClick = false;
      activePointerId = event.pointerId;
      apply(machine.pointerDown(pointer(event), latest.current.displayedRevision));
    };
    const move = (event: PointerEvent): void => {
      apply(machine.pointerMove(pointer(event), latest.current.displayedRevision));
    };
    const up = (event: PointerEvent): void => {
      apply(machine.pointerUp(pointer(event), latest.current.displayedRevision));
      if (activePointerId === event.pointerId) activePointerId = null;
    };
    const cancel = (event: PointerEvent): void => {
      apply(machine.pointerCancel(event.pointerId));
      if (activePointerId === event.pointerId) activePointerId = null;
    };
    const lost = (event: PointerEvent): void => {
      if (event.target !== surface) return;
      apply(machine.lostPointerCapture(event.pointerId));
      if (activePointerId === event.pointerId) activePointerId = null;
    };
    const suppress = (event: MouseEvent): void => {
      if (!suppressPointerClick || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    };

    surface.addEventListener('pointerdown', down as EventListener);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    surface.addEventListener('lostpointercapture', lost as EventListener);
    surface.addEventListener('click', suppress as EventListener, true);
    surface.addEventListener('dblclick', suppress as EventListener, true);
    return () => {
      surface.removeEventListener('pointerdown', down as EventListener);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      surface.removeEventListener('lostpointercapture', lost as EventListener);
      surface.removeEventListener('click', suppress as EventListener, true);
      surface.removeEventListener('dblclick', suppress as EventListener, true);
      apply(machine.cancelActive());
      activePointerId = null;
    };
  }, [options.surfaceRef, options.thresholdCssPixels]);
}
