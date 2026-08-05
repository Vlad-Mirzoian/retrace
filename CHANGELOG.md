# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.1] — 2026-08-05

### Fixed

- `retrace import --projects-dir <path>` pointing at a directory that doesn't exist (or isn't a
  directory) now fails immediately with a clear message and exit code `2`, instead of silently
  reporting `Scanned 0 file(s), imported 0 event(s)...` — `findTranscripts`'s own "missing dir → []"
  leniency (correct for the *default* `~/.claude/projects`, which legitimately may not exist yet on a
  fresh install) was masking an explicit `--projects-dir` typo as if nothing were wrong.
- `retrace export --output <path>` where `<path>` is an existing directory now writes the default
  filename (`<sessionId>.json`/`.html`) inside it, matching what happens when `--output` is omitted
  entirely — previously this crashed with a raw `EISDIR: illegal operation on a directory`.
- `retrace reimport [--all]` no longer prints a redundant, differently-worded line per source file
  (`<id>: imported N event(s) from M new line(s)`, from `importFile`'s own internal logging) alongside
  its own `<id>: re-imported N event(s) from K file(s)` summary — the console logger is no longer
  forwarded into the reimport's internal `importFile` calls, since the summary line already reports
  everything that matters.
- A tamper edit to `events.jsonl` that changes a line's byte length (not just swaps same-length
  characters — the common real-world mistake, since `RetraceStore` indexes each event by a fixed byte
  offset recorded at append time) previously crashed `retrace verify`/`retrace verify --all` with a raw
  `SyntaxError`, and crashed the web viewer's `/api/sessions/:id/events`, `/verify`, and `/check` routes
  with an opaque `500`, blanking the entire session page behind two confusing, unrelated-looking error
  messages. `RetraceStore.readEvents` now stops cleanly at the first row it can't read (further offsets
  are just as likely to be desynced, risking silently-wrong data rather than a clean failure) and
  reports exactly which `seq` and why via a new `truncatedAt: { seq, reason }`, threaded through
  `collectAllEvents`/`checkSession`/`exportSession`/`verifySession` and the three HTTP routes above.
  `retrace verify`'s tampered output now names the real `seq` that failed, replacing a `-1` placeholder
  used previously when the read itself (not a hash mismatch) was the problem. The viewer renders
  whatever prefix of the session *is* readable — a working, if partial, timeline — with a
  `Session truncated at seq N: …` banner, instead of a blank page; the same banner appears in
  `retrace export --html`'s offline bundle. `retrace export`'s console output also notes the truncation
  when it applies.
- The Failures panel's highlight now derives directly from the shared replay cursor, so jumping to an
  error via the replay controls' **Next error**/**Previous error** (or any other cursor move — a
  timeline row, the scrubber) highlights the matching failure — previously only a click inside the
  panel itself set the highlight, so a control-driven jump landed on the right event without showing
  which failure it was.
- Manually scrolling the timeline (wheel/touch) now clears the Failures/Findings panels' selected-item
  highlight, instead of leaving it pinned to whatever was last clicked even after scrolling away to look
  at something else; the next seek re-establishes it (`useClearSelectionOnScroll`).
- The replay controls' **First step** button (and any jump back to `seq` 0) now scrolls the whole page
  to the top, instead of centering the first timeline row mid-viewport and leaving the page header
  scrolled out of view above it.
- CI: `release.yml`'s publish steps are now idempotent — each checks the registry for the current
  version before `npm publish`, so re-running the job after a partial failure (e.g. `retrace-core`
  published, `retrace-cli` didn't — GitHub Actions can't resume a job from its failed step) skips the
  already-published package instead of failing outright on npm's immutable-version rule.
