import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  verifyChain,
  type ChainVerification,
  type RetraceEvent,
  type RetraceStore,
  type SessionRow,
} from "retrace-core";
import { collectAllEvents } from "../events.js";

export interface ExportedSession {
  session: SessionRow;
  events: RetraceEvent[];
  /**
   * The CAS objects this session's events point at, keyed by hash — the file
   * snapshots a hook captured. Without them an exported file would have to
   * reach back to a running server to draw its diffs, which defeats the point
   * of the export. Oversized payload bodies are *not* in here: the store
   * already restores those inline when reading, so embedding them again would
   * just duplicate the bytes.
   */
  objects: Record<string, string>;
  /**
   * The tamper-evidence verdict for this session's hash chain, computed once
   * at export time so the standalone file can show the same integrity badge
   * the live viewer does, with no server to ask.
   */
  verification: ChainVerification;
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

/**
 * Gather the CAS objects the viewer resolves at render time. That is exactly
 * the file snapshots referenced by `file_change` events — mirroring
 * FileChangeCard, the viewer's only runtime object lookup.
 */
function collectObjects(store: RetraceStore, events: RetraceEvent[]): Record<string, string> {
  const objects: Record<string, string> = {};
  for (const event of events) {
    if (event.kind !== "file_change") continue;
    for (const hash of [event.payload.beforeRef, event.payload.afterRef]) {
      if (!hash || hash in objects) continue;
      try {
        objects[hash] = store.objects.getTextSync(hash);
      } catch {
        // A snapshot that's gone from the store shouldn't sink the whole
        // export; the card degrades to "failed to load" for that one diff.
      }
    }
  }
  return objects;
}

function buildExportedSession(store: RetraceStore, sessionId: string): ExportedSession {
  const session = store.getSession(sessionId)!; // caller has already resolved this to a real id
  const events = collectAllEvents(store, sessionId);
  return {
    session,
    events,
    objects: collectObjects(store, events),
    verification: verifyChain(events),
  };
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
 *
 * `idOrPrefix` may be a full session id or a unique prefix of one — e.g. the
 * 10 chars `list` truncates its SESSION column to.
 */
export function exportSession(
  store: RetraceStore,
  idOrPrefix: string,
  options: ExportOptions,
): ExportResult {
  const sessionId = store.resolveSessionId(idOrPrefix);
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
