/**
 * The living demo: a graph that is edited while you watch, and a readout that
 * says how little of it moved.
 *
 * WHAT THIS EXISTS TO SHOW. Dagr's headline claim is that layout is stable
 * under an edit: a mutation arrives as a delta, and the nodes it did not touch
 * stay exactly where they were. The numbers behind that claim are published, at
 * `docs/docs/incremental-layout.md`, measured over a six-session corpus. The
 * claim is repeated on the landing page. Until this component there was nothing
 * anywhere that let a visitor SEE it: the campaign demo proves scale and
 * semantic zoom and never mutates a graph at all. This one exists to make the
 * published numbers legible, not to produce new ones.
 *
 * THREE VERBS AND A COUNT. `grow`, `prune` and `relayout` each make one edit;
 * the readout says what that edit added, removed and moved, and how much of the
 * drawing it left alone; and the nodes it touched wear a halo, so the count is
 * checkable rather than merely stated. `edit-script.ts` owns the verbs,
 * `readout.ts` owns the count, and this file is the page around them.
 *
 * THE CAMERA FITS ONCE AND THEN IT IS THE VISITOR'S, which is `<DagrCanvas>`'s
 * decision and not this component's to relitigate. An animated demo that
 * refitted on every edit would look impressive and would hide the very thing it
 * exists to show, because a drawing that stays put while the camera moves is
 * indistinguishable from a drawing that moves. What this component does instead
 * is make the rule keepable: the graph is built so that no edit can enlarge the
 * drawing (see `STAGE_WIDTHS` and `test/lap.test.ts`), so the first fit stays
 * right forever, and there is a refit button for a visitor who has panned away.
 * That button is pressed by a person, which is the whole difference.
 *
 * EVERY EDIT IS ONE `graph.batch`, which `applyStep` guarantees and
 * `test/edit-script.test.ts` counts. Unbatched, each mutating call is its own
 * patch and its own relayout, React commits once holding the last, and
 * `<DagrCanvas>` correctly reseats rather than gliding. The picture would be
 * right and the demo would be pointless.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { LayoutDelta, LayoutResult } from '@dagr/layout';
import { DagrCanvas, toWorldBounds, useDagrCanvas } from '@dagr/react';
// From `@dagr/react`, not `@dagr/render`: this package's only contact with the
// renderer is through the component, and it re-exports the types its own props
// are spelled in so a consumer does not take a dependency to write one
// annotation. That re-export exists because writing this file wanted it.
import type { SceneMotionOptions } from '@dagr/react';
import { CLEAR_COLOR, STAGE_LEGEND, livingAppearance, touchedBy } from './appearance.js';
import {
  EDIT_KINDS,
  INITIAL_SCRIPT_STATE,
  applyStep,
  createEditScript,
  takeAutoStep,
  takeStep,
} from './edit-script.js';
import type { EditKind, EditStep, ScriptState } from './edit-script.js';
import { LIVING_LAYOUT_CONFIG, createLivingGraph, stageOf } from './living-graph.js';
import type { Stage } from './living-graph.js';
import { readEdit } from './readout.js';
import type { Readout } from './readout.js';
import { usePrefersReducedMotion } from './use-reduced-motion.js';

/**
 * How long autoplay waits between edits.
 *
 * Long enough that the glide finishes (the half-life below settles well inside
 * a second) and the readout can be read before it is replaced. A demo that
 * edits faster than a visitor reads is a screensaver.
 */
const AUTOPLAY_INTERVAL_MS = 2800;

/**
 * The feel. Slower than `@dagr/render`'s 0.12 default, on purpose.
 *
 * The default is tuned for an application, where the animation's job is to keep
 * the user oriented and then get out of the way. Here the animation IS the
 * subject, so it is slowed to the point where a visitor can follow an
 * individual node from where it was to where it belongs.
 */
const FEEL: SceneMotionOptions = { halfLifeSeconds: 0.2 };

