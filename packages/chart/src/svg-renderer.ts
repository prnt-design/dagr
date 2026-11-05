import { Camera2D } from '@prnt/dagr-render';
import type { Renderer, SceneNode, SceneEdge, EdgeFrameStyle } from '@prnt/dagr-render';
import type { ChartClassNames } from './styling.js';
import { classes } from './styling.js';

const NS = 'http://www.w3.org/2000/svg';
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Internal adapter: the same spring frames can draw DOM marks without a GPU context. */
export function createSvgRenderer(svg: SVGSVGElement, background: number, getClasses: () => ChartClassNames): Renderer {
  const camera = new Camera2D({ viewport: { width: 300, height: 150, devicePixelRatio: 1 } });
  let nodes: readonly SceneNode[] = [];
  let edges: readonly SceneEdge[] = [];
  let intensityOf: (id: string) => number = () => 1;
  let style: EdgeFrameStyle = { halfWidthPixels: 1.6, alpha: 1 };
  let disposed = false;
  const elements = new Map<string, SVGElement>();
  const put = (key: string, tag: string, attributes: Record<string, string>): SVGElement => {
    let element = elements.get(key);
    if (element === undefined) {
      element = document.createElementNS(NS, tag);
      elements.set(key, element);
    }
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    svg.append(element);
    return element;
  };
  return {
    camera,
    backend: 'unknown',
    setNodes: (next) => { nodes = next; },
    setEdges: (_group, next) => { edges = next; },
    setEdgeIntensity: (_group, next) => { intensityOf = next; },
    setEdgeStyle: (_group, next) => { style = next; },
    resize: (viewport) => { camera.setViewport(viewport); },
    async pickNode(pointer) {
      if (disposed) return null;
      const point = camera.screenToWorld(pointer);
      for (const node of [...nodes].reverse()) {
        if (node.id.startsWith('grid:')) continue;
        const dx = Math.abs(point.x - node.center.x);
        const dy = Math.abs(point.y - node.center.y);
        const halfW = node.size.width / 2;
        const halfH = node.size.height / 2;
        if (dx > halfW || dy > halfH) continue;
        if (node.shape === 'circle' && dx * dx + dy * dy > halfW * halfW) continue;
        const r = node.cornerRadius ?? 0;
        const cx = Math.max(0, dx - halfW + r);
        const cy = Math.max(0, dy - halfH + r);
        if (node.shape === 'roundedRect' && cx * cx + cy * cy > r * r) continue;
        return node.id;
      }
      return null;
    },
    render() {
      if (disposed) return;
      const height = camera.viewport.height;
      svg.setAttribute('viewBox', `0 0 ${String(camera.viewport.width)} ${String(height)}`);
      svg.style.backgroundColor = hex(background);
      const names = getClasses();
      const kept = new Set<string>();
      for (const node of nodes) {
        kept.add(node.id);
        const circle = node.shape === 'circle';
        const kind = circle ? 'point' : node.id.startsWith('grid:') ? 'gridline' : 'bar';
        const element = put(node.id, circle ? 'circle' : 'rect', {
          'data-mark-id': node.id,
          'data-hovered': String(node.glowWorld > 0),
          class: classes(`dagr-chart__${kind}`, names[kind]),
          fill: hex(node.fillColor),
          ...(circle ? { cx: String(node.center.x), cy: String(height - node.center.y), r: String(node.size.width / 2) }
            : { x: String(node.center.x - node.size.width / 2), y: String(height - node.center.y - node.size.height / 2),
              width: String(node.size.width), height: String(node.size.height), rx: String(node.cornerRadius ?? 0) }),
        });
        element.style.filter = node.glowWorld > 0 ? `drop-shadow(0 0 4px ${hex(node.glowColor)})` : '';
      }
      for (const edge of edges) {
        kept.add(edge.id);
        // A Catmull-Rom spline through every category centre.
        const points = edge.points;
        let d = '';
        for (let i = 0; i < points.length; i += 1) {
          const p = points[i]!;
          if (i === 0) { d = `M${String(p.x)},${String(height - p.y)}`; continue; }
          const a = points[i - 1]!;
          const before = points[Math.max(0, i - 2)]!;
          const after = points[Math.min(points.length - 1, i + 1)]!;
          d += ` C${String(a.x + (p.x - before.x) / 6)},${String(height - a.y - (p.y - before.y) / 6)} ${String(p.x - (after.x - a.x) / 6)},${String(height - p.y + (after.y - a.y) / 6)} ${String(p.x)},${String(height - p.y)}`;
        }
        put(edge.id, 'path', { 'data-mark-id': edge.id, class: classes('dagr-chart__line', names.line), d,
          fill: 'none', stroke: hex(edge.color), 'stroke-width': '3.2', opacity: String(intensityOf(edge.id) * style.alpha) });
      }
      for (const [key, element] of elements) {
        if (!kept.has(key)) { element.remove(); elements.delete(key); }
      }
    },
    dispose() { disposed = true; svg.replaceChildren(); elements.clear(); },
  };
}
