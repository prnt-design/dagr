/**
 * The landing page's live demo: the bench corpus, laid out by @dagr/layout in
 * the visitor's browser, timed on their machine.
 *
 * It replaced a committed SVG of the same graph with a quoted millisecond
 * figure. The figure was honest and it was somebody else's machine, which is
 * the thing a reader cannot check. This runs the published engine on the
 * published corpus and reports what it took here.
 *
 * Three things carry that:
 *
 * The graph is generated, not shipped. `corpus.ts` is a port of the bench kit's
 * seeded generator, pinned to it by a test, so the 1k preset is the same graph
 * the committed baseline gates on and the same one the layout docs' cost table
 * has a column for.
 *
 * The run happens in a worker. `createLayout({ worker })` is worker mode as
 * M2.10 shipped it, and `runAsync` is the same call with or without a port, so
 * the fallback path when a worker cannot be constructed is one `undefined`
 * rather than a second code path. On that path the run is scheduled behind
 * `requestIdleCallback`, because a hundred-millisecond run on the main thread
 * is a page that stops answering the scrollbar.
 *
 * The number is end to end. It is measured around `runAsync`, so it includes
 * preparing the graph, encoding it, the round trip, and decoding the answer,
 * not just the pipeline. That is more than the docs' stage table measures and
 * it is what the page actually costs, so it is what the caption says it is.
 */

import Link from '@docusaurus/Link';
import { Graph } from '@dagr/graph';
import type { LayoutConfig, LayoutResult } from '@dagr/layout';
import { createLayout } from '@dagr/layout';
import clsx from 'clsx';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CorpusPreset } from './corpus';
import { BENCH_1K, CORPUS_PRESETS, layeredDag } from './corpus';
import styles from './LiveLayout.module.css';

/** Node box and base separations: the drawing the static figure used, kept. */
const NODE_SIZE = { width: 8, height: 8 } as const;
const BASE_RANK_SEP = 42;
const BASE_NODE_SEP = 4;

/** Padding around the fitted drawing, in layout units. */
const PAD = 16;

/** How far the view may zoom out and in, as a multiple of the fitted box. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Drawing {
  readonly edgePath: string;
  readonly nodePath: string;
  readonly fit: Box;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

function configFor(spacing: number): LayoutConfig {
  return {
    defaultNodeSize: NODE_SIZE,
    rankSep: Math.round(BASE_RANK_SEP * spacing),
    nodeSep: Math.max(1, Math.round(BASE_NODE_SEP * spacing)),
  };
}

function buildGraph(preset: CorpusPreset): Graph {
  const spec = layeredDag(preset);
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/**
 * Two path strings for the whole drawing: one for every edge, one for every
 * node. Four thousand `<path>` elements would be four thousand React nodes to
 * diff and four thousand boxes for the browser to lay out; two paths of the
 * same geometry are a couple of hundred kilobytes of string that nothing
 * reconciles. The layout ranks top to bottom and the figure is landscape, so x
 * and y swap and the graph reads left to right.
 */
function drawingOf(result: LayoutResult): Drawing {
  const r = (value: number): number => Math.round(value);
  let edgePath = '';
  for (const edge of result.edges.values()) {
    edgePath += `M${edge.points.map((p) => `${r(p.y)} ${r(p.x)}`).join('L')}`;
  }
  let nodePath = '';
  for (const node of result.nodes.values()) {
    nodePath +=
      `M${r(node.y - node.height / 2)} ${r(node.x - node.width / 2)}` +
      `h${node.height}v${node.width}h-${node.height}z`;
  }
  return {
    edgePath,
    nodePath,
    fit: {
      x: r(result.bounds.y) - PAD,
      y: r(result.bounds.x) - PAD,
      width: r(result.bounds.height) + PAD * 2,
      height: r(result.bounds.width) + PAD * 2,
    },
    nodeCount: result.nodes.size,
    edgeCount: result.edges.size,
  };
}

const count = (value: number): string => value.toLocaleString('en-US');

// The gap before the unit is a narrow no-break space written as an escape, so
// the source stays plain ASCII and the figure never splits from its unit
// across a line.
const ms = (value: number): string =>
  `${(Math.round(value * 10) / 10).toLocaleString('en-US')}\u202fms`;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Runs `work` when the browser is idle, so a main-thread run does not jank. */