/**
 * The highlight before anything has been edited, and after a cold run.
 *
 * One shared frozen set rather than a fresh one each time, because it feeds
 * `nodeAppearance`, which `<DagrCanvas>` compares by IDENTITY: a new empty set
 * is a new callback is a rebuilt scene array, for a picture that did not
 * change.
 */
const NOTHING_TOUCHED: ReadonlySet<string> = Object.freeze(new Set<string>());

/** What a verb's button says. */
const VERB_LABELS: Readonly<Record<EditKind, string>> = {
  grow: 'grow',
  prune: 'prune',
  relayout: 'relayout',
};

/** What each verb does, for the visitor who wants to know before pressing it. */
const VERB_HINTS: Readonly<Record<EditKind, string>> = {
  grow: 'add three tasks and their dependencies, as one edit',
  prune: 'take three tasks away again, as one edit',
  relayout: 'add one dependency between two tasks that are already there',
};

/** What {@link LivingStage} takes. */
export interface LivingStageProps {
  /** The graph's seed. Read when it changes, which restarts the demo. */
  readonly seed?: number | undefined;
  /** Whether to start playing on its own. Default true, unless motion is reduced. */
  readonly autoplay?: boolean | undefined;
  /** Put on the outermost element. The stage fills whatever height it is given. */
  readonly className?: string | undefined;
}

/**
 * Refits the camera on the drawing, when a person asks.
 *
 * INSIDE the canvas, because `useDagrCanvas` is how anything reaches the
 * renderer and the layout, and a button outside would need a ref the component
 * deliberately does not hand out. No padding argument, so this frames the graph
 * exactly as the one automatic fit did.
 */
function RefitButton(): ReactElement {
  const { renderer, result, requestDraw } = useDagrCanvas();
  const refit = useCallback(() => {
    renderer.camera.fitBounds(toWorldBounds(result.bounds));
    requestDraw();
  }, [renderer, result, requestDraw]);
  return (
    <button type="button" className="living__refit" onClick={refit}>
      refit
    </button>
  );
}

/** One number and its name. */
function Stat({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <div className="living__stat">
      <span className="living__statValue">{value}</span>
      <span className="living__statLabel">{label}</span>
    </div>
  );
}

/** The numbers, or the honest reason there are none. */
function Numbers({ readout }: { readout: Readout | null }): ReactElement {
  if (readout === null) {
    return <p className="living__waiting">laying the graph out</p>;
  }
  if (readout.kind === 'initial') {
    return (
      <p className="living__waiting">
        {readout.nodes} nodes and {readout.edges} edges, laid out cold. Make an edit and this
        becomes a count of what moved.
      </p>
    );
  }
  if (readout.kind === 'coalesced') {
    // Unreachable while every edit goes through `applyStep`, which batches.
    // Here because the alternative to saying this is showing a number measured
    // from a drawing that never reached the screen. See `readout.ts`.
    return (
      <p className="living__waiting">
        More than one edit arrived in a single frame, so there is no single edit to count.
      </p>
    );
  }
  return (
    <div className="living__stats">
      <Stat value={`${readout.stayedPut} of ${readout.nodes}`} label="nodes stayed put" />
      <Stat value={String(readout.moved)} label="moved" />
      <Stat value={String(readout.added)} label="added" />
      <Stat value={String(readout.removed)} label="removed" />
      <Stat value={`${readout.rerouted} of ${readout.edges}`} label="edges rerouted" />
    </div>
  );
}

