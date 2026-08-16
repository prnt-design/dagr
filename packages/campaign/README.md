# @dagr/campaign

A deterministic mock D&D campaign dataset for Dagr demos: schema types and a
seeded generator. Private, unpublished, and zero dependencies, including on
`@dagr/graph`, because it is a fixture rather than a product and a fixture that
depended on the graph model would be unusable to anything that is not Dagr.

The demo it feeds is at https://dagr.prnt.design/demos/campaign. A campaign is
a genuinely graph-shaped domain: a real hierarchy, thousands of nodes, dense
cross-links that are not the hierarchy, and content worth reading when you get
close. That is the workload Dagr exists for, panning and zooming through a
large structure, which is why the fixture is a campaign and not a random graph.
The decision record is `plans/2026-08-14-campaign-demo.md`; this file describes
what shipped.

## Usage

```ts
import { generateCampaign, cardRows, EDGE_ROLES } from '@dagr/campaign';

const campaign = generateCampaign(); // seed 20260814, scale 1
const bigger = generateCampaign({ seed: 7, scale: 2 });

campaign.seed; // 20260814, the seed it ran with
campaign.rootId; // the id of the single campaign node
campaign.nodes.length; // 3010
campaign.edges.length; // 7100
```

`rootId` is exposed rather than left to be guessed, because the id scheme is
the generator's private business and a consumer that hardcodes `'campaign-1'`
is one prefix rename away from a crash at load.

Loading a whole campaign into one graph is one loop per array, and what rides
on the attribute bag is the consumer's decision. Put the node record on the
node, as `@dagr/campaign-stage` does, and a size function or an overlay tier
reads a kind without re-joining against the arrays:

```ts
import { Graph } from '@dagr/graph';
import type { CampaignNode } from '@dagr/campaign';

const graph = new Graph<{ node: CampaignNode }>();
for (const node of campaign.nodes) graph.addNode({ id: node.id, attrs: { node } });
for (const edge of campaign.edges) {
  graph.addEdge({ id: edge.id, source: edge.source, target: edge.target });
}
```

A consumer that does want the record on both ends passes a second type
parameter, `new Graph<{ node: CampaignNode }, { edge: CampaignEdge }>()`, and
adds `attrs: { edge }` in the second loop. `@dagr/campaign-stage` passes only
the first, because it tessellates its ribbons from `campaign.edges` directly
and never asks the graph what kind an edge is.

**The loop above is not what a consumer feeding LAYOUT writes**, and the
difference is the routed and overlay split below. `@dagr/campaign-stage` cuts
the campaign into about a hundred tiles and builds one graph per tile, adding
an edge only when `EDGE_ROLES` calls it routed and both of its endpoints are in
that tile. So layout sees a little over half the edges, in pieces, and the rest
are drawn above the result.

## Exports

Three values and eleven types, which is the whole surface:

```ts
function generateCampaign(options?: GenerateOptions): Campaign;
function cardRows(node: CampaignNode): readonly (readonly [string, string])[];
const EDGE_ROLES: Record<EdgeKind, EdgeRole>;

interface GenerateOptions {
  readonly seed?: number; // default 20260814
  readonly scale?: number; // default 1
}

interface Campaign {
  readonly seed: number;
  readonly rootId: string;
  readonly nodes: readonly CampaignNode[];
  readonly edges: readonly CampaignEdge[];
}
```

| Type | What it is |
| --- | --- |
| `NodeKind` | The 16 kinds a node can be, as a union of string literals |
| `NodeData` | The kind-specific half of a node, a discriminated union on `kind` |
| `CampaignNode` | One node: the common fields, plus its `data` |
| `EdgeKind` | The 23 kinds an edge can be |
| `EdgeRole` | `'routed'` or `'overlay'`, the values of `EDGE_ROLES` |
| `CampaignEdge` | One edge, a union over the two kinds that carry a payload and the rest |
| `SkillCheck` | `{ skill, dc }`, on a scene or a quest step and on every `branch_on` edge |
| `CheckOutcome` | `'success'`, `'failure'`, or `'partial'`, what a `branch_on` edge resolved as |
| `PathKind` | `'road'`, `'trail'`, `'door'`, `'secret'`, or `'one_way'`, how a `leads_to` edge is traversed |
| `Campaign`, `GenerateOptions` | The two shapes above |

Three outcomes rather than two, because partial success is a branch a DM
actually runs, and a `one_way` path exists so that a room graph can state the
thing a bidirectional edge cannot: the drop you cannot climb back up.

