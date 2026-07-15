import { CORE_VERSION } from "@retrace/core";

export const CLI_VERSION = "0.0.1";

export function describeCli(): string {
  return `retrace CLI ${CLI_VERSION} (core ${CORE_VERSION})`;
}
