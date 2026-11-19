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

## Manual generator (R2)

Build with `pnpm --filter @dagr/reports build`, then run
`node apps/reports/dist/cli.js /absolute/private/dagr-reports` from the checkout.
The explicit output directory must resolve outside the checkout. Keep it private:
PR titles can contain confidential information. Nothing is published or scheduled.

The generator reads HEAD and the latest 50 GitHub PR records using existing `gh`
authentication. It never writes credentials or settings. Each UTC date has one
append-only JSON file. A valid same-day file wins on retry, preserving its original
capture time even if remote records change. The next date compares with the most
recent saved earlier report; a gap is visible in previousDate. Coverage is partial,
not a claim about all activity or roadmap completion. Revision and capture time
appear in overview.unknowns; later remote changes are explicitly unknown.

Missing git/GitHub access, empty PR results, invalid data, and invalid existing
reports fail without a new dated file. There is no cached-source fallback. A stale
same-day report retains its recorded observation time. Temporary files are private;
an atomic hard link publishes a complete validated file without overwriting an
existing date. Interrupted temporary files are ignored and may be removed manually.
Concurrent losers fail safely and can retry. This protects against partial process
writes, not disk loss; back up the private output directory separately.

All archive inspection, baseline selection and dated-file publication run under
one directory-wide `.save-lock` created atomically. Competing writers fail and
must retry after the winner finishes, including when dates differ. Normal errors
release the lock. A killed process can leave the lock directory behind; never
remove it while any writer may still be running. Stop/verify all invocations for
this archive, inspect the dated files, then remove the empty `.save-lock` directory
and retry. Locks are never stolen based on age or PID. Temporary files are ignored.
Persisted dates must agree with filenames, both for retry and baseline selection.

## P4 slice 1: simulated follow-up boundary

`src/follow-up.ts` is a manual local fixture adapter, not live workboard
integration. It never executes work. Build with `pnpm --filter @dagr/reports build`,
then run `node apps/reports/dist/follow-up-cli.js /absolute/private/follow-ups /absolute/action.json`.
The action file follows the exported `Action` union. A draft includes the validated
source report (and its previous report when needed), nodeId, stable caller key,
title, scope and criteria. Provenance comes from that report's source table.
Use decision actions to defer, reject or explicitly accept the simulated scope;
submit requires accepted state. Acceptance is a local simulation, not an
authenticated person's approval. Accepted payloads are frozen. Reusing the same
repository/date/node/key with different content fails.

Submit returns a stable `fixture-` task ID and a queued receipt, never completion.
`fixture-status` simulates later work states; `observe` explicitly reads them back.
`followUpContent` supplies existing R1 paragraph content for a later report;
missing or different-day observations display unknown. Completed, failed, blocked,
canceled and unknown remain distinct. Submission errors are separate from work
state. `loseResponse: true` simulates creation followed by a lost response; restart
and submit the same proposal to recover the one durable task. All data and output
are labeled simulated. Nothing is sent to Dispatch.

The ledger must be outside the checkout, including resolved directory symlinks.
One `.follow-up-lock` excludes every writer and reader operation. Contention fails
explicitly. After interruption, stop and verify all ledger processes before manually
removing that empty lock directory. Never recover by age or PID alone. JSON is
atomically replaced with private temporary files; this is not a disk-loss backup.
Do not manually edit the private ledger. Back it up separately.

Live acceptance into the workboard remains future work. An external bridge could
use existing Dispatch task tools, but task creation has no idempotency argument.
It needs a reviewed durable proposal-to-task reconciliation scheme before retrying
uncertain submissions. This fixture does not establish that live guarantee. Live
integration, authenticated approval, execution and scheduling are outside this slice.

## P4 slice 2: external protocol boundary, fake transport only

`src/dispatch-protocol.ts` defines an injected task-tool transport and the narrow
prepared/attempting/mapped submission protocol. There is no live transport, CLI,
authentication host or production journal implementation. `prepareDispatch` takes
an accepted proposal from the existing validated follow-up path and an injected
approval capability. A local simulated decision alone is insufficient: the future
trusted host must verify original user authorship and bind exact payload, project,
column and provenance to that evidence. JSON cannot authenticate its own author.

The host must serialize all calls for one namespace, persist the initial journal,
and durably checkpoint attempting before create. This module neither locks nor
writes storage. Tests serialize checkpoints and inject transport failures; they do
not prove production storage durability, process locking or authenticity. Missing
and malformed journals are rejected. A syntactically valid journal rollback is
undetectable without external monotonic authority and is explicitly unsupported,
as are lost storage, multiple independent writers and marker tampering.

An uncertain create is never automatically repeated, including zero-match scans.
A complete active-plus-archived scan can recover one exact body/creator/project
match. Duplicate or conflicting matches fail closed. The body carries scope,
criteria, sources and the approval binding in the original create operation.
There is no exactly-once or eventual-creation guarantee. The transport adapter must
hydrate task bodies and honestly report incomplete scans, and must disable create
retries. This contract uses the existing task tools, without implementing them.

Inert-column preflight rejects automation, but cannot prevent a configuration race.
Live creation remains blocked until the owner maintains the column without triggers
or the server provides conditional inert creation. No Dispatch configuration changes
are included. Receipt verification is separate from completion. Projection reports
board progress/review/completion, archive and launch failure independently; this
board has no native failed/canceled/blocked outcomes. Stale or failed observations
are unknown. Later integration must retain raw observations and mapping provenance.
Overall P4 and a verified live cycle remain open.
