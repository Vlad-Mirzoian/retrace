#!/usr/bin/env node
/**
 * Packs both publishable packages (retrace-core, retrace-cli) exactly as
 * `pnpm publish` would, then smoke-tests the *packed artifact* — not the
 * workspace source tree — end to end: tarball contents, a real `npm install`
 * from the tarball files, and the installed `retrace` binary run against a
 * throwaway store.
 *
 * This exists because retrace-cli ships an embedded viewer that is not in
 * its source tree (scripts/copy-viewer-dist.mjs copies it into dist/ as a
 * post-build step, and "files": ["dist"] is what carries it into the
 * tarball). If build ordering slips, or dist is stale, `pnpm test` — which
 * only ever runs against source — would not notice: the published package
 * would install cleanly and then serve a blank page.
 *
 * Cross-platform by construction: no shell-isms, no `tar` shell-out (tarball
 * contents come from `pnpm pack --json`), and the installed CLI is invoked by
 * running its dist/cli.js directly with `process.execPath` rather than
 * through a platform-specific bin shim (.cmd on Windows vs. a plain script
 * elsewhere).
 */

import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const skipBuild = process.argv.includes("--skip-build");

// On Windows, `pnpm`/`npm` are .cmd shims that CreateProcess can't exec
// directly — spawning them requires going through a shell. Node scripts we
// invoke ourselves (the installed CLI) are run via `process.execPath` with no
// shell involved at all, sidestepping this entirely.
const useShell = process.platform === "win32";

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}${options.cwd ? `  (in ${options.cwd})` : ""}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: useShell, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: useShell,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
  return result.stdout;
}

/** `pnpm pack --json` prints a JSON object: { name, version, filename, files: [{ path }] }. */
function packPackage(pkgDir, packDestination) {
  const output = runCapture("pnpm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: pkgDir,
  });
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  const info = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  console.log(`✓ packed ${info.name}@${info.version} -> ${info.filename}`);
  return info;
}

function assertEntriesPresent(info, expectedPaths) {
  const actual = new Set(info.files.map((f) => f.path));
  const missing = expectedPaths.filter((p) => !actual.has(p));
  if (missing.length > 0) {
    throw new Error(`${info.name}@${info.version} tarball is missing: ${missing.join(", ")}`);
  }
  console.log(`✓ ${info.name} tarball contains: ${expectedPaths.join(", ")}`);
}

