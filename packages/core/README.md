# retrace-core

The library half of [Retrace](https://github.com/Vlad-Mirzoian/retrace), which checks whether
Claude Code did what it said it did. This package has no CLI or UI of its own — for that, see
[`retrace-cli`](https://www.npmjs.com/package/retrace-cli), which depends on it.

It provides:

- The normalized event schema (zod) every Claude Code transcript record and hook payload is parsed into.
- A hash-chained, tamper-evident event store, the transcript parser, and a content-addressed store for
  file snapshots and large payloads.
- Pure, dependency-free replay/comparison primitives (working-tree reconstruction, causal traces,
  side-by-side run alignment) and the check engine (`runChecks`) that flags things like edits to
  never-read files or unverified test claims.

## `retrace-core/browser`

A second entry point, `retrace-core/browser`, re-exports only the parts of this package that touch no
Node builtins (schema, replay, compare, check) — no `node:sqlite`, `node:fs`, or `node:crypto`. It's what
lets the Retrace viewer's timeline, replay, and findings panel run identically whether served by
`retrace ui` or opened as a self-contained `retrace export --html` file with no server at all. Import
from here in any browser/bundled context; the default `retrace-core` entry will throw at load time if
bundled for a browser, since it eagerly imports Node builtins.

See the [main repository](https://github.com/Vlad-Mirzoian/retrace) for the full project README,
architecture notes, and how the pieces fit together.
