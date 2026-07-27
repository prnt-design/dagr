/**
 * What a bench file imports.
 *
 * One entry point rather than deep paths, so a consuming package needs one
 * `paths` entry and one vitest alias, matching how `@dagr/layout` already
 * resolves `@dagr/graph` from source. The collector, the gate and the CLI are
 * not here: those are plain `.mjs` run by bare `node` in CI and nothing under
 * vitest imports them.
 */
export { controlWorkload } from './control.js';
export { largeCorpus, layeredDag, mulberry32, smallCorpus } from './corpus.js';
export type { GraphSpec, LayeredOptions } from './corpus.js';
export { registerControl } from './register.js';
