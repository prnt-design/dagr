/**
 * `@dagr/react`: a graph on a canvas, as one component.
 *
 * The package was scaffolded with the workspace and stayed empty by decision
 * until M5.1, because `<Html>` needed a context and the context is
 * `<DagrCanvas>`'s to provide: shipping the sugar first would have meant
 * inventing that context in a package with no component to provide it, and then
 * living with the shape when the requirements that should have decided it
 * finally arrived. They have, and the whole package is four exports and a
 * conversion.
 *
 * - {@link DagrCanvas} is the component: a graph goes in, a picture comes out.
 * - {@link useDagr} is the layout on its own, for a caller drawing it their own
 *   way or reading the geometry beside a canvas somebody else owns.
 * - {@link Html} puts React content in world coordinates over the canvas.
 * - {@link useDagrCanvas} is how anything inside reaches the renderer, the
 *   overlay and the layout.
 *
 * **What this package is FOR is the seam nothing else in the workspace owns.**
 * `@dagr/render` refuses to name a `LayoutResult`, on the argument that the
 * y-down to y-up conversion belongs to whoever owns the layout, and until now
 * the only thing that owned both was `@dagr/campaign-stage`: private, written
 * for one dataset, and copied by every host that wanted a different one. The
 * conversion is `scene.ts` here, exported rather than hidden, because a caller
 * driving the renderer directly wants the same three functions and should not
 * write the flip a fourth time.
 *
 * **What is deliberately NOT here**, each waiting on the task that decides it:
 *
 * - No interaction. Hover, selection and drag are M5.2 and they want M4.8's
 *   picking pass underneath, not a hit test invented here against a scene array.
 * - No animation. M4.6 shipped the springs and M4.7 is the delta consumer that
 *   drives them from a `LayoutDelta`. `<DagrCanvas>` re-lays out and re-sets;
 *   nothing tweens, and adding a tween here would be M4.7 built in the wrong
 *   package.
 * - No worker. See `use-dagr.ts`: the `Worker` has to be the caller's, and
 *   M3.9 owns the worker-side session that makes a per-edit round trip worth
 *   taking.
 * - No node ontology. What a node looks like is a callback, and it stays one.
 *   Deciding that a node of kind X draws as a hexagon is M6's, and M6 was
 *   rescoped precisely so that Dagr ships no ontology of its own.
 *
 * `PKG_NAME` is gone, as it went from `@dagr/render` for the same reason:
 * scaffolding from the workspace's first commit, imported by nothing, and an
 * exported constant nobody uses is one more thing a consumer can depend on by
 * accident.
 */

export { DEFAULT_EDGE_GROUP_ID, DagrCanvas } from './DagrCanvas.js';
export type { DagrCanvasProps } from './DagrCanvas.js';
export { Html } from './Html.js';
export type { HtmlProps } from './Html.js';
export { DagrCanvasContext, useDagrCanvas } from './canvas-context.js';
export type { DagrCanvasHandle } from './canvas-context.js';
export { CanvasContextError } from './errors.js';
export type { DagrReactErrorCode } from './errors.js';
export {
  DEFAULT_EDGE_COLOR,
  DEFAULT_NODE_APPEARANCE,
  nodeWorldBounds,
  toSceneEdges,
  toSceneNodes,
  toWorldBounds,
} from './scene.js';
export type { EdgeColorOf, NodeAppearance, NodeAppearanceOf } from './scene.js';
export { useDagr } from './use-dagr.js';
export type { DagrLayoutState, UseDagrOptions } from './use-dagr.js';
