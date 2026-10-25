import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import * as sdfNodes from '../src/sdf-nodes.js';
import * as shapeMaterial from '../src/shape-material.js';

/**
 * What the package exports, pinned as an EXACT list.
 *
 * A surface test rather than a behaviour test: the behaviour is in the other
 * files, and what this one catches is a symbol added or dropped without anybody
 * deciding to. Exact rather than a superset, and that is the load-bearing part
 * rather than pedantry. `sdf-nodes.ts` and `shape-material.ts` are internal
 * because every signature in them mentions a three.js `Node`, `Mesh` or
 * material, and three is a peer dependency: a three type in an exported
 * signature makes two copies of three in one tree a type error rather than a
 * bundle-size problem, and makes three a build-time requirement for a consumer
 * that only wants to name a viewport. Nothing about exporting one of those
 * modules would fail a typecheck, a build, or any other test in this package.
 * It breaks in somebody else's tree, so the check has to be here, and a list
 * that merely CONTAINS the expected names would not be one.
 *
 * It also, incidentally, proves that importing the package's entry point does
 * not need a GPU. `webgpu-renderer.ts` pulls in `three/webgpu`, and a
 * module-scope reference to `navigator` or `document` in that dependency would
 * fail this import under Node, which would make the package unusable in any
 * server-rendered application.
 */
describe('@dagr/render', () => {
  it('exports exactly the M4.2 runtime surface', () => {
    // Types are erased, so only the runtime exports can be checked here. The
    // type surface is exercised by the other files in the suite importing from
    // it.
    expect(Object.keys(api).sort()).toEqual([
      'AA_QUAD_PADDING_FRACTION',
      'Camera2D',
      'RendererDisposedError',
      'circleDistance',
      'clampCornerRadius',
      'createRenderer',
      'edgeCoverage',
      'glowIntensity',
      'normalizeShape',
      'roundedRectDistance',
      'shapeQuadSize',
    ]);
  });

  it('exports nothing that any internal module exports', () => {
    // The instinct on finding an unexported module is to export it, and this is
    // the assertion that answers the instinct with a failure rather than with a
    // paragraph nobody reads. Computed from the modules themselves rather than
    // from a copied list of names, so a node factory added to either one is
    // covered on the day it is added.
    const internal = [...Object.keys(sdfNodes), ...Object.keys(shapeMaterial)];
    expect(internal.length).toBeGreaterThan(0);
    for (const name of internal) {
      expect(name in api).toBe(false);
    }
  });

  it('does not export the renderer implementation class', () => {
    // `WebGPUSceneRenderer` is exported from its own module so the lifecycle
    // bookkeeping can be tested with stub collaborators, and deliberately not
    // from here: `createRenderer` is the only supported way to get one, because
    // it is the only thing that awaits `init()`. A class a caller can `new`
    // themselves is a half-initialised renderer waiting to happen.
    expect('WebGPUSceneRenderer' in api).toBe(false);
  });

  it('no longer exports the PKG_NAME scaffolding', () => {
    expect('PKG_NAME' in api).toBe(false);
  });
});
