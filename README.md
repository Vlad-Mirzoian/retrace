# Retrace

**A flight recorder for AI coding agents.**

Autonomous agents are writing code, touching production, and moving money — and when one of them does something expensive, the investigation usually turns into archaeology across scattered logs. Retrace captures everything Claude Code does in a session (prompts, reasoning, tool calls, file diffs) into a single local, replayable record, with a timeline viewer to make sense of it after the fact.

This is an early MVP. Local-only, single-user, single-adapter (Claude Code). See [Roadmap](#roadmap) for what's next.

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

## Commands

| Command | What it does |
| --- | --- |
| `retrace import [--watch] [--projects-dir <dir>]` | Import Claude Code transcripts from `~/.claude/projects` (or a custom dir) into the local store. Incremental — re-running only picks up new lines. `--watch` keeps importing as sessions change. |
| `retrace list` | List recorded sessions, most recent first. |
| `retrace init [--global]` | Install Retrace's hooks into Claude Code settings (project-local by default, `--global` for `~/.claude/settings.json`). Backs up the existing file and preserves any hooks already there. |
| `retrace ui [--port <port>] [--no-open]` | Serve the timeline viewer. Picks a free port by default and opens your browser; `--no-open` for headless use. |
| `retrace export <sessionId> [--json] [--output <path>]` | Export a session — a self-contained HTML file by default, or `--json` for the raw data. |
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
                                 └─ objects/           (content-addressed file snapshots)
                                                             ▼
                                 `retrace ui` → local API + timeline viewer
```

Every session's events are normalized into a single schema and appended to a hash chain (each event's hash covers the one before it), so tampering is detectable — a small step toward the audit-trail use case this is ultimately aimed at. The raw transcript is always kept alongside the normalized events, since the format is undocumented and shifts between Claude Code versions.

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

Shipped so far: recording (transcript import + live hooks), a local store with a tamper-evident hash chain, and a viewer with search/filtering and diffs.

Not yet built: publishing to npm, replay (forking a session from a chosen point and re-running with changes), an LLM-request proxy for full prompt/response capture, cloud storage for teams, anomaly detection, and signed exports for compliance use cases.

## License

[MIT](LICENSE)
