import { useEffect, useRef } from 'react';
import type { layout } from '@dagr/layout';
import { useViewportAdapter } from '../GraphViewport';
import type { Camera } from '../GraphViewport/useGraphCamera';
import type positions from './positions.json';

type Position = (typeof positions)[number];
type Drawing = ReturnType<typeof layout>;
const glyphs: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};
const cells = (board: string) =>
  board
    .split('/')
    .flatMap((row) =>
      [...row].flatMap((piece) =>
        /[1-8]/.test(piece) ? Array<string>(Number(piece)).fill('') : [piece],
      ),
    );

/** Immediate-mode graph drawing; the shared viewport owns the only camera loop. */
export default function AtlasCanvas({
  nodes,
  drawing,
  selected,
  routeIds,
  onSelect,
}: {
  nodes: Position[];
  drawing: Drawing;
  selected: string;
  routeIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const register = useViewportAdapter();
  const scene = useRef({ selected, routeIds, onSelect });
  const redraw = useRef(() => {});
  useEffect(() => {
    scene.current = { selected, routeIds, onSelect };
    redraw.current();
  }, [selected, routeIds, onSelect]);
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d', { alpha: false });
    if (!ctx) return;
    const viewport = element.parentElement!.parentElement!;
    const parsed = new Map(nodes.map((node) => [node.id, cells(node.board)]));
    const previews = new Map<string, HTMLCanvasElement>();
    const details = new Map<
      string,
      { size: number; image: HTMLCanvasElement }
    >();
    const labels = new Map<string, HTMLCanvasElement>();
    let camera: Camera = { x: 0, y: 0, scale: 1 };
    let width = 0,
      height = 0;
    let palette: Record<string, string> = {};
    let font = 'sans-serif';
    let mono = 'monospace';
    let alive = true;
    const readTheme = () => {
      const style = getComputedStyle(element);
      palette = Object.fromEntries(
        [
          'light-square',
          'dark-square',
          'move',
          'white-piece',
          'black-piece',
          'wire',
        ].map((name) => [
          name,
          style.getPropertyValue(`--atlas-${name}`).trim(),
        ]),
      );
      palette.background = style.getPropertyValue('--dagr-background').trim();
      palette.foreground = style.getPropertyValue('--dagr-foreground').trim();
      palette.accent = style.getPropertyValue('--primary-text').trim();
      palette.border = style.getPropertyValue('--contrast-20pct').trim();
      font = style.getPropertyValue('--ifm-font-family-base');
      mono = style.getPropertyValue('--ifm-font-family-monospace');
      previews.clear();
      details.clear();
      labels.clear();
    };
    const board = (
      target: CanvasRenderingContext2D,
      node: Position,
      detailed: boolean,
    ) => {
      parsed.get(node.id)!.forEach((piece, i) => {
        const x = (i % 8) * 20,
          y = Math.floor(i / 8) * 20;
        const square = (7 - Math.floor(i / 8)) * 8 + (i % 8);
        target.fillStyle = node.lastMove.includes(square)
          ? palette.move!
          : palette[
              ((i % 8) + Math.floor(i / 8)) % 2
                ? 'dark-square'
                : 'light-square'
            ]!;
        target.fillRect(x, y, 20, 20);
        if (!piece) return;
        const white = piece === piece.toUpperCase();
        target.fillStyle = palette[white ? 'white-piece' : 'black-piece']!;
        target.strokeStyle = palette[white ? 'black-piece' : 'white-piece']!;
        if (detailed) {
          target.font = "19px Georgia, 'DejaVu Sans', serif";
          target.textAlign = 'center';
          target.lineWidth = white ? 0.45 : 0.2;
          target.strokeText(glyphs[piece.toLowerCase()]!, x + 10, y + 16.5);
          target.fillText(glyphs[piece.toLowerCase()]!, x + 10, y + 16.5);
        } else {
          target.beginPath();
          target.arc(x + 10, y + 10, 5, 0, Math.PI * 2);
          target.fill();
        }
      });
    };
    const text = (
      value: string,
      x: number,
      y: number,
      size: number,
      family: string,
      color: string,
      scale: number,
      centered = false,
    ) => {
      const resolution =
        2 ** Math.ceil(Math.log2(scale * (window.devicePixelRatio || 1)));
      const key = `${value}/${size}/${family}/${color}/${resolution}`;
      const textWidth = centered ? 70 : 176;
      if (resolution > 8) {
        ctx.font = `${size}px ${family}`;
        ctx.fillStyle = color;
        ctx.textAlign = centered ? 'center' : 'left';
        ctx.fillText(value, x, y);
        return;
      }
      let image = labels.get(key);
      if (!image) {
        image = document.createElement('canvas');
        image.width = Math.ceil(textWidth * resolution);
        image.height = Math.ceil(28 * resolution);
        const target = image.getContext('2d')!;
        target.scale(resolution, resolution);
        target.font = `${size}px ${family}`;
        target.fillStyle = color;
        target.textAlign = centered ? 'center' : 'left';
        target.fillText(value, centered ? textWidth / 2 : 0, 22);
        labels.set(key, image);
        let pixels = [...labels.values()].reduce(
          (sum, item) => sum + item.width * item.height,
          0,
        );
        while (labels.size > 256 || pixels > 2 * 1024 * 1024) {
          const oldest = labels.keys().next().value!;
          const old = labels.get(oldest)!;
          pixels -= old.width * old.height;
          labels.delete(oldest);
        }
      }
      ctx.drawImage(
        image,
        x - (centered ? textWidth / 2 : 0),
        y - 22,
        textWidth,
        28,
      );
    };
    const draw = () => {
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr),
        pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.background!;
      ctx.fillRect(0, 0, width, height);
      const { scale } = camera;
      const ox = camera.x - drawing.bounds.x * scale;
      const oy = camera.y - drawing.bounds.y * scale;
      const visible = (
        left: number,
        top: number,
        right: number,
        bottom: number,
      ) =>
        right * scale + ox >= -8 &&
        left * scale + ox <= width + 8 &&
        bottom * scale + oy >= -8 &&
        top * scale + oy <= height + 8;
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      // Detail depends on CSS pixels, not DPR: a readable 136px board gets full pieces.
      const detail = Math.max(0, Math.min(1, (160 * scale - 72) / 64));
      for (const node of nodes) {
        if (!node.parent) continue;
        const points = drawing.edges.get(node.id)!.points;
        if (
          !visible(
            Math.min(...points.map((p) => p.x)),
            Math.min(...points.map((p) => p.y)),
            Math.max(...points.map((p) => p.x)),
            Math.max(...points.map((p) => p.y)),
          )
        )
          continue;
        ctx.strokeStyle = scene.current.routeIds.has(node.id)
          ? palette.accent!
          : palette.wire!;
        ctx.lineWidth = scene.current.routeIds.has(node.id) ? 5 : 2;
        ctx.beginPath();
        points.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.stroke();
        const end = points[points.length - 1]!,
          previous = points[points.length - 2]!;
        const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
        ctx.save();
        ctx.translate(end.x, end.y);
        ctx.rotate(angle);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-9, -4);
        ctx.lineTo(-9, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (scale > 0.35) {
          const x = (points[0]!.x + end.x) / 2,
            y = (points[0]!.y + end.y) / 2;
          ctx.fillStyle = palette.background!;
          ctx.fillRect(x - 35, y - 14, 70, 28);
          text(
            node.san,
            x,
            y + 6,
            17,
            mono,
            palette.foreground!,
            scale,
            true,
          );
        }
      }
      let count = 0;
      for (const node of nodes) {
        const box = drawing.nodes.get(node.id)!;
        if (!visible(box.x - 96, box.y - 119, box.x + 96, box.y + 119))
          continue;
        count++;
        ctx.save();
        ctx.translate(box.x - 96, box.y - 119);
        ctx.fillStyle = palette.background!;
        ctx.fillRect(0, 0, 192, 238);
        ctx.strokeStyle = scene.current.routeIds.has(node.id)
          ? palette.accent!
          : palette.border!;
        ctx.lineWidth =
          scene.current.selected === node.id
            ? 7
            : scene.current.routeIds.has(node.id)
              ? 3
              : 2;
        ctx.strokeRect(0, 0, 192, 238);
        ctx.save();
        ctx.translate(16, 38);
        if (detail < 1) {
          let preview = previews.get(node.id);
          if (!preview) {
            preview = document.createElement('canvas');
            preview.width = 160;
            preview.height = 160;
            board(preview.getContext('2d')!, node, false);
            previews.set(node.id, preview);
          }
          ctx.drawImage(preview, 0, 0);
        }
        if (detail > 0) {
          // Rasterize once per resolution tier, never magnify an undersized board.
          const size = 2 ** Math.ceil(Math.log2(160 * scale * dpr));
          ctx.globalAlpha = detail;
          if (size > 2048) {
            // Extreme zoom shows very few squares. Draw directly instead of
            // allocating an enormous texture or stretching a smaller one.
            board(ctx, node, true);
          } else {
            let cached = details.get(node.id);
            if (!cached || cached.size < size) {
              const image = document.createElement('canvas');
              image.width = size;
              image.height = size;
              const context = image.getContext('2d')!;
              context.scale(size / 160, size / 160);
              board(context, node, true);
              cached = { size, image };
            }
            details.delete(node.id);
            details.set(node.id, cached);
            // Bound both entry count and backing-store memory (32 MiB RGBA).
            let pixels = [...details.values()].reduce(
              (sum, item) => sum + item.size ** 2,
              0,
            );
            while (details.size > 24 || pixels > 8 * 1024 * 1024) {
              const oldest = details.keys().next().value!;
              pixels -= details.get(oldest)!.size ** 2;
              details.delete(oldest);
            }
            ctx.drawImage(cached.image, 0, 0, 160, 160);
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        if (scale > 0.35) {
          text(
            node.ply
              ? `${node.ply % 2 ? Math.ceil(node.ply / 2) + '.' : node.ply / 2 + '…'} ${node.san}`
              : 'Initial position',
            16,
            24,
            19,
            font,
            palette.foreground!,
            scale,
          );
          text(
            node.openings[0]?.eco ?? `${node.turn} to move`,
            16,
            219,
            13,
            mono,
            palette.wire!,
            scale,
          );
        }
        ctx.restore();
      }
      element.dataset.visibleNodes = String(count);
      element.dataset.detail =
        detail === 0 ? 'overview' : detail === 1 ? 'pieces' : 'transition';
    };
    readTheme();
    redraw.current = draw;
    register({
      width: drawing.bounds.width,
      height: drawing.bounds.height,
      apply: (next, w, h) => {
        camera = next;
        width = w;
        height = h;
        draw();
      },
    });
    const theme = new MutationObserver(() => {
      readTheme();
      draw();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    void document.fonts.ready.then(() => {
      if (alive) {
        readTheme();
        draw();
      }
    });
    let down: { x: number; y: number; id: number } | undefined;
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0)
        down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const pointerUp = (event: PointerEvent) => {
      const start = down;
      down = undefined;
      if (
        !start ||
        start.id !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      )
        return;
      const rect = element.getBoundingClientRect();
      const x =
        (event.clientX - rect.left - camera.x) / camera.scale +
        drawing.bounds.x;
      const y =
        (event.clientY - rect.top - camera.y) / camera.scale +
        drawing.bounds.y;
      const hit = nodes.find((node) => {
        const box = drawing.nodes.get(node.id)!;
        return Math.abs(x - box.x) <= 96 && Math.abs(y - box.y) <= 119;
      });
      if (hit) scene.current.onSelect(hit.id);
    };
    const cancel = () => {
      down = undefined;
    };
    viewport.addEventListener('pointerdown', pointerDown);
    viewport.addEventListener('pointerup', pointerUp);
    viewport.addEventListener('pointercancel', cancel);
    return () => {
      alive = false;
      theme.disconnect();
      register(null);
      redraw.current = () => {};
      viewport.removeEventListener('pointerdown', pointerDown);
      viewport.removeEventListener('pointerup', pointerUp);
      viewport.removeEventListener('pointercancel', cancel);
    };
  }, [nodes, drawing, register]);
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Chess opening move tree. Use Inspect a position and Continue the line below for keyboard navigation."
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
