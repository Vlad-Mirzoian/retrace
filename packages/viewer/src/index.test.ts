import { describe, expect, it } from "vitest";
import { VIEWER_VERSION } from "./index.js";

describe("@retrace/viewer", () => {
  it("exposes a version", () => {
    expect(VIEWER_VERSION).toBe("0.0.1");
  });
});
