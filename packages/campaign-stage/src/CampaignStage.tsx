import type { JSX } from 'react';
import { FirstLight } from './FirstLight.js';
import { useCampaignScene } from './use-campaign-scene.js';

/**
 * The campaign demo, whole: one element a page mounts and nothing else.
 *
 * This is the composition {@link useCampaignScene} and {@link FirstLight} were
 * split apart for. A host that wants the canvas and no more mounts this; a host
 * that wants to write prose about the scene calls the hook itself and passes
 * the pieces down, which is what `apps/demo` does with its facts panel.
 *
 * The stage fills the element it is mounted in, so its HEIGHT is the host's to
 * set: see `stage.css`. It needs the stylesheet, which is a separate import
 * (`@dagr/campaign-stage/stage.css`) rather than a side effect of this module,
 * for the reason that file's header gives.
 */
export function CampaignStage({
  createWorker,
}: {
  /**
   * Builds the layout worker. Called once per mount; see the hook's docstring
   * for why the identity of this function is deliberately not watched, and why
   * the worker entry belongs to the host rather than to this package.
   */
  createWorker: () => Worker;
}): JSX.Element {
  const { scene, edges, failure } = useCampaignScene(createWorker);
  return <FirstLight scene={scene} edges={edges} sceneFailure={failure} />;
}
