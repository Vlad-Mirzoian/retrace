# Releasing

Retrace ships two npm packages from this workspace: `retrace-core` (the library) and `retrace-cli` (the
`retrace` command, which embeds the built viewer). Both are published together, in that order —
`retrace-cli` depends on `retrace-core` at whatever concrete version `workspace:*` gets rewritten to at
pack time, and that version must already resolve on the registry before `retrace-cli` installs.

## Automated (preferred)

Push a tag matching `v*` (e.g. `v0.4.0`) to trigger `.github/workflows/release.yml`. It builds, tests,
runs `pnpm verify:pack` (packs both packages and smoke-tests the packed artifact end to end — not just
the source tree), then publishes `retrace-core` and then `retrace-cli` with npm provenance. The job is
guarded to only run on this repository (never a fork) and sits behind a `release` GitHub Environment, so
configure required reviewers there if you want a manual approval gate before publishing actually happens.

Nothing about this repository's tooling automatically pushes a tag — that step, like the decision to
release at all, is yours.

## Manual

If the workflow isn't usable for some reason:

```bash
pnpm build && pnpm test && pnpm verify:pack
pnpm --filter retrace-core publish --access public
pnpm --filter retrace-cli  publish --access public
```

**Use `pnpm publish`, never `npm publish`, for this manual path.** `pnpm publish` rewrites each
package's `workspace:*` specifiers to the real, concrete version being published; plain `npm publish`
does not, and would publish `retrace-cli` with a literal, uninstallable `"retrace-core": "workspace:*"`
dependency.

(The release *workflow* uses `npm publish` internally, but only on an already-`pnpm pack`-built tarball
— never on the live workspace source — specifically to get npm provenance, which the pinned `pnpm`
version doesn't support. See the comment in `release.yml` for the full reasoning. That distinction only
matters for the workflow; for a manual release, just use `pnpm publish` as above and don't think about it
further.)

## Before either path

- `pnpm verify:pack` must pass. It fails loudly (naming the missing piece) if the embedded viewer didn't
  survive packing — the failure mode this whole file exists to prevent.
- Bump both packages' `version` in their `package.json` first. Nothing in this repo bumps versions for
  you.
- npm versions are immutable. If you're unsure about metadata (`repository`, `homepage`, `bugs`,
  `description`), fix it before publishing, not after.

## The GitHub Action's `v0` tag

`action.yml` is consumed as `Vlad-Mirzoian/retrace@v0` (see [`README.md`](README.md#use-it-in-ci) and
[`docs/ci.md`](docs/ci.md)) — a second artifact, with a second, separate release cadence from the npm
packages above. It's a floating major-version tag, the convention every widely-used GitHub Action
follows (`actions/checkout@v4`, `actions/setup-node@v4`, ...): consumers pin to `v0` once and get
every subsequent fix and feature automatically, without editing their workflow file each time, while
still being able to pin an exact commit or tag themselves if they want stability over updates instead.

**This repo's tooling does not move that tag for you — nothing here even suggests a version number.**
After a release where `action.yml` changed (or its default `version` input needs bumping to point at
the npm release just published), move it yourself:

```bash
git tag -f v0 <commit-sha-or-just-pushed-tag>
git push origin v0 --force
```

Forgetting this step is the classic way a GitHub Action silently stops updating: the tag stays parked
on an old commit, every consumer keeps running old behavior, and nothing in CI complains because
there's nothing to compare against. If `action.yml`'s default `version` input still names an old
`retrace-cli` release after an npm publish, that's a sign this step was missed, not a sign the Action
input needs a second bump elsewhere — the tag move and the `version` input default should be part of
the same release, not two.

There is no automation for this in `.github/workflows/` — deliberately, matching the tag-push trigger
above: releasing is a decision, not something that happens as a side effect of some other job passing.
