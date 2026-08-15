/**
 * Errors thrown by the layout pipeline.
 *
 * Deliberately the same shape as the `@dagr/graph` error family, so a caller
 * who has learned one has learned both: every error extends
 * {@link DagrLayoutError} and can be caught with one `instanceof` check, every
 * error carries a `code` string literal for callers who would rather switch on
 * a value than on a class, and the base declares `code` abstractly so a switch
 * through a value typed as the base class stays exhaustive. Each subclass
 * restores its own prototype explicitly, so `instanceof` stays correct even
 * when the output is downlevelled below the ES2022 target.
 *
 * The members cover the ways a layout run can go wrong, split by whose bug each
 * one is: the caller handed in nonsense ({@link InvalidConfigError}), a stage
 * did not hold up its end of the pipeline contract
 * ({@link StageContractError}), the worker boundary a run crossed did not
 * behave ({@link WorkerTransportError}), a delta was applied to a result it was
 * not computed against ({@link DeltaMismatchError}), or this package broke one
 * of its own invariants ({@link InternalLayoutError}). Sorting them that way is
 * the point of having several rather than one, because it is the only question
 * a caller catching one actually has to answer: fix the input, fix the stage,
 * fix the worker wiring, fix the bookkeeping, or file the bug.
 */

/**
 * The `code` of every error the layout pipeline throws.
 *
 * Widening this union is a breaking change for a caller with an exhaustive
 * `switch`, which is exactly the caller the `code` discriminant exists to
 * serve. Adding a member is therefore something to do before v0.1 rather than
 * after.
 */
export type DagrLayoutErrorCode =
  | 'INVALID_CONFIG'
  | 'STAGE_CONTRACT'
  | 'INTERNAL'
  | 'WORKER'
  | 'DELTA_MISMATCH';

/**
 * Base class for every error the layout pipeline throws. Abstract on purpose,
 * for the same reason as `DagrGraphError`: a family member with no `code` would
 * defeat the point of the union, and tightening this later would break callers.
 */
export abstract class DagrLayoutError extends Error {
  /** Discriminant for switching on the error without naming its class. */
  abstract readonly code: DagrLayoutErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DagrLayoutError';
    Object.setPrototypeOf(this, DagrLayoutError.prototype);
  }
}

/**
 * Renders a rejected config value for a message. `String` is enough for the
 * numbers this is used on (`NaN`, `Infinity`, `-1` all read fine), and the
 * `JSON.stringify` fallback keeps a rejected object such as a bad
 * `defaultNodeSize` legible instead of printing `[object Object]`.
 */
function describeValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Thrown when a number a caller named is not one the pipeline can work with.
 *
 * Two kinds of caller input reach it. A field of the `LayoutConfig`, which is a
 * separation or a size and has to be a finite number that is zero or greater:
 * `nodeSep`, `rankSep`, `edgeSep`, `defaultNodeSize`, and every size the
 * `nodeSize` callback returns. And an option a stage factory validates when the
 * stage is built rather than when it runs, which today is `maxIterations` on
 * {@link networkSimplexRank} and `maxSweeps` and `maxTransposePasses` on
 * {@link barycenterOrder}, each with a rule of its own.
 *
 * The message says which of the two it was, `Invalid layout config:` against
 * `Invalid layout option:`, and quotes the rule the value broke rather than
 * assuming every rejected value is a size. A caller told that `maxIterations`
 * is not a valid layout config would go looking for it in an object that has no
 * field by that name.
 *
 * Zero is allowed: a zero separation or a zero-sized node is a strange layout
 * but a well defined one. `NaN` and `Infinity` are not, because they propagate
 * silently through every later coordinate and the failure would surface as an
 * unrenderable scene rather than as a bad input. A budget gets to say
 * otherwise, and the budgets split: `maxIterations` takes
 * `Number.POSITIVE_INFINITY` as a run to convergence, `maxSweeps` and
 * `maxTransposePasses` reject it. What decides is whether the budget bounds a
 * solver with a stopping condition to converge to or a heuristic with none, and
 * the argument is made in full beside `maxSweeps` in `order.ts`.
 *
 * `field` is a path rather than a bare name, so a size rejected inside the
 * `nodeSize` callback says which node it came from: `nodeSize("n1").width`.
 */
