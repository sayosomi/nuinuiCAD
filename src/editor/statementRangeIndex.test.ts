import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { createStatementRangeIndex, elementIdAtCursor, mapStatementRangeIndex } from "./statementRangeIndex";

const compiled = (source: string) => {
  const result = compileDslDocument(source);
  expect(result.document).not.toBeNull();
  expect(result.statementMap).not.toBeNull();
  return result;
};

describe("statementRangeIndex", () => {
  it("maps runtime-ID ranges through dirty edits without consulting stale statement lines", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint = (1, 1)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const unnamedId = result.document!.elements.find((element) => element.name === "")!.id;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const changes = ChangeSet.of({ from: 0, insert: "# dirty\n" }, doc.length);
    const mapped = mapStatementRangeIndex(original, changes);

    const unnamed = mapped.get(unnamedId)!;
    expect(elementIdAtCursor(mapped, unnamed.from)).toBe(unnamedId);
    expect(unnamed.from).toBeGreaterThan(original.get(unnamedId)!.from);
  });

  it("drops a wholly deleted statement instead of retaining a stale line identity", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint B = (1, 1)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const range = original.get(pointB.id)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapStatementRangeIndex(original, changes).has(pointB.id)).toBe(false);
  });

  it("keeps a statement identity when replacing a value at its final character", () => {
    const source = "nui 1\npoint A = offset B dx=130 dy=9";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointA = result.document!.elements.find((element) => element.name === "A")!;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const range = original.get(pointA.id)!;
    const valueStart = source.lastIndexOf("9");
    const changes = ChangeSet.of({ from: valueStart, to: valueStart + 1, insert: "10" }, doc.length);
    const mapped = mapStatementRangeIndex(original, changes);

    expect(elementIdAtCursor(mapped, valueStart)).toBe(pointA.id);
    expect(elementIdAtCursor(mapped, valueStart + 1)).toBe(pointA.id);
    expect(mapped.get(pointA.id)?.to).toBe(range.to + 1);
  });
});
