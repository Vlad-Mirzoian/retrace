import { CORE_VERSION } from "@retrace/core";
import { CLI_VERSION } from "./version.js";

export { CLI_VERSION };

export function describeCli(): string {
  return `retrace CLI ${CLI_VERSION} (core ${CORE_VERSION})`;
}

export * from "./commands/import.js";
export * from "./commands/list.js";
export * from "./commands/hook.js";
export * from "./commands/init.js";
export * from "./commands/ui.js";
export * from "./server/app.js";
export * from "./program.js";
