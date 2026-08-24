import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, DagrRenderError } from '../src/errors.js';
import {
  BACKEND_PREFERENCES,
  DEFAULT_BACKEND,
  backendOf,
  forceWebGLFor,
  requireBackendHonoured,
  requireBackendPreference,
} from '../src/backend.js';
import type { BackendMarkers } from '../src/backend.js';
import type { BackendPreference, RendererBackend } from '../src/types.js';

/**
 * M4.9a's backend decision, tested without a device.
 *
 * The whole of this module is a choice made from two strings and two booleans,
 * which is deliberate: the part of a backend decision that needs a GPU is
 * whether an adapter exists, and three answers that inside `init()`. What this
 * package decides is what to CONSTRUCT before the question is asked and what to
 * TELL the caller after it is answered, and neither of those needs a device to
 * check. `bench/browser/backend-probe.mjs` is where the other half is measured.
 */

/** A three backend reduced to the two flags this package reads. */
function markers(gpu: boolean, gl: boolean): BackendMarkers {
  return { isWebGPUBackend: gpu, isWebGLBackend: gl };
}

describe('the preference vocabulary', () => {
  it('lists exactly the three preferences a caller may write', () => {
    expect([...BACKEND_PREFERENCES]).toEqual(['auto', 'webgpu', 'webgl2']);
  });

  it('defaults to auto', () => {
    // The default is the whole automatic-versus-explicit decision, so it is
    // pinned as a value rather than left implicit at the one call site.
    expect(DEFAULT_BACKEND).toBe('auto');
  });

  it('accepts each preference and hands it back', () => {
    for (const preference of BACKEND_PREFERENCES) {
      expect(requireBackendPreference(preference)).toBe(preference);
    }
  });

  it('rejects a preference that is not one of the three, naming the field', () => {
    // Vacuous to a TypeScript caller and not to a JavaScript one, which is why
    // the cast is here: `backend: 'webgl'` is the plausible typo, and without
    // this check it would silently mean `auto` by falling down the else branch
    // of `forceWebGLFor`, so a caller who asked for WebGL2 would get WebGPU.
    expect(() => requireBackendPreference('webgl' as BackendPreference)).toThrow(
      /^backend has to be one of "auto", "webgpu", "webgl2", got webgl$/,
    );
    expect(() => requireBackendPreference('WebGPU' as BackendPreference)).toThrow(RangeError);
    expect(() => requireBackendPreference(undefined as unknown as BackendPreference)).toThrow(
      RangeError,
    );
  });

  it('does not accept the reported-only backend name as a preference', () => {
    // `unknown` is something a renderer can BE and not something a caller can
    // ASK for, and the two unions differ by exactly that member.
    expect(() => requireBackendPreference('unknown' as unknown as BackendPreference)).toThrow(
      RangeError,
    );
  });
});

describe('what three is constructed with', () => {
  it('forces WebGL2 only when the caller named it', () => {
    expect(forceWebGLFor('webgl2')).toBe(true);
    expect(forceWebGLFor('auto')).toBe(false);
    expect(forceWebGLFor('webgpu')).toBe(false);
  });

  it('does not force WebGL2 for the strict WebGPU case, which is the whole trick', () => {
    // `forceWebGL: false` leaves three's own fallback installed, so a strict
    // WebGPU request is NOT refused by construction: it is constructed exactly
    // like `auto` and then refused afterwards by reading what came up. That is
    // forced on this package rather than chosen, because three's
    // `WebGPURenderer` constructor writes its own `getFallback` over anything
    // passed in, so there is no supported way to ask it not to fall back.
    expect(forceWebGLFor('webgpu')).toBe(forceWebGLFor('auto'));
  });
});

