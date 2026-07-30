#!/usr/bin/env node
/**
 * Development instrument for measuring the check engine at corpus scale.
 *
 * Not a CLI subcommand and not part of CI — `retrace` is a user-facing tool,
 * this is a way for the check-tuning work (modules 02/03 of the check-tuning
 * plan) to see aggregate numbers move. Point it at any unpacked
 * `~/.retrace`-shaped store via --home, or at a saved `check --all --json`
 * report via --json for a store that was never shipped.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const SEVERITIES = ["high", "medium", "low"];
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

function parseArgs(argv) {
  const args = { home: undefined, json: undefined, baseline: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --flag` does not strip the separator on every
    // pnpm version, so tolerate a literal "--" token wherever it lands.
    if (arg === "--") continue;
    if (arg === "--home") args.home = argv[++i];
    else if (arg === "--json") args.json = argv[++i];
    else if (arg === "--baseline") args.baseline = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function resolveHome(homeArg) {
  if (homeArg) return resolve(homeArg);
  if (process.env.RETRACE_HOME) return resolve(process.env.RETRACE_HOME);
  return join(homedir(), ".retrace");
}

/** Run `check --all --json` against a store via the built CLI. */
function runCliCheckAll(home) {
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "cli.js");
  if (!existsSync(cliEntry)) {
    throw new Error(
      `${cliEntry} is missing — run \`pnpm build\` first, then re-run \`pnpm check:corpus\`.`,
    );
  }
  const result = spawnSync(
    process.execPath,
    [cliEntry, "check", "--all", "--json", "--fail-on", "never"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, RETRACE_HOME: home } },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `check --all --json exited ${result.status} against ${home}:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function median(sortedNumbers) {
  if (sortedNumbers.length === 0) return 0;
  const mid = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2 === 0
    ? (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2
    : sortedNumbers[mid];
}

/** Whether any finding in `findings` is at or above `threshold`. */
function breaches(findings, threshold) {
  return findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[threshold]);
}

/** Aggregate an array of `CheckReport` objects into the harness's report shape. */
function aggregate(reports, meta) {
  const sessionsChecked = reports.length;
  const findingCounts = reports.map((r) => r.findings.length);
  const sessionsWithFinding = findingCounts.filter((n) => n > 0).length;
  const totalFindings = findingCounts.reduce((a, b) => a + b, 0);
  const sorted = [...findingCounts].sort((a, b) => a - b);

  const ruleSeverityMatrix = {};
  const rulesSkipped = {};

  for (const report of reports) {
    for (const finding of report.findings) {
      const row = (ruleSeverityMatrix[finding.ruleId] ??= { high: 0, medium: 0, low: 0, total: 0 });
      row[finding.severity]++;
      row.total++;
    }
    for (const skip of report.rulesSkipped ?? []) {
      const row = (rulesSkipped[skip.ruleId] ??= { reasons: {}, total: 0 });
      row.reasons[skip.reason] = (row.reasons[skip.reason] ?? 0) + 1;
      row.total++;
    }
  }

  const breachesByThreshold = {};
  for (const severity of SEVERITIES) {
    breachesByThreshold[severity] = reports.filter((r) => breaches(r.findings, severity)).length;
  }

  return {
    meta: { generatedAt: new Date().toISOString(), ...meta },
    sessionsChecked,
    sessionsWithFinding,
    sessionsClean: sessionsChecked - sessionsWithFinding,
    totalFindings,
    findingsPerSession: {
      mean: sessionsChecked === 0 ? 0 : totalFindings / sessionsChecked,
      median: median(sorted),
      max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    },
    ruleSeverityMatrix,
    breaches: breachesByThreshold,
    rulesSkipped,
  };
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function pct(part, whole) {
  if (whole === 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function deltaStr(current, baseline) {
  const d = current - baseline;
  if (d === 0) return "±0";
  return d > 0 ? `+${fmt(d)}` : fmt(d);
}

function printReport(report, baseline) {
  console.log(`generated:                   ${report.meta.generatedAt}`);
  console.log(`source:                      ${report.meta.source}`);
  console.log("");
  console.log(`sessions checked:            ${report.sessionsChecked}`);
  console.log(
    `sessions with >=1 finding:   ${report.sessionsWithFinding}  (${pct(report.sessionsWithFinding, report.sessionsChecked)})`,
  );
  console.log(`sessions clean:              ${report.sessionsClean}`);
  console.log(`total findings:              ${report.totalFindings}${baseline ? `  (${deltaStr(report.totalFindings, baseline.totalFindings)})` : ""}`);
  console.log(
    `findings/session mean/median/max: ${fmt(report.findingsPerSession.mean)} / ${fmt(report.findingsPerSession.median)} / ${fmt(report.findingsPerSession.max)}`,
  );
  console.log("");

  console.log("rule x severity matrix:");
  const ruleIds = Object.keys(report.ruleSeverityMatrix).sort(
    (a, b) => report.ruleSeverityMatrix[b].total - report.ruleSeverityMatrix[a].total,
  );
  for (const ruleId of ruleIds) {
    const row = report.ruleSeverityMatrix[ruleId];
    const baseRow = baseline?.ruleSeverityMatrix?.[ruleId];
    const deltaPart = baseline ? `  (${deltaStr(row.total, baseRow?.total ?? 0)})` : "";
    console.log(
      `  ${ruleId.padEnd(26)} total=${String(row.total).padStart(4)}  high=${row.high} medium=${row.medium} low=${row.low}${deltaPart}`,
    );
  }
  console.log("");

  console.log("breach counts (sessions with a finding at or above threshold):");
  for (const severity of SEVERITIES) {
    const count = report.breaches[severity];
    const deltaPart = baseline ? `  (${deltaStr(count, baseline.breaches[severity])})` : "";
    console.log(`  ${severity.padEnd(8)} ${count}${deltaPart}`);
  }
  console.log("");

  const skippedRuleIds = Object.keys(report.rulesSkipped);
  if (skippedRuleIds.length > 0) {
    console.log("rules skipped:");
    for (const ruleId of skippedRuleIds) {
      const row = report.rulesSkipped[ruleId];
      const reasons = Object.entries(row.reasons)
        .map(([reason, count]) => `${reason} (${count})`)
        .join(", ");
      console.log(`  ${ruleId}: ${row.total} — ${reasons}`);
    }
    console.log("");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let reports;
  let meta;
  if (args.json) {
    const jsonPath = resolve(args.json);
    reports = JSON.parse(readFileSync(jsonPath, "utf8"));
    meta = { source: "json-file", jsonPath };
  } else {
    const home = resolveHome(args.home);
    reports = runCliCheckAll(home);
    meta = { source: "cli", home };
  }

  const report = aggregate(reports, meta);

  let baseline;
  if (args.baseline) {
    const baselinePath = resolve(args.baseline);
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  }

  printReport(report, baseline);

  if (args.out) {
    const outPath = resolve(args.out);
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`wrote ${outPath}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`check-corpus FAILED: ${err.message}`);
  process.exitCode = 1;
}
