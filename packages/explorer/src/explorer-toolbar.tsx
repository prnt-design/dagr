/**
 * `ExplorerToolbar`: zoom out, the zoom readout, zoom in, fit, and zoom to
 * the selected node.
 *
 * Zoom out, zoom in and fit are icons, named by their labels, which are also
 * their tooltips. Zoom to selected keeps its text, which names the node.
 *
 * **The readout follows the camera without a render.** It subscribes to the
 * root's camera source and writes its own text when the whole percent
 * changes, so a zoom that runs for twenty frames re-renders nothing. React
 * renders the element with no children, so it never overwrites that text.
 * It is not a live region: announcing every frame of a zoom is noise.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { ExplorerCamera } from './camera.js';
import { useExplorerContext } from './context.js';
import { FitIcon, MinusIcon, PlusIcon, TargetIcon } from './icons.js';

/** The same steps as the `+` and `-` keys. */
const ZOOM_IN = 1.25;
const ZOOM_OUT = 0.8;

export interface ExplorerToolbarProps {
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

export function ExplorerToolbar(props: ExplorerToolbarProps): ReactElement {
  const { state } = useExplorerContext('ExplorerToolbar');
  const { labels, selectedNode, camera } = state;
  const readoutRef = useRef<HTMLSpanElement>(null);
  const { zoomLevel } = labels;

  useEffect(() => {
    const readout = readoutRef.current;
    if (readout === null) return undefined;
    let shown: number | null = null;
    const write = (now: ExplorerCamera | null): void => {
      if (now === null) return;
      const percent = Math.round(now.scale * 100);
      if (percent === shown) return;
      shown = percent;
      readout.textContent = zoomLevel(percent);
    };
    write(camera.get());
    return camera.subscribe(write);
  }, [camera, zoomLevel]);

  return (
    <div
      data-dagr-explorer="toolbar"
      role="group"
      aria-label={labels.zoomControls}
      className={props.className}
      style={props.style}
    >
      <button
        type="button"
        data-action="zoom-out"
        aria-label={labels.zoomOut}
        title={labels.zoomOut}
        onClick={() => state.zoomBy(ZOOM_OUT)}
      >
        <MinusIcon />
      </button>
      <span ref={readoutRef} data-dagr-explorer="zoom-level" />
      <button
        type="button"
        data-action="zoom-in"
        aria-label={labels.zoomIn}
        title={labels.zoomIn}
        onClick={() => state.zoomBy(ZOOM_IN)}
      >
        <PlusIcon />
      </button>
      <button type="button" data-action="fit" aria-label={labels.fit} title={labels.fit} onClick={() => state.fit()}>
        <FitIcon />
      </button>
      <button
        type="button"
        data-action="zoom-to-selected"
        disabled={selectedNode === null}
        onClick={() => {
          if (selectedNode === null) return;
          state.focusNode(selectedNode.id);
          state.focusViewport();
        }}
      >
        <TargetIcon />{' '}
        {selectedNode === null ? labels.zoomToSelected : labels.zoomTo(selectedNode.label)}
      </button>
    </div>
  );
}
