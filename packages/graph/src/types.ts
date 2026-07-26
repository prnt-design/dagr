/** Identity of a node. Stable for the lifetime of the node in a graph. */
export type NodeId = string;

/** Identity of an edge. Stable for the lifetime of the edge in a graph. */
export type EdgeId = string;

/** A vertex of the graph. Identity is the whole record for now. */
export interface Node {
  readonly id: NodeId;
}

/** A directed connection from `source` to `target`, with its own identity. */
export interface Edge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
}
