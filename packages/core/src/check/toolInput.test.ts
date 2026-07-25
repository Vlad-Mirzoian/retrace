import { describe, expect, it } from "vitest";
import { asRecord, bashCommand, normalizePath, toolFilePath } from "./toolInput.js";

describe("asRecord", () => {
  it("returns the object as-is for a plain object", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("never throws on malformed input, returning {} instead", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord("a string")).toEqual({});
    expect(asRecord(42)).toEqual({});
    expect(asRecord(["array"])).toEqual(["array"]); // arrays are objects; callers key-access safely
  });
});

describe("toolFilePath", () => {
  it("reads file_path", () => {
    expect(toolFilePath({ file_path: "/a/b.ts" })).toBe("/a/b.ts");
  });

  it("falls back to notebook_path", () => {
    expect(toolFilePath({ notebook_path: "/a/nb.ipynb" })).toBe("/a/nb.ipynb");
  });

  it("returns undefined for missing, non-string, or empty values", () => {
    expect(toolFilePath({})).toBeUndefined();
    expect(toolFilePath({ file_path: 123 })).toBeUndefined();
    expect(toolFilePath({ file_path: "" })).toBeUndefined();
    expect(toolFilePath(null)).toBeUndefined();
    expect(toolFilePath(undefined)).toBeUndefined();
  });
});

describe("bashCommand", () => {
  it("reads command", () => {
    expect(bashCommand({ command: "ls -la" })).toBe("ls -la");
  });

  it("returns undefined for missing or non-string command", () => {
    expect(bashCommand({})).toBeUndefined();
    expect(bashCommand({ command: 1 })).toBeUndefined();
    expect(bashCommand("not an object")).toBeUndefined();
  });
});

describe("normalizePath", () => {
  it("unifies backslash and forward-slash separators", () => {
    expect(normalizePath("C:\\repo\\src\\index.ts")).toBe(normalizePath("C:/repo/src/index.ts"));
  });

  it("strips a leading ./", () => {
    expect(normalizePath("./src/index.ts")).toBe(normalizePath("src/index.ts"));
  });

  it("collapses repeated slashes and a trailing slash", () => {
    expect(normalizePath("src//index.ts")).toBe(normalizePath("src/index.ts"));
    expect(normalizePath("src/")).toBe(normalizePath("src"));
  });

  it("is case-insensitive, matching Windows filesystem semantics", () => {
    expect(normalizePath("C:\\Repo\\Config.JSON")).toBe(normalizePath("c:/repo/config.json"));
  });
});
