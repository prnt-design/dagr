import { color, float, positionLocal, vec2 } from 'three/tsl';
import { it } from 'vitest';
import { shapeShading } from '../src/sdf-nodes.js';
import { circleSDF, roundedRectSDF } from '../src/sdf-nodes.js';

function describeValue(value: unknown): string {
  if (typeof value === 'number') return String(value);
  const c = value as { isColor?: boolean; getHexString?: () => string };
  if (c?.isColor === true && typeof c.getHexString === 'function') return `#${c.getHexString()}`;
  if (value === undefined) return 'undefined';
  return JSON.stringify(value) ?? String(value);
}

let visits = 0;

function graphKey(node: unknown, depth = 0): string {
  visits += 1;
  if (depth > 300) return '...';
  const n = node as Record<string, unknown> & {
    constructor: { name: string };
    getChildren?: () => Iterable<unknown>;
  };
  const parts: string[] = [n.constructor.name];
  for (const field of ['method', 'op', 'components', 'name', 'scope', 'nodeType']) {
    const v = n[field];
    if (typeof v === 'string') parts.push(`${field}=${v}`);
  }
  if ('value' in n) parts.push(`value=${describeValue(n['value'])}`);
  const children: string[] = [];
  if (typeof n.getChildren === 'function') {
    for (const child of n.getChildren()) children.push(graphKey(child, depth + 1));
  }
  return `${parts.join(' ')}(${children.join(',')})`;
}

interface Bound {
  p?: unknown;
  kind?: 'circle' | 'roundedRect';
  radius?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  outlinePixels?: number;
  glowWorld?: number;
  glowAlpha?: number;
  fillColor?: number;
}

function build(b: Bound = {}): string {
  const p = (b.p ?? positionLocal.xy) as never;
  const kind = b.kind ?? 'roundedRect';
  const distance =
    kind === 'circle'
      ? circleSDF(p, float(b.radius ?? 2))
      : roundedRectSDF(
          p,
          vec2(b.width ?? 10, b.height ?? 4),
          float(b.cornerRadius ?? 1),
        );
  const shading = shapeShading({
    distance: distance as never,
    fillColor: color(b.fillColor ?? 0xffb703),
    outlineColor: color(0x023047),
    glowColor: color(0xfb8500),
    glowAlpha: float(b.glowAlpha ?? 0.45),
    outlinePixels: float(b.outlinePixels ?? 2),
    glowWorld: float(b.glowWorld ?? 1),
  });
  return `${graphKey(shading.color)}|${graphKey(shading.alpha)}`;
}

it('probes graph fingerprints', () => {
  visits = 0;
  const base = build();
  const t0 = Date.now();
  const base2 = build();
  console.log('visits per build:', visits / 2, 'len:', base.length, 'ms:', Date.now() - t0);
  console.log('stable across builds:', base === base2);

  console.log('mutant 1 swap outlinePixels/glowWorld:', build({ outlinePixels: 1, glowWorld: 2 }) !== base);
  const circleBase = build({ kind: 'circle', radius: 2 });
  const circleAsRect = build({ kind: 'roundedRect', width: 4, height: 4, cornerRadius: 2 });
  console.log('mutant 2 circle drawn as rect:', circleAsRect !== circleBase);
  console.log('mutant 3 radius doubled:', build({ kind: 'circle', radius: 4 }) !== circleBase);
  console.log('mutant 4 width + 4:', build({ width: 14 }) !== base);
  console.log('mutant 5 positionLocal.xy.mul(2):', build({ p: positionLocal.xy.mul(2) }) !== base);
  console.log('control fillColor change:', build({ fillColor: 0x123456 }) !== base);
  console.log('control glowAlpha change:', build({ glowAlpha: 0.4 }) !== base);
  console.log('head:', base.slice(0, 600));
});
