import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useViewportAdapter } from './index';

/** Move the vector viewBox rather than enlarging a composited bitmap. */
export default function SvgAdapter({
  bounds,
  label,
  children,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  label: string;
  children: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const register = useViewportAdapter();
  const { x, y, width, height } = bounds;
  useEffect(() => {
    register({
      width,
      height,
      apply: (camera, screenWidth, screenHeight) => {
        svg.current?.setAttribute(
          'viewBox',
          `${x - camera.x / camera.scale} ${y - camera.y / camera.scale} ${screenWidth / camera.scale} ${screenHeight / camera.scale}`,
        );
      },
    });
    return () => register(null);
  }, [x, y, width, height, register]);
  return (
    <svg
      ref={svg}
      style={{ width: '100%', height: '100%', display: 'block' }}
      viewBox={`${x} ${y} ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}
