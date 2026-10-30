/** Print strong root paths to the diagnostic WeakRefs' surviving targets. */
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { nodes, edges, strings } = snapshot;
const meta = snapshot.snapshot.meta;
const width = meta.node_fields.length;
const edgeWidth = meta.edge_fields.length;
const field = Object.fromEntries(meta.node_fields.map((name, i) => [name, i]));
const edgeField = Object.fromEntries(meta.edge_fields.map((name, i) => [name, i]));
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const count = nodes.length / width;
const starts = new Uint32Array(count + 1);
for (let i = 0; i < count; i++) starts[i + 1] = starts[i] + nodes[i * width + field.edge_count] * edgeWidth;
const edgeType = (at) => edgeTypes[edges[at + edgeField.type]];
const edgeName = (at) => ['element', 'hidden'].includes(edgeType(at))
  ? String(edges[at + edgeField.name_or_index]) : strings[edges[at + edgeField.name_or_index]];
const destination = (at) => edges[at + edgeField.to_node] / width;
const name = (i) => strings[nodes[i * width + field.name]];
function string(i) {
  if (name(i) !== '(concatenated string)') return name(i);
  const parts = {};
  for (let at = starts[i]; at < starts[i + 1]; at += edgeWidth) {
    if (['first', 'second'].includes(edgeName(at))) parts[edgeName(at)] = string(destination(at));
  }
  return (parts.first ?? '') + (parts.second ?? '');
}

// Walk from the root. Weak edges and DevTools shortcuts are not strong retainers.
const parent = new Int32Array(count).fill(-1);
const via = new Int32Array(count).fill(-1);
const queue = new Uint32Array(count);
let tail = 1;
parent[0] = 0;
for (let head = 0; head < tail; head++) {
  const i = queue[head];
  for (let at = starts[i]; at < starts[i + 1]; at += edgeWidth) {
    if (['weak', 'shortcut'].includes(edgeType(at))) continue;
    const to = destination(at);
    if (parent[to] !== -1) continue;
    parent[to] = i;
    via[to] = at;
    queue[tail++] = to;
  }
}
const describe = (i) => `${nodeTypes[nodes[i * width + field.type]]}:${name(i)}#${nodes[i * width + field.id]}`;
let sampled = 0;
const survivors = [];
for (let i = 0; i < count; i++) {
  if (name(i) !== 'WeakRef' && !['Object', 'Array'].includes(name(i))) continue;
  let label;
  let target;
  for (let at = starts[i]; at < starts[i + 1]; at += edgeWidth) {
    if (edgeType(at) === 'property' && edgeName(at) === 'label') label = string(destination(at));
    if (name(i) === 'WeakRef' && edgeType(at) === 'weak') target = destination(at);
    if (edgeType(at) === 'property' && edgeName(at) === '__dagrLifetime') {
      label = string(destination(at));
      target = i;
    }
  }
  if (!/^\d+:e\d+-\d+:(points|point|velocities)$/.test(label ?? '')) continue;
  sampled++;
  if (target === undefined) continue;
  const path = [];
  for (let at = target; at !== 0 && parent[at] !== -1; at = parent[at]) {
    path.push(`${describe(parent[at])} --${edgeType(via[at])}:${edgeName(via[at])}--> ${describe(at)}`);
  }
  survivors.push({ label, target: describe(target), stronglyReachable: parent[target] !== -1, path: path.reverse() });
}
console.log(JSON.stringify({ sampled, survivors }, null, 2));