describe('reading which backend three built', () => {
  it('names the WebGPU backend', () => {
    expect(backendOf(markers(true, false))).toBe('webgpu');
  });

  it('names the WebGL2 backend', () => {
    expect(backendOf(markers(false, true))).toBe('webgl2');
  });

  it('reads a flag that is present rather than a flag that is true', () => {
    // three sets exactly one of these to `true` and leaves the other absent, so
    // the absent case is the normal one and not an edge.
    expect(backendOf({ isWebGPUBackend: true })).toBe('webgpu');
    expect(backendOf({ isWebGLBackend: true })).toBe('webgl2');
  });

  it('reports unknown when neither flag is set', () => {
    // The three release that renames these flags leaves a renderer that draws
    // perfectly and cannot be named. It is reported, not refused.
    expect(backendOf({})).toBe('unknown');
    expect(backendOf(markers(false, false))).toBe('unknown');
  });

  it('reports unknown when both flags are set', () => {
    // Not a third backend: an object that claims to be both is one this package
    // cannot name, which is the same answer for the same reason.
    expect(backendOf(markers(true, true))).toBe('unknown');
  });

  it('reports unknown for a renderer with no backend at all', () => {
    expect(backendOf(null)).toBe('unknown');
    expect(backendOf(undefined)).toBe('unknown');
  });

  it('ignores a truthy value that is not true', () => {
    // A marker read off a proxy or a stale mock can be truthy without being the
    // boolean three sets. Strict equality is what makes "the flag is there" a
    // fact rather than a coercion.
    expect(backendOf({ isWebGPUBackend: 1 as unknown as boolean })).toBe('unknown');
  });
});

describe('honouring a backend the caller named', () => {
  it('takes whatever came up under auto', () => {
    const backends: readonly RendererBackend[] = ['webgpu', 'webgl2', 'unknown'];
    for (const backend of backends) {
      expect(requireBackendHonoured('auto', backend)).toBe(backend);
    }
  });

  it('takes a named backend that was honoured', () => {
    expect(requireBackendHonoured('webgpu', 'webgpu')).toBe('webgpu');
    expect(requireBackendHonoured('webgl2', 'webgl2')).toBe('webgl2');
  });

  it('refuses the fallback the caller asked not to get', () => {
    // The reachable arm, and the one the probe exercised on this box: three
    // falls back inside `init()` and this is the only place a caller can be
    // told, because `createRenderer` resolving is otherwise the only signal and
    // it says nothing about which backend resolved it.
    expect(() => requireBackendHonoured('webgpu', 'webgl2')).toThrow(BackendUnavailableError);
    expect(() => requireBackendHonoured('webgpu', 'webgl2')).toThrow(
      'backend "webgpu" was requested and the renderer came up on "webgl2". Pass backend: "auto" to take whichever backend is available.',
    );
  });

  it('refuses a named backend it cannot confirm', () => {
    // A caller who names a backend is asking for a guarantee, and a backend
    // this package cannot recognise is one it cannot make that guarantee about.
    // The same fact is reported under `auto` and refused under a name, which is
    // the whole rule.
    expect(() => requireBackendHonoured('webgpu', 'unknown')).toThrow(BackendUnavailableError);
    expect(() => requireBackendHonoured('webgl2', 'unknown')).toThrow(BackendUnavailableError);
  });

  it('refuses the WebGL2 direction too, which nothing reaches through createRenderer today', () => {
    // Vacuous by construction: `forceWebGL: true` means three cannot hand back a
    // WebGPU backend, so this arm is unreachable from `createRenderer`. It is
    // here because the rule is about the caller's request and not about three's
    // flag, and a release that came to ignore `forceWebGL` would otherwise turn
    // a refusal into a silent upgrade. The test drives it directly rather than
    // through the factory, which is the only way it can fail.
    expect(() => requireBackendHonoured('webgl2', 'webgpu')).toThrow(BackendUnavailableError);
  });

  it('carries the package error code and base class', () => {
    try {
      requireBackendHonoured('webgpu', 'webgl2');
      expect.unreachable('a refused backend has to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DagrRenderError);
      expect(error).toBeInstanceOf(BackendUnavailableError);
      expect((error as BackendUnavailableError).code).toBe('BACKEND_UNAVAILABLE');
      expect((error as BackendUnavailableError).name).toBe('BackendUnavailableError');
      expect((error as BackendUnavailableError).requested).toBe('webgpu');
      expect((error as BackendUnavailableError).actual).toBe('webgl2');
    }
  });
});
