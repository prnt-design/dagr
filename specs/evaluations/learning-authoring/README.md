# Learning authoring evaluation

Read protocol.md before interpreting results. This is a contaminated,
same-context feasibility exercise, not evidence that the skill improves
learning outcomes. Both conditions intentionally preserve the same authored
content. The initial observations record content weaknesses before UI testing.

## Reproduce the external consumer

Copy this directory outside the workspace. Copy consumer-package.json to
package.json, consumer-tsconfig.json to tsconfig.json and host.tsx to main.tsx.
Use npm install, npx tsc and npx vite build. Run node check.mjs for headless
Chromium checks (install Playwright Chromium if needed). Wrap installs,
compilation and the entire browser/server lifetime in the shared compute
window described by ~/compute.md on the evaluation host. Browser output is
written to evidence/. All imports resolve to published Explorer 0.2.0, not
workspace aliases. No distribution discovery is repeated.

The source snapshot is ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2. The evaluation
branch was rebased onto 5e3487d619abee9ebef1f6fa85995dd587ac7bf8 after PR159
merged; that renderer change does not alter the cited material.
