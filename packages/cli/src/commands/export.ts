import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RetraceEvent, RetraceStore, SessionRow } from "@retrace/core";

export interface ExportedSession {
  session: SessionRow;
  events: RetraceEvent[];
}

export type ExportFormat = "json" | "html";

export interface ExportOptions {
  format: ExportFormat;
  /** Output file path. Defaults to `<sessionId>.json` / `<sessionId>.html`. */
  output?: string;
  /** Directory holding the embedded single-file export template (html only). */
  viewerExportDir?: string;
}

export interface ExportResult {
  path: string;
  format: ExportFormat;
  eventCount: number;
}

/** Page through the store until the whole session's events are collected. */
function collectAllEvents(store: RetraceStore, sessionId: string, pageSize = 500): RetraceEvent[] {
  const all: RetraceEvent[] = [];
  for (;;) {
    const page = store.readEvents(sessionId, all.length, pageSize);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

function buildExportedSession(store: RetraceStore, sessionId: string): ExportedSession {
  const session = store.getSession(sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  return { session, events: collectAllEvents(store, sessionId) };
}

/**
 * Embed the session data into the single-file export template as a <script>.
 * `<` is escaped so a literal "</script>" inside event text (e.g. a code
 * snippet) can't prematurely close the tag and break the page.
 */
function injectData(template: string, data: ExportedSession): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const script = `<script>window.__RETRACE_EXPORT__ = ${json};</script>`;
  return template.includes("</head>")
    ? template.replace("</head>", `${script}\n</head>`)
    : `${template}\n${script}`;
}

function defaultOutputPath(sessionId: string, format: ExportFormat): string {
  return `${sessionId}.${format}`;
}

/**
 * Export one session as either a plain JSON dump (session metadata + every
 * event) or a self-contained HTML file — the built viewer's timeline with the
 * session's data embedded, viewable by double-clicking with no server and
 * nothing else to send.
 */
export function exportSession(
  store: RetraceStore,
  sessionId: string,
  options: ExportOptions,
): ExportResult {
  const data = buildExportedSession(store, sessionId);
  const path = options.output ?? defaultOutputPath(sessionId, options.format);

  if (options.format === "json") {
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    return { path, format: "json", eventCount: data.events.length };
  }

  if (!options.viewerExportDir) {
    throw new Error("HTML export requires the embedded export template (viewerExportDir)");
  }
  const templatePath = join(options.viewerExportDir, "export.html");
  if (!existsSync(templatePath)) {
    throw new Error(
      `export template not found at ${templatePath} — rebuild @retrace/viewer (pnpm --filter @retrace/viewer build)`,
    );
  }
  const template = readFileSync(templatePath, "utf8");
  writeFileSync(path, injectData(template, data), "utf8");
  return { path, format: "html", eventCount: data.events.length };
}
