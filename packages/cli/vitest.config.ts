import { defineConfig } from "vitest/config";

/**
 * Several tests here (git.test.ts, commands/report.test.ts) shell out to
 * real `git` subprocesses — init, clone, push, fetch, notes — for a genuine
 * round-trip rather than mocking git away, since the subprocess behavior
 * itself (argument handling, exit codes, stdin piping) is what's under
 * test. Under CI's shared/contended load — the root `pnpm test` runs
 * core/cli/viewer's suites concurrently — those subprocesses have been
 * observed missing vitest's 5000ms default and failing the whole release
 * workflow on nothing more than runner contention, not a real hang.
 * Bumped rather than mocked away.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
