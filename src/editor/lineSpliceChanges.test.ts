import { describe, expect, it } from "vitest";
import { applyLineSplices, type LineSplice } from "../document/textPatch";
import { applySourceTextChanges, lineSplicesToSourceTextChanges } from "./lineSpliceChanges";
import { normalizeSourceTextForEditor } from "./sourceTextFormat";

const expectEquivalent = (source: string, splices: LineSplice[]) => {
  const changes = lineSplicesToSourceTextChanges(source, splices);
  expect(applySourceTextChanges(source, changes)).toBe(normalizeSourceTextForEditor(applyLineSplices(source, splices)));
};

describe("LineSplice to source-editor changes", () => {
  it("applies non-contiguous replacement, deletion, and insertion without a full replacement", () => {
    const source = "a\nb\nc\nd";
    const splices = [
      { startLine: 1, endLine: 1, replacementLines: ["A"] },
      { startLine: 3, endLine: 3, replacementLines: [] },
      { startLine: 5, endLine: 4, replacementLines: ["E"] }
    ];
    const changes = lineSplicesToSourceTextChanges(source, splices);
    expect(changes).toHaveLength(3);
    expect(changes.some((change) => change.from === 0 && change.to === source.length)).toBe(false);
    expectEquivalent(source, splices);
  });

  it("handles an empty document and a trailing empty line", () => {
    expectEquivalent("", [{ startLine: 1, endLine: 0, replacementLines: ["A"] }]);
    expectEquivalent("a\nb\n", [
      { startLine: 2, endLine: 2, replacementLines: ["B"] },
      { startLine: 3, endLine: 3, replacementLines: [] }
    ]);
  });

  it("uses CM logical LF coordinates for LF, CRLF, and mixed source", () => {
    const splices = [{ startLine: 2, endLine: 2, replacementLines: ["B"] }];
    expectEquivalent("a\nb\nc", splices);
    expectEquivalent("a\r\nb\r\nc", splices);
    expectEquivalent("a\nb\r\nc", splices);
  });
});
