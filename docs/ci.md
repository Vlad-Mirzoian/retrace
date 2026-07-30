# Using Retrace in CI

This is the setup guide for the GitHub Action (`action.yml`). If you just want the short version,
see [Use it in CI](../README.md#use-it-in-ci) in the README — this document covers the same ground
in more depth, plus the prerequisite step that trips up a first install.

## What it surfaces, and what it deliberately does not

On a pull request, the Action posts:

- **Inline annotations** on the changed files — one per finding Retrace could resolve to a
  repo-relative path, capped by default at 20.
- **A job summary** — a table of every finding (including ones that couldn't be annotated), which
  rules ran and which were skipped, and a `retrace ui` / session-id pointer for anyone who wants full
  context.

Both come from a `RetraceReport`: findings and identifiers only. **No prompt text, no reasoning, no
tool output, and no diff content ever appear anywhere the Action writes.** This isn't an
oversight to fix later — reviewers of agent-authored PRs measurably do not want session context in
the review; they want to know what changed and whether the account of it holds up. The full
transcript stays local and reachable only via `retrace ui`, one command a reviewer runs themselves.

What it does not do: block a merge by default, run on anything other than a `pull_request` event,
aggregate findings by author (a per-developer view of this data is exactly the kind of thing the EU
AI Act's Annex III treats as high-risk worker-performance evaluation — Retrace stays repo-level,
deliberately), or send anything off the runner. No network calls beyond `npm`/`npx` resolving
`retrace-cli` and the `git fetch`/`git diff` already described below.

## The prerequisite: someone has to publish a report

**This is the step that decides whether the Action looks broken or looks useful on day one.** CI has
no access to `~/.retrace` — there is no store on the runner, and there never will be. So the findings
have to travel with the branch, and nothing does that automatically:

```bash
retrace report --publish
```

Run this after finishing a piece of work (or wire it into whatever you already run before opening a
PR — a `post-commit` hook, a git alias, a script). It writes the findings for HEAD's commit range to
`refs/notes/retrace` and pushes that ref in the same command. Until you do this at least once, the
Action's very first runs will show a neutral message and a green check — **that is the correct,
expected behavior for a repository that hasn't published anything yet, not a sign the Action is
broken.** See [Getting the report to CI](../README.md#getting-the-report-to-ci) in the README for the
full mechanics (why git notes, what a rebase does to them, the file-based fallback if notes don't work
in your setup).

If you'd rather not run this by hand every time, that's a workflow decision for your own repo (a
pre-push hook, a step in whatever CI job builds your branch) — Retrace does not install one for you.
`retrace init` already asks for a fair amount of trust by editing your Claude Code settings; reaching
into your git hooks or push workflow on top of that, unasked, is further than it should go.

## The workflow

```yaml
on: pull_request

permissions:
  contents: read # nothing more is needed — no checks:write, no PAT, no GitHub App

jobs:
  retrace:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history — the action diffs base...head and fetches git notes

      - uses: actions/setup-node@v4
        with:
          node-version: "22" # node:sqlite (used by retrace-cli) needs >=22.5

      - uses: Vlad-Mirzoian/retrace@v0
```

`fetch-depth: 0` matters: `actions/checkout` defaults to a shallow clone, and the action needs the
PR's full base...head history both to compute the changed-files diff annotations are filtered against
and to fetch `refs/notes/retrace`, which lives outside the commit graph a shallow clone would give you.

This is the same file dogfooded in this repository at
[`.github/workflows/example-retrace-check.yml`](../.github/workflows/example-retrace-check.yml) — it
uses `./` instead of `Vlad-Mirzoian/retrace@v0` there, since that's this repo checking its own action
source rather than a tagged release.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `fail-on` | `high` | Exit non-zero when a finding at or above this severity exists (`high\|medium\|low\|never`). Only matters if you also mark the check *required* — see below before doing that. |
| `max-annotations` | `20` | Cap on inline annotations posted to the diff. A truncated list is noted in the job summary, never silently dropped. |
| `disable` | *(none)* | Space-separated rule ids to skip, e.g. `disable: "unverified-test-claim edit-without-read"`. |
| `notes-ref` | `retrace` | The git-notes ref the report was published under. Only change this if you also passed `--notes-ref` to `retrace report --publish`. |
| `version` | pinned to the current release | `retrace-cli` version to run, via `npx retrace-cli@<version>`. Pinned deliberately — an Action run should not change behavior under you without a version bump you chose. Bump it yourself when you want the update; don't set it to `latest`. |

## Tuning `fail-on`

`high` (the default) means: the session ended in a state the agent's own account does not match, and
nothing in the record resolves it — a failed test/build run nothing responded to, or a claim that
directly contradicts a recorded failure. That's the bar module 02 was built to make meaningful, and
it's a reasonable default to fail the *check* on (not the merge — see below).

If your repository's agent workflow legitimately produces a lot of `medium` findings you don't want in
red (real behavioral issues with a plausible benign explanation — worth a look, not worth a failing
check), leave `fail-on: high`. If you want the check to only ever show green regardless of severity
(informational only, annotations and summary still post), set `fail-on: never`.

## Disabling a noisy rule

Every rule can produce false positives in some repositories more than others — `untracked-bash-mutation`
in particular is tuned against a general corpus, not yours. If a specific rule is consistently wrong for
how your team works, disable it rather than living with the noise:

```yaml
- uses: Vlad-Mirzoian/retrace@v0
  with:
    disable: "untracked-bash-mutation"
```

Run `npx retrace-cli check --list-rules` locally to see every rule id, its default severity, and what
it checks for before deciding what to disable.

## Should I make this required?

**No — not at first, and maybe not ever.** Nothing in this repository's tooling, documentation, or
default configuration suggests marking the Retrace check as a required status check in branch
protection, and that's deliberate:

- **The moment a check is required, one false positive blocks a merge.** The check-tuning work this
  project ships (modules 01–03) measurably reduced false-positive noise, but "measurably reduced" is
  not "zero," and a required check with any false-positive rate becomes the thing a team routes around
  or disables the first time it blocks something that was actually fine.
- **A failing (non-required) check and a blocked merge are different things**, and this Action is
  built to keep them different: `fail-on` controls whether the check shows red, branch protection
  controls whether red blocks anything. Leaving it non-required lets the check accumulate a track
  record — is it usually right? — before anyone bets a merge on it.
- If, after real use, a specific rule at a specific severity has proven itself trustworthy enough to
  gate on, that's a decision to make deliberately and narrowly (e.g. only `high` from
  `unaddressed-error`), not by making the whole check required wholesale.
