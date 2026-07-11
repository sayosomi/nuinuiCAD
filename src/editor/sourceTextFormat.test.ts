import { describe, expect, it } from "vitest";
import { normalizeSourceTextForEditor, serializeEditorText, sourceTextFormat } from "./sourceTextFormat";

describe("source text line-ending policy", () => {
  it("round-trips uniform LF and CRLF", () => {
    expect(serializeEditorText(normalizeSourceTextForEditor("a\nb\n"), sourceTextFormat("a\nb\n"))).toBe("a\nb\n");
    expect(serializeEditorText(normalizeSourceTextForEditor("a\r\nb\r\n"), sourceTextFormat("a\r\nb\r\n"))).toBe("a\r\nb\r\n");
  });

  it("marks mixed and lone-CR source for a future direct editor normalization", () => {
    expect(sourceTextFormat("a\nb\r\nc")).toEqual({ lineEnding: "mixed", normalizeToLfOnEditorCommit: true });
    expect(sourceTextFormat("a\rb")).toEqual({ lineEnding: "mixed", normalizeToLfOnEditorCommit: true });
    expect(normalizeSourceTextForEditor("\uFEFFa\r\nb")).toBe("\uFEFFa\nb");
  });
});
