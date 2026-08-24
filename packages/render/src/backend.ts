import { BackendUnavailableError } from './errors.js';
import type { BackendPreference, RendererBackend } from './types.js';

/**
 * Which of three's two backends a renderer comes up on, and what a caller is
 * told about it. **M4.9a's whole decision lives here, and it is device-free on
 * purpose.**
 *
 * three's `WebGPURenderer` already falls back to WebGL2 by itself: its
 * constructor installs a `getFallback` and `init()` calls it when the WebGPU
 * backend refuses to start. So the choice this task had to make was never
 * whether to fall back, which was already happening. It was whether a caller
 * can TELL, and M4.1's own note said so: it "neither sets it nor reports which
 * backend won".
 *
 * **The decision is automatic, with a named exception.** `backend` defaults to
 * `auto`, because a consumer on a machine without WebGPU wants a slower picture
 * rather than no picture, and because refusing by default would make this
 * package's headline feature unavailable on every browser that has not shipped
 * WebGPU. What `auto` adds over today is that the answer is READABLE:
 * `renderer.backend` says which one drew. Naming `webgpu` or `webgl2` turns the
 * preference into a requirement, and an unmet requirement is a
 * {@link BackendUnavailableError} rather than a silently slower frame.
 *
 * **The entry asked for an event when the fallback fires and there is none,
 * because there is no moment for it to fire in.** three falls back inside
 * `init()`, which `createRenderer` awaits, so by the time a caller holds a
 * renderer the fallback has already happened and `renderer.backend` already
 * says so. A callback passed through the options would deliver the same fact
 * through a second mechanism, earlier than the caller has anything to act on,
 * and every consumer would then have two places to read one value. The property
 * is the report.
 *
 * **The check is after `init()` and not before it, and that is measured rather
 * than argued.** On the dispatch box's headless Chromium (2026-08-23, through
 * `bench/browser/backend-probe.mjs`), `'gpu' in navigator` is TRUE, and
 * `requestAdapter()` then returns null: the console carries "No available
 * adapters" followed by three's own "WebGPU is not available, running under
 * WebGL2 backend". A capability probe before construction would therefore have
 * reported WebGPU on a machine that cannot give one, which is the exact wrong
 * answer for the one caller who cared enough to ask. What three built is the
 * only honest report, and it does not exist until `init()` has resolved.
 *
 * **A strict WebGPU request is not made by construction, which is forced.**
 * `forceWebGL: true` is the only backend switch three's constructor exposes,
 * and the else branch of that same constructor overwrites `parameters.getFallback`
 * with its own, so there is no supported way to ask for WebGPU and no fallback.
 * `webgpu` is therefore constructed exactly like `auto` and refused afterwards
 * by {@link requireBackendHonoured}, which disposes the device it is refusing.
 *
 * **An unrecognised backend is a fact under `auto` and a refusal under a name.**
 * This package reads three's `isWebGPUBackend` and `isWebGLBackend` markers, and
 * a three release that renames either one leaves a renderer that draws perfectly
 * and cannot be named. Throwing there would trade a working renderer for a
 * naming problem, so `auto` reports `unknown` and hands the renderer back. A
 * caller who NAMED a backend asked for a guarantee this package can no longer
 * make, so that one is refused. Both halves are the same rule read from the two
 * ends.
 *
 * Nothing here is exported from `index.ts`. The seam a caller needs is
 * `createRenderer`'s option and `Renderer.backend`, and these four functions are
 * how the module that owns the device applies them; the test imports them
 * directly, which is the arrangement `webgpu-renderer.ts` already uses for its
 * own class.
 */

/**
 * Every value {@link RendererOptions.backend} accepts, in the order the error
 * message lists them.
 *
 * A list rather than a `switch`, so the validator, the message and the test all
 * read the same source and a fourth preference cannot be added to one of the
 * three.
 */
export const BACKEND_PREFERENCES: readonly BackendPreference[] = ['auto', 'webgpu', 'webgl2'];

/**
 * What a caller gets when they do not say: whichever backend is available.
 *
 * A named constant rather than a literal at the one call site, because it IS
 * the automatic-versus-explicit decision and a default that can only be read out
 * of a `??` is one nothing can assert.
 */
