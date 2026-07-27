/** Typed directed graph model: stable node identity, zero dependencies. */
export { Graph } from './graph.js';
// `traversal.ts` is deliberately not exported. Its functions take an
// `AdjacencyView` rather than a `Graph`, which is an internal seam that exists
// so `ancestors` can be `descendants` pointed the other way, and exporting it
// would pin the package to that shape before anything outside has asked for it.
// The traversal surface is the methods on `Graph`. This is the same call M2.2
// made in `@dagr/layout`, where only `defaultStages` is public.
export {
  CycleError,
  DagrGraphError,
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  EdgeNotFoundError,
  InvalidDocumentError,
  InvalidIdError,
  NodeNotFoundError,
  PortDirectionError,
  PortInUseError,
  PortNotFoundError,
  isDagrGraphError,
} from './errors.js';
export type { DagrGraphErrorCode, DagrGraphErrorLike } from './errors.js';
export { PatchListenerError, apply, invert } from './patch.js';
export type {
  AddEdgeOp,
  AddNodeOp,
  AddPortOp,
  Patch,
  PatchListener,
  PatchOp,
  RemoveEdgeOp,
  RemoveNodeOp,
  RemovePortOp,
  UpdateEdgeAttrsOp,
  UpdateEdgePortsOp,
  UpdateGraphAttrsOp,
  UpdateNodeAttrsOp,
} from './patch.js';
// Only the document types are public. `toJSON` is a method on `Graph` and
// `fromJSON` is a static on it, so the functions behind them in `serialize.ts`
// are an internal seam in the same way `traversal.ts` is: exporting them would
// pin a second entry point to the format before anything outside has asked for
// one. A caller who needs a name for a document has one.
export type {
  EdgeDocument,
  GraphDocument,
  NodeDocument,
  PortDocument,
} from './serialize.js';
export type {
  Attrs,
  AttrsPatch,
  Edge,
  EdgeId,
  EdgeInit,
  EdgePortsPatch,
  Node,
  NodeId,
  NodeInit,
  Port,
  PortDirection,
  PortId,
  PortInit,
  ReadAttrs,
} from './types.js';
