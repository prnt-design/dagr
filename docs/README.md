# docs

The Docusaurus site behind [dagr.prnt.design](https://dagr.prnt.design):
the landing page in `src/pages/`, the docs in `docs/`, the muslin theme
port in `src/css/custom.css`. Render deploys `main` when CI is green; see
`render.yaml` at the repo root.

## Regenerating the landing page's figures

Both figures on the landing page are committed engine output, not build
products, because the Render deploy builds only this workspace and must not
depend on the packages building first. After a `pnpm build` at the repo
root:

```bash
pnpm --filter docs generate:hero   # src/components/heroGraphData.json
pnpm --filter docs generate:perf   # static/img/bench-1k-*.svg, src/components/perfStats.json
```

`generate:perf` also rewrites the measured layout time the page quotes, so
run it on a quiet machine and check the number beside its recorded machine
in `src/components/perfStats.json` before committing. Regenerate whenever
the layout engine changes enough that the drawings stop representing it.
