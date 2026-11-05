import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { EDGE_ROLES } from '@dagr/campaign';
import { FirstLight, useCampaignScene } from '@dagr/campaign-stage';
import { LivingStage } from '@dagr/living-stage';
import { ChartStage } from './chart/ChartStage.js';

/**
 * The playground page: three demos, one at a time, and the few facts about
 * each that a picture cannot show.
 *
 * ONE AT A TIME. The campaign proves scale, tiling and semantic zoom at 3,010
 * nodes; the living stage proves that an edit moves only the part of the
 * drawing it touches, which is the claim the project competes on and which
 * scale cannot show; the chart shows `@prnt/dagr-chart`, bars and lines on
 * the same renderer. None subsumes another, so none was deleted. They are
 * behind a switch rather than stacked because each mounts a canvas, and two
 * live canvases is two GPU device contexts for a page that can only be looking
 * at one of them.
 *
 * The switch is one `useState` and no router. A route each would be the right
 * answer for a site a visitor navigates; this is a local playground, and the
 * deployed versions of the two graph demos already have routes of their own on
 * the docs site (see `render.yaml`: this app has no deploy).
 *
 * The two graph demos live in packages, `@dagr/campaign-stage` and
 * `@dagr/living-stage`, because the docs site mounts the same two components
 * and a component cannot be imported from an app. The chart is a package of
 * its own, `@prnt/dagr-chart`, and `chart/` holds only its data and controls.
 * What is left here is the page around them.
 */

/**
 * Builds the campaign's layout worker.
 *
 * The worker entry is built HERE, not in the package. `new Worker(new
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

/** The animated demo, and what it is for. */
function LivingView(): JSX.Element {
  return (
    <>
      <div className="page__stage">
        <LivingStage />
      </div>

      <section className="facts">
        <h2 className="facts__title">what is on the canvas</h2>
        <p className="facts__lead">
          A seeded build pipeline, laid out by <code>@prnt/dagr-layout</code> and drawn by{' '}
          <code>@prnt/dagr-render</code> through <code>&lt;DagrCanvas animate&gt;</code>. Press a verb,
          or let it play. Each verb is ONE <code>graph.batch</code>, so the engine sees one patch
          and answers with one <code>LayoutDelta</code>, and the drawing glides from where it was
          to where it belongs instead of cutting.
        </p>
        <p className="facts__lead">
          The numbers under the canvas are read off that delta and nothing else. The lit nodes are
          the ones it named; everything unlit is a node the edit did not touch, drawn in exactly
          the place it was in before. That is the whole claim, and the corpus measurement behind it
          is in <code>docs/docs/incremental-layout.md</code>.
        </p>
        <p className="facts__lead">
          The camera fits once, when the drawing first appears, and is yours after that. It never
          refits on an edit: a drawing that stays put while the camera moves is indistinguishable
          from a drawing that moves, so an automatic refit would hide the thing this page exists to
          show. The graph is built so that no edit can make the drawing bigger, which is what makes
          one fit enough. The refit button over the canvas is for when you have panned away.
        </p>
      </section>
    </>
  );
}

/** The chart view: `<DagrChart>`, with controls that change what it is given. */
function ChartView(): JSX.Element {
  return (
    <>
      <div className="page__stage">
        <ChartStage />
      </div>

      <section className="facts">
        <h2 className="facts__title">what is on the canvas</h2>
        <p className="facts__lead">
          Twelve months of data in <code>&lt;DagrChart&gt;</code> from{' '}
          <code>@prnt/dagr-chart</code>: GPU mode draws bars and markers as instanced SDF nodes with{' '}
          <code>@prnt/dagr-render</code>, each line is one smooth ribbon, the scales and ticks are
          D3&apos;s. SVG mode draws DOM marks from the same layout and spring frames. Hover a mark for
          its value.
        </p>
        <p className="facts__lead">
          The controls only hand the chart a new <code>series</code> prop. Marks are matched by
          id, so one in both sets glides from where it is, a new one grows in and one that left
          shrinks out, all on the renderer&apos;s critically damped springs. <em>daily + total</em>{' '}
          puts a running total on a second axis. WebGPU where the browser has it, WebGL2 where it
          does not, or select SVG without a GPU context. The label beside the legend says which.
        </p>
      </section>
    </>
  );
}

/** The campaign demo, and the few facts about it that a picture cannot show. */
function CampaignView(): JSX.Element {
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
    <>
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
          laid out one tile at a time by <code>@prnt/dagr-layout</code> in a worker, and drawn by{' '}
          <code>@prnt/dagr-render</code> as two instanced draw calls and one mesh per edge group. Drag to pan, scroll to zoom.
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
              One pass over the whole campaign ranks 1,023 rooms into a couple of layers and draws a
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
    </>
  );
}

/** Which demo is on screen. */
type View = 'living' | 'chart' | 'campaign';

const VIEWS: readonly { readonly id: View; readonly label: string }[] = [
  { id: 'living', label: 'living graph' },
  { id: 'chart', label: 'chart' },
];

/**
 * Which demo to open on, from `#view=` in the URL.
 *
 * The living graph unless the hash says otherwise, because it is the one that
 * shows the claim the project competes on.
 *
 * THE HASH IS WHY `scripts/capture.mjs` STILL WORKS. The screenshots are all of
 * the campaign, taken by navigating to a hash and waiting for the stage to say
 * it has drawn; with the switch defaulting the other way, a capture would wait
 * sixty seconds for a stage that was never mounted. `#view=campaign` is how it
 * asks, and `URLSearchParams` is how `camera-input.ts` reads `#node=` and
 * `#zoom=` out of the same hash, so an extra key is ignored by both.
 *
 * Read ONCE, at mount, with no `hashchange` listener, which is the rule the
 * campaign stage already set for its own two keys: the switch below is the way
 * a person changes the view, and a hash that fought it would reset the demo
 * under them.
 */
function initialView(): View {
  if (typeof window === 'undefined') return 'living';
  const { hash } = window.location;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const view = new URLSearchParams(body).get('view');
  return view === 'campaign' || view === 'chart' ? view : 'living';
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>(initialView);

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">Dagr demo</h1>
        <p className="page__subtitle">
          {view === 'living'
            ? 'A build pipeline, edited while you watch, and a count of what moved'
            : view === 'chart'
              ? 'Bars and a line, drawn and animated by the graph renderer'
              : 'A mock D&D campaign, laid out in tiles and drawn'}
        </p>
        <nav className="page__views" aria-label="Which demo">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="page__view"
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/*
        One at a time, so only one canvas holds a device. React unmounts the
        other, which disposes its renderer: `<DagrCanvas>` and the campaign
        stage both take their device back in their own cleanup.
      */}
      {view === 'living' ? <LivingView /> : view === 'chart' ? <ChartView /> : <CampaignView />}
    </main>
  );
}
