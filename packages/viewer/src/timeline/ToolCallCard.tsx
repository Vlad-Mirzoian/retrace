import type { ToolCallEvent, ToolResultEvent } from "./grouping.js";
import { Card } from "./cards.js";
import { DiffView } from "./DiffView.js";
import { CodeBlock, JsonBlock } from "./primitives.js";

/** Tool results arrive as a plain string or as an array of content blocks. */
export function outputToText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : JSON.stringify(block),
      )
      .join("\n");
  }
  if (output === undefined || output === null) return "";
  return JSON.stringify(output, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Render a tool's input. Edits get a real diff straight from the transcript's
 * old_string/new_string, which is the whole point of the timeline — seeing
 * *what changed*, not a wall of JSON.
 */
function ToolInput({ call }: { call: ToolCallEvent }) {
  const input = asRecord(call.payload.input);
  const filePath = str(input.file_path) ?? str(input.notebook_path);
  const toolName = call.payload.toolName;

  if (toolName === "Edit") {
    const oldString = str(input.old_string);
    const newString = str(input.new_string);
    if (oldString !== undefined && newString !== undefined) {
      return (
        <>
          {filePath && <p className="file-path">{filePath}</p>}
          <DiffView oldText={oldString} newText={newString} />
        </>
      );
    }
  }

  if (toolName === "Write") {
    const content = str(input.content);
    if (content !== undefined) {
      return (
        <>
          {filePath && <p className="file-path">{filePath}</p>}
          <CodeBlock text={content} label="new contents" />
        </>
      );
    }
  }

  if (toolName === "Bash") {
    const command = str(input.command);
    if (command !== undefined) return <pre className="code">{command}</pre>;
  }

  return <JsonBlock value={call.payload.input} label="input" />;
}

export function ToolCallCard({
  call,
  result,
}: {
  call: ToolCallEvent;
  result?: ToolResultEvent;
}) {
  const isError = result?.payload.isError === true;
  const outputText = result ? outputToText(result.payload.output) : "";

  return (
    <Card
      kind="tool"
      ts={call.ts}
      title={
        <>
          <strong className="tool-name">{call.payload.toolName}</strong>
          {isError && <span className="badge badge-error">error</span>}
          {!result && <span className="badge">no result</span>}
        </>
      }
      tone={isError ? "error" : undefined}
    >
      <ToolInput call={call} />
      {result && (
        <div className="tool-result">
          <CodeBlock text={outputText} label={isError ? "error output" : "result"} />
        </div>
      )}
    </Card>
  );
}
