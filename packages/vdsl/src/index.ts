/**
 * Toolkit for building a node-graph language on Dagr.
 *
 * A toolkit, not a language: this package holds the interface a consumer
 * implements to describe their own node kinds, and never an ontology of its
 * own. See `docs/docs/visual-languages.md` for why that distinction is the
 * whole design.
 */
export {
  DagrVdslError,
  InvalidSpecError,
  NodeKindMissingError,
  UnknownNodeKindError,
  isDagrVdslError,
} from './errors.js';
export type { DagrVdslErrorCode, DagrVdslErrorLike } from './errors.js';
export { DEFAULT_KIND_KEY, defineRegistry, sameType } from './registry.js';
export type {
  ConfigCheck,
  ConnectionAllowed,
  ConnectionCheck,
  ConnectionCheckResult,
  ConnectionEnd,
  ConnectionEnds,
  ConnectionRefusalCode,
  ConnectionRefused,
  KindNodeInit,
  NodeRegistry,
  NodeSpec,
  NodeSpecInit,
  PortRef,
  PortSpec,
  ProposedConnection,
  RegistryOptions,
} from './types.js';