export class InvalidConfigError extends DagrLayoutError {
  readonly code = 'INVALID_CONFIG';

  constructor(
    readonly field: string,
    readonly value: unknown,
    subject: 'config' | 'option' = 'config',
    requirement = 'a finite number that is not negative',
  ) {
    super(
      `Invalid layout ${subject}: ${field} must be ${requirement}, ` +
        `received ${describeValue(value)}`,
    );
    this.name = 'InvalidConfigError';
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

/**
 * Thrown when a stage returns a result that later stages, or the caller, could
 * not work with: a node with no rank or no size, a virtual node declared at a
 * size that is not a usable pair of lengths, a dummy chain that is empty or
 * runs the wrong way, an edge that runs up the page without being declared
 * reversed, a node missing from the layers or listed twice, a layer that mixes
 * ranks or is empty, a node with no position, an edge with no route, a route
 * with fewer than two points, a result that mentions something the graph does
 * not hold.
 *
 * This is the payoff of swappable stages. The runner checks each stage's output
 * at that stage's own boundary, so a half-finished ranker is reported as a
 * ranker problem rather than surfacing three stages later as an edge that
 * routes to `undefined`. `stage` is the offending stage's `name` and `id` is
 * the node or edge it left behind, both also quoted in the message. One check
 * is about the layers rather than one id, and uses a plain label instead:
 * `layer 3`.
 */
export class StageContractError extends DagrLayoutError {
  readonly code = 'STAGE_CONTRACT';

  constructor(
    readonly stage: string,
    readonly id: string,
    readonly detail: string,
  ) {
    super(`Layout stage "${stage}" left work undone for "${id}": ${detail}`);
    this.name = 'StageContractError';
    Object.setPrototypeOf(this, StageContractError.prototype);
  }
}

/**
 * Thrown when a run sent to a worker did not come back as a layout.
 *
 * This is the fourth culprit the family sorts by, and M2.10 is what made it a
 * culprit at all: before worker mode there was no boundary between the caller
 * and the pipeline, so a run either produced a result or threw one of the three
 * above, in the caller's own stack. Once a run crosses a port, two things that
 * are nobody's stage and nobody's config become possible: the two ends disagree
 * about the wire format, because they were built from different versions, or
 * the stages on the far side threw something that is not a member of this
 * family at all. Neither is a config to fix or a stage contract that was broken
 * here, and neither is an invariant of this package: the wiring is what is
 * wrong, and the wiring is the caller's.
 *
 * A message this package does not RECOGNISE is deliberately not among them, and
 * the distinction matters to anyone debugging with this class in hand. Both
 * ends tag their messages and ignore what they cannot identify, because serving
 * layout on a port does not claim the port and somebody else's traffic is
 * allowed to be on it. So an answer that never arrives, or arrives unrecognised,
 * is a promise that stays pending rather than an error: there is no timeout, for
 * the reasons `engine.runAsync` gives. What this class catches is the answer
 * that IS recognised and is wrong, a `layout-result` whose box, count or point
 * lengths disagree with the graph it answers, because the alternative to
 * checking is a layout with every id present, every number finite, and
 * everything in the wrong place.
 *
 * A foreign error is the interesting case, and it is why `detail` carries text
 * rather than a cause. Structured cloning does not carry a class, so a
 * `TypeError` from a third-party stage cannot arrive as one. What CAN arrive
 * faithfully is a {@link StageContractError} or an {@link InternalLayoutError},
 * because both carry nothing but strings, and the worker rebuilds those as
 * themselves rather than wrapping them: a stage that left work undone reads the
 * same whether it ran here or there. Anything else arrives as its reported name
 * and message quoted inside this error, which keeps the text and admits the
 * class is gone rather than inventing one.
 *
 * {@link InvalidConfigError} deliberately has no path across. The config is
 * resolved and every node is measured on the CALLING side, before anything is
 * posted, precisely so that the `nodeSize` callback never has to cross a
 * boundary it cannot survive. So a bad separation or a bad size is thrown at
 * the caller, synchronously, by the same code that would have thrown it for a
 * sync run.
 */
export class WorkerTransportError extends DagrLayoutError {
  readonly code = 'WORKER';

  constructor(readonly detail: string) {
    super(`Layout worker: ${detail}`);
    this.name = 'WorkerTransportError';
    Object.setPrototypeOf(this, WorkerTransportError.prototype);
  }
}

/**
 * Thrown when a {@link LayoutDelta} is applied to a result it was not computed
 * against: it moves a node that result does not hold, removes an edge that is
 * not there, or adds one that already is.
 *
 * The fifth culprit, and M3.1 is what made it one. A delta is a description of
 * the difference between two results and carries no evidence of which two, so
 * pairing it with the wrong one is a mistake nothing in the type system can
 * refuse. What makes it worth an error class rather than a tolerated no-op is
 * that the alternative is silence: applying a move for a node that is not there
 * and carrying on leaves a scene that is wrong, stays wrong, and drifts further
 * wrong with every later delta, which is exactly the desynchronisation the
 * absent-means-unchanged delta shape has to be defended against elsewhere.
 * Reported at the first entry that does not fit, so the message names a cause
 * rather than a count.
 *
 * It is the CALLER's bookkeeping rather than this package's invariant, which is
 * why it is not an {@link InternalLayoutError}: `diffLayout` and `applyDelta`
 * are pure functions over results the caller chose to pair, and choosing is the
 * whole of what can go wrong. It is not a {@link StageContractError} either,
 * because there is no stage anywhere near it.
 *
 * `id` is the node or edge that did not fit, and `detail` says what was being
 * done to it. Both are quoted in the message.
 */
export class DeltaMismatchError extends DagrLayoutError {
  readonly code = 'DELTA_MISMATCH';

  constructor(
    readonly id: string,
    readonly detail: string,
  ) {
    super(`Layout delta does not fit the result it was applied to: "${id}" ${detail}`);
    this.name = 'DeltaMismatchError';
    Object.setPrototypeOf(this, DeltaMismatchError.prototype);
  }
}

/**
 * Thrown when the pipeline catches itself breaking one of its own invariants:
 * an index into one of its internal arrays with nothing at it, a rank sweep
 * that could not reach every node, `bounds` that do not enclose the drawing it
 * just computed them from, a cycle breaker with no vertex left to pick.
 *
 * This is always a bug in `@dagr/layout`, never in the caller and never in a
 * caller-supplied stage. That is the whole reason it is not a
 * {@link StageContractError}: that class names a stage, and naming one here
 * would pin this package's mistake on whoever happened to be plugged in when it
 * surfaced. Nothing a caller does to their graph, their config, or their stages
 * can produce one, so there is nothing for them to fix. Report it.
 *
 * It is a member of the family rather than a bare `Error` because a caller
 * wrapping `layout` wants one `catch` and one `switch`, and an invariant
 * failure escaping as something outside the union would fall out of the bottom
 * of that switch silently, which is the shape of bug that gets a crash reported
 * as "layout returned nothing".
 *
 * `detail` is the invariant, phrased as what was observed rather than as what
 * was expected, because the observation is the part that narrows down where to
 * look.
 */
export class InternalLayoutError extends DagrLayoutError {
  readonly code = 'INTERNAL';

  constructor(readonly detail: string) {
    super(`Layout invariant broken: ${detail}. This is a bug in @dagr/layout.`);
    this.name = 'InternalLayoutError';
    Object.setPrototypeOf(this, InternalLayoutError.prototype);
  }
}
