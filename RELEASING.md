# Releasing

Retrace ships two npm packages from this workspace: `retrace-core` (the library) and `retrace-cli` (the
`retrace` command, which embeds the built viewer). Both are published together, in that order —
`retrace-cli` depends on `retrace-core` at whatever concrete version `workspace:*` gets rewritten to at
pack time, and that version must already resolve on the registry before `retrace-cli` installs.

## Automated (preferred)

Push a tag matching `v*` (e.g. `v0.3.0`) to trigger `.github/workflows/release.yml`. It builds, tests,
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
