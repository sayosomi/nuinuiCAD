import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import {
  createPrintLayoutRangeIndex,
  createStatementRangeIndex,
  elementIdAtCursor,
  mapPrintLayoutRangeIndex,
  mapStatementRangeIndex
} from "./statementRangeIndex";

const compiled = (source: string) => {
  const result = compileDslDocument(source);
  expect(result.document).not.toBeNull();
  expect(result.statementMap).not.toBeNull();
  return result;
};

describe("statementRangeIndex", () => {
  it("anchors an inline brace on the final row of a handwritten multiline header", () => {
    const source = [
      "nui 2",
      "group Multi (printEnabled: true",
      ") {",
      "  point A = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const target = createStatementRangeIndex(doc, result.statementMap!).get(group.id)!.foldTargets[0]!;

    expect(target).toMatchObject({
      branch: "primary",
      gutterLineFrom: doc.line(3).from,
      foldFrom: doc.line(3).to,
      foldTo: doc.line(5).from
    });
  });

  it("adds a statement target for a handwritten multiline expression and leaves its close row visible", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(",
      "  from: A",
      "  dx: 100",
      "  dy: 0",
      ")"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const target = createStatementRangeIndex(doc, result.statementMap!).get(pointB.id)!.foldTargets;

    expect(target).toEqual([expect.objectContaining({
      branch: "statement",
      gutterLineFrom: doc.line(3).from,
      foldFrom: doc.line(3).to,
      foldTo: doc.line(7).from
    })]);
  });

  it("temporarily disables a multiline statement target when its opening row becomes dirty", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(",
      "  from: A",
      ")"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const ranges = createStatementRangeIndex(doc, result.statementMap!);
    const openParen = doc.line(3).to - 1;

    const mapped = mapStatementRangeIndex(
      ranges,
      ChangeSet.of({ from: openParen, to: openParen + 1, insert: "[" }, doc.length)
    );

    expect(mapped.get(pointB.id)?.foldTargets).toEqual([]);
  });

  it("temporarily disables only a target whose structural anchor is dirty", () => {
    const source = ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "}"].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const ranges = createStatementRangeIndex(doc, result.statementMap!);
    const openBrace = doc.line(2).to - 1;

    const mapped = mapStatementRangeIndex(
      ranges,
      ChangeSet.of({ from: openBrace, to: openBrace + 1, insert: "[" }, doc.length)
    );

    expect(mapped.get(group.id)?.foldTargets).toEqual([]);
    expect(mapped.get(group.id)?.from).toBe(ranges.get(group.id)?.from);
  });

  it("maps an intact target through dirty interior line edits", () => {
    const source = ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "}"].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const original = createStatementRangeIndex(doc, result.statementMap!).get(group.id)!.foldTargets[0]!;

    const mapped = mapStatementRangeIndex(
      createStatementRangeIndex(doc, result.statementMap!),
      ChangeSet.of({ from: doc.line(3).to, insert: "\n  point B = coordinate(x: 1 y: 1)" }, doc.length)
    ).get(group.id)!.foldTargets[0]!;

    expect(mapped.gutterLineFrom).toBe(original.gutterLineFrom);
    expect(mapped.foldTo).toBeGreaterThan(original.foldTo);
  });

  it("maps runtime-ID ranges through dirty edits without consulting stale statement lines", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)\npoint = coordinate(x: 1 y: 1)";
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
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const range = original.get(pointB.id)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapStatementRangeIndex(original, changes).has(pointB.id)).toBe(false);
  });

  it("keeps a statement identity when replacing a value at its final character", () => {
    const source = "nui 2\npoint B = coordinate(x: 0 y: 0)\npoint A = offset(from: B dx: 130 dy: 9)";
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

describe("printLayoutRangeIndex", () => {
  const printLayoutSource = ["nui 2", "printLayout Layout1 () {", "  layoutVar Width = 10", "}"].join("\n");

  it("builds one entry per printLayout:<id> statementMap key, at the block-opening line", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const index = createPrintLayoutRangeIndex(doc, result.statementMap!);

    expect(index.size).toBe(1);
    const range = index.get(printLayoutId)!;
    expect(range).toBeDefined();
    expect(doc.sliceString(range.from, range.to)).toBe("printLayout Layout1 () {");
  });

  it("tracks an insertion above the block, shifting the line but preserving printLayoutId identity", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const original = createPrintLayoutRangeIndex(doc, result.statementMap!);
    const changes = ChangeSet.of({ from: 0, insert: "# dirty\n" }, doc.length);
    const mapped = mapPrintLayoutRangeIndex(original, changes);

    const range = mapped.get(printLayoutId)!;
    expect(range).toBeDefined();
    expect(range.from).toBeGreaterThan(original.get(printLayoutId)!.from);
  });

  it("drops an entry whose block-opening line is fully replaced", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const original = createPrintLayoutRangeIndex(doc, result.statementMap!);
    const range = original.get(printLayoutId)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapPrintLayoutRangeIndex(original, changes).has(printLayoutId)).toBe(false);
  });
});
