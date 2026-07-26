# retrace-cli

**A flight recorder for AI coding agents.**

The `retrace` command: records everything Claude Code does in a session (prompts, reasoning, tool calls,
file diffs) into a single local, replayable record, with a timeline viewer, a check engine that flags
things like edits to never-read files or unverified test claims, and a comparison view for two runs of
the same task.

This package embeds the [Retrace viewer](https://github.com/Vlad-Mirzoian/retrace/tree/main/packages/viewer)
and depends on [`retrace-core`](https://www.npmjs.com/package/retrace-core), the library half. See the
[main repository](https://github.com/Vlad-Mirzoian/retrace) for the full project README and architecture
notes.

> This package is young — local-only, single-user, single-adapter (Claude Code) for now.

## Quickstart

```bash
npx retrace-cli import   # or: npm install -g retrace-cli, then use `retrace` directly
npx retrace-cli list
```

**Capture new sessions as they happen** (file snapshots + session boundaries via Claude Code hooks — run
from the project you want to record):

```bash
npx retrace-cli init
```

This adds hooks to `.claude/settings.json`, merging in alongside anything already there.

**Browse a session's timeline:**

```bash
npx retrace-cli ui
```

Opens a local server with a searchable, filterable timeline — prompts, reasoning, tool calls paired with
their results, file diffs, collapsed subagent branches, and a findings panel for anything the check
engine flagged.

**Check a session for things worth a second look** (unaddressed errors, edits to never-read files,
unverified test claims, and more):

```bash
npx retrace-cli check <sessionId>
```

Exits non-zero above the configured severity threshold, so it also works as a CI gate.

**Send a session to someone else** as one self-contained file (no server needed to view it):

```bash
npx retrace-cli export <sessionId>
```

**Compare two runs of the same task** side by side, event-by-event and by final working tree:

```bash
npx retrace-cli compare <sessionIdA> <sessionIdB>
```

## Commands

| Command | What it does |
| --- | --- |
| `retrace import [--watch] [--projects-dir <dir>]` | Import Claude Code transcripts from `~/.claude/projects` (or a custom dir) into the local store. Incremental — re-running only picks up new lines. `--watch` keeps importing as sessions change. |
| `retrace list` | List recorded sessions, most recent first. |
| `retrace init [--global]` | Install Retrace's hooks into Claude Code settings (project-local by default, `--global` for `~/.claude/settings.json`). Backs up the existing file and preserves any hooks already there. |
| `retrace ui [--port <port>] [--no-open]` | Serve the timeline viewer. Picks a free port by default and opens your browser; `--no-open` for headless use. |
| `retrace check [sessionId] [--all] [--json] [--fail-on <severity>] [--disable <ruleId...>] [--list-rules]` | Run the check engine. `--fail-on` (default `high`) sets the exit-1 severity threshold (`high\|medium\|low\|never`); `--json` prints the raw report for `jq`; `--list-rules` prints every rule with no store needed. Exit codes: `0` clean (or below threshold), `1` findings at or above the threshold, `2` operational failure. |
| `retrace export <sessionId> [--json] [--output <path>]` | Export a session — a self-contained HTML file by default, or `--json` for the raw data. |
| `retrace reimport [sessionId] [--all]` | Delete a session's stored data and re-import it from its source transcript (for recovering after a parser-bug fix). `--all` re-imports every session with a known source. |
| `retrace verify [sessionId] [--all]` | Verify a session's tamper-evident hash chain, printing `✓ verified` or `✗ tampered at seq N`. Exits non-zero on any failure. |
| `retrace compare <sessionIdA> <sessionIdB> [--port <port>] [--no-open]` | Open the viewer's side-by-side comparison of two recorded sessions — aligned event-by-event, plus a diff of each run's final working tree. |
| `retrace hook` | Internal: invoked by the hooks `retrace init` installs, reading a Claude Code hook payload from stdin. Not meant to be run by hand. |
