import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { sourceInsertionForCommandLineCreation } from "./commandLineSourceInsertion";

const compiled = (lines: string[]) => {
  const result = compileDslDocument(lines.join("\n"));
  if (!result.document || !result.statementMap) throw new Error("fixture must compile");
  return result;
};

describe("command-line source insertion", () => {
  it("keeps an element-statement cursor after the complete statement", () => {
    const result = compiled([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)"
    ]);
    const pointA = result.document!.elements.find((element) => element.name === "A")!;

    expect(sourceInsertionForCommandLineCreation({
      cursor: { sourceRevision: 1, line: 2, lineCount: result.sourceLines.length, elementId: pointA.id },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      insertionTarget: { insertionIndex: 1 },
      sourceInsertionLine: 3
    });
  });

  it("inserts a comment-line cursor inside its enclosing group", () => {
    const result = compiled([
      "nui 3",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  # keep this comment with the following insertion",
      "}",
      "point B = coordinate(x: 1, y: 1)"
    ]);
    const group = result.document!.elements.find((element) => element.name === "G")!;

    expect(sourceInsertionForCommandLineCreation({
      cursor: { sourceRevision: 1, line: 4, lineCount: result.sourceLines.length, elementId: null },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      insertionTarget: { insertionIndex: 2, parentGroupId: group.id },
      sourceInsertionLine: 4
    });
  });

  it("places an @stop-line cursor before the evaluation boundary", () => {
    const result = compiled([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "# create before the stop",
      "@stop",
      "point B = coordinate(x: 1, y: 1)"
    ]);

    expect(sourceInsertionForCommandLineCreation({
      cursor: { sourceRevision: 1, line: 4, lineCount: result.sourceLines.length, elementId: null },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      insertionTarget: { insertionIndex: 1 },
      sourceInsertionLine: 4
    });
  });
});