## What a node is

```ts
interface CampaignNode {
  readonly id: string;
  readonly name: string;
  readonly oneLine: string;
  readonly depth: number;
  readonly tags: readonly string[];
  readonly data: NodeData;
}
```

The first five fields are what all sixteen kinds have in common, which is what
a label tier and the head of a card can render without knowing the kind at all.
`data` is a `NodeData`, a discriminated union on a `NodeKind`, so a scene cannot
carry an item's rarity, and an optional field there is a genuinely optional fact
(not every NPC has a secret) rather than a stand-in for "unknown".

| Kind | What `data` carries | At the default seed |
| --- | --- | --- |
| `campaign` | level range, premise | 1 |
| `arc` | level band, summary | 4 |
| `chapter` | expected order, summary | 16 |
| `scene` | scene type, trigger, optional skill check | 123 |
| `encounter` | difficulty, XP budget | 238 |
| `location` | subtype, and optionally a key code, terrain, and hub or dungeon flags | 1,191 |
| `npc` | role, attitude, optional secret | 375 |
| `faction` | goal, stance | 12 |
| `quest` | objective, state | 60 |
| `quest_step` | objective, optional check, revelation flag | 324 |
| `clue` | the fact it states | 120 |
| `item` | rarity, plot-critical flag | 300 |
| `front` | doom, clock size | 12 |
| `clock_tick` | index, portent | 59 |
| `statblock` | challenge rating | 130 |
| `condition_modifier` | scope (weather, time, terrain, magical), effect | 45 |

`location` is the largest kind because it is four strata under one type: 6
regions, 24 settlements, 138 buildings, and 1,023 rooms at the default seed.
The `subtype` field is what separates them, and the two flags mark the
structural roles: `hub` is the safe settlement a region's sites radiate from,
`dungeon` is a keyed multi-room site with a looping room graph.

`depth` is the semantic-zoom hint. It is 0 at the campaign node and each
`contains` step adds one, so a viewer can gate whole strata on it: arcs and
regions at far zoom, rooms and clues up close. Nodes outside the `contains`
forest carry the depth of the stratum they belong with rather than 0, so the
gate stays meaningful for them. At the default seed the strata hold 1, 10, 64,
380, 2,435, and 120 nodes across depths 0 to 5.

`tags` are free-form, and the ones prefixed `pattern:` name the structure a
node is part of: `pattern:hub-spoke`, `pattern:pointcrawl`,
`pattern:branch-merge`, `pattern:clue-web`, `pattern:front-clock`. A keyed site
also carries `jaquaysed`, and the 88-room finale carries `finale`. They exist so
a demo can highlight one pattern without re-deriving it from the edges.

## What an edge is, and which half layout sees

There are 23 edge kinds. `EDGE_ROLES` maps every one of them to `routed` or
`overlay`, which is what a consumer reads to decide whether an edge goes
through the layout pipeline or is drawn as a straight line above it.

| Group | Kinds | Role | Edges at the default seed |
| --- | --- | --- | --- |
| Hierarchy | `contains` | routed | 1,955 |
| Narrative flow | `next`, `branch_on`, `merges_into` | routed | 674 |
| Traversal | `leads_to`, `entry_point` | routed | 1,237 |
| Dependency | `requires`, `unlocks`, `rewards` | routed | 97 |
| Investigation | `contains_clue`, `points_to` | overlay | 240 |
| Social | `member_of`, `leads`, `ally_of`, `hostile_to`, `knows` | overlay | 1,446 |
| Reference | `uses_statblock`, `located_at`, `gives_quest` | overlay | 1,344 |
| Pressure | `advances_clock`, `triggers`, `interrupted_by` | overlay | 64 |
| State | `modified_by` | overlay | 43 |

That is 3,963 routed edges and 3,137 overlay ones, so layout draws a little over
half the graph and the rest is drawn above it.

The split is a rendering decision before it is a layout one. The overlay groups
are dense and cyclic by nature: 1,072 of the edges here are one NPC knowing
another, and 536 point at a statblock, 486 of them from encounters and the rest
from hostile NPCs. Feeding that to crossing reduction buys nothing a viewer can
read, because the result is still more edges than anyone can follow through a
drawing, and it costs the pass real time on every relayout. Ranking is the
other half of the argument: `knows` is symmetric in spirit, and a symmetric
relation fed to a layered ranker either forces a cycle break that means nothing
or forces an arbitrary rank separation and a dummy chain to route it. The
default ranker is longest path, so the cost of an edge nobody wanted is depth in
the drawing and one dummy node per rank it spans.