/** Asserts at least one packed entry falls under `prefix`, and that `mustInclude` is one of them. */
function assertHasPrefixedEntry(info, prefix, mustInclude) {
  const matches = info.files.map((f) => f.path).filter((p) => p.startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(
      `${info.name}@${info.version} tarball has no entries under ${prefix} — did the viewer fail to embed? ` +
        `(build order: retrace-core, then @retrace/viewer, then retrace-cli)`,
    );
  }
  if (!matches.includes(mustInclude)) {
    throw new Error(
      `${info.name}@${info.version} tarball has entries under ${prefix} but not ${mustInclude}: found ${matches.join(", ")}`,
    );
  }
  console.log(`✓ ${info.name} tarball contains ${matches.length} file(s) under ${prefix}, including ${mustInclude}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      return res;
    } catch (err) {
      if (Date.now() > deadline) {
        throw new Error(`retrace ui never became reachable on port ${port} within ${timeoutMs}ms: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

let workDir;
let uiProcess;

function cleanup() {
  if (uiProcess && uiProcess.exitCode === null) {
    try {
      uiProcess.kill();
    } catch {
      // already gone
    }
  }
  if (workDir && existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!skipBuild) {
    run("pnpm", ["build"], { cwd: repoRoot });
  }

  workDir = mkdtempSync(join(tmpdir(), "retrace-verify-pack-"));
  const packDestination = join(workDir, "tarballs");
  mkdirSync(packDestination, { recursive: true });

  const coreInfo = packPackage(join(repoRoot, "packages", "core"), packDestination);
  const cliInfo = packPackage(join(repoRoot, "packages", "cli"), packDestination);

  if (coreInfo.name !== "retrace-core") throw new Error(`expected retrace-core, packed ${coreInfo.name}`);
  if (cliInfo.name !== "retrace-cli") throw new Error(`expected retrace-cli, packed ${cliInfo.name}`);

  assertEntriesPresent(cliInfo, ["dist/cli.js", "dist/index.js", "README.md", "LICENSE"]);
  // The served viewer's shell is index.html; the single-file export template
  // is named export.html (see packages/viewer/vite.export.config.ts) — not
  // index.html, despite what a quick assumption might suggest.
  assertHasPrefixedEntry(cliInfo, "dist/viewer/", "dist/viewer/index.html");
  assertHasPrefixedEntry(cliInfo, "dist/viewer-export/", "dist/viewer-export/export.html");
  assertEntriesPresent(coreInfo, ["dist/index.js", "dist/browser.js", "README.md", "LICENSE"]);

  // --- install both tarballs by file path into a scratch project, so a
  // workspace symlink can never be silently substituted for the real thing.
  const installDir = join(workDir, "install");
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    join(installDir, "package.json"),
    JSON.stringify({ name: "verify-pack-scratch", private: true, version: "0.0.0" }, null, 2),
  );
  run("npm", ["install", coreInfo.filename, cliInfo.filename], { cwd: installDir });

  // Run the installed dist/cli.js directly, bypassing the platform-specific
  // bin shim (node_modules/.bin/retrace(.cmd)) entirely.
  const cliEntry = join(installDir, "node_modules", "retrace-cli", "dist", "cli.js");
  if (!existsSync(cliEntry)) throw new Error(`installed package is missing ${cliEntry}`);

  const homeDir = join(workDir, "home");
  const env = { ...process.env, RETRACE_HOME: homeDir };

  const printedVersion = runCapture(process.execPath, [cliEntry, "--version"], { cwd: installDir, env }).trim();
  if (printedVersion !== cliInfo.version) {
    throw new Error(`retrace --version printed "${printedVersion}", expected the packed version "${cliInfo.version}"`);
  }
  console.log(`✓ retrace --version -> ${printedVersion}`);

  run(process.execPath, [cliEntry, "list"], { cwd: installDir, env });
  console.log("✓ retrace list (empty store) exited 0");

  // findTranscripts scans a *projects tree* recursively (each transcript
  // nested under a project directory, mirroring ~/.claude/projects/<project>/
  // <sessionId>.jsonl) — not a flat directory of .jsonl files.
  const projectsDir = join(workDir, "fixtures-projects");
  const fixturesDest = join(projectsDir, "proj");
  mkdirSync(fixturesDest, { recursive: true });
  const fixturesSrc = join(repoRoot, "packages", "core", "fixtures");
  for (const name of ["basic-session.jsonl", "subagent-session.jsonl"]) {
    cpSync(join(fixturesSrc, name), join(fixturesDest, name));
  }

  const importOutput = runCapture(
    process.execPath,
    [cliEntry, "import", "--projects-dir", projectsDir],
    { cwd: installDir, env },
  );
  console.log(importOutput.trim());
  if (!/imported\s+([1-9]\d*)\s+event/i.test(importOutput)) {
    throw new Error(`retrace import did not report importing any events:\n${importOutput}`);
  }
  console.log("✓ retrace import (fixture projects tree) imported events");

  const exportPath = join(workDir, "out.html");
  run(process.execPath, [cliEntry, "export", "basic-session", "--output", exportPath], {
    cwd: installDir,
    env,
  });
  const exportedHtml = readFileSync(exportPath, "utf8");
  const MIN_EXPORT_BYTES = 100_000; // the export template alone is ~350 KB before data injection
  if (exportedHtml.length < MIN_EXPORT_BYTES) {
    throw new Error(
      `exported HTML is only ${exportedHtml.length} bytes (expected >= ${MIN_EXPORT_BYTES}) — ` +
        `dist/viewer-export likely did not survive packing`,
    );
  }
  if (!exportedHtml.includes("__RETRACE_EXPORT__")) {
    throw new Error("exported HTML has no __RETRACE_EXPORT__ payload — export-main.tsx bundle is missing");
  }
  console.log(`✓ retrace export -> ${exportPath} (${exportedHtml.length} bytes, embedded data present)`);

  const port = await findFreePort();
  uiProcess = spawn(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
    cwd: installDir,
    env,
    stdio: "inherit",
  });
  const res = await waitForPort(port);
  const body = await res.text();
  if (res.status === 404 || !body.includes('<div id="root">')) {
    throw new Error(
      `GET / returned status ${res.status} and did not look like the viewer shell — dist/viewer likely did not survive packing`,
    );
  }
  console.log(`✓ retrace ui -> GET / returned ${res.status} with the viewer shell`);
  uiProcess.kill();
  uiProcess = null;

  console.log("\nverify:pack passed.");
}

main()
  .catch((err) => {
    console.error(`\nverify:pack FAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
