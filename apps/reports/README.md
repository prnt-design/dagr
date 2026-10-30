# Personal repository briefing, format v0

This private workspace owns R1's JSON contract and validator. R2 can import
`validateReport` and `entityId` from `src/index.ts`; R3 can consume the exported
`Report` type. It has no renderer or runtime dependencies. Generated daily
reports remain append-only outside main; these committed files are test
fixtures. R2 chooses storage and data collection. R3 supplies the host.

## Reading the briefing

Start with `overview.changed`, `overview.blocked`, `overview.attention`, and
`overview.unknowns`. These are required plain-text answers, including an
explicit statement when no blocker or decision is known. Nodes carry detail;
views select graph subsets; ordered tour steps provide a reading path.

`fixtures/day-1.json` and `day-2.json` are representative, partial briefings
based on merged PRs #181 (October 28) and #172 (October 29). They do not claim
to enumerate all repository activity. The second day preserves the PR and
package IDs from the first. Its M4.10 follow-up is a proposal, not an executed
experiment, and the performance outcome is explicitly unknown. Read its
three tour steps for what changed, what is blocked or unknown, and what needs
attention. Source URLs point to PR records or a pinned roadmap revision;
`asOf` records the observation day, not a guarantee that a remote page is immutable.

## Contract

`src/types.ts` is the type contract; `validateReport(unknown, previous?)` is
its runtime boundary. It returns `{ ok: true, report }` or
`{ ok: false, errors }`, with paths in errors. It rejects unknown fields and
versions. Validate parsed JSON before rendering; the validator neither fetches
URLs nor verifies the truth or completeness of claims. Dates are UTC calendar
days in `YYYY-MM-DD`. A report describes one `owner/repo` repository.

- `formatVersion` is the number `0`. `date`, `title`, and `overview` identify
  the report. `previousDate` is an earlier day or null when no baseline exists.
- `sources` have unique IDs, labels, absolute HTTPS URLs without credentials,
  and `asOf` dates no later than the report. Prefer PR permalinks and full
  commit-pinned file URLs. IDs are local to the report's source table.
- `nodes` have unique canonical entity IDs, labels, summaries, rich `content`,
  evidence `sourceIds`, confidence with a reason, previous status, activity,
  state, and an attention decision with a reason. Confidence is `confirmed`
  (direct evidence), `inferred` (interpretation), or `unknown` (insufficient
  evidence). Confirmed and inferred nodes require sources. Unknowns still
  require a reason. Confidence is not a probability or an execution status.
- Activity is `observed`, `proposed`, or `unknown`. State is `open`, `blocked`,
  `done`, or `unknown`. A proposal cannot be `done`. A blocked node's summary
  and content should explain the blocker and who can act. Attention is
  independent of completion and confidence. It never authorizes an action.
- Content blocks are paragraphs, lists, code, source links, or node links.
  Links reference declared IDs, not inline URLs. A source link must also be
  listed in its node's evidence. All strings are plain text. R3 must escape
  text, render code inertly, and never interpret HTML or Markdown.
- `edges` have unique IDs, source/target node IDs, and labels. Self-edges are
  rejected. `views` have unique IDs, labels, and explicit node/edge ID lists;
  both endpoints of each included edge must belong to the view.
- `tour` is an ordered, nonempty list of uniquely identified steps, each with
  a title, plain-text transcript (`text`), view ID, and nonempty node ID list.
  Every highlighted node must belong to that step's view. R3 can select the
  view, focus a node, and render the transcript using existing Explorer APIs.

Nodes, views, and the tour must be nonempty. Sources and edges may be empty.
IDs are unique within each table; references are typed by their field. View,
edge, source, and tour IDs are author-controlled and should remain stable
when their meaning persists. R3 resolves views to node and edge objects for
`ExplorerView`, using node `label` for accessible names. It can build a
zero-click text outline from overview, views, node content, sources and tour.
No explorer package change or UI implementation is included here.

## Durable identity and comparison

`entityId({ kind, key })` returns `kind:encodeURIComponent(key)`. PR keys are
canonical positive decimal numbers without leading zeros; package keys are
exact package names; milestone keys are persistent roadmap identifiers such
as `M4.10`. Empty or padded keys are rejected. Names are case-sensitive and
losslessly encoded, never slugged. Titles and dates do not enter identity.
IDs are repository-scoped, so host routes also need repository and report
 date. A package or milestone rename is a new entity in v0; R2 must not guess
aliases. Absent nodes mean omitted coverage, not deletion or completion.

With no available baseline, use `previousStatus: "unknown"`. With the named
previous report supplied, validation requires `new` for an absent ID,
`unchanged` for matching display/status snapshots, and `changed` otherwise.
The snapshot consists of label, summary, content (ordered), activity, state,
and attention. Source freshness, confidence, and evidence IDs outside content
do not change that status. It describes the briefing's display/status change,
not proof that repository files changed. Validation checks baseline date and
repository, and validates its structure and references without requiring the
entire archive. The baseline's own comparison claims are not reverified.

## Shared fixtures and checks

Run `pnpm --filter @dagr/reports test` and
`pnpm --filter @dagr/reports typecheck`. The root gate includes this workspace.

`fixtures/invalid-cases.json` names a base file, previous file, one RFC 6902
`replace` or `remove` operation, and an expected diagnostic substring per
case. R2/R3 can load the named JSON files, apply the operation, and assert
rejection. Cases cover malformed content, missing fields, duplicate IDs,
dangling references, view membership, identity drift, comparison errors,
proposal/completion confusion, unsafe URLs, and impossible dates. These are
negative examples, never generator output. Tests also cover malformed roots,
missing and mismatched baselines, changed nodes, and a third day's identity.
