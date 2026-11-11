/// <reference lib="dom" />
/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDsl,
  parseDslSnapshot,
  queryDslFormatting,
  scanDslSource,
  type DslFormattingOptions,
  type DslFormattingSourceRange
} from "../index";
import { isLastGoodDslDocument } from "../document/canonicalDocument";
import { evaluateElementsReference } from "../../../../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../../../../src/geometry/productionEvaluationContext";

const defaultOptions: DslFormattingOptions = { tabSize: 2, insertSpaces: true };

const format = (
  source: string,
  options: DslFormattingOptions = defaultOptions,
  selectionRange?: DslFormattingSourceRange
) => queryDslFormatting({ normalizedSource: source, options, ...(selectionRange ? { selectionRange } : {}) });

const applyEdits = (
  source: string,
  edits: ReturnType<typeof queryDslFormatting>
): string => {
  let result = source;
  for (const edit of [...edits].sort((left, right) => right.range.from - left.range.from)) {
    result = `${result.slice(0, edit.range.from)}${edit.newText}${result.slice(edit.range.to)}`;
  }
  return result;
};

const formatText = (source: string, options: DslFormattingOptions = defaultOptions) =>
  applyEdits(source, format(source, options));

const compileAndEvaluate = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(
    parsed.statements.map((_, index) => [index, `formatter-statement-${index}`] as const)
  );
  const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(isLastGoodDslDocument(compiled)).toBe(true);
  if (!isLastGoodDslDocument(compiled)) throw new Error("expected valid formatter fixture");
  const evaluation = evaluateElementsReference(
    compiled.document.elements,
    buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    })
  );
  return { compiled, evaluation };
};

