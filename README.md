# Retrace

**Retrace records what Claude Code actually did — and checks whether it matches what it said.**

The agent reports that the tests pass, the file is updated, the error is handled. Retrace records
every prompt, tool call and file change locally, then checks the record against the claims: files
edited without ever being read, tool failures nothing responded to, changes made by shell commands
that nothing is tracking.

This is an early MVP. Local-only, single-user, single-adapter (Claude Code). See
[Roadmap](#roadmap) for what's next.

## Quickstart

```bash
npx retrace-cli ui
```

One command, no prior setup: if you have no sessions recorded yet, it imports your existing Claude
Code history from `~/.claude/projects` and opens the timeline.

**Capture new sessions as they happen** (file snapshots + session boundaries via Claude Code hooks —
run from the project you want to record):

```bash
npx retrace-cli init
```

This adds hooks to `.claude/settings.json`, merging in alongside anything already there.

**Check a session against what the agent claimed:**

```bash
npx retrace-cli check <sessionId>
```

Here's real output from a session on this machine, not a made-up example:

```
$ retrace check 36192c50
✗ 36192c50-75f6-4b3e-a3d5-64e65930d224 — 4 finding(s)

  medium  untracked-bash-mutation  seq    3  Bash command (output redirection (> / >>)) may have modified files outside Retrace's record
  medium  untracked-bash-mutation  seq  140  Bash command (cp) may have modified files outside Retrace's record
  medium  untracked-bash-mutation  seq  249  Bash command (git checkout/reset/apply/revert) may have modified files outside Retrace's record
  medium  edit-without-read        seq  255  D:\Projects\Retrace\retrace\packages\viewer\src\theme.css edited without being read

  Run `retrace ui` and open the session to inspect each finding in context.
```

Exits non-zero above the configured severity threshold (default `high`), so it also works as a CI
gate.

## Recording, replay and comparison

Underneath the checks, Retrace captures everything Claude Code does in a session (prompts,
reasoning, tool calls, file diffs) into a single local record, and every recorded session doubles
as a **replayable** one: step through it event by event, reconstruct the working tree at any point,
jump straight to failures, and diff two runs of the same task side by side.

```bash
node packages/cli/dist/cli.js ui
```

Opens a local server with a searchable, filterable timeline — prompts, reasoning, tool calls paired
with their results, file diffs, collapsed subagent branches, and a findings panel for anything
`check` flagged.

**Send a session to someone else** as one self-contained file (no server needed to view it):

```bash
node packages/cli/dist/cli.js export <sessionId>
```

**Step through a session's replay** — playback controls, working-tree reconstruction, and failure
jump-to: run `retrace ui` and open the session; the replay cursor is part of every session's detail
view, no separate command needed.

**Compare two runs of the same task** side by side, event-by-event and by final working tree:

```bash
node packages/cli/dist/cli.js compare <sessionIdA> <sessionIdB>
```

Every event is also hash-chained (each event's hash covers the one before it), so accidental or
casual tampering with the local store is detectable via `retrace verify`. This is not a defense
against a determined adversary: the chain lives on the same machine it protects, and whoever
controls that machine can recompute it. External anchoring, which would change that, is on the
[Roadmap](#roadmap), not shipped.

## Commands

| Command | What it does |
| --- | --- |
| `retrace import [--watch] [--projects-dir <dir>]` | Import Claude Code transcripts from `~/.claude/projects` (or a custom dir) into the local store. Incremental — re-running only picks up new lines. `--watch` keeps importing as sessions change. |
| `retrace list` | List recorded sessions, most recent first. |
| `retrace init [--global]` | Install Retrace's hooks into Claude Code settings (project-local by default, `--global` for `~/.claude/settings.json`). Backs up the existing file and preserves any hooks already there. |
| `retrace ui [--port <port>] [--no-open] [--no-import]` | Serve the timeline viewer. Picks a free port by default and opens your browser; `--no-open` for headless use; `--no-import` skips the auto-import when the store is empty. |
| `retrace check [sessionId] [--all] [--json] [--fail-on <severity>] [--disable <ruleId...>] [--list-rules]` | Run the check engine — catches edits to never-read files, unaddressed tool errors, unverified test/build claims, claimed file changes with no matching edit, and untracked Bash/PowerShell mutations. `--fail-on` (default `high`) sets the exit-1 severity threshold (`high\|medium\|low\|never`); `--json` prints the raw report for `jq`; `--list-rules` prints every rule with no store needed. Exit codes: `0` clean (or below threshold), `1` findings at or above the threshold, `2` operational failure (session not found, ambiguous prefix, store unreadable) — so CI can tell "the agent did something questionable" from "the check itself broke". |
| `retrace export <sessionId> [--json] [--output <path>]` | Export a session — a self-contained HTML file by default, or `--json` for the raw data. |
| `retrace reimport [sessionId] [--all]` | Delete a session's stored data and re-import it from its source transcript (for recovering after a parser-bug fix). `--all` re-imports every session with a known source. |
| `retrace verify [sessionId] [--all]` | Verify a session's tamper-evident hash chain, printing `✓ verified` or `✗ tampered at seq N`. Exits non-zero on any failure. |
| `retrace compare <sessionIdA> <sessionIdB> [--port <port>] [--no-open]` | Open the viewer's side-by-side comparison of two recorded sessions — aligned event-by-event, plus a diff of each run's final working tree. |
| `retrace delete <sessionId...> [--yes]` | Permanently delete one or more sessions (their events and on-disk data). Prompts for confirmation unless `--yes` is given. CAS snapshots aren't reclaimed — that needs `retrace reset`. |
| `retrace reset [--yes]` | Permanently wipe the entire store — every session and every CAS object, all of `~/.retrace` (or `$RETRACE_HOME`). Prompts for confirmation unless `--yes` is given. |
| `retrace hook` | Internal: invoked by the hooks `retrace init` installs, reading a Claude Code hook payload from stdin. Not meant to be run by hand. |

## How it works

```
Claude Code
 ├─ transcripts ~/.claude/projects/**/*.jsonl ──► importer ─┐
 └─ hooks (settings.json) ──► `retrace hook` (stdin) ───────┤
                                                             ▼
                                 ~/.retrace/
                                 ├─ store.db        (SQLite index)
                                 ├─ sessions/<id>/
                                 │   ├─ events.jsonl  (hash-chained events)
                                 │   └─ raw.jsonl      (raw transcript copy)
                                 └─ objects/           (content-addressed bodies:
                                                        file snapshots + large payloads)
                                                             ▼
                        `retrace check` → findings   `retrace ui` → local API + timeline viewer
```

Every session's events are normalized into a single schema and appended to a hash chain. The raw
transcript is always kept alongside the normalized events, since the format is undocumented and
shifts between Claude Code versions.

A few events carry most of a session's bytes — a long command's output, a long stretch of
reasoning — so any body over 8 KB is moved into the content-addressed store and referenced by hash,
which also collapses repeats (the same file read twice) to a single object. Reads restore it
transparently, and because the hash is taken over the real body rather than the reference, swapping
a stored object out still breaks verification.

## Development

A pnpm workspace with three packages:

- **`packages/core`** — event schema (zod), hash chain, content-addressed store, SQLite-backed
  session store, transcript parser, and the check engine (`runChecks`). Ships a browser-safe subset
  (`@retrace/core/browser`) with zero Node dependencies for the viewer.
- **`packages/cli`** — the `retrace` command (commander), the HTTP API (Hono), hook/init handling,
  and the build step that embeds the viewer's static assets.
- **`packages/viewer`** — the timeline UI (React + Vite), plus a separate single-file build used by
  `retrace export`.

```bash
git clone <this-repo>
cd retrace
pnpm install
pnpm build          # builds core, then viewer, then cli (in that dependency order)
pnpm test           # runs every package's test suite
node packages/cli/dist/cli.js import
node packages/cli/dist/cli.js list
```

For viewer UI work, run the API and the Vite dev server side by side:

```bash
node packages/cli/dist/cli.js ui --port 4317 --no-open   # terminal 1
pnpm --filter @retrace/viewer dev                        # terminal 2
```

The dev server proxies `/api` to port 4317 by convention (see `packages/viewer/vite.config.ts`).

See [RELEASING.md](RELEASING.md) for the publish process.

## Roadmap

Shipped: recording (transcript import + live hooks), the check engine and `retrace check` (edits to
never-read files, unaddressed tool errors, unverified test/build claims, claimed changes with no
matching edit, untracked shell mutations), findings surfaced in the API and viewer, a local store
with a tamper-evident hash chain, and full recording-side replay — step-through playback,
working-tree reconstruction, failure localization with causal traces, and side-by-side run
comparison.

- **Next: session ↔ commit/PR provenance.** Link findings to the commits they came from, emit the
  Linux-kernel `Assisted-by:` trailer, and interoperate with the
  [`cursor/agent-trace`](https://github.com/cursor/agent-trace) spec — which deliberately excludes
  tool calls and reasoning, so it complements rather than competes with what Retrace records.
- **After: cross-session forensics.** The store already indexes every session; the viewer only
  ever renders one at a time.
- **Later: external chain anchoring and signing**, for when the tamper-evidence claim needs to hold
  against someone who controls the machine, not just casual or accidental tampering.
- **Explicitly not planned:** cost/token analytics (`ccusage`, Anthropic's Analytics API, and native
  OpenTelemetry all cover it already), multi-agent adapters, and cloud storage.

## License

[MIT](LICENSE)
