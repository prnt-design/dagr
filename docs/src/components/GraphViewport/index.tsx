import { createContext, useContext, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useGraphCamera } from './useGraphCamera';
import type { Camera } from './useGraphCamera';
import styles from './styles.module.css';

export type ViewportAdapter = {
  width: number;
  height: number;
  getBounds?: () => { x: number; y: number; width: number; height: number };
  apply: (camera: Camera, width: number, height: number) => void;
};
const AdapterContext = createContext<(adapter: ViewportAdapter | null) => void>(
  () => {},
);
export const useViewportAdapter = () => useContext(AdapterContext);

/** Shared interaction surface for DOM/SVG diagrams and native renderer cameras. */
export default function GraphViewport({
  children,
  label,
  width = 1000,
  height = 500,
  native = false,
}: {
  children: ReactNode;
  label: string;
  width?: number;
  height?: number;
  native?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const hint = useId();
  const [adapter, setAdapter] = useState<ViewportAdapter | null>(null);
  const camera = useGraphCamera(
    viewport,
    plane,
    adapter?.width ?? width,
    adapter?.height ?? height,
    !native || adapter !== null,
    adapter?.apply,
    adapter?.getBounds,
  );
  return (
    <AdapterContext.Provider value={setAdapter}>
      <div className={styles.shell}>
        <div
          ref={viewport}
          className={styles.viewport}
          tabIndex={0}
          aria-label={label}
          aria-describedby={hint}
        >
          <div
            ref={plane}
            className={native ? styles.native : styles.plane}
            style={native ? undefined : { width, height }}
          >
            {children}
          </div>
        </div>
        <div className={styles.toolbar}>
          <div role="group" aria-label={`${label} zoom`}>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => camera.current.zoom(0.8)}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => camera.current.zoom(1.25)}
            >
              +
            </button>
            <button type="button" onClick={() => camera.current.reset()}>
              Fit graph
            </button>
          </div>
          <span id={hint}>
            Focus to scroll-zoom. Drag or arrow keys to pan. + / − zoom. 0 fits.
            Escape releases focus.
          </span>
        </div>
      </div>
    </AdapterContext.Provider>
  );
}