describe("nui source formatting query", () => {
  it("canonically indents nested hand/box groups and multiline polyline construction", () => {
    const source = [
      "nui 1",
      "group hand {",
      "group box {",
      "point left = coordinate(x:0,y:0)",
      "point right = coordinate(x:40,y:0)",
      "line border = polyline(points: [@left, @right], closed:true)",
      "}",
      "}"
    ].join("\n");

    expect(formatText(source)).toBe([
      "nui 1",
      "group hand {",
      "  group box {",
      "    point left = coordinate(",
      "      x: 0,",
      "      y: 0,",
      "    )",
      "    point right = coordinate(",
      "      x: 40,",
      "      y: 0,",
      "    )",
      "    line border = polyline(",
      "      points: [@left, @right],",
      "      closed: true,",
      "    )",
      "  }",
      "}"
    ].join("\n"));
  });

  it("preserves compiled statement identities, references, and evaluated geometry", () => {
    const source = [
      "nui 1",
      "group hand {",
      "group box {",
      "point left = coordinate(x: 0, y: 0)",
      "point right = coordinate(x: 40, y: 0)",
      "point top = coordinate(x: 20, y: 30)",
      "line border = polyline(points: [@left, @right, @top], closed: true)",
      "}",
      "}"
    ].join("\n");
    const formatted = formatText(source);
    const original = compileAndEvaluate(source);
    const after = compileAndEvaluate(formatted);

    expect([...after.compiled.statementMap!.statementIdByStatementIndex!]).toEqual(
      [...original.compiled.statementMap!.statementIdByStatementIndex!]
    );
    expect(after.compiled.document.elements.map((element) => element.id)).toEqual(
      original.compiled.document.elements.map((element) => element.id)
    );
    const references = (compiled: typeof original.compiled) => compiled.document.elements
      .filter((element) => element.name === "border")
      .map((element) => ({
        start: "startPoint" in element ? element.startPoint : undefined,
        end: "endPoint" in element ? element.endPoint : undefined
      }));
    expect(references(after.compiled)).toEqual(references(original.compiled));
    expect(after.evaluation.errors).toEqual([]);
    expect(original.evaluation.errors).toEqual([]);
    expect([...after.evaluation.computedGeometry]).toEqual([...original.evaluation.computedGeometry]);
  });

  it("keeps a range-format edit inside the selected declaration bytes", () => {
    const source = [
      "// outside before",
      "group hand {",
      "  // outside in the group",
      "  point left = coordinate(x: 0, y: 0)",
      "  point right = coordinate(x: 40, y: 0)",
      "  line border = polyline(points: [@left, @right], closed:true)",
      "  // outside after",
      "}",
      "// outside at root"
    ].join("\n");
    const start = source.indexOf("  line border");
    const end = source.indexOf("\n", start);
    const selected: DslFormattingSourceRange = { from: start, to: end };
    const formatted = applyEdits(source, format(source, defaultOptions, selected));

    expect(formatted.slice(0, start)).toBe(source.slice(0, start));
    const delta = formatted.length - source.length;
    expect(formatted.slice(end + delta)).toBe(source.slice(end));
    expect(formatted).toContain("  line border = polyline(\n    points: [@left, @right],\n    closed: true,\n  )");
  });

  it("respects indentation width and tabs", () => {
    const source = "group G {\npoint P = coordinate(x:0,y:0)\n}";
    expect(formatText(source, { tabSize: 4, insertSpaces: true })).toContain(
      "    point P = coordinate(\n        x: 0,\n        y: 0,\n    )"
    );
    expect(formatText(source, { tabSize: 4, insertSpaces: false })).toBe(
      "group G {\n\tpoint P = coordinate(\n\t\tx: 0,\n\t\ty: 0,\n\t)\n}"
    );
  });

  it("indents nested modules, record definitions and constructors, arrays, and value blocks", () => {
    const source = [
      "record Pair(left: number,right: number)",
      "module Box(width:number,height:number) {",
      "const values: number[] = [",
      "1,",
      "2,",
      "]",
      "const pair: Pair = Pair(left:1,right:2)",
      "const selected: number = if (@flag) {",
      "1",
      "} else {",
      "2",
      "}",
      "}"
    ].join("\n");
    const formatted = formatText(source);

    expect(formatted).toContain("record Pair(\n  left: number,\n  right: number,\n)");
    expect(formatted).toContain("module Box(\n  width: number,\n  height: number,\n) {");
    expect(formatted).toContain("  const values: number[] = [\n    1,\n    2,\n  ]");
    expect(formatted).toContain("  const pair: Pair = Pair(\n    left: 1,\n    right: 2,\n  )");
    expect(formatted).toContain("    1\n  } else {\n    2\n  }");
  });

  it("preserves comments, quoted strings, blank lines, references, layers, and transformations", () => {
    const source = [
      "// keep me",
      "layer paper",
      "group G {",
      "point A = coordinate(x:0,y:0) // end comment",
      "",
      "line L in @paper = segment(start:@lib::A, end:@A)",
      "move @L (from:@A, to:@L.end) // keep transformation comment",
      "const text: string = \"quoted // and } and )\"",
      "}",
      "/* block opener */",
      "point Outside = coordinate(x:0,y:0)"
    ].join("\n");
    const formatted = formatText(source);
    const comments = (value: string) => scanDslSourceForComments(value);

    expect(comments(formatted)).toEqual(comments(source));
    expect(formatted).toContain("  line L in @paper = segment(\n    start: @lib::A,\n    end: @A,\n  )");
    expect(formatted).toContain("  move @L (\n    from: @A,\n    to: @L.end,\n  ) // keep transformation comment");
    expect(formatted).toContain("  const text: string = \"quoted // and } and )\"");
    expect(formatted).toContain("\n\n  line L");
  });

  it("keeps numeric operator continuations deeper than their declarations", () => {
    const source = [
      "group G {",
      "const leading: number = 1",
      "     + 2",
      "const trailing: number = 1 +",
      "  2",
      "}"
    ].join("\n");
    expect(formatText(source)).toBe([
      "group G {",
      "  const leading: number = 1",
      "    + 2",
      "  const trailing: number = 1 +",
      "    2",
      "}"
    ].join("\n"));
  });

  it("leaves incomplete calls and missing values unchanged while formatting independent safe statements", () => {
    const missingValue = "const broken: number = helper(first: , second: 2)";
    const incomplete = "const unfinished: number = helper(first: 1,\nsecond: 2";
    const source = [
      missingValue,
      incomplete,
      "group safe {",
      "point P = coordinate(x:0,y:0)",
      "}",
      "const independent: number = 4"
    ].join("\n");
    const formatted = formatText(source);

    expect(formatted).toContain(missingValue);
    expect(formatted).toContain(incomplete);
    expect(formatted).toContain("group safe {\n  point P = coordinate(\n    x: 0,\n    y: 0,\n  )\n}");
    expect(formatted).toContain("const independent: number = 4");
  });

  it("formats safe statements when an unrelated compiler diagnostic is present", () => {
    const source = [
      "nui 1",
      "const broken: point = coordinate(x: @missing, y: 20)",
      "line probe = segment(start: (10, 20), end: @broken)",
      "point safe = coordinate(x:0,y:0)"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `formatter-diagnostic-${index}`]))
    });
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);

    const formatted = formatText(source);
    expect(formatted).toContain("const broken: point = coordinate(\n  x: @missing,\n  y: 20,\n)");
    expect(formatted).toContain("point safe = coordinate(\n  x: 0,\n  y: 0,\n)");
  });

  it("produces no edits on a second pass", () => {
    const source = "group G {\npoint A = coordinate(x:0,y:0)\nline AB = segment(start:@A,end:(10,0))\n}";
    const once = formatText(source);
    expect(format(once)).toEqual([]);
  });

  it("fails closed for raw CRLF input and invalid selection bounds", () => {
    expect(format("group G {\r\npoint P\r\n}")).toEqual([]);
    expect(format("point P", defaultOptions, { from: 2, to: 100 })).toEqual([]);
  });
});

const scanDslSourceForComments = (source: string) => {
  return scanDslSource(source).lines.flatMap((line) => line.comments.map((comment) => comment.text));
};
