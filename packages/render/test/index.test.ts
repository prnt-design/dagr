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
  it('exports exactly the runtime surface, through M4.11', () => {
    // Types are erased, so only the runtime exports can be checked here. The
    // type surface is exercised by the other files in the suite importing from
    // it.
    expect(Object.keys(api).sort()).toEqual([
      'CENTRE_ANCHOR',
      'Camera2D',
      'DagrRenderError',
      'OverlayDisposedError',
      'OverlayParentError',
      'RendererDisposedError',
      'createHtmlOverlay',
      'createRenderer',
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
