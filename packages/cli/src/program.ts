import { appendFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import {
  DEFAULT_MAX_ANNOTATIONS,
  formatGithub,
  RetraceStore,
  RULES,
  type CheckOptions,
  type CheckReport,
  type CheckRule,
  type RetraceReport,
  type Severity,
} from "retrace-core";
import type {
  ImportOptions,
  ImportSummary,
  WatchHandle,
  WatchImportOptions,
} from "./commands/import.js";
import type { InitOptions, InitResult } from "./commands/init.js";
import type { UiHandle, UiOptions } from "./commands/ui.js";
import type { ExportOptions, ExportResult } from "./commands/export.js";
import type { ReimportAllSummary, ReimportResult } from "./commands/reimport.js";
import type { VerifyAllSummary, VerifyResult } from "./commands/verify.js";
import type { CheckAllSummary, CheckSessionResult } from "./commands/check.js";
import type { CompareOptions } from "./commands/compare.js";
import type { DeleteSessionsSummary } from "./commands/delete.js";
import type { ResetResult } from "./commands/reset.js";
import type { LinkAllSummary, LinkCommandOptions, LinkSessionResult } from "./commands/link.js";
import type { GenerateReportOptions, GenerateReportResult } from "./commands/report.js";
import { confirm } from "./confirm.js";
import { CLI_VERSION } from "./version.js";

// Command implementations are pulled in only when their command actually runs.
// `retrace hook` is spawned by Claude Code once per tool call and sits on the
// critical path of every file edit, so it must not pay to load the HTTP server
// (hono, @hono/node-server) or the browser launcher (open) that only `ui` needs.
// Type-only imports above are erased at compile time and cost nothing.
const lazy = {
  import: () => import("./commands/import.js"),
  list: () => import("./commands/list.js"),
  init: () => import("./commands/init.js"),
  hook: () => import("./commands/hook.js"),
  ui: () => import("./commands/ui.js"),
  export: () => import("./commands/export.js"),
  reimport: () => import("./commands/reimport.js"),
  verify: () => import("./commands/verify.js"),
  compare: () => import("./commands/compare.js"),
  check: () => import("./commands/check.js"),
  delete: () => import("./commands/delete.js"),
  reset: () => import("./commands/reset.js"),
  link: () => import("./commands/link.js"),
  report: () => import("./commands/report.js"),
};

export interface ProgramDeps {
  createStore?: () => RetraceStore;
  importOnce?: (store: RetraceStore, options?: ImportOptions) => ImportSummary;
  watchImport?: (store: RetraceStore, options?: WatchImportOptions) => WatchHandle;
  initHooks?: (options: InitOptions) => InitResult;
  runHook?: (createStore: () => RetraceStore) => Promise<void>;
  startUi?: (store: RetraceStore, options?: UiOptions) => Promise<UiHandle>;
  exportSession?: (store: RetraceStore, sessionId: string, options: ExportOptions) => ExportResult;
  reimportSession?: (
    store: RetraceStore,
    idOrPrefix: string,
    log?: (message: string) => void,
  ) => ReimportResult;
  reimportAll?: (store: RetraceStore, log?: (message: string) => void) => ReimportAllSummary;
  verifySession?: (store: RetraceStore, idOrPrefix: string) => VerifyResult;
  verifyAll?: (store: RetraceStore) => VerifyAllSummary;
  checkSession?: (
    store: RetraceStore,
    idOrPrefix: string,
    options?: CheckOptions,
  ) => CheckSessionResult;
  checkAll?: (
    store: RetraceStore,
    options?: CheckOptions,
    failOn?: Severity | "never",
  ) => CheckAllSummary;
  startCompare?: (
    store: RetraceStore,
    idAOrPrefix: string,
    idBOrPrefix: string,
    options?: CompareOptions,
  ) => Promise<UiHandle>;
  deleteSessions?: (store: RetraceStore, idsOrPrefixes: string[]) => DeleteSessionsSummary;
  resetStore?: (store: RetraceStore) => ResetResult;
  linkSession?: (
    store: RetraceStore,
    idOrPrefix: string,
    options?: LinkCommandOptions,
  ) => LinkSessionResult;
  linkAll?: (store: RetraceStore, options?: LinkCommandOptions) => LinkAllSummary;
  generateReport?: (
    store: RetraceStore,
    cwd: string,
    options?: GenerateReportOptions,
  ) => GenerateReportResult;
  writeReportNote?: (repoRoot: string, sha: string, report: RetraceReport) => void;
  readReportNote?: (repoRoot: string, sha: string) => RetraceReport | undefined;
  publishReportNote?: (repoRoot: string, remote: string) => void;
  resolveRepoRoot?: (cwd: string) => string;
  changedFilesInRange?: (repoRoot: string, range: RetraceReport["range"]) => string[] | undefined;
  /** Yes/no prompt for `delete`/`reset` when `--yes` isn't given. Injectable so tests never block on real stdin. */
  confirm?: (question: string) => Promise<boolean>;
  /** Absolute path to the embedded viewer build; passed by cli.ts (see server/app.ts). */
  viewerDir?: string;
  /** Absolute path to the embedded single-file export template; passed by cli.ts. */
  viewerExportDir?: string;
}

interface ImportCommandOptions {
  watch?: boolean;
  projectsDir?: string;
}

interface InitCommandOptions {
  global?: boolean;
}

interface PortAndOpenOptions {
  port?: string;
  open?: boolean;
}

// The `--no-import` auto-import suppression is `ui`-only, per the module 03
// plan ("do not add this to any other command") — `compare` keeps the
// smaller PortAndOpenOptions shape so that constraint is visible in the types.
interface UiCommandOptions extends PortAndOpenOptions {
  import?: boolean;
}

interface ExportCommandOptions {
  json?: boolean;
  output?: string;
}

interface ReimportCommandOptions {
  all?: boolean;
}

interface VerifyCommandOptions {
  all?: boolean;
}

interface CheckCommandOptions {
  all?: boolean;
  json?: boolean;
  failOn?: string;
  disable?: string[];
  listRules?: boolean;
}

interface YesOption {
  yes?: boolean;
}

interface LinkCliOptions {
  all?: boolean;
  repo?: string;
  grace?: string;
  json?: boolean;
}

interface ReportCliOptions {
  base?: string;
  head?: string;
  output?: string;
  publish?: boolean;
  remote?: string;
  failOn?: string;
  disable?: string[];
  json?: boolean;
  read?: string;
  format?: string;
  maxAnnotations?: string;
}

const REPORT_FORMAT_VALUES = ["json", "github"] as const;

const FAIL_ON_VALUES = ["high", "medium", "low", "never"] as const;
const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Findings sorted for human display: worst severity first, then session order. */
function sortFindingsForDisplay(findings: CheckReport["findings"]): CheckReport["findings"] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.seq - b.seq,
  );
}

