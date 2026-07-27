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
 * The class below restores its own prototype explicitly, exactly as
 * `DagrGraphError` and `DagrLayoutError` do, so `instanceof` stays correct even
 * when the output is downlevelled below the ES2022 target. No abstract base
 * here: the sibling packages have one because each has several failure kinds a
 * caller might want to catch apart and a `code` to switch on, and a base class
 * over a family of one would be a family only in the sense that a single point
 * is a line. A second member is when this file grows a base, and that is a
 * mechanical change at the time rather than a design owed now.
 */

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
export class RendererDisposedError extends Error {
  constructor(method: string) {
    super(`cannot call ${method}() on a disposed renderer`);
    this.name = 'RendererDisposedError';
    Object.setPrototypeOf(this, RendererDisposedError.prototype);
  }
}
