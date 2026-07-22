import { describe, expect, it } from "vitest";
import { formatDuration } from "./summarize.js";

describe("formatDuration", () => {
  const start = "2026-07-15T14:00:00.000Z";

  it("formats seconds-only durations", () => {
    expect(formatDuration(start, "2026-07-15T14:00:42.000Z")).toBe("42s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(start, "2026-07-15T14:04:12.000Z")).toBe("4m 12s");
  });

  it("drops seconds once a session runs for hours", () => {
    expect(formatDuration(start, "2026-07-15T16:30:20.000Z")).toBe("2h 30m");
  });

  it("returns null when either end is missing", () => {
    expect(formatDuration(null, start)).toBeNull();
    expect(formatDuration(start, null)).toBeNull();
  });

  it("returns null rather than a negative duration for out-of-order stamps", () => {
    expect(formatDuration("2026-07-15T14:05:00.000Z", start)).toBeNull();
  });

  it("returns null for unparseable timestamps", () => {
    expect(formatDuration("not a date", start)).toBeNull();
  });

  it("treats a zero-length session as 0s, not as missing", () => {
    expect(formatDuration(start, start)).toBe("0s");
  });
});
