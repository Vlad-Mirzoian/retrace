# retrace-cli

**Checks whether Claude Code did what it said it did — and records everything it did to prove it.**

The `retrace` command: records every prompt, tool call and file change from a Claude Code session
into a single local record, then checks that record against the agent's claims — files edited
without ever being read, tool failures nothing responded to, changes made by shell commands that
nothing is tracking. Also includes a timeline viewer, full recording-side replay, and a
side-by-side comparison view for two runs of the same task.

This package embeds the [Retrace viewer](https://github.com/Vlad-Mirzoian/retrace/tree/main/packages/viewer)
and depends on [`retrace-core`](https://www.npmjs.com/package/retrace-core), the library half. See the
[main repository](https://github.com/Vlad-Mirzoian/retrace) for the full project README and architecture
notes.

> This package is young — local-only, single-user, single-adapter (Claude Code) for now.

## Quickstart

```bash
npx retrace-cli ui
```

One command, no prior setup: if you have no sessions recorded yet, it imports your existing Claude Code
history from `~/.claude/projects` and opens the timeline — a searchable, filterable view of prompts,
reasoning, tool calls paired with their results, file diffs, collapsed subagent branches, and a findings
panel for anything the check engine flagged. (Nothing there yet? It says so and still opens, rather than
serving a silent blank page. `--no-import` skips the auto-import if you'd rather run it yourself.)

**Capture new sessions as they happen** (file snapshots + session boundaries via Claude Code hooks — run
from the project you want to record):

```bash
npx retrace-cli init
```

This adds hooks to `.claude/settings.json`, merging in alongside anything already there.

Everything below this point is optional — `ui` and `init` cover the common path. `npm install -g
retrace-cli` gets you the plain `retrace` command instead of `npx retrace-cli` for everything that follows.

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

Exits non-zero above the configured severity threshold (default `high`), so it also works as a CI gate.

**Send a session to someone else** as one self-contained file (no server needed to view it):

```bash
npx retrace-cli export <sessionId>
```

**Compare two runs of the same task** side by side, event-by-event and by final working tree:

```bash
npx retrace-cli compare <sessionIdA> <sessionIdB>
```

Every event is also hash-chained, so accidental or casual tampering with the local store is
detectable via `retrace verify` — not a defense against someone who controls the machine the store
lives on, just against drift and mistakes.

## Commands

| Command | What it does |
| --- | --- |
| `retrace import [--watch] [--projects-dir <dir>]` | Import Claude Code transcripts from `~/.claude/projects` (or a custom dir) into the local store. Incremental — re-running only picks up new lines. `--watch` keeps importing as sessions change. |
| `retrace list` | List recorded sessions, most recent first. |
| `retrace init [--global]` | Install Retrace's hooks into Claude Code settings (project-local by default, `--global` for `~/.claude/settings.json`). Backs up the existing file and preserves any hooks already there. |
| `retrace ui [--port <port>] [--no-open] [--no-import]` | Serve the timeline viewer. Picks a free port by default and opens your browser; `--no-open` for headless use. If the store has no sessions yet, imports from `~/.claude/projects` first (prints what it's doing, or that the directory doesn't exist) — suppress with `--no-import`. |
| `retrace check [sessionId] [--all] [--json] [--fail-on <severity>] [--disable <ruleId...>] [--list-rules]` | Run the check engine. `--fail-on` (default `high`) sets the exit-1 severity threshold (`high\|medium\|low\|never`); `--json` prints the raw report for `jq`; `--list-rules` prints every rule with no store needed. Exit codes: `0` clean (or below threshold), `1` findings at or above the threshold, `2` operational failure. |
| `retrace export <sessionId> [--json] [--output <path>]` | Export a session — a self-contained HTML file by default, or `--json` for the raw data. |
| `retrace reimport [sessionId] [--all]` | Delete a session's stored data and re-import it from its source transcript (for recovering after a parser-bug fix). `--all` re-imports every session with a known source. |
| `retrace verify [sessionId] [--all]` | Verify a session's tamper-evident hash chain, printing `✓ verified` or `✗ tampered at seq N`. Exits non-zero on any failure. |
| `retrace compare <sessionIdA> <sessionIdB> [--port <port>] [--no-open]` | Open the viewer's side-by-side comparison of two recorded sessions — aligned event-by-event, plus a diff of each run's final working tree. |
| `retrace hook` | Internal: invoked by the hooks `retrace init` installs, reading a Claude Code hook payload from stdin. Not meant to be run by hand. |