- CI: raised `retrace-cli`'s test timeout to 30s (from vitest's 5000ms default, in a new
  `packages/cli/vitest.config.ts`) — tests that shell out to real `git` subprocesses (`git.test.ts`,
  `commands/report.test.ts`) were intermittently missing the default under CI's shared, contended load
  (the root `pnpm test` runs all three packages' suites concurrently), failing the release workflow on
  runner contention rather than a real hang.

### Added

- A search box on the session list, filtering by project, branch, title, or path — narrows the visible
  list to whatever matches, case-insensitively.
- A footer on every viewer page and in the offline HTML export, linking to the project's GitHub and the
  CI setup guide.

## [0.4.0] — 2026-07-29

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
  contract as `retrace check` (`0` clean, `1` breaches `--fail-on`, `2` operational failure) — including
  for a store that can't be opened, which previously fell through as an uncaught exception (exit `1`,
  no clean message) instead of the documented `2`, since `createStore()` wasn't wrapped in its own
  try/catch the way `check`'s is. See
  [Getting the report to CI](README.md#getting-the-report-to-ci) in the README for the push/fetch
  requirement and the file fallback.
- `retrace report --format github` — turns a `RetraceReport` into what a GitHub Actions job can
  display: workflow-command annotations (`::warning file=…,line=…,title=…::message`) on stdout and a
  markdown job summary written to `$GITHUB_STEP_SUMMARY` (stdout as a fallback, so the command stays
  usable locally). No token, no `checks: write` permission, and no GitHub App install required —
  annotations attach to the job's own check rather than a separate Check Run. Severity maps to level
  (`high`→`error`, `medium`→`warning`, `low`→`notice`), but the level is purely cosmetic: only the
  process's exit code (governed by `--fail-on`, unchanged) fails a job. A finding can only be annotated
  when it has a repo-relative path and that path falls inside the commit range's diff (computed via a
  new `changedFiles` git helper, three-dot against the merge-base — the same diff a PR shows); every
  other finding stays in the summary table with a note explaining why it wasn't annotated. No line
  number is fabricated — `CheckFinding` anchors to an event `seq`, not a source line, so every
  annotation lands on line 1. Annotations are capped at 20 by default (`--max-annotations` overrides),
  with the omitted count surfaced in the summary rather than silently dropped. The summary carries
  findings and identifiers only — no transcript text, reasoning, or diff content, ever. New
  `packages/core/src/ci/github.ts` (`formatGithub`, pure, no Node imports, re-exported from
  `browser.ts`) does the formatting; `program.ts` wires stdout/file placement and `--format`/
  `--max-annotations` validation. See [CI output format](README.md#ci-output-format) in the README.
- **A composite GitHub Action** (`action.yml`, repo root) — the shipped Direction A surface: findings
  posted on the PR itself, with no GitHub App install, no `checks: write` permission, and no PAT (a
  composite action running `npx retrace-cli@<version> report --read ... --format github` needs
  `contents: read` alone). Inputs: `fail-on` (default `high`), `max-annotations` (default `20`),
  `disable`, `notes-ref` (default `retrace`), and `version` — pinned to a concrete release by default,
  deliberately not `latest`, so a workflow's behavior never changes without someone choosing to bump
  it. Guards against running outside a `pull_request` event, and tolerates `git fetch`ing a notes ref
  that doesn't exist yet on the remote (the expected state for every repository on its first run,
  before anyone has published a report) rather than failing — reuses `retrace report --read`'s
  existing "no report" handling rather than duplicating that check. Dogfooded on this repository's own
  PRs via `.github/workflows/example-retrace-check.yml` (referencing the local action source, `./`,
  rather than a tag that doesn't exist yet). See [Use it in CI](README.md#use-it-in-ci) in the README
  and the full guide at [`docs/ci.md`](docs/ci.md), including the explicit "should I make this
  required?" answer (no).
- `retrace report`'s `--notes-ref <ref>` (default `retrace`) — which git-notes ref to read from and
  write to, for a repository that already uses the default one for something else. Threaded through
  `writeReportNote`/`readReportNote`/`publishReportNote`, and exposed as the Action's `notes-ref`
  input above.
- With `--read`, `retrace report`'s existing `--base`/`--head` options now also override which diff
  `--format github` filters annotations against — previously always the stored report's own `range`,
  which reflects whatever base/head the developer had locally when they published it, not necessarily
  a PR's actual base. The Action passes the PR's real `base.sha`/`head.sha` explicitly for this reason.
- `--disable <ruleId...>` now also applies to `--read`, dropping that rule's findings from what's
  printed (in any `--format`) and from the `--fail-on` breach check — previously `--disable` was
  silently ignored in `--read` mode, since it only ever reached `checkSession` on the report-generation
  path, and a *read* report has no session left to re-run a rule against. The Action's `disable` input
  (and `docs/ci.md`'s "disabling a noisy rule" guidance) depend on this working, since the Action
  always runs `retrace report --read`, never a fresh generate.

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
  - Resolves and names the actual file a command targets where the command text allows it, instead of
    only naming the matched shape (`cp`, `sed -i`, ...) — but never by guessing at an unexpanded shell
    variable (`$f`, `$RETRACE_HOME`, `$env:TEMP\x`): a variable names whatever it holds at runtime,
    which this rule has no way to know, so a target that's still a variable reference bails out to no
    path rather than being reported as a literal filename named `$f`.
  - Two related parser fixes, both found by spot-checking findings against their sessions by hand:
    a heredoc body (`cat > file <<'EOF' ... EOF`) is no longer scanned line-by-line for further
    redirects once the heredoc starts, so an embedded comparison operator in the piped-in script
    (`if (x > 100000)`, `if count >= 8:`) can no longer be misread as a second shell redirect; and a
    `#`-comment is stripped before scanning, so descriptive prose above a command (`# ... <tarball>
    reads ...`) can no longer supply a bogus redirect target either.
  - Findings whose resolved path lands in an obviously transient location (`node_modules/`, `dist/`,
    `.git/`, `.retrace/` — this tool's own app-data directory, a temp dir, a `scratch-`-prefixed file,
    or a TypeScript `*.tsbuildinfo` cache) are `low`, and — unlike a resolved path elsewhere — collapse
    to one finding per shape per session regardless of how many distinct transient paths were touched,
    the same as a housekeeping shape with no resolvable target. A non-transient resolved path still
    gets its own finding per distinct file, since that's what makes the rule usable as a PR annotation
    (module 06). Shapes that are near-universally housekeeping with no resolvable target (`mkdir`,
    package installs, `git checkout`/`reset`) are also `low`. The rule's main case stays `medium`.
  - Capped at 10 findings per session with a trailing summary finding for any remainder, so the rule
    stays boundable on a PR.
  - **Known limitation, measured honestly rather than hidden:** this module's plan targeted
    `untracked-bash-mutation` accounting for under 40% of total findings (down from the original 70%).
    Against the same 67-session corpus it now accounts for **71.1%** (145/204) — better than the 77.3%
    this module regressed to when per-file collapsing first landed, and better than the original 70%
    baseline, but still not under 40%. This corpus (the author's own history of building Retrace) is
    unusually shell-mutation-heavy — ad-hoc scratch files and multi-step manual verification scripts
    are routine in this project's own workflow in a way a typical contributor's PR is unlikely to
    reproduce — and per-file collapsing (needed for module 06's per-file PR annotations) is inherently
    more granular than one-finding-per-shape. Collapsing every transient-path finding to one-per-shape
    (this pass's main lever) recovered most of the regression without giving up per-file attribution
    for the paths that matter; collapsing everything, including real project files, was rejected
    because it would defeat the point of resolving a path at all. 63.4% of the rule's findings still
    carry a resolved path — down from a prior pass's 85.6%, but that figure included roughly a quarter
    unexpanded shell variables reported as if they were literal filenames (`$f`, `$RETRACE_HOME`); the
    smaller number is the one that's actually clean, confirmed by hand against ten findings spread
    across the corpus.

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