The dataset draws nothing itself. `EDGE_ROLES` is the decision recorded where
the data is, ahead of the consumer that acts on it: this package hands over a
role per edge, and routing one group while overlaying the other is the drawing
code's job.

`EDGE_ROLES` is a `Record<EdgeKind, EdgeRole>` rather than a lookup with a
default, so a kind added to the union without a role is a type error rather
than an edge nobody routes and nobody notices. The invariant suite checks the
other direction too: every kind that actually occurs resolves to a role.

Two kinds carry a payload. `branch_on` carries a `CheckOutcome` and the
`SkillCheck` it resolved, and `leads_to` carries a `PathKind`. Every other kind
is fully described by its endpoints, so the union gives those kinds no extra
fields rather than an always-empty `data` bag.

## Where the schema came from

The kinds are a synthesis of how published hardcovers and the existing campaign
tools (Kanka, World Anvil, Foundry VTT, the 5e SRD API) structure the domain.
No single one of those is the authority: the hardcovers say what a campaign
contains, and the tools say which of those things need identity and
cross-references rather than being prose in a document.

The proportions are calibrated against three published modules:

| Module | Structure | Scale |
| --- | --- | --- |
| Curse of Strahd | 15 location-chapters, each a sandbox | Castle Ravenloft alone has 88 keyed areas; 80 to 100 named NPCs |
| Waterdeep: Dragon Heist | 4 plot chapters, 4 villain lairs, 8 factions | about 51 stat blocks in the appendix |
| Lost Mine of Phandelver | 4 parts, hub town with radiating sites | about 12 named NPCs in Phandalin, 5 site maps of 8 to 20 areas |

The rule of thumb that falls out: one 256-page hardcover is 10 to 15 chapters,
150 to 250 keyed locations, 50 to 100 named NPCs, 100 to 200 encounters, and 5
to 10 factions. So 2,000 to 5,000 nodes is a two-to-four-hardcover
mega-campaign, which is large enough to be worth a graph engine and still
honest about what campaigns contain. The finale dungeon is 88 rooms because
Castle Ravenloft is.

This is not anyone's final schema, and the package says so in its own types.
The generator is the only producer today, and a real external schema can
retarget it. What the synthesis is for is that a demo dataset with no defensible
shape teaches a viewer nothing, and the schema is the part of this work that
might outlive the demo.

Every name, table, and monster in the package is original, so the dataset ships
with no licensing question attached to it.

## The generator

The dataset is generated, not committed. At the default seed the campaign
serializes to about 1.1 MB of JSON; the package that produces it is about 60 KB
of source, tables included, runs in roughly 8 ms on the dev box, and
reproduces the same campaign byte for byte from the same seed. Screenshots and
future benchmarks depend on that last property, which a committed blob would
also give, but the blob would cost a megabyte in the bundle and could not be
rescaled.

Determinism is narrow enough to state exactly. Everything flows from one
`Rng`, a mulberry32 whose entire state is a single uint32, so nothing in the
generator reads `Date`, `Math.random`, or the iteration order of anything
unordered. The test asserts it as deep equality over the whole structure rather
than as spot checks, because a spot check on a 3,010-node structure is a claim
about the parts you remembered to look at.

Two options, both defaulted:

| Option | Default | Effect |
| --- | --- | --- |
| `seed` | `20260814` | Same seed, same campaign. Must be an integer. |
| `scale` | `1` | Moves rooms per dungeon and NPCs per settlement together. Must be positive and finite. |

`scale` deliberately moves two knobs and not the whole dataset: the spine,
quests, and bestiary stay put, so the ratios do not distort as the total moves.
Measured, it spans 2,581 nodes and 5,912 edges at 0.5, 3,010 and 7,100 at 1,
and 3,752 and 9,118 at 2. Rooms floor at 8 per keyed site whatever the scale,
because below that a dungeon cannot carry its loop quota or its entry point: a
tiny scale shrinks the count of things, never the integrity of a thing.

Each layer of the campaign is one function that builds one stratum and returns
the ids the next layer references: spine, geography, people, items and
statblocks, quests and clues, then pressure. The structural patterns are built
deliberately rather than left to emerge, because emergence at this scale means
a graph that looks like noise:

- **Hub and spoke.** Each of the 6 regions gets a hub settlement its sites
  radiate from, which is the sandbox shape Phandalin and Barovia's villages
  have.
