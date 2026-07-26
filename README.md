# Retrace

**A flight recorder for AI coding agents.**

Autonomous agents are writing code, touching production, and moving money — and when one of them does something expensive, the investigation usually turns into archaeology across scattered logs. Retrace captures everything Claude Code does in a session (prompts, reasoning, tool calls, file diffs) into a single local, replayable record, with a timeline viewer to make sense of it after the fact.

This is an early MVP. Local-only, single-user, single-adapter (Claude Code). Recorded sessions are also **replayable**: step through a session event by event, reconstruct the working tree at any point, jump straight to failures, and diff two runs of the same task side by side. See [Roadmap](#roadmap) for what's next.

## Quickstart

Retrace isn't published to npm yet — run it from a clone of this repo.

```bash
git clone <this-repo>
cd retrace
pnpm install
pnpm build
```

**Pull in your existing Claude Code history:**

```bash
node packages/cli/dist/cli.js import
node packages/cli/dist/cli.js list
```

**Capture new sessions as they happen** (file snapshots + session boundaries via Claude Code hooks — run from the project you want to record):

```bash
node packages/cli/dist/cli.js init
```

This adds hooks to `.claude/settings.json`, merging in alongside anything already there.

**Browse a session's timeline:**

```bash
node packages/cli/dist/cli.js ui
```

Opens a local server with a searchable, filterable timeline — prompts, reasoning, tool calls paired with their results, file diffs, and collapsed subagent branches.

**Send a session to someone else** as one self-contained file (no server needed to view it):

```bash
node packages/cli/dist/cli.js export <sessionId>
```

**Step through a session's replay** — playback controls, working-tree reconstruction, and failure jump-to: run `retrace ui` and open the session; the replay cursor is part of every session's detail view, no separate command needed.

**Compare two runs of the same task** side by side, event-by-event and by final working tree:

```bash
node packages/cli/dist/cli.js compare <sessionIdA> <sessionIdB>
```

## Commands

| Command | What it does |
| --- | --- |
| `retrace import [--watch] [--projects-dir <dir>]` | Import Claude Code transcripts from `~/.claude/projects` (or a custom dir) into the local store. Incremental — re-running only picks up new lines. `--watch` keeps importing as sessions change. |
| `retrace list` | List recorded sessions, most recent first. |
| `retrace init [--global]` | Install Retrace's hooks into Claude Code settings (project-local by default, `--global` for `~/.claude/settings.json`). Backs up the existing file and preserves any hooks already there. |
| `retrace ui [--port <port>] [--no-open]` | Serve the timeline viewer. Picks a free port by default and opens your browser; `--no-open` for headless use. |
| `retrace export <sessionId> [--json] [--output <path>]` | Export a session — a self-contained HTML file by default, or `--json` for the raw data. |
| `retrace reimport [sessionId] [--all]` | Delete a session's stored data and re-import it from its source transcript (for recovering after a parser-bug fix). `--all` re-imports every session with a known source. |
| `retrace verify [sessionId] [--all]` | Verify a session's tamper-evident hash chain, printing `✓ verified` or `✗ tampered at seq N`. Exits non-zero on any failure. |
| `retrace check [sessionId] [--all] [--json] [--fail-on <severity>] [--disable <ruleId...>] [--list-rules]` | Run the check engine — catches edits to never-read files, unaddressed tool errors, unverified test/build claims, claimed file changes with no matching edit, and untracked Bash/PowerShell mutations. `--fail-on` (default `high`) sets the exit-1 severity threshold (`high\|medium\|low\|never`); `--json` prints the raw report for `jq`; `--list-rules` prints every rule with no store needed. Exit codes: `0` clean (or below threshold), `1` findings at or above the threshold, `2` operational failure (session not found, ambiguous prefix, store unreadable) — so CI can tell "the agent did something questionable" from "the check itself broke". |
| `retrace compare <sessionIdA> <sessionIdB> [--port <port>] [--no-open]` | Open the viewer's side-by-side comparison of two recorded sessions — aligned event-by-event, plus a diff of each run's final working tree. |
| `retrace hook` | Internal: invoked by the hooks `retrace init` installs, reading a Claude Code hook payload from stdin. Not meant to be run by hand. |

## Replay & comparison

Every recorded session doubles as a replayable record, not just a read-only log. `retrace ui` adds a **replay cursor** on top of every session's timeline:

- **Playback controls** — play/pause, step forward/back, scrub to any point, jump to the next/previous error or file change.
- **Working tree** — reconstructs the content of every file touched up to the cursor (created / edited / deleted / no snapshot captured), with a diff against that file's previous recorded change.
- **Failures** — every error and failed tool call, one click away, each with a causal trace (the tool call and file changes that produced it).
- **Tamper-evidence badge** — the hash-chain verdict (`retrace verify`) surfaced right in the header.

All of this runs entirely client-side over the already-recorded event stream (no re-invocation of Claude Code) and works identically in a standalone `retrace export --html` file, since the core reconstruction logic is pure and Node-free.

`retrace compare <idA> <idB>` aligns two runs of the same task for side-by-side inspection: matched/changed/only-in-one-run rows down the middle, and a diff of what each run actually left in the working tree by the end — useful for "why did the second attempt behave differently".

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
                                 `retrace ui` → local API + timeline viewer
```

Every session's events are normalized into a single schema and appended to a hash chain (each event's hash covers the one before it), so tampering is detectable — a small step toward the audit-trail use case this is ultimately aimed at. The raw transcript is always kept alongside the normalized events, since the format is undocumented and shifts between Claude Code versions.

A few events carry most of a session's bytes — a long command's output, a long stretch of reasoning — so any body over 8 KB is moved into the content-addressed store and referenced by hash, which also collapses repeats (the same file read twice) to a single object. Reads restore it transparently, and because the hash is taken over the real body rather than the reference, swapping a stored object out still breaks verification.

## Development

A pnpm workspace with three packages:

- **`packages/core`** — event schema (zod), hash chain, content-addressed store, SQLite-backed session store, transcript parser. Ships a browser-safe subset (`@retrace/core/browser`) with zero Node dependencies for the viewer.
- **`packages/cli`** — the `retrace` command (commander), the HTTP API (Hono), hook/init handling, and the build step that embeds the viewer's static assets.
- **`packages/viewer`** — the timeline UI (React + Vite), plus a separate single-file build used by `retrace export`.

```bash
pnpm install
pnpm build          # builds core, then viewer, then cli (in that dependency order)
pnpm test           # runs every package's test suite
```

For viewer UI work, run the API and the Vite dev server side by side:

```bash
node packages/cli/dist/cli.js ui --port 4317 --no-open   # terminal 1
pnpm --filter @retrace/viewer dev                        # terminal 2
```

The dev server proxies `/api` to port 4317 by convention (see `packages/viewer/vite.config.ts`).

## Roadmap

Shipped so far: recording (transcript import + live hooks), a local store with a tamper-evident hash chain (verifiable on demand via `retrace verify`), a viewer with search/filtering and diffs, and full recording-side replay — step-through playback, working-tree reconstruction, failure localization with causal traces, and side-by-side run comparison (`retrace compare`).

Not yet built: publishing to npm, **forking** a session from a chosen point and re-running it with changes (true fork-and-rerun, distinct from the playback/reconstruction above — this would mean re-invoking Claude Code itself, which raises its own questions around model non-determinism), an LLM-request proxy for full prompt/response capture, cloud storage for teams, anomaly detection, and signed exports for compliance use cases.

## License

[MIT](LICENSE)
