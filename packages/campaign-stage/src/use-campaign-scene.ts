import { useEffect, useMemo, useRef, useState } from 'react';
import { generateCampaign } from '@dagr/campaign';
import type { Campaign } from '@dagr/campaign';
import { campaignEdges, edgeColor } from './campaign-edges.js';
import { buildCampaignScene } from './campaign-scene.js';
import type { CampaignScene } from './campaign-scene.js';
import type { CampaignEdges } from './campaign-edges.js';

/**
 * The campaign every mount of the stage draws.
 *
 * Generated at MODULE LOAD, and the split from the scene build below is not
 * arbitrary. Generating is synchronous, deterministic and about a millisecond,
 * and graph identity has to outlive a render, so a module constant is the
 * honest version of a store for it. Laying it out is a hundred worker round
 * trips, which is not something to start while a module is being evaluated: it
 * needs a `Worker`, which needs a document, and it has to be cancellable when
 * the component goes away.
 *
 * A module constant also means two stages on one page would share the dataset
 * and lay it out twice, which is the right trade for a page that has one.
 */
const campaign = generateCampaign();

/** What {@link useCampaignScene} knows, at every stage of the build. */
export interface CampaignSceneState {
  /** The dataset, available from the first render. */
  readonly campaign: Campaign;
  /** The laid-out, packed scene, or `null` while the worker is still running. */
  readonly scene: CampaignScene | null;
  /** The scene's edges, ready for `setEdges`, or `null` with the scene. */
  readonly edges: CampaignEdges | null;
  /** What went wrong, for a build that will not finish. */
  readonly failure: string | null;
}

/**
 * Generates the campaign, lays it out in a worker, and builds its edges.
 *
 * Everything asynchronous about the stage is here, so the component below it
 * takes drawable data and nothing else. Two hosts call it: `CampaignStage`, for
 * a page that wants the canvas and no more, and `apps/demo`, which wants the
 * same state to write a facts panel from.
 *
 * **`createWorker` is called once per mount and its identity is never
 * compared.** A caller writing `useCampaignScene(() => new Worker(...))` inline
 * would otherwise hand a new function every render, and an effect keyed on it
 * would tear down a hundred layout runs and start them again on any re-render
 * that had nothing to do with the worker. The factory is read through a ref for
 * that reason, which makes the rule explicit rather than a footgun: the worker
 * belongs to the mount.
 *
 * The factory is the CALLER's because `new Worker(new URL('./x.ts',
 * import.meta.url))` is an expression a bundler reads statically, and the two
 * hosts are Vite and webpack. A `new URL` inside this package would have to
 * resolve, and emit its own self-contained chunk, under both. Each host owns
 * its worker entry instead, which is also what puts the docs site's entry where
 * its `dagr-worker-runtime` plugin already covers one.
 */
export function useCampaignScene(createWorker: () => Worker): CampaignSceneState {
  const [scene, setScene] = useState<CampaignScene | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // See the docstring: read in the effect, never in its dependency list.
  const createWorkerRef = useRef(createWorker);
  createWorkerRef.current = createWorker;

  // Memoised on the scene, since the split walks 7,100 edges and bows a line
  // for most of them, and a re-render that has not laid anything out again
  // would get the same answer.
  const edges = useMemo(
    () => (scene === null ? null : campaignEdges(campaign, scene, edgeColor)),
    [scene],
  );

  useEffect(() => {
    // The worker is created here and terminated in the cleanup, so a StrictMode
    // remount does not leave one running: a worker outlives the effect that made
    // it unless something ends it, and a second one would double the layout work
    // for a page that only draws once.
    const worker = createWorkerRef.current();
    let cancelled = false;

    /**
     * A worker that dies is a run that is never answered.
     *
     * `@dagr/layout`'s engine has no timeout by design (how long is too long
     * belongs to the caller and to the graph), and posting to a dead worker is a
     * silent no-op in both runtimes rather than a throw. So a worker script that
     * fails to load or throws while its module evaluates leaves every one of the
     * hundred runs pending forever, `Promise.all` never settles, and the stage
     * sits on "laying out the campaign" with nothing thrown for the `catch`
     * below to catch. The docs site learned this at PR #23 and its landing page
     * demo carries the same listener; a listener is all this needs, because the
     * stage has a failure state of its own to show.
     */
    const onWorkerError = (event: ErrorEvent): void => {
      if (cancelled) return;
      setFailure(event.message === '' ? 'the layout worker failed to start' : event.message);
    };
    worker.addEventListener('error', onWorkerError);

    buildCampaignScene(campaign, { worker })
      .then((built) => {
        // The component may have unmounted while a hundred layouts ran. Setting
        // state then is a React warning and a scene nobody will draw.
        if (!cancelled) setScene(built);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFailure(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      worker.removeEventListener('error', onWorkerError);
      // A worker that is never terminated keeps its thread and its module graph
      // alive for the life of the page. There is no watchdog here, unlike the
      // docs site's landing page demo: the stage shows its own failure state and
      // a layout that never answers leaves the readout saying so, where the
      // landing page had a figure that would have sat empty with no explanation.
      worker.terminate();
    };
  }, []);

  return { campaign, scene, edges, failure };
}
