import { expect, it } from 'vitest';
import { generateCampaign } from '@dagr/campaign';
import { buildCampaignScene } from '../../src/campaign-scene.js';
import { assignTiles } from '../../src/tiles.js';

it('builds', async () => {
  const c = generateCampaign();
  const tiles = assignTiles(c);
  const seen = new Set<string>();
  for (const t of tiles) for (const id of t.nodeIds) {
    expect(seen.has(id)).toBe(false);
    seen.add(id);
  }
  expect(seen.size).toBe(c.nodes.length);
  const scene = await buildCampaignScene(c);
  expect(scene.nodes.length).toBe(c.nodes.length);
  // every node box inside scene bounds?
  let out = 0;
  for (const [, b] of scene.nodeBounds) {
    if (b.minX < scene.bounds.minX || b.maxX > scene.bounds.maxX || b.minY < scene.bounds.minY || b.maxY > scene.bounds.maxY) out += 1;
  }
  console.log('tiles', tiles.length, 'runs', scene.layoutRuns, 'bounds', scene.bounds, 'aspect', (scene.bounds.maxX-scene.bounds.minX)/(scene.bounds.maxY-scene.bounds.minY), 'outside', out, 'routes', scene.edgeRoutes.size, 'smallest', scene.smallestNodeSize);
  // overlap check across the whole scene
  const list = [...scene.nodeBounds.entries()];
  list.sort((a,b)=>a[1].minX-b[1].minX);
  let overlaps = 0;
  for (let i=0;i<list.length;i++){
    for (let j=i+1;j<list.length;j++){
      const a=list[i]![1], b=list[j]![1];
      if (b.minX >= a.maxX) break;
      if (b.minY < a.maxY && b.maxY > a.minY) overlaps += 1;
    }
  }
  console.log('overlapping node pairs', overlaps);
}, 120000);
