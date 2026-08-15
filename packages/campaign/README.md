# @dagr/campaign

A deterministic mock D&D campaign dataset for Dagr demos: schema types and a
seeded generator. Private, unpublished, zero dependencies.

```ts
import { generateCampaign, cardRows, EDGE_ROLES } from '@dagr/campaign';

const campaign = generateCampaign();            // same seed, same campaign
const campaign2 = generateCampaign({ seed: 7, scale: 2 });
```

The default seed generates 3,010 nodes and 7,100 edges: a campaign spine
(arcs, chapters, scenes, encounters), a geography tree down to keyed rooms,
NPCs and factions, branch-and-merge quest DAGs, a clue web, faction fronts
with countdown clocks, and weather and condition modifiers. `scale` moves
rooms per dungeon and NPCs per settlement together, spanning roughly 2,600 to
3,800 nodes across 0.5 to 2.

Why a generator and not a JSON file: the dataset would be megabytes, the
generator is kilobytes, and the same seed reproduces the same campaign byte
for byte, which keeps screenshots and benchmarks reproducible.

What a consumer needs to know:

- `EDGE_ROLES` splits the 23 edge kinds into `routed` (hierarchy, narrative
  flow, traversal, dependency: feed these to layout) and `overlay`
  (investigation, social, reference, pressure, state: draw these as
  zoom-gated lines, never route them).
- `cardRows(node)` turns a node's typed data into the key/value rows a card
  tier renders, one formatter for all 16 kinds.
- `depth` is the semantic-zoom hint: 0 is the campaign, each `contains` step
  adds one, and nodes outside the contains forest carry the depth of their
  stratum.

The structural claims (Three Clue Rule, jaquays loop quota, hub-and-spoke
degree, branch-merge rate, Zipf bestiary reuse) are enforced by
`test/invariants.test.ts` across multiple seeds. The design record is
`plans/2026-08-14-campaign-demo.md`, and the schema is written up for readers
at https://dagr.prnt.design/docs/campaign (`docs/docs/campaign.md`).
