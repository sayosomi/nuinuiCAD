import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import {
  resolveDocumentEndSourceCreationInsertion,
  resolveSourceCreationInsertion,
  sourceInsertionForCreation
} from "./sourceCreationInsertion";

const compiled = (lines: string[], assignedStatementIds?: Map<number, string>) => {
  const result = compileDslDocument(lines.join("\n"), { assignedStatementIds });
  if (!result.document || !result.statementMap) throw new Error("fixture must compile");
  return result;
};

describe("command-line source insertion", () => {
  it("keeps an element-statement cursor after the complete statement", () => {
    const result = compiled([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)"
    ]);
    const pointA = result.document!.elements.find((element) => element.name === "A")!;

    expect(sourceInsertionForCreation({
      cursor: { sourceRevision: 1, line: 2, lineCount: result.sourceLines.length, elementId: pointA.id },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      sourceRevision: 1,
      insertionTarget: { insertionIndex: 1 },
      sourceInsertionLine: 3
    });
  });

  it("keeps an element-statement cursor after a multiline unnamed declaration", () => {
    const result = compiled([
      "nui 1",
      "point Left = coordinate(x: -50, y: 0)",
      "point Right = coordinate(x: 50, y: 0)",
      "line Guide = segment(start: @Left, end: @Right)",
      "point = coordinate(",
      "  x: 12.5,",
      "  y: -8,",
      ")"
    ]);
    const unnamedPoint = result.document!.elements.find((element) => element.name === "")!;
    const info = result.statementMap!.byElementId.get(unnamedPoint.id)!;

    expect(info.endLine).toBe(8);
    expect(info.range.endLine).toBe(5);
    expect(sourceInsertionForCreation({
      cursor: {
        sourceRevision: result.statementMap!.sourceRevision,
        line: 5,
        lineCount: result.sourceLines.length,
        elementId: unnamedPoint.id
      },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      sourceRevision: result.statementMap!.sourceRevision,
      insertionTarget: { insertionIndex: result.document!.elements.length },
      sourceInsertionLine: 9
    });
  });

  it("inserts a comment-line cursor inside its enclosing group", () => {
    const result = compiled([
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  // keep this comment with the following insertion",
      "}",
      "point B = coordinate(x: 1, y: 1)"
    ]);
    const group = result.document!.elements.find((element) => element.name === "G")!;

    expect(sourceInsertionForCreation({
      cursor: { sourceRevision: 1, line: 4, lineCount: result.sourceLines.length, elementId: null },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      sourceRevision: 1,
      insertionTarget: { insertionIndex: 2, parentGroupId: group.id },
      sourceInsertionLine: 4
    });
  });

  it("places an stop-line cursor before the evaluation boundary", () => {
    const result = compiled([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "// create before the stop",
      "stop",
      "point B = coordinate(x: 1, y: 1)"
    ]);

    expect(sourceInsertionForCreation({
      cursor: { sourceRevision: 1, line: 4, lineCount: result.sourceLines.length, elementId: null },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    })).toEqual({
      sourceRevision: 1,
      insertionTarget: { insertionIndex: 1 },
      sourceInsertionLine: 4
    });
  });

  it("normalizes an interior line of a non-element logical statement to its header", () => {
    const result = compiled([
      "nui 1",
      "const width: number = (",
      "  10",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ], new Map([[1, "typed-width"]]));
    const statement = result.statementMap!.statements.find((info) => info.kind === "typedDeclaration")!;
    const insertion = sourceInsertionForCreation({
      cursor: {
        sourceRevision: result.statementMap!.sourceRevision,
        line: statement.line + 1,
        lineCount: result.sourceLines.length,
        elementId: null
      },
      elements: result.document!.elements,
      statementMap: result.statementMap!
    });

    expect(statement.endLine).toBe(statement.line + 2);
    expect(insertion?.sourceInsertionLine).toBe(statement.line);
    expect(result.sourceLines[insertion!.sourceInsertionLine - 1]).toContain("const width");
    expect(result.sourceLines[insertion!.sourceInsertionLine - 1]).not.toContain("10");
  });

  it("distinguishes no Source target, safe insertion, and unsafe current metadata", () => {
    const result = compiled([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ]);
    const statementMap = result.statementMap!;
    const cursor = {
      sourceRevision: statementMap.sourceRevision,
      line: 1,
      lineCount: result.sourceLines.length,
      elementId: null
    };

    expect(resolveSourceCreationInsertion({
      cursor: null,
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap: null
    })).toEqual({ kind: "none" });
    expect(resolveSourceCreationInsertion({
      cursor,
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap
    })).toMatchObject({ kind: "safe" });
    expect(resolveSourceCreationInsertion({
      cursor: { ...cursor, sourceRevision: statementMap.sourceRevision - 1 },
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap
    })).toEqual({ kind: "unsafe", reason: "stale-source-revision" });
    expect(resolveSourceCreationInsertion({
      cursor,
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap: null
    })).toEqual({ kind: "unsafe", reason: "missing-statement-metadata" });
  });

  it("fails closed for unresolved and ambiguous Source locations", () => {
    const result = compiled([
      "nui 1",
      "const width: number = (",
      "  10",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ], new Map([[1, "typed-width"]]));
    const statementMap = result.statementMap!;
    const cursor = {
      sourceRevision: statementMap.sourceRevision,
      line: 3,
      lineCount: result.sourceLines.length,
      elementId: null
    };
    const logicalStatement = statementMap.statements.find((info) => info.kind === "typedDeclaration")!;

    expect(resolveSourceCreationInsertion({
      cursor: { ...cursor, elementId: "missing-element" },
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap
    })).toEqual({ kind: "unsafe", reason: "missing-element-statement" });

    expect(resolveSourceCreationInsertion({
      cursor,
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap: { ...statementMap, statements: [...statementMap.statements, logicalStatement] }
    })).toEqual({ kind: "unsafe", reason: "ambiguous-source-location" });
  });

  it("resolves a safe root document-end boundary after existing trailing bytes", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "// keep this trailing comment",
      "",
      ""
    ].join("\n");
    const result = compiled(source.split("\n"));

    expect(resolveDocumentEndSourceCreationInsertion({
      sourceText: source,
      documentText: source,
      sourceRevision: result.statementMap!.sourceRevision,
      elements: result.document!.elements,
      statementMap: result.statementMap
    })).toEqual({
      kind: "safe",
      insertion: {
        sourceRevision: result.statementMap!.sourceRevision,
        insertionTarget: { insertionIndex: result.document!.elements.length },
        sourceInsertionLine: source.split("\n").length
      }
    });
  });

  it("fails closed for fatal, stale, and inconsistent document-end source state", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const result = compiled(source.split("\n"));
    const statementMap = result.statementMap!;
    const args = {
      sourceText: source,
      documentText: source,
      sourceRevision: statementMap.sourceRevision,
      elements: result.document!.elements,
      statementMap
    };

    expect(resolveDocumentEndSourceCreationInsertion({
      ...args,
      documentText: `${source}\npoint Broken = coordinate(x: )`
    })).toEqual({ kind: "unsafe", reason: "fatal-source-text" });
    expect(resolveDocumentEndSourceCreationInsertion({
      ...args,
      sourceRevision: statementMap.sourceRevision + 1
    })).toEqual({ kind: "unsafe", reason: "stale-source-revision" });
    expect(resolveDocumentEndSourceCreationInsertion({
      ...args,
      statementMap: {
        ...statementMap,
        statements: statementMap.statements.map((info, index) => index === 0
          ? { ...info, range: { ...info.range, endLine: source.split("\n").length + 1 } }
          : info)
      }
    })).toEqual({ kind: "unsafe", reason: "missing-statement-metadata" });
  });
});
