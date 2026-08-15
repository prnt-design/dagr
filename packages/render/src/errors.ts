/**
 * Errors thrown by `@dagr/render`, and the rule for which kind is which.
 *
 * **An out-of-range value is a `RangeError` naming the field. Anything else
 * this package throws gets a named class.** That is the whole rule, and it is
 * applicable without judgement, which is the property a rule of this kind
 * needs. A bad number is something the caller wrote on a line they can see, and
 * `RangeError` with the field in the message is already the best possible
 * report of it; inventing a class per field would be ceremony. A lifecycle
 * failure is not like that: it arrives from a race in somebody else's
 * framework, at a moment no single line of the caller's code owns, and it is
 * the one a caller actually writes a `catch` for. Matching a string is not a
 * way to catch anything.
 *
 * **The base class arrived with the overlay, exactly as this file said it
 * would.** It used to carry a paragraph explaining that a base over a family of
 * one would be a family only in the sense that a single point is a line, and
 * that a second member is when the file grows one. M4.11 brought two, so
 * {@link DagrRenderError} is here now, with the abstract `code` that
 * `DagrGraphError` and `DagrLayoutError` carry for callers who would rather
 * switch on a value than on a class. `RendererDisposedError` keeps its name,
 * its message and its `instanceof Error`, so nothing that catches it today
 * notices.
 *
 * Every class restores its own prototype explicitly, as the sibling packages
 * do, so `instanceof` stays correct even when the output is downlevelled below
 * the ES2022 target.
 */

/**
 * The `code` of every error this package throws.
 *
 * A union rather than an enum, so it is a value a `switch` narrows exhaustively
 * and nothing has to be imported to compare against it.
 */
export type DagrRenderErrorCode =
  | 'RENDERER_DISPOSED'
  | 'OVERLAY_PARENT'
  | 'OVERLAY_DISPOSED'
  | 'UNKNOWN_INSTANCE_HANDLE'
  | 'SCENE_DISPOSED';

/** The base every error this package throws extends. */
export abstract class DagrRenderError extends Error {
  abstract readonly code: DagrRenderErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DagrRenderError';
    Object.setPrototypeOf(this, DagrRenderError.prototype);
  }
}

/**
 * Thrown when a renderer is used after its `dispose()`.
 *
 * The likely cause is a lifecycle race rather than a typo: a component that
 * unmounted while a frame was queued, a hot reload that swapped a module out
 * from under a running loop, an animation callback that outlived the thing it
 * was drawing. Every one of those is a case where a caller reasonably wants to
 * catch and stop rather than crash, which is why this is a class and not the
 * bare `Error` it used to be.
 */
export class RendererDisposedError extends DagrRenderError {
  readonly code = 'RENDERER_DISPOSED';

  constructor(method: string) {
    super(`cannot call ${method}() on a disposed renderer`);
    this.name = 'RendererDisposedError';
    Object.setPrototypeOf(this, RendererDisposedError.prototype);
  }
}

/**
 * Thrown when `createHtmlOverlay` is given a parent it cannot mount into.
 *
 * The overlay's two divs are `position: absolute`, which resolves against the
 * nearest POSITIONED ancestor. Given a `static` parent, the layer would find
 * whatever positioned element happens to be further up the page, or the initial
 * containing block, and cover the document at full size with labels in
 * plausible-looking but entirely wrong places. Since a caller cannot see that
 * from the overlay's own code, this is checked once at creation.
 *
 * A parent that is not in a document fails the same check for a different
 * reason: `getComputedStyle` on a disconnected element returns an empty
 * declaration, so its `position` is neither `static` nor anything else, and
 * accepting that would mean accepting the exact case this class exists to name
 * whenever a caller builds an overlay before mounting. It is also not a state
 * the overlay can work in, since the layer is placed in the canvas's coordinate
 * space and a disconnected element has none.
 *
 * Not a `RangeError`, because nothing here is out of range: the parent is a
 * perfectly good element in the wrong state. And the overlay does not set
 * `position: relative` on it instead, because silently restyling an element the
 * caller owns is how a library ends up in the middle of somebody else's layout
 * bug.
 */
export class OverlayParentError extends DagrRenderError {
  readonly code = 'OVERLAY_PARENT';

