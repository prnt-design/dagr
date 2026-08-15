import { useMemo } from 'react';
import type { JSX } from 'react';
import { EDGE_ROLES } from '@dagr/campaign';
import { FirstLight, useCampaignScene } from '@dagr/campaign-stage';

/**
 * The playground page: the campaign stage, and the few facts about it that a
 * picture cannot show.
 *
 * Everything on the canvas moved to `@dagr/campaign-stage` when the docs site
 * started mounting the same thing, and what is left here is the page around it.
 * That is the whole shape of this file now: the stage's own state comes from
 * {@link useCampaignScene}, which this calls directly rather than mounting
 * `CampaignStage`, because the facts below the canvas are written from the same
 * scene the canvas draws and calling the hook twice would lay the campaign out
 * twice.
 *
 * The layout worker is built HERE, not in the package. `new Worker(new
 * URL(...))` is an expression the bundler reads statically, and this app's
 * bundler is Vite where the docs site's is webpack, so each host owns its
 * worker entry. Vite emits `layout-worker.ts` as its own chunk from the
 * expression below, which is what a worker needs: it loads exactly one script.
 */
function createWorker(): Worker {
  return new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
}

/**
 * A count the scene carries, or what is standing between the reader and it.
 *
 * `undefined` and a failure are different absences and read differently: one is
 * a hundred layout runs still going, the other is a number that will never
 * arrive. The failure's own text is on the stage, over the canvas, so this says
 * only that the wait is over.
 */
function describe(count: number | undefined, unit: string, failure: string | null): string {
  if (count !== undefined) return `${String(count)} ${unit}`;
  return failure === null ? 'laying out' : 'layout failed';
}

export function App(): JSX.Element {
  const { campaign, scene, edges, failure } = useCampaignScene(createWorker);

  /** How many of the campaign's edges a layout is allowed to see. See EDGE_ROLES. */
  const edgeRoleCounts = useMemo(
    () =>
      campaign.edges.reduce(
        (counts, edge) =>
          EDGE_ROLES[edge.kind] === 'routed'
            ? { ...counts, routed: counts.routed + 1 }
            : { ...counts, overlay: counts.overlay + 1 },
        { routed: 0, overlay: 0 },
      ),
    [campaign],
  );

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">Dagr demo</h1>
        <p className="page__subtitle">A mock D&amp;D campaign, laid out in tiles and drawn</p>
      </header>

      {/*
        The stage fills the element it is given, so the height is set here: the
        package deliberately does not carry one, because the docs route wants
        the viewport and this page wants a band with the facts under it.
      */}
      <div className="page__stage">
        <FirstLight campaign={campaign} scene={scene} edges={edges} sceneFailure={failure} />
      </div>

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
            {/*
              Three states, not two. A scene that has not arrived is either on
              its way or never coming, and a panel that says "laying out"
              forever under a stage that says the layout failed is the same
              contradiction the failure line moved out of here to avoid, with
              the halves swapped. The stage says WHY; this says that these two
              numbers are not coming.
            */}
            <p className="facts__label">tiles</p>
            <p className="facts__value">{describe(scene?.tiles.length, 'tiles', failure)}</p>
            <p className="facts__label">layout runs</p>
            <p className="facts__value">
              {describe(scene?.layoutRuns, 'Sugiyama passes', failure)}
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
        {/*
          A failed layout is reported on the STAGE, in the readout over the
          canvas, and not repeated here. It used to be the other way round,
          which left the canvas saying it was still laying out while the only
          explanation sat below the fold.
        */}
      </section>
    </main>
  );
}
