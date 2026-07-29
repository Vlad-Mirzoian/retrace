# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `retrace link [sessionId] [--all] [--repo <dir>] [--grace <minutes>] [--json]` — links a recorded
  session to the git commit(s) it plausibly produced, inferred from repo containment, a time window,
  and touched-file overlap. Never writes to the commit, its message, or any git ref; recorded in a new
  `session_commits` table, queryable via `commitsForSession`/`sessionsForCommit`.
- `retrace report [--base <ref>] [--head <ref>] [--output <path>] [--publish] [--remote <name>] [--fail-on <severity>] [--disable <ruleId...>] [--json] [--read <sha>]`
  — the piece that makes the check engine usable in CI, which has no access to `~/.retrace`. Assembles
  a versioned, self-contained JSON report for a commit range (every linked session's findings, with
  paths normalized to repo-relative) and writes it to `refs/notes/retrace` on the head commit — the
  same transport `git-ai` uses for line-level provenance, chosen because notes survive rebase/squash/
  amend/cherry-pick and never touch the commit message. `--output` writes a plain file instead, for
  anyone who can't or won't push notes; `--publish` pushes the note in the same command; `--read <sha>`
  is how CI reads a report back, since it never has a store to regenerate one from. Same exit-code
  contract as `retrace check` (`0` clean, `1` breaches `--fail-on`, `2` operational failure). See
  [Getting the report to CI](README.md#getting-the-report-to-ci) in the README for the push/fetch
  requirement and the file fallback.

### Changed

- **Breaking (CI-visible):** `unaddressed-error` and `unverified-test-claim` can now report `high`
  severity findings. Previously `high` was reachable only when a failed tool call was the literal
  last event in the whole session — a condition real sessions almost never satisfy, since a trailing
  assistant message is essentially guaranteed — so the default `--fail-on high` gate never fired
  against any of the 67 sessions in the measured corpus. It now escalates to `high` when: an
  unaddressed failure is a failed test/build command (`unaddressed-error`), or the agent took no
  further tool action after an unaddressed failure (`unaddressed-error`), or the assistant claimed
  "tests pass" / "the build succeeds" directly contradicting a recorded failing run of that same
  command (`unverified-test-claim`, previously `medium`). Sessions that previously exited `0` under
  the default threshold may now exit `1`. See the `Severity` doc comment in
  `packages/core/src/check/types.ts` for the full contract each escalation is held to.
- `untracked-bash-mutation` is more precise and, where possible, actionable:
  - No longer matches stderr-to-null or stream-merge redirects (`2>/dev/null`, `2>NUL`, `2>$null`,
    `2>&1`, `>&2`) — previously the single largest source of findings, all false positives, since
    none of these write to a real file.
  - Resolves and names the actual file a command targets where the command text allows it (85.6% of
    findings in the measured corpus), instead of only naming the matched shape (`cp`, `sed -i`, ...).
    Findings whose resolved path lands in an obviously transient location (`node_modules/`, `dist/`,
    `.git/`, a temp dir, or a `scratch-`-prefixed file — this project's own scratch-file convention)
    are `low`; shapes that are near-universally housekeeping with no resolvable target (`mkdir`,
    package installs, `git checkout`/`reset`) are also `low`. The rule's main case stays `medium`.
  - Collapses to one finding per distinct `(shape, resolved file)` pair per session — previously one
    per shape regardless of how many files it touched — capped at 10 with a trailing summary finding
    for any remainder, so the rule stays boundable on a PR.
  - **Known limitation, measured honestly rather than hidden:** this module's plan targeted
    `untracked-bash-mutation` accounting for under 40% of total findings (down from the original 70%).
    Against the same 67-session corpus it now accounts for **77.3%** (201/260) — higher, not lower.
    This isn't the redirect-noise fix failing; excluding null/merge redirects and capping both work as
    intended, but per-file collapsing is inherently more granular than the old one-finding-per-shape
    behavior, and this corpus (the author's own history of building Retrace) contains an unusually
    high number of genuinely distinct untracked shell mutations — ad-hoc scratch files and multi-step
    manual verification scripts are common in this project's own workflow in a way a typical
    contributor's PR is unlikely to reproduce. Even capping every session's findings from this rule
    down to 1 (which would eliminate per-file attribution entirely) only reaches 41.6%. The
    per-finding quality bar (spot-checked findings name a plausible real file; the redirect exclusion
    is exact) was prioritized over hitting the percentage target on this specific corpus.

## [0.3.0] — 2026-07-27

### Added

- `retrace check` — a check engine that runs over a session's recorded event stream and flags
  places where the agent's claims and the record disagree:
  - `edit-without-read` — a file edited without ever being read in the session.
  - `unaddressed-error` — a tool call failed and nothing later in the session responded to it.
  - `unverified-test-claim` — the assistant claimed tests or the build pass with no matching
    test/build run afterward.
  - `claimed-change-missing` — the assistant said it changed a file with no matching `file_change`
    recorded.
  - `untracked-bash-mutation` — a Bash/PowerShell command matched a filesystem-mutation shape
    (redirection, `sed -i`, `mv`/`cp`/`rm`, `git checkout`/`reset`, package installs, ...) with no
    corresponding `file_change` event.
  - `--all`, `--json`, `--fail-on <severity>`, `--disable <ruleId...>`, `--list-rules`, and exit
    codes (`0` clean, `1` findings at/above threshold, `2` operational failure) so it works as a CI
    gate.
- A findings panel in the viewer, backed by a new `/api/sessions/:id/check` endpoint — works
  identically in the served viewer and in offline `retrace export --html` files.
- A Node-version preflight: running on Node <22.5 now fails with a clear message instead of
  crashing inside `node:sqlite`.
- Self-populating first run: `retrace ui` auto-imports from `~/.claude/projects` when the store is
  empty, instead of opening a silent blank page (`--no-import` to skip).
- `pnpm verify:pack` — packs both packages and smoke-tests the packed tarball end to end (not just
  the source tree), catching cases where the embedded viewer build doesn't survive packing.
- `release.yml`, a tag-triggered GitHub Actions workflow that builds, tests, runs
  `pnpm verify:pack`, and publishes `retrace-core` then `retrace-cli` with npm provenance.

### Changed

- Repositioned around checking, not just recording: the README and both package descriptions now
  lead with `retrace check` rather than the timeline/replay feature set. Recording, replay, and
  comparison are still fully supported and documented, just no longer the headline.
- `packages/core` and `packages/cli` `keywords` now include `code-review`, `audit`,
  `verification`, `agent`.

### Fixed

- `retrace --version` now reports the correct, single-sourced package version (previously could
  drift from the published `package.json` version).
- npm-facing metadata (`repository`, `homepage`, `bugs`, `description`) corrected on both published
  packages.

### Removed

- `retrace replay` — the standalone command, removed in `876a3da` and never announced until now.
  Its functionality lives on as the replay cursor built into every session's view in `retrace ui`
  and in `retrace export` — no separate command is needed to step through a session, reconstruct
  the working tree, or jump to failures.

## [0.2.0] and earlier

Pre-dates this changelog. See `git log` for history: transcript import and live-capture hooks,
the timeline viewer, the tamper-evident hash chain and `retrace verify`, recording-side replay
(playback controls, working-tree reconstruction, failure localization with causal traces), and
side-by-side run comparison (`retrace compare`).