  constructor(problem: string) {
    super(
      `the overlay parent ${problem}. It has to be in the document and establish a containing block: give it position: relative (or absolute, fixed or sticky).`,
    );
    this.name = 'OverlayParentError';
    Object.setPrototypeOf(this, OverlayParentError.prototype);
  }
}

/**
 * Thrown when an overlay is added to after its `dispose()`.
 *
 * `add()` is called from the caller's own code, so a throw here has a stack
 * that points at the line to fix. `sync()` deliberately does NOT throw after
 * dispose, which is a knowing divergence from `RendererDisposedError` being
 * thrown from every renderer method: `sync()` is the one method the platform
 * calls, from inside a `requestAnimationFrame` callback where a throw reaches
 * the global error handler rather than the caller's `catch`, and a component
 * that unmounts with a frame already queued is the normal case rather than a
 * bug. See `html-overlay.ts`.
 */
export class OverlayDisposedError extends DagrRenderError {
  readonly code = 'OVERLAY_DISPOSED';

  constructor(method: string) {
    // "after dispose()" rather than "on a disposed overlay", because M4.12's
    // `createRichNodes` throws this too and a rich-node binding is not an
    // overlay. One class rather than two: the failure, the cause and what a
    // caller does about it are identical, and the method name in the message
    // says which object it was.
    super(`cannot call ${method}() after dispose()`);
    this.name = 'OverlayDisposedError';
    Object.setPrototypeOf(this, OverlayDisposedError.prototype);
  }
}

/**
 * Thrown when an instance buffer is asked about a handle it does not hold.
 *
 * A class rather than a `RangeError`, on this file's own rule: nothing about the
 * number is out of range, and the caller is almost never looking at the line
 * that produced it. The cause is a handle that outlived the instance it named,
 * which arrives from a graph delta removing a node while something else still
 * holds its handle, or from a slot index stored where a handle belonged (see the
 * invariant in `instance-buffer.ts`). Both are worth catching deliberately, and
 * both are worth failing on rather than papering over: the alternative to a
 * throw is a sentinel index that array arithmetic accepts, which writes one
 * instance's data over another's and shows up as a shape in the wrong place
 * several frames later.
 */
export class UnknownInstanceHandleError extends DagrRenderError {
  readonly code = 'UNKNOWN_INSTANCE_HANDLE';

  constructor(handle: number) {
    super(`instance handle ${String(handle)} is not live: it was freed, or never allocated`);
    this.name = 'UnknownInstanceHandleError';
    Object.setPrototypeOf(this, UnknownInstanceHandleError.prototype);
  }
}

/**
 * Thrown when anything holding GPU resources for a scene is used after its
 * `dispose()`: a family's instanced mesh, or the node collection over them.
 *
 * A class rather than the bare `Error` this started as, on the rule at the top
 * of this file: a call after dispose is the lifecycle case that rule was
 * written for, and a bare `Error` lands in a caller's `catch` with no `code` and
 * failing `instanceof DagrRenderError`, which is the one thing this family
 * exists to prevent.
 *
 * ONE class for both, on {@link OverlayDisposedError}'s terms, and the name is
 * the second one it has had: it was `InstancedShapesDisposedError` while a mesh
 * was the only thing that threw it, and `SceneNodes` throwing the same failure a
 * task later is exactly the case that argument covers. The failure, the cause
 * and what a caller does about it are identical, and the label in the message
 * says which object it was.
 *
 * **No consumer can see this today, which is the strongest form of that
 * argument.** `Renderer.setNodes` asserts live before it delegates, so a
 * disposed renderer throws {@link RendererDisposedError} and the scene is never
 * asked; and both objects that throw this one are unexported. It is therefore a
 * guard on the internals and a class in place for the day one of them is handed
 * out, which is a reason to have exactly one of it rather than two.
 */
export class SceneDisposedError extends DagrRenderError {
  readonly code = 'SCENE_DISPOSED';

  constructor(method: string, label: string) {
    super(`cannot call ${method}() on the disposed ${label}`);
    this.name = 'SceneDisposedError';
    Object.setPrototypeOf(this, SceneDisposedError.prototype);
  }
}
