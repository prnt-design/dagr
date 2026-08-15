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
  it('exports exactly the runtime surface, through the campaign demo P3', () => {
    // Types are erased, so only the runtime exports can be checked here. The
    // type surface is exercised by the other files in the suite importing from
    // it. `fitZoom` joined in P2: the pure fit arithmetic behind
    // `Camera2D.fitBounds`, exported so limit derivation shares its formula.
    // `UnknownInstanceHandleError` and `InstancedShapesDisposedError` joined in
    // P3 (M4.3), and they are the only things the instanced path puts on the
    // surface: an error arrives in somebody else's `catch` whether or not the
    // module that throws it was exported.
    expect(Object.keys(api).sort()).toEqual([
      'CENTRE_ANCHOR',
      'Camera2D',
      'DagrRenderError',
      'InstancedShapesDisposedError',
      'OVERLAY_INV_ZOOM_PROPERTY',
      'OVERLAY_ZOOM_PROPERTY',
      'OverlayDisposedError',
      'OverlayParentError',
      'RendererDisposedError',
      'UnknownInstanceHandleError',
      'createHtmlOverlay',
      'createRenderer',
      'createRichNodes',
      'fitZoom',
      'measureHtmlSizes',
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

  it('does not export the ribbon arithmetic, which M4.5 landed with no consumer', () => {
    // M4.5's first half is the tessellation core and the dash coverage, and it
    // adds nothing to this list on purpose. The demo half of the task is what
    // will need a seam, and it waits on M4.4; exporting `tessellateRibbons`
    // now would be guessing at the shape of that seam with nothing to check
    // the guess against, which is the argument M4.2 made about the shape scene
    // and this project has since made twice more.
    //
    // `ribbon-nodes.ts` stays internal for the stronger reason `sdf-nodes.ts`
    // does: a TSL node is a three.js type, and `types.ts` keeps every one of
    // them off this package's surface.
    expect('tessellateRibbons' in api).toBe(false);
    expect('ribbonCoverage' in api).toBe(false);
    expect('ribbonWorldPosition' in api).toBe(false);
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
