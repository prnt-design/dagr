# Manual npm trusted publishing

This workflow does not authorize a release. An explicit maintainer request must
name the action, package scope, exact version and dist-tag. Staging does not
authorize promotion. No push, tag or PR triggers publication.

## One-time npm setup

For **each** of `@prnt/dagr-graph`, `@prnt/dagr-layout`, `@prnt/dagr-render`,
`@prnt/dagr-explorer`, `@prnt/dagr-react`, `@prnt/dagr-vdsl`,
`@prnt/dagr-chart` and `@prnt/dagr`, open package Settings, Trusted Publisher,
GitHub Actions. Set:

| Field | Value |
| --- | --- |
| Organization or user | `prnt-design` |
| Repository | `dagr` |
| Workflow filename | `npm-release.yml` |
| Environment | Leave blank |
| Allowed actions | Enable direct `npm publish` **and** `npm dist-tag` |

The two allowed actions are independent. Keep 2FA enabled. No npm token,
GitHub secret, environment or repository setting change is needed. The workflow
uses GitHub-hosted Ubuntu, Node 22.22.1 and npm 11.21.0, which supports OIDC for
both actions. New npm trust configurations expire if their first successful
publish does not occur within two days. Do not assume a promotion-only run
validates a new trust configuration. See [npm's trusted publisher documentation](https://docs.npmjs.com/trusted-publishers/).

## Preserve and review release evidence

Complete the release candidate's local gate, machine-matched `pnpm bench:gate`,
external verifier, diff and merged-tree reviews, and concluded green CI first.
The workflow checks successful push CI for both the source SHA and workflow
commit on main. It cannot
replace local benchmark evidence with a GitHub-hosted benchmark.

Preserve the exact **pnpm-packed** tarballs that passed review and validation.
Use immutable public HTTPS storage with SHA-512 pins. Never rebuild to obtain
publish bytes. The existing `verify:tools` can verify preserved tarballs without
building or packing by setting `DAGR_TARBALL_DIR` to their absolute directory.
The directory must contain all eight standard pnpm tarball filenames and no
other tarballs. It runs the existing publint, attw and installed-consumer checks.

Commit a JSON record under `packaging/release-evidence/` through a reviewed PR.
Do not put credentials or signed URLs in the evidence. Example schema (replace
all placeholders, this example is not release authorization):

```json
{
  "mode": "promote",
  "version": "0.2.0",
  "tag": "latest",
  "scope": ["@prnt/dagr-react", "@prnt/dagr-vdsl", "@prnt/dagr"],
  "source": "<40-character reviewed source commit on main>",
  "request": "https://github.com/prnt-design/dagr/issues/123#issuecomment-456",
  "checks": {
    "typecheck": "https://github.com/prnt-design/dagr/pull/123",
    "test": "https://github.com/prnt-design/dagr/pull/123",
    "lint": "https://github.com/prnt-design/dagr/pull/123",
    "build": "https://github.com/prnt-design/dagr/pull/123",
    "bench:gate": "https://github.com/prnt-design/dagr/pull/123",
    "verify:tools": "https://github.com/prnt-design/dagr/pull/123",
    "diff-review": "https://github.com/prnt-design/dagr/pull/123",
    "tree-review": "https://github.com/prnt-design/dagr/pull/123"
  },
  "packages": {
    "@prnt/dagr-graph": {"integrity": "sha512-<base64 SHA-512>"}
  }
}
```

`packages` must contain all eight package names, each with the reviewed
`sha512-...` integrity. Publish mode additionally requires an HTTPS `url` for
each preserved tarball. Promotion uses registry URLs instead and checks the
entire eight-package candidate before moving any selected tag. Evidence links
must point to this repository's issues, PRs or Actions runs. Their content is
reviewed by the evidence PR reviewers, not interpreted as approval by software.
The source SHA must be an ancestor of the workflow commit.

## Run only after trust and explicit authorization

On the Actions page choose **npm release**, Run workflow, branch `main`.
Supply `publish` or `promote`, comma-separated full package names (no spaces),
exact version, tag and committed evidence path. Inputs must match evidence
exactly. A promotion-only request needs no unpublished version or rebuild.
All eight registry versions must already exist and match their pinned bytes.

Publish mode preflights all selected versions as absent, verifies the preserved
candidate, then invokes `npm publish <tarball> --ignore-scripts` in dependency
order. Using npm on an already pnpm-packed tarball preserves rewritten workspace
ranges and exact reviewed bytes. It differs from `npm publish` on a package
directory, which is still prohibited by the release candidate instructions.
Promotion invokes only `npm dist-tag add`. Both modes download and hash registry
artifacts and verify selected tags after each write. The complete candidate is
checked by the existing external consumer verifier before the first write.

Multi-package operations are not atomic. On failure inspect registry state and
record the completed package list. Never blindly retry publication or unpublish.
A partial publish needs a new reviewed scope excluding existing versions, or a
separately authorized promotion once the entire candidate is verified. A partial
promotion can be retried with the same explicit scope and evidence. This workflow
does not move GitHub tags, create releases, roll back or alter package versions.
