import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  dslCompletionInsertionTextFor,
  expressionReferenceTokenEndingAt,
  parseDslSnapshot,
  queryDslCompletion,
  type CompiledDslDocument,
  type DslCompletionQueryResult
} from "@nuinuicad/nui-language";

const compileWithIds = (source: string, sourceRevision = 1697): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue-1697-completion:${index}`]))
  });
};

const queryAt = (
  source: string,
  position: number,
  compiled = compileWithIds(source),
  sourceRevision = compiled.spans.sourceMap.sourceRevision
) => queryDslCompletion({
  source: { normalizedSource: source, sourceRevision },
  position,
  semantic: { sourceRevision, compiled }
});

const candidate = (result: DslCompletionQueryResult | null, kind: string, label: string) =>
  result?.candidates.find((item) => item.kind === kind && item.label === label);

const insert = (source: string, result: DslCompletionQueryResult, item: NonNullable<ReturnType<typeof candidate>>) =>
  source.slice(0, result.replacementRange.from) +
  dslCompletionInsertionTextFor(item, result.category, result.replacementRange, source) +
  source.slice(result.replacementRange.to);

describe("Issue #1697 shared completion syntax cutover", () => {
  it("separates bare typed references from schema-authorized @choice literals", () => {
    const source = [
      "nui 1",
      "const width: number = 40",
      "const left: number = 12",
      "const picked: choice(left, right) = @left",
      "const copied: number = wi",
      "const selected: choice(left, right) = @le",
      "const bareChoice: choice(left, right) = le",
      "const wrongSigil: number = @wi"
    ].join("\n");
    const compiled = compileWithIds(source);

    const widthCursor = source.indexOf("wi", source.indexOf("const copied")) + 2;
    const widthQuery = queryAt(source, widthCursor, compiled);
    const width = candidate(widthQuery, "binding", "width");
    const widthBinding = compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "width");
    expect(width).toMatchObject({ identity: widthBinding?.id });
    expect(widthQuery?.replacementRange).toEqual({ from: widthCursor - 2, to: widthCursor });
    expect(insert(source, widthQuery!, width!)).toBe(source.replace(/wi(?=\nconst selected)/, "width"));
    expect(dslCompletionInsertionTextFor(width!, widthQuery!.category, widthQuery!.replacementRange, source)).toBe("width");
    expect(widthQuery?.candidates.some((item) => item.kind === "binding" && item.label === "@width")).toBe(false);

    const choiceCursor = source.indexOf("@le", source.indexOf("const selected")) + "@le".length;
    const choiceQuery = queryAt(source, choiceCursor, compiled);
    const leftOption = candidate(choiceQuery, "literal", "left");
    expect(leftOption).toMatchObject({ identity: "left", sourceText: "@left" });
    expect(choiceQuery?.replacementRange).toEqual({ from: choiceCursor - 2, to: choiceCursor });
    expect(dslCompletionInsertionTextFor(leftOption!, choiceQuery!.category, choiceQuery!.replacementRange, source)).toBe("left");
    expect(insert(source, choiceQuery!, leftOption!)).toBe(source.replace("@le\n", "@left\n"));
    expect(choiceQuery?.candidates.some((item) => item.kind === "binding" && item.label === "left")).toBe(false);

    const bareChoiceCursor = source.indexOf("le", source.indexOf("const bareChoice")) + 2;
    const bareChoiceQuery = queryAt(source, bareChoiceCursor, compiled);
    expect((bareChoiceQuery?.candidates ?? []).some((item) => item.kind === "literal" && item.label === "left")).toBe(false);
    expect((bareChoiceQuery?.candidates ?? []).some((item) => item.kind === "binding" && item.label === "left")).toBe(false);

    const wrongSigilCursor = source.indexOf("@wi", source.indexOf("const wrongSigil")) + "@wi".length;
    const wrongSigilQuery = queryAt(source, wrongSigilCursor, compiled);
    expect(wrongSigilQuery?.candidates.some((item) => item.kind === "binding" && item.label === "width")).toBe(false);

    const emptyChoiceSource = "nui 1\nconst selection: choice(left, right) = ";
    const emptyChoiceQuery = queryAt(emptyChoiceSource, emptyChoiceSource.length);
    const emptyLeft = candidate(emptyChoiceQuery, "literal", "left");
    expect(emptyLeft?.sourceText).toBe("@left");
    expect(dslCompletionInsertionTextFor(emptyLeft!, emptyChoiceQuery!.category, emptyChoiceQuery!.replacementRange, emptyChoiceSource)).toBe("@left");
    const completedChoiceSource = insert(emptyChoiceSource, emptyChoiceQuery!, emptyLeft!);
    expect(completedChoiceSource).toContain("choice(left, right) = @left");
    expect(compileWithIds(completedChoiceSource).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps geometry property replacement member-only across qualified and occurrence paths", () => {
    const paths = [
      { text: "AB.le", element: "AB", occurrence: undefined },
      { text: "front::AB.le", element: "front::AB", occurrence: undefined },
      { text: "::front::AB.le", element: "::front::AB", occurrence: undefined },
      { text: "Mark[1].le", element: "Mark", occurrence: "1" },
      { text: "AB.start", element: "AB", occurrence: undefined }
    ];
    for (const entry of paths) {
      const match = expressionReferenceTokenEndingAt(entry.text, entry.text.length);
      const memberStart = entry.text.lastIndexOf(".") + 1;
      expect(match).toMatchObject({
        kind: "elementProperty",
        tokenStart: 0,
        from: memberStart,
        to: entry.text.length,
        sigil: false,
        elementToken: entry.element,
        ...(entry.occurrence ? { occurrenceIndex: entry.occurrence } : {})
      });
      expect(entry.text.slice(match!.from, match!.to)).toBe(entry.text.slice(memberStart));
    }
    expect(expressionReferenceTokenEndingAt("1.23", 4)).toBeNull();
    expect(expressionReferenceTokenEndingAt("@AB.le", 6)).toBeNull();
    expect(expressionReferenceTokenEndingAt("@width", 6)).toBeNull();
    const invalidQuotedPath = "\"unfinished path::AB.le";
    expect(expressionReferenceTokenEndingAt(invalidQuotedPath, invalidQuotedPath.length)).toBeNull();

    const source = [
      "nui 1",
      "line AB = segment(start: (0, 0), end: (30, 0))",
      "const measured: number = AB.le"
    ].join("\n");
    const cursor = source.length;
    const result = queryAt(source, cursor);
    const length = candidate(result, "property", "length");
    expect(result?.replacementRange).toEqual({ from: cursor - 2, to: cursor });
    expect(length?.identity).toBeTruthy();
    const completed = insert(source, result!, length!);
    expect(completed).toBe(source.replace("AB.le", "AB.length"));
    expect(compileWithIds(completed).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("queries numeric geometry properties through relative, absolute, and occurrence references", () => {
    const source = [
      "nui 1",
      "group front {",
      "  line AB = segment(start: (0, 0), end: (30, 0))",
      "}",
      "const relativeLength: number = front::AB.length",
      "const absoluteLength: number = ::front::AB.length",
      "for i in range(min: 0, max: 2, step: 1) {",
      "  line Mark = segment(start: (0, 0), end: (10, 0))",
      "  const occurrenceLength: number = Mark[1].length",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    for (const reference of ["front::AB.length", "::front::AB.length", "Mark[1].length"]) {
      const cursor = source.indexOf(reference) + reference.length;
      const result = queryAt(source, cursor, compiled);
      const length = candidate(result, "property", "length");
      expect(length?.identity).toBeTruthy();
      expect(dslCompletionInsertionTextFor(length!, result!.category, result!.replacementRange, source)).toBe("length");
      expect(source.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe("length");
    }
  });

  it("uses bare canonical spellings for construction, list, layer, target, and Module candidates", () => {
    const source = [
      "nui 1",
      "layer Pat",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line L = segment(start: A, end: B)",
      "line Offset = offset(sources: [L], distance: 2, side: @left, closed: false, suppressTrimWarnings: false)",
      "module Maker(width: number, anchor: point, path: path) {",
      "  const inside: number = width",
      "}",
      "const widthCopy: number = 0",
      "instance Use = Maker(width: 4, anchor: A, path: L)",
      "reverse L()",
      "line WithLayer in Pat = segment(start: A, end: B)",
      "layout Layout {",
      "}",
      "print Output(layout: Layout, layers: [Pat], paper: a4, overlap: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const sourceValueCursor = source.indexOf("start: A") + "start: A".length;
    const construction = queryAt(source, sourceValueCursor, compiled);
    const pointA = candidate(construction, "geometry", "A");
    expect(pointA?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(pointA!, construction!.category, construction!.replacementRange, source)).toBe("A");

    const arrayCursor = source.indexOf("sources: [L") + "sources: [L".length;
    const arrayQuery = queryAt(source, arrayCursor, compiled);
    const lineL = candidate(arrayQuery, "geometry", "L");
    expect(lineL?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(lineL!, arrayQuery!.category, arrayQuery!.replacementRange, source)).toBe("L");

    const choiceCursor = source.indexOf("@left", source.indexOf("line Offset")) + "@left".length;
    const choiceQuery = queryAt(source, choiceCursor, compiled);
    const leftOption = candidate(choiceQuery, "literal", "left");
    expect(leftOption).toMatchObject({ identity: "left", sourceText: "@left" });
    expect(dslCompletionInsertionTextFor(leftOption!, choiceQuery!.category, choiceQuery!.replacementRange, source)).toBe("left");

    const moduleWidthCursor = source.indexOf("= width", source.indexOf("module Maker")) + "= width".length;
    const moduleWidthQuery = queryAt(source, moduleWidthCursor, compiled);
    const moduleWidth = candidate(moduleWidthQuery, "binding", "width");
    expect(moduleWidth?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(moduleWidth!, moduleWidthQuery!.category, moduleWidthQuery!.replacementRange, source)).toBe("width");

    const shorthandSource = [
      "nui 1",
      "const width: number = 4",
      "module Shorthand(width: number = 0) {",
      "}",
      "instance Use = Shorthand()"
    ].join("\n");
    const shorthandCursor = shorthandSource.indexOf("Shorthand()") + "Shorthand(".length;
    const shorthandQuery = queryAt(shorthandSource, shorthandCursor);
    const shorthand = candidate(shorthandQuery, "literal", "width");
    const named = candidate(shorthandQuery, "argumentName", "width");
    expect(shorthand?.identity).toContain("module-argument-shorthand:");
    expect(dslCompletionInsertionTextFor(shorthand!, shorthandQuery!.category, shorthandQuery!.replacementRange, shorthandSource)).toBe("width");
    expect(dslCompletionInsertionTextFor(named!, shorthandQuery!.category, shorthandQuery!.replacementRange, shorthandSource)).toBe("width: ");

    const targetCursor = source.indexOf("reverse L") + "reverse L".length;
    const targetQuery = queryAt(source, targetCursor, compiled);
    const targetA = candidate(targetQuery, "geometry", "L");
    expect(targetQuery?.category).toBe("transformationTarget");
    expect(targetA?.sourceText).toBe("L");
    expect(dslCompletionInsertionTextFor(targetA!, targetQuery!.category, targetQuery!.replacementRange, source)).toBe("L");

    const layerCursor = source.indexOf("in Pat") + "in Pat".length;
    const layerQuery = queryAt(source, layerCursor, compiled);
    const layer = candidate(layerQuery, "layer", "Pat");
    expect(layer?.sourceText).toBe("Pat");
    expect(dslCompletionInsertionTextFor(layer!, layerQuery!.category, layerQuery!.replacementRange, source)).toBe("Pat");

    const printCursor = source.indexOf("layers: [Pat") + "layers: [Pat".length;
    const printQuery = queryAt(source, printCursor, compiled);
    expect(candidate(printQuery, "layer", "Pat")?.sourceText).toBe("Pat");
  });

  it("retains Module record and geometry candidate identities for bare members", () => {
    const source = [
      "nui 1",
      "record Piece(width: number, label: string)",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "module Maker(path: path, input: Piece) {",
      "  export line outline = segment(start: (0, 0), end: (10, 0))",
      "  export const copy: Piece = Piece(width: 4, label: \"seam\")",
      "  export const measure: number = 8",
      "  const pathLength: number = path.length",
      "}",
      "instance Use = Maker(path: L, input: Piece(width: 4, label: \"seam\"))",
      "const copiedWidth: number = Use::copy.width",
      "const outlineCopy: path = Use::outline",
      "const measuredCopy: number = Use::measure"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const moduleParameterCursor = source.indexOf("path.length") + "path.length".length;
    const moduleParameterQuery = queryAt(source, moduleParameterCursor, compiled);
    const pathLength = candidate(moduleParameterQuery, "property", "length");
    expect(pathLength?.identity).toContain("module-parameter:");
    expect(dslCompletionInsertionTextFor(pathLength!, moduleParameterQuery!.category, moduleParameterQuery!.replacementRange, source)).toBe("length");

    const recordCursor = source.indexOf("Use::copy.width") + "Use::copy.width".length;
    const recordQuery = queryAt(source, recordCursor, compiled);
    const recordWidth = candidate(recordQuery, "property", "width");
    expect(recordWidth?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(recordWidth!, recordQuery!.category, recordQuery!.replacementRange, source)).toBe("width");

    const qualifiedGeometryCursor = source.indexOf("Use::outline") + "Use::".length;
    const qualifiedGeometryQuery = queryAt(source, qualifiedGeometryCursor, compiled);
    const outline = candidate(qualifiedGeometryQuery, "geometry", "outline");
    expect(outline?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(outline!, qualifiedGeometryQuery!.category, qualifiedGeometryQuery!.replacementRange, source)).toBe("outline");

    const qualifiedScalarCursor = source.indexOf("Use::measure") + "Use::".length + 2;
    const qualifiedScalarQuery = queryAt(source, qualifiedScalarCursor, compiled);
    const measure = candidate(qualifiedScalarQuery, "binding", "measure");
    expect(measure?.identity).toBeTruthy();
    expect(dslCompletionInsertionTextFor(measure!, qualifiedScalarQuery!.category, qualifiedScalarQuery!.replacementRange, source)).toBe("measure");
  });

  it("keeps Module choice values distinct from references and rejects sigilled qualified members", () => {
    const choiceSource = [
      "nui 1",
      "const left: number = 12",
      "module Choose(side: choice(left, right)) {",
      "}",
      "instance Use = Choose(side: @le)"
    ].join("\n");
    const choiceCursor = choiceSource.length - 1;
    const choiceQuery = queryAt(choiceSource, choiceCursor);
    const leftOption = candidate(choiceQuery, "literal", "left");
    expect(leftOption).toMatchObject({ sourceText: "@left", identity: "left" });
    expect(choiceQuery?.candidates.some((item) => item.kind === "binding" && item.label === "left")).toBe(false);
    expect(insert(choiceSource, choiceQuery!, leftOption!)).toBe(choiceSource.replace("@le)", "@left)"));

    const qualifiedSource = [
      "nui 1",
      "module Producer() {",
      "  export const measure: number = 10",
      "}",
      "module Consumer(value: number) {",
      "}",
      "instance Use = Producer()",
      "instance Outer = Consumer(value: @Use::mea)"
    ].join("\n");
    const qualifiedCompiled = compileWithIds(qualifiedSource);
    expect(qualifiedCompiled.moduleSemanticAnalysis).toBeDefined();
    const qualifiedCursor = qualifiedSource.length - 1;
    const qualifiedQuery = queryAt(qualifiedSource, qualifiedCursor, qualifiedCompiled);
    expect(qualifiedQuery?.context.kind).toBe("moduleQualifiedMember");
    expect(qualifiedQuery?.candidates.some((item) => item.label === "measure")).toBe(false);
  });

  it("keeps number, boolean, string, none, and source path text unchanged", () => {
    const emptyNumber = "nui 1\nconst circumference: number = ";
    const numberQuery = queryAt(emptyNumber, emptyNumber.length);
    expect(numberQuery?.candidates.some((item) => item.label === "pi")).toBe(true);
    expect(numberQuery?.candidates.some((item) => item.kind === "builtin" && item.label === "distance")).toBe(true);

    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "image Reference = image(source: \"assets/underlay@front.png\", origin: A, scale: 1)",
      "const flag: boolean = true",
      "const missing: number? = none",
      "const title: string = \"literal @width\"",
      "const width: number = 4",
      "const copied: number = wi"
    ].join("\n");
    const cursor = source.indexOf("wi", source.indexOf("const copied")) + 2;
    const result = queryAt(source, cursor);
    const width = candidate(result, "binding", "width");
    const completed = insert(source, result!, width!);
    expect(completed).toContain('source: "assets/underlay@front.png"');
    expect(completed).toContain("const flag: boolean = true");
    expect(completed).toContain("const missing: number? = none");
    expect(completed).toContain('const title: string = "literal @width"');
  });

  it("rejects stale binding snapshots and leaves unrelated source bytes untouched", () => {
    const committedSource = "nui 1\nconst width: number = 40\nconst copied: number = 0";
    const stale = compileWithIds(committedSource, 12);
    const liveSource = "nui 1\nconst width: number = 40\nconst copied: number = wi";
    const cursor = liveSource.length;
    const result = queryDslCompletion({
      source: { normalizedSource: liveSource, sourceRevision: 12 },
      position: cursor,
      semantic: { sourceRevision: 12, compiled: stale }
    });
    expect(result?.candidates.some((item) => item.kind === "binding" && item.label === "width")).toBe(false);

    const exactSource = "nui 1\nimport \"./lib@front.nui\" as lib\nconst width: number = 40\nconst copied: number = wi\nconst text: string = \"literal @width\"\n// keep this comment";
    const exact = compileWithIds(exactSource);
    const exactCursor = exactSource.indexOf("wi", exactSource.indexOf("const copied")) + 2;
    const exactQuery = queryAt(exactSource, exactCursor, exact);
    const width = candidate(exactQuery, "binding", "width");
    const completed = insert(exactSource, exactQuery!, width!);
    expect(completed).toBe("nui 1\nimport \"./lib@front.nui\" as lib\nconst width: number = 40\nconst copied: number = width\nconst text: string = \"literal @width\"\n// keep this comment");
    expect(completed.slice(completed.indexOf("//"))).toBe("// keep this comment");
  });
});
