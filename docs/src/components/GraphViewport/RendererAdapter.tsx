import { useEffect, useRef } from 'react';
import { useDagrCanvas } from '@dagr/react';
import { useViewportAdapter } from './index';

/** This module is loaded only with a browser-only DagrCanvas. */
export default function RendererAdapter() {
  const { renderer, result, requestDraw } = useDagrCanvas();
  const register = useViewportAdapter();
  const latest = useRef(result.bounds);
  latest.current = result.bounds;
  useEffect(() => {
    const bounds = latest.current;
    register({
      width: bounds.width,
      height: bounds.height,
      getBounds: () => ({
        x: latest.current.x - bounds.x,
        y: latest.current.y - bounds.y,
        width: latest.current.width,
        height: latest.current.height,
      }),
      apply: (camera, width, height) => {
        renderer.camera.setZoom(camera.scale);
        renderer.camera.setCenter({
          x: bounds.x + (width / 2 - camera.x) / camera.scale,
          y: -(bounds.y + (height / 2 - camera.y) / camera.scale),
        });
        requestDraw();
      },
    });
    return () => register(null);
  }, [renderer, requestDraw, register]);
  return null;
}