function whenIdle(work: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(work, { timeout: 600 });
    return () => {
      cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(work, 0);
  return () => {
    clearTimeout(handle);
  };
}

interface Measurement {
  /** The settings the timings were taken at; they are meaningless across a change. */
  readonly key: string;
  readonly times: readonly number[];
}

export default function LiveLayout(): ReactNode {
  const [preset, setPreset] = useState<CorpusPreset>(
    CORPUS_PRESETS.find((p) => p.id === BENCH_1K.id) ?? BENCH_1K,
  );
  const [spacing, setSpacing] = useState(1);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>({ key: '', times: [] });
  const [mode, setMode] = useState<'worker' | 'main' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<Box | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const graphs = useRef(new Map<string, Graph>());
  const runToken = useRef(0);
  const warmed = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const settingsKey = `${preset.id}:${String(spacing)}`;

  // Annotated rather than inferred because the warm-up path below calls it,
  // and a `const` whose type is inferred from an initializer that mentions it
  // has no type to infer from.
  const run: (nextPreset: CorpusPreset, nextSpacing: number) => void = useCallback(
    (nextPreset: CorpusPreset, nextSpacing: number): void => {
      const token = runToken.current + 1;
      runToken.current = token;
      // The first run of a page is a warm-up and its time is not reported. It
      // is the run where the JIT meets this code, and on the machines this was
      // checked on it lands two to three times the ones after it. The bench
      // harness discards a first run after idle for the same reason; a demo
      // that reported it would be quoting the slowest number it will ever see.
      const warmup = !warmed.current;
      warmed.current = true;
      setBusy(true);
      const key = `${nextPreset.id}:${String(nextSpacing)}`;
      // A browser `Worker` satisfies `LayoutPort` structurally, so nothing is
      // cast here, and `undefined` is the whole of the fallback.
      const engine = createLayout({
        config: configFor(nextSpacing),
        worker: workerRef.current ?? undefined,
      });

      let graph = graphs.current.get(nextPreset.id);
      if (graph === undefined) {
        graph = buildGraph(nextPreset);
        graphs.current.set(nextPreset.id, graph);
      }

      const started = performance.now();
      engine.runAsync(graph).then(
        (result) => {
          // A run whose settings have already been replaced is an answer to a
          // question nobody is asking any more.
          if (runToken.current !== token) return;
          const elapsed = performance.now() - started;
          setDrawing(drawingOf(result));
          setFailure(null);
          if (warmup) {
            // Straight into the measured run, from here rather than from an
            // effect, so the two are one page load's worth of work and not a
            // state change the visitor can interrupt halfway.
            run(nextPreset, nextSpacing);
            return;
          }
          setMeasurement((previous) =>
            previous.key === key
              ? { key, times: [...previous.times, elapsed] }
              : { key, times: [elapsed] },
          );
          setBusy(false);
        },
        (error: unknown) => {
          if (runToken.current !== token) return;
          setFailure(error instanceof Error ? error.message : String(error));
          setBusy(false);
        },
      );
    },
    [],
  );

  // The worker, built once. A browser that refuses to construct one (an old
  // engine, a policy that blocks worker scripts) leaves the ref null, and
  // `runAsync` then runs the pipeline on this thread and resolves, which is the
  // fallback M2.10 designed in rather than a path this component invents.
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    workerRef.current = worker;
    setMode(worker === null ? 'main' : 'worker');
    return () => {
      workerRef.current = null;
      worker?.terminate();
    };
  }, []);

  // Every run the visitor did not ask for by name: the first one, and the ones
  // a changed control implies. Idle-scheduled so the page finishes painting
  // first, and debounced so dragging the spacing slider queues one run rather
  // than one per pixel.
  useEffect(() => {
    let cancelIdle: (() => void) | null = null;
    const timer = setTimeout(() => {
      cancelIdle = whenIdle(() => {
        run(preset, spacing);
      });
    }, 160);
    return () => {
      clearTimeout(timer);
      cancelIdle?.();
    };
  }, [preset, spacing, run]);

  // A new fit box means a different drawing, so the view goes back to fitted.
  // Re-running the same settings keeps wherever the visitor panned to.
  const fitKey = drawing === null ? '' : Object.values(drawing.fit).join(' ');
  useEffect(() => {
    setView(null);
  }, [fitKey]);

  const box = view ?? drawing?.fit ?? null;

  const zoomBy = useCallback(
    (factor: number, originX = 0.5, originY = 0.5): void => {
      setView((current) => {
        const from = current ?? drawing?.fit ?? null;
        const fit = drawing?.fit ?? null;
        if (from === null || fit === null) return current;
        const scale = fit.width / from.width;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
        const width = fit.width / next;
        const height = fit.height / next;
        return {
          x: from.x + (from.width - width) * originX,
          y: from.y + (from.height - height) * originY,
          width,
          height,
        };
      });
    },
    [drawing],
  );

  // Wheel zoom is bound here rather than as a React prop because it has to be
  // non-passive to call `preventDefault`, and only Ctrl-wheel (which is what a
  // trackpad pinch sends) zooms: a plain wheel over the figure scrolls the page,
  // because a figure that eats the scroll is a figure you cannot scroll past.
  useEffect(() => {
    const element = svgRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * 0.01),
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [zoomBy]);

  const drag = useRef<{ pointer: number; x: number; y: number; box: Box } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (box === null) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, box };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const held = drag.current;
    if (held === null || held.pointer !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView({
      x: held.box.x - ((event.clientX - held.x) * held.box.width) / rect.width,
      y: held.box.y - ((event.clientY - held.y) * held.box.height) / rect.height,
      width: held.box.width,
      height: held.box.height,
    });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const config = useMemo(() => configFor(spacing), [spacing]);
  const times = measurement.key === settingsKey ? measurement.times : [];
  const latest = times[times.length - 1];
  const nodes = drawing?.nodeCount ?? preset.nodeCount;
  const edges = drawing?.edgeCount ?? preset.edgeCount;

  const label =
    latest === undefined
      ? `A ${count(preset.nodeCount)} node graph, being laid out.`
      : `${count(nodes)} nodes and ${count(edges)} edges laid out by Dagr, ` +
        `drawn left to right, one square per node.`;

  return (
    <figure className={clsx('selvedge', styles.figure)}>
      <div className={clsx('dagr-live-js-only', styles.controls)}>
        <div className={styles.group}>
          <span className={styles.groupLabel} id="live-size">
            Nodes
          </span>
          <div className={styles.segmented} role="group" aria-labelledby="live-size">
            {CORPUS_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={clsx(
                  'corner-cut-native-s',
                  styles.segment,
                  option.id === preset.id && styles.segmentOn,
                )}
                aria-pressed={option.id === preset.id}
                onClick={() => {
                  setPreset(option);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <label className={styles.groupLabel} htmlFor="live-spacing">
            Spacing
          </label>
          <input
            id="live-spacing"
            className={styles.slider}
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={spacing}
            onChange={(event) => {
              setSpacing(Number(event.target.value));
            }}
          />
          <code className={styles.configEcho}>
            rankSep {config.rankSep} · nodeSep {config.nodeSep}
          </code>
        </div>

        <div className={styles.group}>
          <button
            type="button"
            className={clsx('bias-open-s', styles.action)}
            onClick={() => {
              run(preset, spacing);
            }}
            disabled={busy}
          >
            {busy ? 'Laying out…' : 'Lay it out again'}
          </button>
          <span className={styles.zoom}>
            <button
              type="button"
              className={clsx('corner-cut-native-s', styles.segment)}
              onClick={() => {
                zoomBy(1 / 1.6);
              }}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className={clsx('corner-cut-native-s', styles.segment)}
              onClick={() => {
                zoomBy(1.6);
              }}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className={clsx('corner-cut-native-s', styles.segment)}
              onClick={() => {
                setView(null);
              }}
              disabled={view === null}
            >
              Fit
            </button>
          </span>
        </div>
      </div>

      {/* Everything below that reports on a run is JS-only, and with scripting
          off it would sit there claiming to be measuring something. The style
          element inside <noscript> is inert wherever the demo can actually run,
          and hides those parts wherever it cannot, leaving the sentence that is
          true in that case. */}
      <noscript>
        <style>{'.dagr-live-js-only{display:none}'}</style>
        <p className={styles.readout}>
          This figure runs the layout engine in your browser rather than showing
          a picture of a run on somebody else&apos;s machine, so it needs
          JavaScript. The graph at the top of this page is the same engine&apos;s
          output, laid out at build time and committed, and the{' '}
          <Link to="/docs/layout#what-a-run-costs">layout docs</Link> publish
          what each stage costs on this corpus and on one ten times its size.
        </p>
      </noscript>

      <div className={clsx('dagr-live-js-only', styles.stage)}>
        {drawing === null || box === null ? (
          <p className={styles.placeholder}>{failure === null ? 'Laying out…' : null}</p>
        ) : (
          <svg
            ref={svgRef}
            className={styles.drawing}
            viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
            role="img"
            aria-label={label}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <path className={styles.edges} d={drawing.edgePath} />
            <path className={styles.nodes} d={drawing.nodePath} />
          </svg>
        )}
      </div>

      <p className={clsx('dagr-live-js-only', styles.readout)} aria-live="polite">
        {failure !== null ? (
          <>Layout did not finish in this browser: {failure}.</>
        ) : latest === undefined ? (
          <>Measuring {count(preset.nodeCount)} nodes on your device…</>
        ) : (
          <>
            <strong className={styles.time}>{ms(latest)}</strong> to lay out{' '}
            {count(nodes)} nodes and {count(edges)} edges{' '}
            {mode === 'main' ? 'on this page’s own thread' : 'in a web worker'}, measured
            on your device
            {/* A median of two is one of the two, so it waits for a third. */}
            {times.length > 2 ? <>, median {ms(median(times))} over {times.length} runs</> : null}.
          </>
        )}
      </p>

      <figcaption className={clsx('dagr-live-js-only', styles.caption)}>
        Timed end to end around one <code>runAsync</code> call, so it counts
        preparing the graph and the trip to the worker, not the pipeline alone.
        The page&apos;s first run is a warm-up and is not reported, which is the
        rule the repository&apos;s own benchmark captures follow. Drag to pan;
        the buttons zoom.
      </figcaption>
    </figure>
  );
}
