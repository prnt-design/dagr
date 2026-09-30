import { useEffect, useMemo, useRef } from 'react';
import { useDagrCanvas } from '@prnt/dagr-react';
import { useViewportAdapter } from './index';

/** This module is loaded only with a browser-only DagrCanvas. */
export default function RendererAdapter() {
  const { renderer, result, requestDraw } = useDagrCanvas();
  const register = useViewportAdapter();
  const latest = useRef(result.bounds);
  latest.current = result.bounds;
  const nodes = useRef(result.nodes);
  nodes.current = result.nodes;
  const adapter = useMemo(() => {
    const bounds = latest.current;
    return {
      width: bounds.width,
      height: bounds.height,
      getNodes: () => [...nodes.current.values()].map((node) => ({
        x: node.x - node.width / 2 - bounds.x, y: node.y - node.height / 2 - bounds.y,
        width: node.width, height: node.height,
      })),
      getBounds: () => ({
        x: latest.current.x - bounds.x,
        y: latest.current.y - bounds.y,
        width: latest.current.width,
        height: latest.current.height,
      }),
      apply: (camera: { scale: number; x: number; y: number }, width: number, height: number) => {
        renderer.camera.setZoom(camera.scale);
        renderer.camera.setCenter({
          x: bounds.x + (width / 2 - camera.x) / camera.scale,
          y: -(bounds.y + (height / 2 - camera.y) / camera.scale),
        });
        requestDraw();
      },
    };
  }, [renderer, requestDraw]);
  useEffect(() => { register({ ...adapter, revision: result }); }, [adapter, result, register]);
  useEffect(() => () => register(null), [register]);
  return null;
}