function formatFindingLine(
  finding: CheckReport["findings"][number],
  severityWidth: number,
  ruleWidth: number,
): string {
  const severity = finding.severity.padEnd(severityWidth);
  const rule = finding.ruleId.padEnd(ruleWidth);
  const seq = `seq ${String(finding.seq).padStart(4)}`;
  const subagent = finding.sidechain ? " (subagent)" : "";
  return `  ${severity}  ${rule}  ${seq}  ${finding.title}${subagent}`;
}

/**
 * Human-readable rendering of one session's check report — the target shape
 * from the module's Goal example. A clean session states the rule count
 * (not just "no findings"), so "passed" reads distinctly from "nothing was
 * actually checked". Rules that failed to run get their own `skipped:`
 * section — a rule that didn't run is not a rule that passed.
 */
function formatCheckReport(result: CheckSessionResult): string {
  const { sessionId, report } = result;
  const lines: string[] = [];

  if (report.findings.length === 0) {
    lines.push(
      `✓ ${sessionId} — no findings (${report.eventCount} event(s), ${report.rulesRun.length} rule(s) run)`,
    );
  } else {
    const sorted = sortFindingsForDisplay(report.findings);
    const severityWidth = Math.max(...sorted.map((f) => f.severity.length));
    const ruleWidth = Math.max(...sorted.map((f) => f.ruleId.length));

    lines.push(`✗ ${sessionId} — ${report.findings.length} finding(s)`, "");
    for (const finding of sorted) lines.push(formatFindingLine(finding, severityWidth, ruleWidth));
    lines.push("", "  Run `retrace ui` and open the session to inspect each finding in context.");
  }

  if (report.rulesSkipped.length > 0) {
    lines.push("", "skipped:");
    for (const skipped of report.rulesSkipped) lines.push(`  ${skipped.ruleId}: ${skipped.reason}`);
  }

  return lines.join("\n");
}

