import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * What the package exports, pinned as a list.
 *
 * A surface test rather than a behaviour test: the behaviour is in
 * `camera.test.ts`, and what this file catches is a symbol added or dropped
 * without anybody deciding to. It also, incidentally, proves that importing the
 * package's entry point does not need a GPU. `webgpu-renderer.ts` pulls in
 * `three/webgpu`, and a module-scope reference to `navigator` or `document` in
 * that dependency would fail this import under Node, which would make the
 * package unusable in any server-rendered application.
 */
describe('@dagr/render', () => {
  it('exports exactly the runtime surface, through the campaign demo P5', () => {
    // Types are erased, so only the runtime exports can be checked here. The
    // type surface is exercised by the other files in the suite importing from
    // it. `fitZoom` joined in P2: the pure fit arithmetic behind
    // `Camera2D.fitBounds`, exported so limit derivation shares its formula.
    // `UnknownInstanceHandleError` and `SceneDisposedError` joined in P3 (M4.3),
    // and they are the only things the instanced path puts on the surface: an
    // error arrives in somebody else's `catch` whether or not the module that
    // throws it was exported. The second was `InstancedShapesDisposedError`
    // until `SceneNodes` grew the same failure and one class covered both.
    // `advanceDashFlow` and `ribbonWidthAt` joined in P5, and they are the two
    // things a DRAW LOOP needs from the ribbon arithmetic: where the dash has
    // flowed to, and the width and alpha the zoom implies. The tessellation
    // itself stays internal, because `setEdges` takes points rather than
    // geometry.
    //
    // M4.6 added the springs, and they are the third group here that no GPU
    // touches: a closed-form step, its two-axis form, the half-life conversion
    // a caller tunes with, and the two envelope constants that conversion is
    // solved from. `spring.ts` is exported whole rather than kept internal
    // because motion is driven by a caller's loop, and because `@dagr/react`
    // will want the same curve for interactions with no graph in them.
    expect(Object.keys(api).sort()).toEqual([
      'CENTRE_ANCHOR',
      'Camera2D',
      'DagrRenderError',
      'HALF_LIFE_OMEGA',
      'OVERLAY_INV_ZOOM_PROPERTY',
      'OVERLAY_ZOOM_PROPERTY',
      'OverlayDisposedError',
      'OverlayParentError',
      'RendererDisposedError',
      'SETTLE_OMEGA_1_PERCENT',
      'SceneDisposedError',
      'UnknownInstanceHandleError',
      'advanceDashFlow',
      'createHtmlOverlay',
      'createRenderer',
      'createRichNodes',
      'fitZoom',
      'measureHtmlSizes',
      'omegaForHalfLife',
      'ribbonWidthAt',
      'stepSpring',
      'stepSpring2D',
    ]);
  });

  it('does not export the overlay arithmetic', () => {
    // `overlay-math.ts` holds the transform composition, the gate and the cap
    // ranking, and it stays internal for the reason `sdf.ts` does: exporting it
    // would be a promise to keep a set of helpers stable for callers who are
    // not writing this package's overlay, and nobody has asked. `CENTRE_ANCHOR`
    // is the exception because a caller writing an anchor by hand needs the
    // default to compare against, and it is one frozen record rather than an
    // interface with behaviour.
    expect('entryTransform' in api).toBe(false);
    expect('selectWithinCap' in api).toBe(false);
  });

  it('does not export the instancing machinery, only the seam over it', () => {
    // M4.3's bookkeeping stays internal and M4.4 did not change that. What M4.4
    // added is `Renderer.setNodes` and the two TYPES a caller needs to call it,
    // `SceneNode` and `NodeStyle`, which are erased at runtime and so cannot be
    // asserted here. The instance handles underneath stay unnamed until M4.8
    // knows what a picking pass needs from them.
    expect('InstanceBuffer' in api).toBe(false);
    expect('InstancedShapes' in api).toBe(false);
    expect('createInstancedShapes' in api).toBe(false);
    expect('SceneNodes' in api).toBe(false);
  });

  it('does not export the ribbon tessellation, only what a frame needs', () => {
    // The seam M4.5's demo half named is `setEdges`, which takes POINTS. A
    // caller never holds a `RibbonGeometry`, so the tessellator, the coverage
    // and the arith interface stay internal and only the two per-frame helpers
    // are on the surface.
    //
    // `ribbon-nodes.ts` stays internal for the stronger reason `sdf-nodes.ts`
    // does: a TSL node is a three.js type, and `types.ts` keeps every one of
    // them off this package's surface.
    expect('tessellateRibbons' in api).toBe(false);
    expect('ribbonCoverage' in api).toBe(false);
    expect('ribbonWorldPosition' in api).toBe(false);
    expect('numberDashArith' in api).toBe(false);
    expect('SceneEdges' in api).toBe(false);
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