- **The jaquaysed dungeon.** A keyed site's rooms are wired as a spanning tree
  first, then extra corridors are dug between distinct unconnected pairs. Loops
  come from the surplus, and doubling a door that already exists is refused,
  because a doubled door is not a loop.
- **Branch and merge.** Quest steps with a check fan out into all three
  outcomes, and most failure branches lead to a complication step that merges
  back into the quest rather than into a dead end.
- **The clue web.** Revelations are built with the Three Clue Rule as a
  construction rule, not as a hope: three clues, from three distinct holders,
  of at least two kinds.
- **Fronts and clocks.** Each faction front owns a countdown clock of 4 to 6
  ticks, and a quest that can interrupt it.
- **Zipf reuse of the bestiary.** Encounters draw statblocks from a
  Zipf-distributed index, so the head of the bestiary is the goblin every site
  reuses and the tail is the vampire lord who appears once.

## What the tests enforce

The structural claims above are asserted on the output, across three seeds,
rather than trusted to the code that says it made them. `test/invariants.test.ts`
runs in two registers on purpose: fixed counts the generator writes as literals
(6 regions, 12 factions, 60 quests) are asserted exactly, and stochastic
quantities are asserted as bands wide enough to hold across seeds, so a claim
like the loop quota is a property of the generator rather than a memorized fact
about one campaign.

| Claim | What the suite asserts |
| --- | --- |
| Referential integrity | Unique node and edge ids, both endpoints of every edge present, every occurring edge kind mapped to a role |
| Scale | 2,000 to 5,000 nodes, and 2 to 4 edges per node |
| The contains forest | At most one parent per node, no cycles, and `depth` steps by exactly one along every `contains` edge |
| The Three Clue Rule | Every revelation has at least 3 clues, from at least 3 distinct holders, of at least 2 kinds |
| Branch and merge | Some check step shows all three outcomes (the maximum arity seen is 3), and 55% to 85% of failure complications have a merge edge |
| The jaquays quota | Every dungeon's loop surplus is at least a quarter of its rooms, the finale is 88 rooms, and no pair of rooms has two corridors |
| Door mix | Secret doors are 5% to 16% of doors, one-way doors 2% to 9% |
| Hub and spoke | Average settlement degree in the pointcrawl sits between 2.5 and 4 |
| Fronts | Every front has exactly `clockSize` ticks and an `interrupted_by` edge out of it |
| Condition modifiers | 30% to 50% of scenes run under one, and every region carries a standing modifier |
| Zipf reuse | The most-used statblock carries at least 5 times the median's encounters, and no encounter is unarmed |
| Determinism | Deep equality over the whole structure for a repeated seed, and inequality across seeds |

The edge count is worth one note of honesty. The research behind the plan
estimated 8,000 to 11,000 edges; the social layer that was built is thinner than
that estimate, and the suite gates the ratio of edges to nodes rather than the
estimate, because the ratio is the property that decides whether a graph is a
bare tree or a hairball, and the estimate was a projection rather than a
promise.

## Cards

`cardRows(node)` turns a node's typed data into the key and value rows a card
renders, and it is the one place that decides how each kind reads:

```ts
cardRows(scene); // "The last vestibule", a scene
// [['type', 'social'],
//  ['trigger', 'When the party arrives, the roads empty at dusk.'],
//  ['check', 'DC 17 Survival']]
```

Rows, not markup, because whoever renders the rows owns the markup. This is the
display half of the schema: `NodeData` keeps the fields typed and `cardRows`
keeps sixteen kinds from becoming sixteen ad hoc formatters in every consumer.
Its consumer is the card tier `@dagr/campaign-stage` draws over the canvas,
which is why the rows are the shape they are.

## What it is not

**Not a simulation.** Clocks do not tick, quests do not change state, and
nothing moves. The dataset is a static snapshot of a campaign, which is what a
schema demo needs. Animation wants a dataset that changes, and this one can grow
that later precisely because it is generated rather than committed.

**Not a map.** Rooms and regions are nodes in a layered drawing like everything
else. A pointcrawl drawn as an actual map is appealing and is a different
renderer feature.

**Not published, and not stable.** The package is private and its only consumer
is `@dagr/campaign-stage`, the component the demo page and the docs site both
mount, so kinds and field names change when that stage learns something. If you
want the shape rather than the package, the types file is 250 lines and copying
it is a supported outcome.