function formatRulesList(rules: CheckRule[]): string {
  const idWidth = Math.max(...rules.map((r) => r.id.length));
  return rules
    .map((r) => `${r.id.padEnd(idWidth)}  ${r.defaultSeverity.padEnd(6)}  ${r.description}`)
    .join("\n");
}

/** "✓ id: verified (N event(s))" or "✗ id: tampered at seq S — <reason>". */
function formatVerifyResult(result: VerifyResult): string {
  if (result.verification.ok) {
    return `✓ ${result.sessionId}: verified (${result.eventCount} event(s))`;
  }
  return `✗ ${result.sessionId}: tampered at seq ${result.verification.index} — ${result.verification.reason}`;
}

function formatLinkResult(result: LinkSessionResult): string {
  if (result.links.length === 0) {
    return `${result.sessionId}: no commits linked (repo: ${result.repoRoot})`;
  }
  const lines = [`${result.sessionId}: linked ${result.links.length} commit(s) (repo: ${result.repoRoot})`];
  for (const link of result.links) {
    lines.push(`  ${link.commitSha.slice(0, 10)}  ${link.confidence}`);
  }
  return lines.join("\n");
}

/** Human-readable rendering of a `RetraceReport` — like `formatCheckReport`, but spanning every session in range, so each line also names which one. */
function formatReport(report: RetraceReport): string {
  const lines: string[] = [
    `Report ${report.range.base ?? "(root)"}..${report.range.head} — ${report.sessions.length} session(s), ${report.findings.length} finding(s)`,
  ];

  if (report.findings.length === 0) {
    lines.push("No findings.");
  } else {
    const sorted = [...report.findings].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.seq - b.seq,
    );
    const severityWidth = Math.max(...sorted.map((f) => f.severity.length));
    for (const finding of sorted) {
      const severity = finding.severity.padEnd(severityWidth);
      const location = finding.repoPath ?? finding.path ?? finding.ruleId;
      lines.push(`  ${severity}  ${finding.sessionId.slice(0, 10)}  ${location}  ${finding.title}`);
    }
  }

  if (report.findingsOmitted) {
    lines.push(`(${report.findingsOmitted} additional finding(s) omitted — capped at assembly time)`);
  }
  if (report.rulesSkipped.length > 0) {
    lines.push("", "skipped:");
    for (const skipped of report.rulesSkipped) lines.push(`  ${skipped.ruleId}: ${skipped.reason}`);
  }

  return lines.join("\n");
}

/**
 * `--format github` output: annotation lines to stdout (workflow commands —
 * that's the whole point of this format, so nothing else shares that
 * stream), and the markdown summary to `$GITHUB_STEP_SUMMARY` when the
 * environment sets it (appended, since a job can run several
 * summary-writing steps), falling back to stdout when it isn't — so the
 * command stays inspectable when run locally, outside an Actions job.
 */
