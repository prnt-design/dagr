/** Typed directed graph model: stable node identity, zero dependencies. */
export { Graph } from './graph.js';
// `traversal.ts` is deliberately not exported. Its functions take an
// `AdjacencyView` rather than a `Graph`, which is an internal seam that exists
// so `ancestors` can be `descendants` pointed the other way, and exporting it
// would pin the package to that shape before anything outside has asked for it.
// The traversal surface is the methods on `Graph`. This is the same call M2.2
// made in `@dagr/layout`, where only `defaultStages` is public.
export {
  ContainmentCycleError,
  CycleError,
  DagrGraphError,
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  EdgeNotFoundError,
  InvalidGraphJSONError,
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
  UpdateNodeParentOp,
} from './patch.js';
// The document types are public, because a caller annotating a file reader or
// a fixture needs them. The validator behind `Graph.fromJSON` is not, for the
// same reason `traversal.ts` is not: it is a seam, and `fromJSON` is the door.
export type { EdgeJSON, GraphJSON, NodeJSON, PortJSON } from './serialize.js';
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
