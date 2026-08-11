import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createModuleSemanticRangeIndex } from "../dsl/moduleSemanticEditor";
import { collapsedFoldTargetAtLine, foldTargetAtLine, foldTargets, moduleDefinitionFoldTargetAtLine, moduleDefinitionFoldTargets } from "./sourceEditorFolding";
import { createStatementRangeIndex } from "./statementRangeIndex";

describe("sourceEditorFolding structural rows", () => {
  it("resolves only collapsed folds from their visible opening and terminal rows", () => {
    const source = [
      "nui 3",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "point B = offset(",
      "  from: A,",
      "  dx: 10,",
      "  dy: 0",
      ")",
      "if Choice (1) {",
      "  point T = coordinate(x: 0, y: 0)",
      "} else {",
      "  point E = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const doc = Text.of(source.split("\n"));
    const ranges = createStatementRangeIndex(doc, compiled.statementMap!);
    const group = compiled.document!.elements.find((element) => element.name === "G")!;
    const multiline = compiled.document!.elements.find((element) => element.name === "B")!;
    const conditional = compiled.document!.elements.find((element) => element.name === "Choice")!;
    const collapsed = new Map([
      [group.id, { expanded: false }],
      [multiline.id, { statementExpanded: false }],
      [conditional.id, { expanded: false, elseExpanded: false }]
    ]);
    const targetAt = (line: number) =>
      collapsedFoldTargetAtLine(ranges, compiled.document!.elements, collapsed, doc.line(line).from)?.elementId;

    expect(targetAt(2)).toBe(group.id);
    expect(targetAt(4)).toBe(group.id);
    expect(targetAt(5)).toBe(multiline.id);
    expect(targetAt(9)).toBe(multiline.id);
    expect(targetAt(10)).toBe(conditional.id);
    expect(targetAt(12)).toBe(conditional.id);
    expect(targetAt(14)).toBe(conditional.id);
    expect(collapsedFoldTargetAtLine(ranges, compiled.document!.elements, new Map([
      [group.id, { expanded: true }],
      [multiline.id, { statementExpanded: true }],
      [conditional.id, { expanded: true, elseExpanded: true }]
    ]), doc.line(4).from)).toBeNull();
  });

  it("offers an expanded-by-default target for an ordinary multiline statement", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(",
      "  from: A,",
      "  dx: 100",
      ")"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    expect(compiled.diagnostics).toEqual([]);
    const doc = Text.of(source.split("\n"));
    const ranges = createStatementRangeIndex(doc, compiled.statementMap!);
    const pointB = compiled.document!.elements.find((element) => element.name === "B")!;

    expect(foldTargetAtLine(ranges, compiled.document!.elements, doc.line(3).from)).toMatchObject({
      elementId: pointB.id,
      branch: "statement",
      from: doc.line(3).to,
      to: doc.line(6).from
    });
    expect(foldTargets(ranges, compiled.document!.elements, new Map())).toEqual([]);
    expect(foldTargets(ranges, compiled.document!.elements, new Map([[pointB.id, { statementExpanded: false }]])))
      .toEqual([expect.objectContaining({ elementId: pointB.id, branch: "statement" })]);
  });

  it("places controls on independent brace rows and leaves both markers visible", () => {
    const source = [
      "nui 3",
      "if Choice (1)",
      "{",
      "  point T = coordinate(x: 0, y: 0)",
      "} else {",
      "  point E = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    expect(compiled.diagnostics).toEqual([]);
    const doc = Text.of(source.split("\n"));
    const ranges = createStatementRangeIndex(doc, compiled.statementMap!);
    const element = compiled.document!.elements[0]!;
    const open = doc.line(3);
    const elseLine = doc.line(5);
    const close = doc.line(7);
    expect(foldTargetAtLine(ranges, compiled.document!.elements, doc.line(2).from)).toBeNull();
    expect(foldTargetAtLine(ranges, compiled.document!.elements, open.from)).toMatchObject({ elementId: element.id, branch: "primary", from: open.to, to: elseLine.from - 1 });
    expect(foldTargetAtLine(ranges, compiled.document!.elements, elseLine.from)).toMatchObject({ elementId: element.id, from: elseLine.to, to: close.from });
  });

  it("projects then and else targets independently when both are collapsed", () => {
    const source = [
      "nui 3",
      "if Choice (1) {",
      "  point T = coordinate(x: 0, y: 0)",
      "} else {",
      "  point E = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    const doc = Text.of(source.split("\n"));
    const element = compiled.document!.elements[0]!;
    const targets = foldTargets(
      createStatementRangeIndex(doc, compiled.statementMap!),
      compiled.document!.elements,
      new Map([[element.id, { expanded: false, elseExpanded: false }]])
    );

    expect(targets.map((target) => target.branch)).toEqual(["primary", "else"]);
    expect(targets[0]!.to).toBeLessThan(targets[1]!.from);
  });
});

describe("sourceEditorFolding module definitions", () => {
  const compileModule = (source: string) => {
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 4 });
    const compiled = compileDslDocument(source, {
      sourceRevision: 4,
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    return compiled;
  };

  it("creates a source-only target keyed by the compiled StatementIdentity", () => {
    const source = [
      "nui 3",
      "module M(a: number) {",
      "  let x: number = @a",
      "  point P = coordinate(x: @x, y: 0)",
      "}",
      "module I = M(a: 10)"
    ].join("\n");
    const compiled = compileModule(source);
    const definition = compiled.moduleSemanticAnalysis!.definitions[0]!;
    const index = createModuleSemanticRangeIndex(compiled);
    const target = index.moduleDefinitionFoldRanges!.get(definition.statementId)!;

    expect(compiled.document!.elements.some((element) => element.id === definition.statementId)).toBe(false);
    expect(target).toMatchObject({
      statementId: definition.statementId,
      gutterLineFrom: source.indexOf("module M"),
      foldFrom: source.indexOf("{", source.indexOf("module M")) + 1,
      foldTo: source.lastIndexOf("}")
    });
    expect(moduleDefinitionFoldTargets(index, new Set())).toEqual([]);
    expect(moduleDefinitionFoldTargets(index, new Set([definition.statementId]))).toEqual([
      expect.objectContaining({ kind: "moduleDefinition", statementId: definition.statementId })
    ]);
    expect(foldTargets(createStatementRangeIndex(Text.of(source.split("\n")), compiled.statementMap!), compiled.document!.elements, new Map())).toEqual([]);
  });

  it("uses the opening brace row for multiline headers and standalone braces", () => {
    for (const source of [
      ["nui 3", "module M(", "  a: number", ") {", "  point P = coordinate(x: @a, y: 0)", "}"].join("\n"),
      ["nui 3", "module M(a: number)", "{", "  point P = coordinate(x: @a, y: 0)", "}"].join("\n")
    ]) {
      const compiled = compileModule(source);
      const definition = compiled.moduleSemanticAnalysis!.definitions[0]!;
      const index = createModuleSemanticRangeIndex(compiled);
      const openingBrace = source.indexOf("{", source.indexOf("module M"));
      const openingLineFrom = source.lastIndexOf("\n", openingBrace) + 1;
      const target = moduleDefinitionFoldTargetAtLine(index, openingLineFrom);
      const range = index.moduleDefinitionFoldRanges!.get(definition.statementId)!;

      expect(target).toMatchObject({
        statementId: definition.statementId,
        gutterLineFrom: range.gutterLineFrom,
        from: range.foldFrom,
        to: range.foldTo
      });
      expect(source.slice(range.gutterLineFrom, source.indexOf("\n", range.gutterLineFrom))).toContain("{");
    }
  });

  it("creates an independent parameter-list target only for multiline non-empty lists", () => {
    const source = [
      "nui 3",
      "module M(",
      "  a: choice(通常, 反転),",
      "  b: number",
      ") {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module I = M(a: 通常, b: 10)"
    ].join("\n");
    const compiled = compileModule(source);
    const definition = compiled.moduleSemanticAnalysis!.definitions[0]!;
    const index = createModuleSemanticRangeIndex(compiled);
    const body = index.moduleDefinitionFoldRanges!.get(definition.statementId)!;
    const parameters = index.moduleDefinitionParameterFoldRanges!.get(definition.statementId)!;
    const open = source.indexOf("(", source.indexOf("module M"));
    const close = source.indexOf(") {", open);

    expect(parameters).toMatchObject({
      statementId: definition.statementId,
      branch: "parameters",
      gutterLineFrom: source.lastIndexOf("\n", open) + 1,
      foldFrom: open + 1,
      foldTo: close
    });
    expect(source.slice(parameters.anchors[0].from, parameters.anchors[0].to)).toBe("(");
    expect(source.slice(parameters.anchors[1].from, parameters.anchors[1].to)).toBe(")");
    expect(body.branch).toBe("body");
    expect(moduleDefinitionFoldTargets(index, new Set(), new Set([definition.statementId]))).toEqual([
      expect.objectContaining({ branch: "parameters", statementId: definition.statementId })
    ]);

    for (const singleLineSource of [
      "nui 3\nmodule M(a: number, b: number) {\n}",
      "nui 3\nmodule M() {\n}"
    ]) {
      const singleLine = compileModule(singleLineSource);
      const singleDefinition = singleLine.moduleSemanticAnalysis!.definitions[0]!;
      const singleIndex = createModuleSemanticRangeIndex(singleLine);
      expect(singleIndex.moduleDefinitionParameterFoldRanges!.has(singleDefinition.statementId)).toBe(false);
    }
  });
});