function printGithubFormat(annotationLines: string[], summaryMarkdown: string): void {
  for (const line of annotationLines) console.log(line);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${summaryMarkdown}\n`);
  } else {
    console.log(summaryMarkdown);
  }
}

/**
 * Build the `retrace` commander program. Dependencies (store construction,
 * import functions) are injectable so command wiring can be tested without
 * touching the real `~/.retrace` store or `~/.claude/projects`.
 */
export function createProgram(deps: ProgramDeps = {}): Command {
  const createStore = deps.createStore ?? (() => new RetraceStore());

  const program = new Command();
  program
    .name("retrace")
    .description("Retrace — a flight recorder for AI coding agents")
    .version(CLI_VERSION);

  program
    .command("import")
    .description("Import Claude Code transcripts into the local Retrace store")
    .option("--watch", "keep watching for new/changed transcripts")
    .option("--projects-dir <dir>", "override the Claude Code projects directory to scan")
    .action(async (opts: ImportCommandOptions) => {
      const store = createStore();
      const importOptions: ImportOptions = {
        projectsDir: opts.projectsDir,
        log: (message) => console.log(message),
      };

      if (opts.watch) {
        const { watchImport, defaultProjectsDir } = await lazy.import();
        console.log(
          `Watching ${importOptions.projectsDir ?? defaultProjectsDir()} for changes... (Ctrl+C to stop)`,
        );
        const handle = (deps.watchImport ?? watchImport)(store, importOptions);
        const stop = () => {
          handle.stop();
          store.close();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        // Intentionally does not await/return a pending promise: the watcher's
        // own fs.watch/timer handle keeps the event loop (and process) alive
        // until `stop` runs, exactly like a real long-running watch command.
        return;
      }

      const importOnce = deps.importOnce ?? (await lazy.import()).importOnce;
      try {
        const summary = importOnce(store, importOptions);
        console.log(
          `Scanned ${summary.filesScanned} file(s), imported ${summary.eventsImported} event(s) from ${summary.filesChanged} changed file(s).`,
        );
      } finally {
        store.close();
      }
    });

  program
    .command("list")
    .description("List recorded sessions, most recently started first")
    .action(async () => {
      const { formatSessionsTable } = await lazy.list();
      const store = createStore();
      try {
        console.log(formatSessionsTable(store.listSessions()));
      } finally {
        store.close();
      }
    });

  program
    .command("init")
    .description("Install Retrace hooks into Claude Code settings")
    .option(
      "--global",
      "write to user settings (~/.claude/settings.json) instead of the project",
    )
    .action(async (opts: InitCommandOptions) => {
      const { initHooks, resolveSettingsPath } = await lazy.init();
      const settingsPath = resolveSettingsPath({ global: opts.global });
      const result = (deps.initHooks ?? initHooks)({ settingsPath });
      if (!result.changed) {
        console.log(`Retrace hooks already present in ${result.settingsPath}`);
        return;
      }
      console.log(`${result.created ? "Created" : "Updated"} ${result.settingsPath}`);
      if (result.backupPath) console.log(`Backed up previous settings to ${result.backupPath}`);
      console.log("Retrace will now capture file snapshots and session boundaries.");
    });

  program
    .command("hook")
    .description("Handle a Claude Code hook event from stdin (invoked by installed hooks)")
    .action(async () => {
      const runHook = deps.runHook ?? (await lazy.hook()).runHook;
      await runHook(createStore);
    });

  program
    .command("ui")
    .description("Serve the Retrace session viewer")
    .option("--port <port>", "port to listen on (default: an OS-assigned free port)")
    .option("--no-open", "don't launch the system browser")
    .option("--no-import", "don't auto-import from ~/.claude/projects when the store is empty")
    .action(async (opts: UiCommandOptions) => {
      const startUi = deps.startUi ?? (await lazy.ui()).startUi;
      const store = createStore();
      const port = opts.port !== undefined ? Number(opts.port) : undefined;
      const handle = await startUi(store, {
        port,
        openBrowser: opts.open,
        autoImport: opts.import,
        viewerDir: deps.viewerDir,
      });
      const stop = async () => {
        await handle.stop();
        store.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      // As with `import --watch`, the server's own listening socket keeps the
      // process alive until `stop` runs — nothing to await here.
    });

  program
    .command("export <sessionId>")
    .description("Export a session as JSON or a self-contained HTML file (default: HTML)")
    .option("--json", "export as a plain JSON file instead of HTML")
    .option("--output <path>", "output file path (default: <sessionId>.json or .html)")
    .action(async (sessionId: string, opts: ExportCommandOptions) => {
      const exportSession = deps.exportSession ?? (await lazy.export()).exportSession;
      const store = createStore();
      try {
        const result = exportSession(store, sessionId, {
          format: opts.json ? "json" : "html",
          output: opts.output,
          viewerExportDir: deps.viewerExportDir,
        });
        console.log(`Exported ${result.eventCount} event(s) to ${result.path}`);
      } finally {
        store.close();
      }
    });

  program
    .command("reimport [sessionId]")
    .description(
      "Delete a session's stored data and re-import it from its source transcript " +
        "(use after fixing a parser bug that already wrote bad data)",
    )
    .option("--all", "reimport every session that has a known source transcript")
    .action(async (sessionId: string | undefined, opts: ReimportCommandOptions) => {
      const mod = await lazy.reimport();
      const reimportSession = deps.reimportSession ?? mod.reimportSession;
      const reimportAll = deps.reimportAll ?? mod.reimportAll;
      const store = createStore();
      const log = (message: string) => console.log(message);
      try {
        if (opts.all) {
          const { results, skipped, failed } = reimportAll(store, log);
          for (const r of results) {
            console.log(
              `${r.sessionId}: re-imported ${r.eventsImported} event(s) from ${r.importPaths.length} file(s)`,
            );
          }
          if (failed.length > 0) {
            for (const f of failed) console.error(`${f.sessionId}: FAILED — ${f.error}`);
            process.exitCode = 1;
          }
          if (skipped.length > 0) {
            console.log(
              `Skipped ${skipped.length} session(s) with no known source transcript: ${skipped.join(", ")}`,
            );
          }
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to reimport every session.");
          process.exitCode = 1;
          return;
        }

        const result = reimportSession(store, sessionId, log);
        if (result.importPaths.length === 0) {
          console.log(`${result.sessionId}: deleted (no known source transcript to re-import from)`);
        } else {
          console.log(
            `${result.sessionId}: re-imported ${result.eventsImported} event(s) from ${result.importPaths.length} file(s)`,
          );
        }
      } finally {
        store.close();
      }
    });

  program
    .command("verify [sessionId]")
    .description("Verify a session's tamper-evident hash chain")
    .option("--all", "verify every recorded session")
    .action(async (sessionId: string | undefined, opts: VerifyCommandOptions) => {
      const mod = await lazy.verify();
      const verifySession = deps.verifySession ?? mod.verifySession;
      const verifyAll = deps.verifyAll ?? mod.verifyAll;
      const store = createStore();
      try {
        if (opts.all) {
          const { results, failed } = verifyAll(store);
          for (const result of results) console.log(formatVerifyResult(result));
          if (failed.length > 0) process.exitCode = 1;
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to verify every session.");
          process.exitCode = 1;
          return;
        }

        const result = verifySession(store, sessionId);
        console.log(formatVerifyResult(result));
        if (!result.verification.ok) process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  program
    .command("check [sessionId]")
    .description("Run the check engine over a session's event stream")
    .option("--all", "check every recorded session")
    .option("--json", "emit the raw report(s) as JSON")
    .option(
      "--fail-on <severity>",
      "exit non-zero when a finding at or above this severity exists (high|medium|low|never). " +
        "high: unresolved or contradicted work a reviewer should see before merging. " +
        "medium: a real issue with a plausible benign explanation. low: an unconfirmable claim.",
      "high",
    )
    .option("--disable <ruleId...>", "skip specific rules")
    .option("--list-rules", "print every rule id, severity, and description, then exit")
    .action(async (sessionId: string | undefined, opts: CheckCommandOptions) => {
      if (opts.listRules) {
        console.log(formatRulesList(RULES));
        return;
      }

      const failOnRaw = opts.failOn ?? "high";
      if (!(FAIL_ON_VALUES as readonly string[]).includes(failOnRaw)) {
        console.error(
          `Invalid --fail-on value "${failOnRaw}" — expected one of: ${FAIL_ON_VALUES.join(", ")}.`,
        );
        process.exitCode = 2;
        return;
      }
      const failOn = failOnRaw as Severity | "never";

      const mod = await lazy.check();
      const checkSession = deps.checkSession ?? mod.checkSession;
      const checkAll = deps.checkAll ?? mod.checkAll;
      const checkOptions: CheckOptions = opts.disable ? { disabled: opts.disable } : {};

      let store: RetraceStore;
      try {
        store = createStore();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
        return;
      }

      try {
        if (opts.all) {
          const { results, failed } = checkAll(store, checkOptions, failOn);
          if (opts.json) {
            console.log(JSON.stringify(results.map((r) => r.report)));
          } else {
            console.log(results.map((r) => formatCheckReport(r)).join("\n\n"));
          }
          if (failed.length > 0) process.exitCode = 1;
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to check every session.");
          process.exitCode = 1;
          return;
        }

        const result = checkSession(store, sessionId, checkOptions);
        if (opts.json) {
          console.log(JSON.stringify(result.report));
        } else {
          console.log(formatCheckReport(result));
        }
        if (mod.breachesThreshold(result.report, failOn)) process.exitCode = 1;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      } finally {
        store.close();
      }
    });

  program
    .command("compare <idA> <idB>")
    .description("Open the viewer's side-by-side comparison of two recorded sessions")
    .option("--port <port>", "port to listen on (default: an OS-assigned free port)")
    .option("--no-open", "don't launch the system browser")
    .action(async (idA: string, idB: string, opts: PortAndOpenOptions) => {
      const startCompare = deps.startCompare ?? (await lazy.compare()).startCompare;
      const store = createStore();
      const port = opts.port !== undefined ? Number(opts.port) : undefined;
      const handle = await startCompare(store, idA, idB, {
        port,
        openBrowser: opts.open,
        viewerDir: deps.viewerDir,
      });
      const stop = async () => {
        await handle.stop();
        store.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      // As with `ui`, the server's own listening socket keeps the process
      // alive until `stop` runs — nothing to await here.
    });

  program
    .command("delete <sessionId...>")
    .description("Permanently delete one or more sessions and their recorded events")
    .option("-y, --yes", "skip the confirmation prompt")
    .action(async (sessionIds: string[], opts: YesOption) => {
      const store = createStore();
      try {
        if (!opts.yes) {
          const confirmFn = deps.confirm ?? confirm;
          const label = sessionIds.length === 1 ? "1 session" : `${sessionIds.length} sessions`;
          const ok = await confirmFn(
            `Permanently delete ${label} (${sessionIds.join(", ")})? This cannot be undone.`,
          );
          if (!ok) {
            console.log("Aborted — nothing was deleted.");
            return;
          }
        }

        const deleteSessions = deps.deleteSessions ?? (await lazy.delete()).deleteSessions;
        const { deleted, failed } = deleteSessions(store, sessionIds);
        for (const id of deleted) console.log(`${id}: deleted`);
        if (failed.length > 0) {
          for (const f of failed) console.error(`${f.input}: FAILED — ${f.error}`);
          process.exitCode = 1;
        }
      } finally {
        store.close();
      }
    });

  program
    .command("reset")
    .description(
      "Permanently delete the entire Retrace store — every session and every recorded " +
        "snapshot, everything in ~/.retrace (or $RETRACE_HOME)",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .action(async (opts: YesOption) => {
      const store = createStore();
      if (!opts.yes) {
        const confirmFn = deps.confirm ?? confirm;
        const ok = await confirmFn(
          `Permanently delete everything in ${store.homeDir}? This cannot be undone.`,
        );
        if (!ok) {
          console.log("Aborted — nothing was deleted.");
          store.close();
          return;
        }
      }

      const resetStore = deps.resetStore ?? (await lazy.reset()).resetStore;
      const result = resetStore(store);
      console.log(`Deleted ${result.sessionCount} session(s) and removed ${result.homeDir}.`);
    });

  program
    .command("link [sessionId]")
    .description("Link a session to the git commit(s) it plausibly produced")
    .option("--all", "link every recorded session")
    .option("--repo <dir>", "override the git repository directory (default: the session's recorded cwd)")
    .option("--grace <minutes>", "how long after a session ends a commit still counts as its work (default: 30)")
    .option("--json", "emit the raw link result(s) as JSON")
    .action(async (sessionId: string | undefined, opts: LinkCliOptions) => {
      const mod = await lazy.link();
      const linkSession = deps.linkSession ?? mod.linkSession;
      const linkAll = deps.linkAll ?? mod.linkAll;
      const linkOptions: LinkCommandOptions = {
        repoDir: opts.repo,
        graceMinutes: opts.grace !== undefined ? Number(opts.grace) : undefined,
      };

      const store = createStore();
      try {
        if (opts.all) {
          const { results, skipped } = linkAll(store, linkOptions);
          if (opts.json) {
            console.log(JSON.stringify(results));
          } else {
            for (const result of results) console.log(formatLinkResult(result));
            if (skipped.length > 0) {
              console.log(`\nSkipped ${skipped.length} session(s):`);
              for (const s of skipped) console.log(`  ${s.sessionId}: ${s.reason}`);
            }
          }
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to link every session.");
          process.exitCode = 1;
          return;
        }

        const result = linkSession(store, sessionId, linkOptions);
        console.log(opts.json ? JSON.stringify(result) : formatLinkResult(result));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      } finally {
        store.close();
      }
    });

  program
    .command("report")
    .description("Assemble a portable findings report for a commit range and write it as a git note")
    .option("--base <ref>", "base of the commit range (default: merge-base with the default branch, or HEAD~1)")
    .option("--head <ref>", "head of the commit range", "HEAD")
    .option("--output <path>", "write the report JSON to a file instead of a git note")
    .option("--publish", "push the note to --remote after writing it (ignored with --output)")
    .option("--remote <name>", "remote to push the note to with --publish", "origin")
    .option(
      "--fail-on <severity>",
      "exit non-zero when a finding at or above this severity exists (high|medium|low|never)",
      "high",
    )
    .option("--disable <ruleId...>", "skip specific rules")
    .option("--json", "print the report as JSON instead of a human-readable summary")
    .option("--read <sha>", "print the stored report note for <sha> instead of generating a new one")
    .option(
      "--format <fmt>",
      "output format: json (default, respects --json/--output) or github (workflow-command annotations + $GITHUB_STEP_SUMMARY)",
      "json",
    )
    .option(
      "--max-annotations <n>",
      `cap on emitted --format github annotations (default ${DEFAULT_MAX_ANNOTATIONS})`,
    )
    .action(async (opts: ReportCliOptions) => {
      const failOnRaw = opts.failOn ?? "high";
      if (!(FAIL_ON_VALUES as readonly string[]).includes(failOnRaw)) {
        console.error(
          `Invalid --fail-on value "${failOnRaw}" — expected one of: ${FAIL_ON_VALUES.join(", ")}.`,
        );
        process.exitCode = 2;
        return;
      }
      const failOn = failOnRaw as Severity | "never";

      const formatRaw = opts.format ?? "json";
      if (!(REPORT_FORMAT_VALUES as readonly string[]).includes(formatRaw)) {
        console.error(
          `Invalid --format value "${formatRaw}" — expected one of: ${REPORT_FORMAT_VALUES.join(", ")}.`,
        );
        process.exitCode = 2;
        return;
      }
      const format = formatRaw as (typeof REPORT_FORMAT_VALUES)[number];

      let maxAnnotations: number | undefined;
      if (opts.maxAnnotations !== undefined) {
        maxAnnotations = Number(opts.maxAnnotations);
        if (!Number.isInteger(maxAnnotations) || maxAnnotations < 0) {
          console.error(`Invalid --max-annotations value "${opts.maxAnnotations}" — expected a non-negative integer.`);
          process.exitCode = 2;
          return;
        }
      }

      const mod = await lazy.report();
      const changedFilesInRange = deps.changedFilesInRange ?? mod.changedFilesInRange;

      if (opts.read !== undefined) {
        try {
          const resolveRepoRoot = deps.resolveRepoRoot ?? mod.resolveRepoRoot;
          const readReportNote = deps.readReportNote ?? mod.readReportNote;
          const root = resolveRepoRoot(process.cwd());
          const report = readReportNote(root, opts.read);
          if (!report) {
            console.log(`No report found for ${opts.read} (ref: retrace).`);
            return;
          }
          if (format === "github") {
            const { annotationLines, summaryMarkdown } = formatGithub(report, {
              changedFiles: changedFilesInRange(root, report.range),
              maxAnnotations,
            });
            printGithubFormat(annotationLines, summaryMarkdown);
          } else {
            console.log(opts.json ? JSON.stringify(report) : formatReport(report));
          }
          if (mod.reportBreachesThreshold(report, failOn)) process.exitCode = 1;
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 2;
        }
        return;
      }

      const generateReport = deps.generateReport ?? mod.generateReport;
      const writeReportNote = deps.writeReportNote ?? mod.writeReportNote;
      const publishReportNote = deps.publishReportNote ?? mod.publishReportNote;
      const checkOptions: CheckOptions = opts.disable ? { disabled: opts.disable } : {};

      let store: RetraceStore;
      try {
        store = createStore();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
        return;
      }

      try {
        const result = generateReport(store, process.cwd(), {
          base: opts.base,
          head: opts.head,
          checkOptions,
        });

        if (opts.output) {
          writeFileSync(opts.output, JSON.stringify(result.report));
        } else {
          writeReportNote(result.repoRoot, result.headSha, result.report);
          if (opts.publish) publishReportNote(result.repoRoot, opts.remote ?? "origin");
        }

        if (format === "github") {
          const { annotationLines, summaryMarkdown } = formatGithub(result.report, {
            changedFiles: changedFilesInRange(result.repoRoot, result.report.range),
            maxAnnotations,
          });
          printGithubFormat(annotationLines, summaryMarkdown);
        } else if (opts.json) {
          console.log(JSON.stringify(result.report));
        } else {
          if (opts.output) {
            console.log(`Wrote report to ${opts.output}`);
          } else {
            console.log(`Wrote report note for ${result.headSha} (ref: retrace)`);
            if (opts.publish) console.log(`Pushed refs/notes/retrace to ${opts.remote ?? "origin"}`);
          }
          console.log(formatReport(result.report));
        }

        if (mod.reportBreachesThreshold(result.report, failOn)) process.exitCode = 1;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      } finally {
        store.close();
      }
    });

  return program;
}
