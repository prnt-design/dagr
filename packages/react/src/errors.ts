/**
 * Errors thrown by `@dagr/react`, and why there is only one.
 *
 * The rule the sibling packages follow applies here unchanged: an
 * out-of-range value is a `RangeError` naming the field, and anything else gets
 * a named class. This package has almost nothing to range-check, because every
 * number it handles came out of a layout it ran itself or goes straight into a
 * renderer that checks it, so what is left is the one failure that is a fact
 * about a component tree rather than about a value.
 *
 * **There is no abstract base yet, on purpose, and `@dagr/render`'s errors file
 * is the precedent for both halves of that.** It carried a paragraph for two
 * milestones saying a base over a family of one would be a family only in the
 * sense that a single point is a line, and then added the base the moment M4.11
 * brought a second member. This file is at the same stage, and a
 * `DagrReactError` with exactly one subclass would be a promise about a
 * hierarchy nobody has needed. The `code` field is here from the start
 * regardless, because that is the part a caller switches on, and adding it
 * later would change a shape that had already shipped.
 *
 * The prototype is restored explicitly, as every sibling does, so `instanceof`
 * stays correct when the output is downlevelled below the ES2022 target.
 */

/** The `code` of every error this package throws. */
export type DagrReactErrorCode = 'OUTSIDE_CANVAS';

/**
 * Thrown when `useDagrCanvas` (or an `<Html>`, which calls it) runs outside a
 * `<DagrCanvas>`.
 *
 * A missing provider is the one mistake in a React package that is completely
 * silent without a check: `useContext` of an unprovided context returns the
 * default value, so a hook that returned `null` here would push the failure
 * into whatever read the renderer off it, several frames and one stack away
 * from the component that was in the wrong place. The message names the
 * component rather than the context, because the component is the thing the
 * caller has to move.
 */
export class CanvasContextError extends Error {
  readonly code: DagrReactErrorCode = 'OUTSIDE_CANVAS';

  constructor(used: string) {
    super(`${used} has to be rendered inside a <DagrCanvas>`);
    this.name = 'CanvasContextError';
    Object.setPrototypeOf(this, CanvasContextError.prototype);
  }
}