export function LivingStage(props: LivingStageProps): ReactElement {
  const { seed, autoplay = true, className } = props;

  const graph = useMemo(() => createLivingGraph({ seed }), [seed]);
  const script = useMemo(() => createEditScript(graph), [graph]);
  const reducedMotion = usePrefersReducedMotion();

  const [state, setState] = useState<ScriptState>(INITIAL_SCRIPT_STATE);
  const [last, setLast] = useState<EditStep | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(NOTHING_TOUCHED);
  const [playing, setPlaying] = useState(autoplay);
  const [failure, setFailure] = useState<unknown>(null);

  /**
   * The result the readout last counted an edit against.
   *
   * A ref rather than state, because it is read inside the callback that sets
   * the state and never rendered. Compared BY IDENTITY with the `from` that
   * comes with each delta, which is the whole continuity check: see
   * `readout.ts`, and M5.3a's entry for the defect that made `from` exist.
   */
  const counted = useRef<LayoutResult | null>(null);

  /** The graph the reset effect below has already run for. See that effect. */
  const seenGraph = useRef(graph);

  /**
   * A new graph is a new demo, so the script goes back to the top.
   *
   * THIS EFFECT MUST NOT TOUCH `counted`, AND THAT IS NOT AN OVERSIGHT. React
   * flushes a child's passive effects before its parent's, and `useDagr` lays a
   * new graph out during RENDER, so `<DagrCanvas>` reports the cold run from
   * its own effect on the first commit, which is BEFORE this one runs. A
   * `counted.current = null` here therefore threw away the record of a drawing
   * that had already been reported, and the first edit of every mount failed
   * the continuity check and rendered "more than one edit arrived in a single
   * frame", which was false: exactly one batched edit had. The cold run sets
   * `counted` to the right object on its own, because a cold run carries no
   * delta and `readEdit` returns `initial` for it whatever `counted` holds.
   *
   * The readout and the highlight are left alone here for the same reason:
   * `onLayout` has already set both from the cold run.
   */
  useEffect(() => {
    // ON AN ACTUAL CHANGE, NEVER ON MOUNT, and the guard is what keeps the
    // `setFailure` below from opening the hole it closes. This effect runs on
    // mount like any other, and a failure raised during that same first commit
    // would be cleared in the same flush; `<DagrCanvas>` reports through
    // `onError` when its own `trouble` CHANGES, so having cleared it we would
    // never be told again, and the canvas would be an empty box instead of the
    // error. Unreachable for this demo (this graph's cold layout does not
    // throw, and a device that never arrives does so in a later commit), which
    // is exactly why it is worth shutting now rather than when it is not.
    if (seenGraph.current === graph) return;
    seenGraph.current = graph;
    setState(INITIAL_SCRIPT_STATE);
    setLast(null);
    // The failure too, or `seed` cannot do what its docstring promises. A new
    // graph remounts nothing by itself, so a latched failure leaves the error
    // paragraph where the canvas was and every verb disabled, forever. A device
    // that is genuinely gone sets it again on the next mount; a layout error
    // that belonged to the old graph does not.
    setFailure(null);
  }, [graph]);

  const onLayout = useCallback(
    (result: LayoutResult, delta: LayoutDelta | null, from: LayoutResult | null): void => {
      setReadout(readEdit(result, delta, from, counted.current));
      setTouched(delta === null ? NOTHING_TOUCHED : touchedBy(delta));
      // Recorded WHATEVER the readout said, so one coalesced burst costs one
      // edit's numbers rather than every edit's from then on.
      counted.current = result;
    },
    [],
  );

  /** Takes one step, without touching whether the demo is playing. */
  const take = useCallback(
    (kind: EditKind): void => {
      const taken = takeStep(script, state, kind);
      if (taken === null) return;
      // The mutation first. `useDagr` relayouts inside this call, in the graph
      // listener, and publishes a new snapshot; the two `set`s below land in
      // the same React batch as that, so the label and the numbers change on
      // the same commit as the drawing.
      applyStep(graph, taken.step);
      setLast(taken.step);
      setState(taken.next);
    },
    [graph, script, state],
  );

  /** A button press, which also takes the demo off autoplay. */
  const press = useCallback(
    (kind: EditKind): void => {
      setPlaying(false);
      take(kind);
    },
    [take],
  );

  // AUTOPLAY IS A CHAIN OF TIMEOUTS RATHER THAN AN INTERVAL, keyed on the state
  // each step produces: the step changes `state`, this effect re-runs, and it
  // schedules the next. An interval would hold the first render's `state` in a
  // closure and take the same step forever.
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = setTimeout(() => {
      const taken = takeAutoStep(script, state);
      if (taken === null) {
        // No verb in the whole cycle applies, which no reachable state
        // produces. Stopping rather than returning is what keeps the button
        // from saying "pause" over a demo that has quietly stopped: that is
        // the failure this arm used to be, back when `takeAutoStep` gave up on
        // the first refusal instead of skipping past it.
        setPlaying(false);
        return;
      }
      applyStep(graph, taken.step);
      setLast(taken.step);
      setState(taken.next);
    }, AUTOPLAY_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [playing, reducedMotion, script, state, graph]);

  const stageOfId = useCallback(
    (id: string): Stage | undefined => {
      const node = graph.getNode(id);
      return node === undefined ? undefined : stageOf(node);
    },
    [graph],
  );

  // Memoised because `<DagrCanvas>` compares it by IDENTITY: an inline arrow
  // would rebuild the scene array on every render of this component, which
  // autoplay causes several times a second.
  const nodeAppearance = useMemo(
    () => livingAppearance(touched, stageOfId),
    [touched, stageOfId],
  );

  const verbs: readonly { kind: EditKind; enabled: boolean }[] = useMemo(
    () =>
      EDIT_KINDS.map((kind) => ({
        // `takeStep` returning null IS the disabled state. Asking it rather
        // than restating its rules here is what keeps an enabled button and a
        // step that throws from ever disagreeing.
        //
        // And nothing is pressable once the canvas has gone: the graph would
        // still edit and the readout would still count, beside no drawing at
        // all, which is a demo inviting a visitor to watch nothing happen.
        kind,
        enabled: failure === null && takeStep(script, state, kind) !== null,
      })),
    [script, state, failure],
  );

  return (
    <section className={className === undefined ? 'living' : `living ${className}`}>
      <div className="living__canvas">
        {failure === null ? (
          <DagrCanvas
            graph={graph}
            config={LIVING_LAYOUT_CONFIG}
            nodeAppearance={nodeAppearance}
            clearColor={CLEAR_COLOR}
            animate={reducedMotion ? undefined : FEEL}
            onLayout={onLayout}
            onError={setFailure}
            style={{ width: '100%', height: '100%' }}
          >
            <RefitButton />
          </DagrCanvas>
        ) : (
          <p className="living__failure" role="alert">
            {/*
              No cause is named. `onError` is the one exit for a renderer that
              never arrived AND for a layout that failed, and the first version
              of this blamed the GPU for both, which would have sent a reader
              looking at their browser for a bug in this package. The error's own
              message is the only thing here that knows which it was.
            */}
            This demo could not be drawn:{' '}
            {failure instanceof Error ? failure.message : String(failure)}
          </p>
        )}
      </div>

      <div className="living__controls">
        <div className="living__verbs">
          {verbs.map(({ kind, enabled }) => (
            <button
              key={kind}
              type="button"
              className="living__verb"
              disabled={!enabled}
              title={VERB_HINTS[kind]}
              onClick={() => {
                press(kind);
              }}
            >
              {VERB_LABELS[kind]}
            </button>
          ))}
        </div>
        {reducedMotion ? (
          <p className="living__reduced">
            Your system asks for reduced motion, so the drawing cuts to each layout instead of
            gliding and nothing plays on its own. The counts are the same either way.
          </p>
        ) : (
          <button
            type="button"
            className="living__play"
            aria-pressed={playing}
            onClick={() => {
              setPlaying((was) => !was);
            }}
          >
            {playing ? 'pause' : 'play'}
          </button>
        )}
      </div>

      <div className="living__readout" aria-live="polite">
        <p className="living__last">
          {last === null ? 'nothing edited yet' : `${last.kind}: ${last.label}`}
        </p>
        <Numbers readout={readout} />
      </div>

      <ul className="living__legend">
        {STAGE_LEGEND.map(({ stage, color }) => (
          <li key={stage} className="living__legendItem">
            <span
              className="living__swatch"
              style={{ background: `#${color.toString(16).padStart(6, '0')}` }}
            />
            {stage}
          </li>
        ))}
      </ul>
    </section>
  );
}
