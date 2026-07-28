# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