export const DEFAULT_BACKEND: BackendPreference = 'auto';

/**
 * Rejects a backend preference that is not one of the three, naming the field.
 *
 * The package rule from `errors.ts`: a bad value a caller wrote on a line they
 * can see is a `RangeError` naming the field. Vacuous to a TypeScript caller and
 * live for a JavaScript one, and the failure it prevents is quiet rather than
 * loud: `backend: 'webgl'` is the plausible typo, and without this it would fall
 * down {@link forceWebGLFor}'s else branch and mean `auto`, so a caller who
 * asked for WebGL2 would be handed WebGPU with nothing raised anywhere.
 */
export function requireBackendPreference(value: BackendPreference): BackendPreference {
  if (!BACKEND_PREFERENCES.includes(value)) {
    throw new RangeError(
      `backend has to be one of ${BACKEND_PREFERENCES.map((p) => `"${p}"`).join(', ')}, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * three's one construction-time backend switch, from this package's preference.
 *
 * True only for `webgl2`. `webgpu` and `auto` are constructed identically, and
 * the difference between them is what happens to the result: see this module's
 * docstring for why that asymmetry is three's rather than this package's.
 */
export function forceWebGLFor(preference: BackendPreference): boolean {
  return preference === 'webgl2';
}

/**
 * A three backend reduced to the two markers this package reads.
 *
 * Documentation of a shape rather than a parameter type, and the difference is
 * the finding: **three declares `isWebGLBackend` on `WebGLBackend` and
 * `isWebGPUBackend` on `WebGPUBackend`, and types `Renderer.backend` as the
 * abstract `Backend`, which declares neither.** So the two flags are not
 * reachable through the declared type of the property they live on, and reading
 * them is a widening however it is written. {@link backendOf} does that widening
 * once, in {@link readMarker}, rather than letting every reader invent their own.
 *
 * Both optional, because three sets exactly one of them and leaves the other
 * absent rather than false, and the day a release renames one is the day this
 * interface stops describing anything: see {@link backendOf} for what happens
 * then, which is `unknown` rather than a throw.
 */
export interface BackendMarkers {
  readonly isWebGPUBackend?: boolean;
  readonly isWebGLBackend?: boolean;
}

/**
 * Reads one marker off an object whose declared type does not have it.
 *
 * The one widening in this module, in two lines, with the reason on
 * {@link BackendMarkers}. Strict `=== true` rather than a truthiness test, so a
 * value read off a proxy or a stale mock cannot coerce its way into an answer,
 * and so a renamed flag reads as absent rather than as the other backend.
 */
function readMarker(source: object | null | undefined, name: keyof BackendMarkers): boolean {
  if (source === null || source === undefined) return false;
  return (source as Record<string, unknown>)[name] === true;
}

/**
 * Names the backend three actually built, or `unknown` when it cannot be named.
 *
 * "Exactly one of the two" is a claim rather than a preference between them: an
 * object asserting both is as unnameable as one asserting neither, and the
 * caller who cannot live with that names a backend and gets an error instead.
 */
export function backendOf(backend: object | null | undefined): RendererBackend {
  const gpu = readMarker(backend, 'isWebGPUBackend');
  const gl = readMarker(backend, 'isWebGLBackend');
  if (gpu && !gl) return 'webgpu';
  if (gl && !gpu) return 'webgl2';
  return 'unknown';
}

/**
 * Hands back the backend that came up, or refuses it when the caller named a
 * different one.
 *
 * Takes both strings rather than reading the markers itself, so the rule (what
 * was asked for against what arrived) is separable from the reading of three's
 * flags, and so the arm that `createRenderer` cannot reach today, a `webgl2`
 * request answered by a WebGPU backend, is still drivable by a test. That arm is
 * vacuous while `forceWebGL: true` means what it means, and it is here because
 * the rule is about the caller's request rather than about three's flag: a
 * release that came to ignore the flag would otherwise turn a refusal into a
 * silent upgrade, which is the same class of silence this whole module exists to
 * end.
 */
export function requireBackendHonoured(
  preference: BackendPreference,
  actual: RendererBackend,
): RendererBackend {
  if (preference !== 'auto' && actual !== preference) {
    throw new BackendUnavailableError(preference, actual);
  }
  return actual;
}
