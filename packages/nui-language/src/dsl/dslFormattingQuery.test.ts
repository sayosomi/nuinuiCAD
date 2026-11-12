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
import {
  compileCanonicalText,
  compileFreshCanonicalText,
  isLastGoodDslDocument
} from "../document/canonicalDocument";
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

const expectNonOverlappingEdits = (edits: ReturnType<typeof queryDslFormatting>) => {
  const ordered = [...edits].sort((left, right) => left.range.from - right.range.from);
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index - 1]!.range.to).toBeLessThanOrEqual(ordered[index]!.range.from);
  }
};

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

  it.each([
    {
      label: "without an existing trailing comma",
      source: [
        "record Label(text: string)",
        "",
        "const item: Label = Label(",
        "      text: \"sample\"",
        "    )"
      ].join("\n")
    },
    {
      label: "with an existing trailing comma",
      source: [
        "record Label(text: string)",
        "",
        "const item: Label = Label(",
        "      text: \"sample\",",
        "    )"
      ].join("\n")
    }
  ])("canonicalizes single-argument multiline calls $label", ({ source }) => {
    const expected = [
      "record Label(text: string)",
      "",
      "const item: Label = Label(",
      "  text: \"sample\",",
      ")"
    ].join("\n");
    const formatted = formatText(source);

    expect(formatted).toBe(expected);
    expect(format(formatted)).toEqual([]);
  });

  it("canonicalizes nested one-argument calls with stable closing-delimiter alignment", () => {
    const source = [
      "nui 1",
      "record Label(text: string)",
      "record Pair(label: Label, title: string)",
      "const pair: Pair = Pair(label: Label(",
      "text: \"sample\"",
      "), title: \"sample\")"
    ].join("\n");

    const formatted = formatText(source);
    expect(formatted).toBe([
      "nui 1",
      "record Label(text: string)",
      "record Pair(",
      "  label: Label,",
      "  title: string,",
      ")",
      "const pair: Pair = Pair(",
      "  label: Label(",
      "    text: \"sample\",",
      "  ),",
      "  title: \"sample\",",
      ")"
    ].join("\n"));
    expect(format(formatted)).toEqual([]);
  });

  it("keeps inline and standalone comments with their arguments while formatting calls", () => {
    const source = [
      "nui 1",
      "record Label(text: string)",
      "record Pair(left: number, right: number)",
      "const item: Label = Label( // keep before text",
      "text: \"sample\" /* keep after text */)",
      "const pair: Pair = Pair(left: 1 /* keep after left */, /* keep before right */ right: 2)"
    ].join("\n");
    const formatted = formatText(source);
    const expected = [
      "nui 1",
      "record Label(text: string)",
      "record Pair(",
      "  left: number,",
      "  right: number,",
      ")",
      "const item: Label = Label(",
      "  // keep before text",
      "  text: \"sample\" /* keep after text */,",
      ")",
      "const pair: Pair = Pair(",
      "  left: 1 /* keep after left */,",
      "  /* keep before right */ right: 2,",
      ")"
    ].join("\n");

    expect(formatted).toBe(expected);
    expect(scanDslSourceForComments(formatted)).toEqual(scanDslSourceForComments(source));
    expect(formatted.indexOf("/* keep after left */")).toBeLessThan(formatted.indexOf("/* keep before right */"));
    expect(formatted.indexOf("/* keep before right */")).toBeLessThan(formatted.indexOf("right: 2"));
    const before = compileAndEvaluate(source);
    const after = compileAndEvaluate(formatted);
    expect(after.compiled.statements.map((statement) => statement.kind)).toEqual(
      before.compiled.statements.map((statement) => statement.kind)
    );
    const orderedEdits = format(source).sort((left, right) => left.range.from - right.range.from);
    for (let index = 1; index < orderedEdits.length; index += 1) {
      expect(orderedEdits[index - 1]!.range.to).toBeLessThanOrEqual(orderedEdits[index]!.range.from);
    }
    expect(format(formatted)).toEqual([]);
  });

  it.each([
    {
      label: "same-line trailing comment",
      argumentLine: "  text: \"sample\" // comment",
      expectedArgumentLine: "  text: \"sample\", // comment"
    },
    {
      label: "same-line trailing comment with extra separator whitespace",
      argumentLine: "  text: \"sample\"    // comment",
      expectedArgumentLine: "  text: \"sample\", // comment"
    },
    {
      label: "standalone trailing comment",
      argumentLine: "  text: \"sample\"\n  // comment",
      expectedArgumentLine: "  text: \"sample\",\n  // comment"
    }
  ])("places a missing trailing comma before a $label in one pass", ({ argumentLine, expectedArgumentLine }) => {
    const source = [
      "nui 1",
      "// outside before",
      "record Label(text: string)",
      "",
      "const item: Label = Label(",
      argumentLine,
      ")",
      "// outside after"
    ].join("\n");
    const expected = [
      "nui 1",
      "// outside before",
      "record Label(text: string)",
      "",
      "const item: Label = Label(",
      expectedArgumentLine,
      ")",
      "// outside after"
    ].join("\n");
    const start = source.indexOf("const item:");
    const end = source.indexOf("\n// outside after");
    const selection = { from: start, to: end };
    const edits = format(source, defaultOptions, selection);
    const formatted = applyEdits(source, edits);

    expectNonOverlappingEdits(edits);
    expect(formatted).toBe(expected);
    expect(formatted.slice(0, start)).toBe(source.slice(0, start));
    expect(formatted.slice(formatted.indexOf("\n// outside after"))).toBe(source.slice(end));
    expect(scanDslSourceForComments(formatted)).toEqual(scanDslSourceForComments(source));
    expect(format(formatted)).toEqual([]);

    const before = compileAndEvaluate(source);
    const after = compileAndEvaluate(formatted);
    expect(after.compiled.statements.map((statement) => statement.kind)).toEqual(
      before.compiled.statements.map((statement) => statement.kind)
    );
    expect(after.evaluation.errors).toEqual(before.evaluation.errors);
    expect([...after.evaluation.computedGeometry]).toEqual([...before.evaluation.computedGeometry]);
  });

  it("keeps an existing comma before a same-line comment without duplicating it", () => {
    const source = [
      "record Label(text: string)",
      "",
      "const item: Label = Label(",
      "      text: \"sample\", // comment",
      "    )"
    ].join("\n");
    const expected = [
      "record Label(text: string)",
      "",
      "const item: Label = Label(",
      "  text: \"sample\", // comment",
      ")"
    ].join("\n");

    const formatted = formatText(source);
    expect(formatted).toBe(expected);
    expect(scanDslSourceForComments(formatted)).toEqual(scanDslSourceForComments(source));
    expect(format(formatted)).toEqual([]);
  });

  it("keeps nested trailing comments with their argument and aligns both closing delimiters", () => {
    const source = [
      "nui 1",
      "record Label(text: string)",
      "record Pair(label: Label, title: string)",
      "const pair: Pair = Pair(label: Label(",
      "text: \"sample\" // nested",
      "), title: \"other\")"
    ].join("\n");
    const expected = [
      "nui 1",
      "record Label(text: string)",
      "record Pair(",
      "  label: Label,",
      "  title: string,",
      ")",
      "const pair: Pair = Pair(",
      "  label: Label(",
      "    text: \"sample\", // nested",
      "  ),",
      "  title: \"other\",",
      ")"
    ].join("\n");
    const edits = format(source);
    const formatted = applyEdits(source, edits);

    expectNonOverlappingEdits(edits);
    expect(formatted).toBe(expected);
    expect(scanDslSourceForComments(formatted)).toEqual(scanDslSourceForComments(source));
    expect(format(formatted)).toEqual([]);

    const before = compileAndEvaluate(source);
    const after = compileAndEvaluate(formatted);
    expect(after.compiled.statements.map((statement) => statement.kind)).toEqual(
      before.compiled.statements.map((statement) => statement.kind)
    );
    expect(after.evaluation.errors).toEqual(before.evaluation.errors);
    expect([...after.evaluation.computedGeometry]).toEqual([...before.evaluation.computedGeometry]);
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
    expect(format(formatted)).toEqual([]);
  });

  it("preserves production statement and drawable identities through canonical recompilation", () => {
    const source = [
      "nui 1",
      "record Label(text: string)",
      "const item: Label = Label(text: \"sample\")",
      "group hand {",
      "group box {",
      "point left = coordinate(x: 0, y: 0)",
      "point right = coordinate(x: 40, y: 0)",
      "point top = coordinate(x: 20, y: 30)",
      "line border = polyline(points: [@left, @right, @top], closed: true)",
      "}",
      "}"
    ].join("\n");
    const initial = compileFreshCanonicalText(source);
    expect(initial.status).toBe("valid");
    const formattedSource = formatText(initial.sourceText);
    const revised = compileCanonicalText(initial, formattedSource);
    expect(revised.status).toBe("valid");

    const initialStatementIds = initial.doc.statementMap.statementIdByStatementIndex!;
    const revisedStatementIds = revised.doc.statementMap.statementIdByStatementIndex!;
    for (const [statementIndex, identity] of initialStatementIds) {
      expect(revisedStatementIds.get(statementIndex)).toBe(identity);
    }
    expect(revisedStatementIds.size).toBe(initialStatementIds.size);
    const initialElementIds = initial.doc.statementMap.elementIdByStatementIndex;
    const revisedElementIds = revised.doc.statementMap.elementIdByStatementIndex;
    expect([...revisedElementIds]).toEqual([...initialElementIds]);
    const identityKinds = new Set(initial.doc.statements.map((statement, index) =>
      initialStatementIds.has(index) ? statement.kind : null
    ));
    expect(identityKinds).toContain("recordDefinition");
    expect(identityKinds).toContain("typedDeclaration");
    expect(identityKinds).toContain("element");

    expect(revised.doc.document.elements).toEqual(initial.doc.document.elements);
    const evaluationFor = (result: typeof initial) => evaluateElementsReference(
      result.doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: result.doc,
        evaluationLimitIndex: result.doc.document.evaluationLimitIndex
      })
    );
    const beforeEvaluation = evaluationFor(initial);
    const afterEvaluation = evaluationFor(revised);
    expect(afterEvaluation.errors).toEqual(beforeEvaluation.errors);
    expect(afterEvaluation.errors).toEqual([]);
    expect([...afterEvaluation.computedGeometry]).toEqual([...beforeEvaluation.computedGeometry]);
    expect(format(formattedSource)).toEqual([]);
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
