import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { EDGE_ROLES, generateCampaign } from '@dagr/campaign';
import { FirstLight } from './FirstLight.js';
import { campaignEdges, edgeColor } from './campaign-edges.js';
import { buildCampaignScene } from './campaign-scene.js';
import type { CampaignScene } from './campaign-scene.js';

/**
 * The demo page: the campaign on the canvas, and the few facts about it that a
 * picture cannot show.
 *
 * P1 loaded the dataset and listed it. P4 DRAWS it, so most of what this file
 * used to say is now visible above rather than tabulated below, and the stats
 * shrank to what is still worth a sentence: how big the dataset is, what share
 * of its edges the layout actually saw, and the fact that the whole thing is
 * generated from a seed rather than shipped as a file.
 *
 * The campaign is generated at MODULE LOAD and the scene is built in an EFFECT,
 * and the split is not arbitrary. Generating is synchronous, deterministic and
 * about a millisecond, and graph identity has to outlive a render, so a module
 * constant is the honest version of a store for it. Laying it out is a hundred
 * worker round trips, which is not something to start while a module is being
 * evaluated: it needs a `Worker`, which needs a document, and it has to be
 * cancellable when the component goes away.
 */
const campaign = generateCampaign();

/** How many of the campaign's edges a layout is allowed to see. See EDGE_ROLES. */
const edgeRoleCounts = campaign.edges.reduce(
  (counts, edge) =>
    EDGE_ROLES[edge.kind] === 'routed'
      ? { ...counts, routed: counts.routed + 1 }
      : { ...counts, overlay: counts.overlay + 1 },
  { routed: 0, overlay: 0 },
);

export function App(): JSX.Element {
  const [scene, setScene] = useState<CampaignScene | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Built HERE rather than in the canvas component, because it needs the
  // campaign and the scene together and the canvas is handed drawable data:
  // `scene.nodes` arrives ready for `setNodes` and these arrive ready for
  // `setEdges`. Memoised on the scene, since the split walks 7,100 edges and
  // bows a line for most of them, and a re-render that has not laid anything
  // out again would get the same answer.
  const edges = useMemo(() => (scene === null ? null : campaignEdges(campaign, scene, edgeColor)), [scene]);

  useEffect(() => {
    // The worker is created here and terminated in the cleanup, so a StrictMode
    // remount does not leave one running: a worker outlives the effect that made
    // it unless something ends it, and a second one would double the layout work
    // for a page that only draws once.
    //
    // `new URL(..., import.meta.url)` rather than a path string, because that is
    // the form a bundler can see through: Vite emits `layout-worker.ts` as its
    // own chunk from this expression, and a worker loads exactly one script.
    const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
      type: 'module',
    });
    let cancelled = false;

    /**
     * A worker that dies is a run that is never answered.
     *
     * `@dagr/layout`'s engine has no timeout by design (how long is too long
     * belongs to the caller and to the graph), and posting to a dead worker is a
     * silent no-op in both runtimes rather than a throw. So a worker script that
     * fails to load or throws while its module evaluates leaves every one of the
     * hundred runs pending forever, `Promise.all` never settles, and the page
     * sits on "laying out the campaign" with nothing thrown for the `catch`
     * below to catch. The docs site learned this at PR #23 and carries the same
     * listener; a listener is all this page needs, because it has a failure
     * state of its own to show.
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
      // docs site's live demo: this page shows its own failure state and a
      // layout that never answers leaves the readout saying so, where the docs
      // site had a figure that would have sat empty with no explanation.
      worker.terminate();
    };
  }, []);

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">Dagr demo</h1>
        <p className="page__subtitle">A mock D&amp;D campaign, laid out in tiles and drawn</p>
      </header>

      <FirstLight scene={scene} edges={edges} />

      <section className="facts">
        <h2 className="facts__title">what is on the canvas</h2>
        <p className="facts__lead">
          A deterministic mock D&amp;D campaign (seed {campaign.seed}), generated in this page,
          laid out one tile at a time by <code>@dagr/layout</code> in a worker, and drawn by{' '}
          <code>@dagr/render</code> as two instanced draw calls and one mesh per edge group. Drag to pan, scroll to zoom.
        </p>
        <div className="facts__grid">
          <div>
            <p className="facts__label">dataset</p>
            <p className="facts__value">
              {campaign.nodes.length} nodes, {campaign.edges.length} edges
            </p>
            <p className="facts__label">edges the layout sees</p>
            <p className="facts__value">
              {edgeRoleCounts.routed} routed, {edgeRoleCounts.overlay} overlay
            </p>
          </div>
          <div>
            <p className="facts__label">tiles</p>
            <p className="facts__value">
              {scene === null ? 'laying out' : `${scene.tiles.length} tiles`}
            </p>
            <p className="facts__label">layout runs</p>
            <p className="facts__value">
              {scene === null ? 'laying out' : `${scene.layoutRuns} Sugiyama passes`}
            </p>
          </div>
          <div>
            <p className="facts__label">why tiles</p>
            <p className="facts__value facts__value--prose">
              One pass over the whole campaign ranks 750 rooms into a couple of layers and draws a
              ribbon 50 times wider than it is tall. Chapters and regions are how a campaign is
              chunked anyway, so each is laid out on its own and the blocks are packed.
            </p>
          </div>
        </div>
        {failure === null ? null : (
          <p className="facts__value" role="alert">
            the layout failed: {failure}
          </p>
        )}
      </section>
    </main>
  );
}
