import { describe, expect, it } from "vitest";
import { checkNodeVersion, MIN_NODE } from "./preflight.js";

describe("checkNodeVersion", () => {
  it("fails just below the floor", () => {
    const result = checkNodeVersion("v22.4.9");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("v22.4.9");
    expect(result.message).toContain("22.5.0");
    expect(result.message).toMatch(/node:sqlite/);
  });

  it("passes exactly at the floor", () => {
    expect(checkNodeVersion("v22.5.0")).toEqual({ ok: true });
  });

  it("passes on a much newer major version", () => {
    expect(checkNodeVersion("v24.0.0")).toEqual({ ok: true });
  });

  it("passes on a later minor within the same major", () => {
    expect(checkNodeVersion("v22.9.1")).toEqual({ ok: true });
  });

  it("fails on an older major version entirely", () => {
    expect(checkNodeVersion("v20.11.0").ok).toBe(false);
  });

  it("does not lock a user out on a malformed version string — passes instead", () => {
    expect(checkNodeVersion("not-a-version")).toEqual({ ok: true });
    expect(checkNodeVersion("")).toEqual({ ok: true });
  });

  it("exposes MIN_NODE for callers that want to display it", () => {
    expect(MIN_NODE).toEqual({ major: 22, minor: 5 });
  });
});
