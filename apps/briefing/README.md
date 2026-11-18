# Private local briefing reader

This bounded R3 host consumes the shipped `@prnt/dagr-explorer` 0.2.0 package.
It adds no library features. Generate reports with R2 first (see
`../reports/README.md`), then set `DAGR_REPORTS_DIR` to that absolute private
archive directory and run `pnpm --filter @dagr/briefing dev` from the root.
Open the localhost address Vite prints. The directory must be outside this
checkout. Never put private reports in public assets or commit generated reports.

The development server is the local host, including its read-only feed. A built
static bundle alone has no feed. There is no scheduler or hosted deployment.
The feed reads only dated JSON filenames, rejects escaping symlinks, disables
caching, validates through R1 including the named baseline, and exposes validation
failures separately from missing days. Latest means the latest archive filename,
so a corrupt latest report never silently falls back to an older day.

The overview, tour transcripts, full node content, status and source list are
visible without opening the graph. Tour controls call ExplorerApi to select a
view and inspect its highlighted item. The Explorer starts in outline mode and
supports its shipped map and keyboard controls. Inspect links preserve repository,
date and canonical node ID. A linked item is named on reload and can be opened
with its button. Previous/next navigate available archive days, including invalid
entries. Reports older than today's UTC day are explicitly stale. Source dates
remain visible. Coverage is partial (at most 50 PR records), and missing nodes
never imply deletion or completion.

All report text is rendered through React text nodes, including inert code.
Only validated HTTPS source URLs become external links. No report HTML or
Markdown is interpreted. The server does not take filesystem paths from requests.

Checks: `pnpm --filter @dagr/briefing typecheck`, `test`, and `build`.
