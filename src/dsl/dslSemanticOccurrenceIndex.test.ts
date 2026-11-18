import { describe, expect, it } from "vitest";
import {
  createDslSemanticOccurrenceIndex,
  createNuiLanguageSession,
  dslSemanticIdentityKey
} from "@nuinuicad/nui-language";
import { AutomationDocument, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElements } from "../geometry/evaluate";

const PROBE_NAME = "ProbeLine";

type Range = { from: number; to: number };
type Fixture = {
  name: string;
  source: string;
  operands: readonly string[];
};

const endpointFixtures: readonly Fixture[] = [
  {
    name: "A root single-line",
    source: [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 50, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "const turn: number = angle(@ProbeLine.end, @ProbeLine.start)"
    ].join("\n"),
    operands: ["@ProbeLine.end", "@ProbeLine.start"]
  },
  {
    name: "B root multiline",
    source: [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 50, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "const turn: number =",
      "  angle(@ProbeLine.end, @ProbeLine.start)",
      "  - angle(@ProbeLine.start, @ProbeLine.end)"
    ].join("\n"),
    operands: ["@ProbeLine.end", "@ProbeLine.start", "@ProbeLine.start", "@ProbeLine.end"]
  },
  {
    name: "C group multiline",
    source: [
      "nui 1",
      "group Sample {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 50, y: 0)",
      "  line ProbeLine = segment(start: @A, end: @B)",
      "  const turn: number =",
      "    angle(@ProbeLine.end, @ProbeLine.start)",
      "    - angle(@ProbeLine.start, @ProbeLine.end)",
      "}"
    ].join("\n"),
    operands: ["@ProbeLine.end", "@ProbeLine.start", "@ProbeLine.start", "@ProbeLine.end"]
  }
];

const errorDiagnostics = (compiled: ReturnType<AutomationDocument["getState"]>["currentCompiled"]) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const rangesForAuthoredOperands = (source: string, operands: readonly string[]): Range[] => {
  let cursor = 0;
  return operands.map((operand) => {
    const start = source.indexOf(operand, cursor);
    if (start < 0) throw new Error("missing authored operand " + operand);
    cursor = start + operand.length;
    const identifier = operand.slice(1, operand.indexOf("."));
    return { from: start + 1, to: start + 1 + identifier.length };
  });
};

const normalizeRenamedDisplayNames = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeRenamedDisplayNames);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    key === "name" ? "<renamed>" : normalizeRenamedDisplayNames(nested)
  ]));
};

const probeDeclarationFor = (compiled: ReturnType<AutomationDocument["getState"]>["currentCompiled"]) => {
  const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find((candidate) =>
    candidate.kind === "geometry" && candidate.name === PROBE_NAME
  );
  if (!declaration) throw new Error("missing compiler declaration " + PROBE_NAME);
  const elementId = compiled.statementMap?.elementIdByStatementIndex.get(declaration.statementIndex);
  if (!elementId) throw new Error("missing stable element identity for " + PROBE_NAME);
  const nameOffset = compiled.spans.sourceMap.source.indexOf("line " + PROBE_NAME) + "line ".length;
  return {
    statementId: declaration.statementId,
    identity: { kind: "element" as const, elementId },
    range: { from: nameOffset, to: nameOffset + PROBE_NAME.length }
  };
};

const targetStatementId = (target: unknown): string | null => {
  if (!target || typeof target !== "object" || !("statementId" in target)) return null;
  return typeof target.statementId === "string" ? target.statementId : null;
};

const applyEdits = (
  source: string,
  edits: readonly { from: number; to: number; newText: string }[]
) => [...edits]
  .sort((left, right) => right.from - left.from || right.to - left.to)
  .reduce((text, edit) => text.slice(0, edit.from) + edit.newText + text.slice(edit.to), source);

const evaluateCompiled = (compiled: ReturnType<AutomationDocument["getState"]>["currentCompiled"]) => {
  if (!compiled.document) throw new Error("expected a compiled document");
  return evaluateElements(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: compiled as LastGoodDslDocument,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  }));
};

const assertResolvedEndpointIndex = (
  source: string,
  operands: readonly string[],
  compiled: ReturnType<AutomationDocument["getState"]>["currentCompiled"],
  session: ReturnType<typeof createNuiLanguageSession>
) => {
  expect(errorDiagnostics(compiled)).toEqual([]);
  expect(session.getSource()).toBe(source);
  const declaration = probeDeclarationFor(compiled);
  const expectedOperandRanges = rangesForAuthoredOperands(source, operands).sort((a, b) => a.from - b.from);

  const semanticAnalysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  const compilerArguments = [...(semanticAnalysis?.rootScalarExpressionsByStatementId.values() ?? [])]
    .flatMap((site) => site.expression.geometryBuiltinArguments)
    .filter((argument) => targetStatementId(argument.reference.target) === declaration.statementId);
  expect(compilerArguments).toHaveLength(operands.length);

  const index = createDslSemanticOccurrenceIndex(compiled);
  const targetKey = dslSemanticIdentityKey(declaration.identity);
  const targetOccurrences = index.occurrences
    .filter((occurrence) => dslSemanticIdentityKey(occurrence.identity) === targetKey)
    .map(({ kind, from, to }) => ({ kind, from, to }));
  const expectedOccurrences = [
    { kind: "declaration" as const, ...declaration.range },
    ...expectedOperandRanges.map((range) => ({ kind: "reference" as const, ...range }))
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  expect(targetOccurrences).toEqual(expectedOccurrences);

  for (const range of expectedOperandRanges) {
    expect(source.slice(range.from, range.to)).toBe(PROBE_NAME);
    expect(source[range.from - 1]).toBe("@");
    expect(source[range.to]).toBe(".");
    expect(index.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.from === range.from &&
      occurrence.to === range.to &&
      dslSemanticIdentityKey(occurrence.identity) === targetKey
    )).toHaveLength(1);
    expect(session.definition(range.from + 1)).toEqual({
      referenceRange: range,
      declarationRange: declaration.range
    });
    expect(session.references(range.from + 1)).toEqual({
      declarationRange: declaration.range,
      referenceRanges: expectedOperandRanges
    });
  }
  expect(session.references(declaration.range.from + 1)).toEqual({
    declarationRange: declaration.range,
    referenceRanges: expectedOperandRanges
  });

  const rename = session.rename(declaration.range.from + 1, "ProbeRenamed");
  expect(rename.status).toBe("ok");
  if (rename.status !== "ok") return;
  expect(rename.plan.edits.map(({ from, to, expectedText, newText }) => ({ from, to, expectedText, newText }))).toEqual(
    expectedOccurrences.map(({ from, to }) => ({
      from,
      to,
      expectedText: PROBE_NAME,
      newText: "ProbeRenamed"
    }))
  );
  expect(rename.plan.edits.every((edit) =>
    source.slice(edit.from, edit.to) === PROBE_NAME &&
    edit.expectedText === PROBE_NAME &&
    edit.newText === "ProbeRenamed"
  )).toBe(true);

  const document = AutomationDocument.fromSource(source);
  const before = document.getState().currentCompiled;
  const beforeEvaluation = evaluateCompiled(before);
  expect(beforeEvaluation.errors).toEqual([]);
  document.replaceSource(applyEdits(source, rename.plan.edits));
  const after = document.getState().currentCompiled;
  expect(errorDiagnostics(after)).toEqual([]);
  expect(after.statementMap?.statementIdByStatementIndex).toEqual(before.statementMap?.statementIdByStatementIndex);
  expect(after.statementMap?.elementIdByStatementIndex).toEqual(before.statementMap?.elementIdByStatementIndex);
  const afterEvaluation = evaluateCompiled(after);
  expect(afterEvaluation.errors).toEqual([]);
  expect(new Map([...afterEvaluation.computedGeometry].map(([id, geometry]) => [
    id,
    normalizeRenamedDisplayNames(geometry)
  ]))).toEqual(new Map([...beforeEvaluation.computedGeometry].map(([id, geometry]) => [
    id,
    normalizeRenamedDisplayNames(geometry)
  ])));
  expect(afterEvaluation.computedScalarBindings).toEqual(beforeEvaluation.computedScalarBindings);
};

describe("compiler-resolved geometry builtin semantic occurrences", () => {
  it.each(endpointFixtures)("$name indexes each angle endpoint and preserves safe editor queries", ({ source, operands }) => {
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const session = createNuiLanguageSession(source);

    assertResolvedEndpointIndex(source, operands, compiled, session);
  });

  it("indexes distance and lineAngle operands through the same resolved geometry path", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 50, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "line Axis = segment(start: @A, end: @B)",
      "const measures: number = distance(@ProbeLine.end, @A) + lineAngle(@ProbeLine.start, @Axis.start)"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const session = createNuiLanguageSession(source);

    assertResolvedEndpointIndex(source, ["@ProbeLine.end", "@ProbeLine.start"], compiled, session);
  });

  it("indexes Module scalar expressions and text-template holes by their parameter identity", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "line Axis = segment(start: @A, end: @B)",
      "module Measure(source: line, axis: line) {",
      "  const turn: number = angle(@source.end, @source.start)",
      "  text Label = label(text: \"turn ${lineAngle(@source.start, @axis.start)}\", anchor: none, size: 3)",
      "}",
      "instance Use = Measure(source: @ProbeLine, axis: @Axis)"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const session = createNuiLanguageSession(source);
    expect(errorDiagnostics(compiled)).toEqual([]);

    const definition = compiled.moduleSemanticAnalysis?.definitions.find((candidate) => candidate.name === "Measure");
    expect(definition).toBeDefined();
    const body = definition?.bodyStatements.find((candidate) => candidate.statementKind === "typedDeclaration");
    const templateBody = definition?.bodyStatements.find((candidate) => candidate.textTemplateHoles.length > 0);
    expect(body?.scalarExpressions.flatMap((site) => site.expression.geometryBuiltinArguments)).toHaveLength(2);
    expect(templateBody?.textTemplateHoles.flatMap((site) => site.expression.geometryBuiltinArguments)).toHaveLength(2);

    const sourceParameterOffset = source.indexOf("source: line");
    const sourceParameterRange = { from: sourceParameterOffset, to: sourceParameterOffset + "source".length };
    const axisParameterOffset = source.indexOf("axis: line");
    const axisParameterRange = { from: axisParameterOffset, to: axisParameterOffset + "axis".length };
    const sourceBindingOffset = source.indexOf("source: @ProbeLine", source.indexOf("instance Use"));
    const sourceBindingRange = { from: sourceBindingOffset, to: sourceBindingOffset + "source".length };
    const axisBindingOffset = source.indexOf("axis: @Axis", source.indexOf("instance Use"));
    const axisBindingRange = { from: axisBindingOffset, to: axisBindingOffset + "axis".length };
    const sourceOperands = rangesForAuthoredOperands(source, [
      "@source.end",
      "@source.start",
      "@source.start"
    ]).sort((a, b) => a.from - b.from);
    const axisOperands = rangesForAuthoredOperands(source, ["@axis.start"]);

    for (const range of sourceOperands) {
      expect(session.definition(range.from + 1)).toEqual({
        referenceRange: range,
        declarationRange: sourceParameterRange
      });
    }
    expect(session.references(sourceOperands[0]!.from + 1)?.referenceRanges).toEqual(
      [...sourceOperands, sourceBindingRange].sort((a, b) => a.from - b.from)
    );
    expect(session.definition(axisOperands[0]!.from + 1)).toEqual({
      referenceRange: axisOperands[0],
      declarationRange: axisParameterRange
    });
    expect(session.references(axisOperands[0]!.from + 1)?.referenceRanges).toEqual([
      ...axisOperands,
      axisBindingRange
    ].sort((a, b) => a.from - b.from));
  });

  it("indexes resolved builtin arguments inside record and collection scalar visitors", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "record Measurement(turn: number)",
      "const measured: Measurement = Measurement(turn: angle(@ProbeLine.end, @ProbeLine.start))",
      "const values: number[] = if (angle(@ProbeLine.start, @ProbeLine.end) > 0) { [1] } else { [2] }",
      "module Measure(value: Measurement) {",
      "  const copied: number = @value.turn",
      "}",
      "instance Use = Measure(value: Measurement(turn: angle(@ProbeLine.end, @ProbeLine.start)))"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const session = createNuiLanguageSession(source);
    expect(errorDiagnostics(compiled)).toEqual([]);

    const operands = [
      "@ProbeLine.end",
      "@ProbeLine.start",
      "@ProbeLine.start",
      "@ProbeLine.end",
      "@ProbeLine.end",
      "@ProbeLine.start"
    ];
    const declaration = probeDeclarationFor(compiled);
    const expectedOperandRanges = rangesForAuthoredOperands(source, operands).sort((a, b) => a.from - b.from);
    const targetKey = dslSemanticIdentityKey(declaration.identity);
    const indexed = createDslSemanticOccurrenceIndex(compiled).occurrences
      .filter((occurrence) => dslSemanticIdentityKey(occurrence.identity) === targetKey)
      .map(({ kind, from, to }) => ({ kind, from, to }));
    expect(indexed).toEqual([
      { kind: "declaration", ...declaration.range },
      ...expectedOperandRanges.map((range) => ({ kind: "reference" as const, ...range }))
    ].sort((a, b) => a.from - b.from || a.to - b.to));
    for (const range of expectedOperandRanges) {
      expect(session.definition(range.from + 1)?.declarationRange).toEqual(declaration.range);
      expect(session.references(range.from + 1)?.referenceRanges).toEqual(expectedOperandRanges);
    }
  });

  it("indexes sanitized head_dart and cheek_dart geometry operands by resolved identity", () => {
    const names = ["head_dart_lower", "head_dart_upper", "cheek_dart_upper", "cheek_dart_lower"] as const;
    const pointStatements = names.flatMap((_, index) => [
      `point P${index * 2} = coordinate(x: ${index * 20}, y: 0)`,
      `point P${index * 2 + 1} = coordinate(x: ${index * 20 + 10}, y: 0)`
    ]);
    const source = [
      "nui 1",
      ...pointStatements,
      ...names.map((name, index) =>
        `line ${name} = segment(start: @P${index * 2}, end: @P${index * 2 + 1})`
      ),
      ...names.map((name) =>
        `const ${name}_turn: number = angle(@${name}.end, @${name}.start)`
      )
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const session = createNuiLanguageSession(source);
    expect(errorDiagnostics(compiled)).toEqual([]);
    const semanticAnalysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;

    for (const name of names) {
      const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find((candidate) =>
        candidate.kind === "geometry" && candidate.name === name
      );
      expect(declaration).toBeDefined();
      if (!declaration) continue;
      const elementId = compiled.statementMap?.elementIdByStatementIndex.get(declaration.statementIndex);
      expect(elementId).toBeDefined();
      if (!elementId) continue;
      const declarationRange = {
        from: source.indexOf(`line ${name}`) + "line ".length,
        to: source.indexOf(`line ${name}`) + "line ".length + name.length
      };
      const operandRanges = ["end", "start"].map((endpoint) => {
        const from = source.indexOf(`@${name}.${endpoint}`) + 1;
        return { from, to: from + name.length };
      }).sort((left, right) => left.from - right.from);
      const compilerArguments = [...(semanticAnalysis?.rootScalarExpressionsByStatementId.values() ?? [])]
        .flatMap((site) => site.expression.geometryBuiltinArguments)
        .filter((argument) => targetStatementId(argument.reference.target) === declaration.statementId);
      expect(compilerArguments).toHaveLength(2);

      const identity = { kind: "element" as const, elementId };
      const identityKey = dslSemanticIdentityKey(identity);
      const occurrences = createDslSemanticOccurrenceIndex(compiled).occurrences
        .filter((occurrence) => dslSemanticIdentityKey(occurrence.identity) === identityKey)
        .map(({ kind, from, to }) => ({ kind, from, to }));
      expect(occurrences).toEqual([
        { kind: "declaration" as const, ...declarationRange },
        ...operandRanges.map((range) => ({ kind: "reference" as const, ...range }))
      ].sort((left, right) => left.from - right.from || left.to - right.to));
      expect(session.references(declarationRange.from + 1)).toEqual({
        declarationRange,
        referenceRanges: operandRanges
      });
      for (const range of operandRanges) {
        expect(session.definition(range.from + 1)).toEqual({ referenceRange: range, declarationRange });
        expect(session.references(range.from + 1)).toEqual({ declarationRange, referenceRanges: operandRanges });
      }
      const rename = session.rename(declarationRange.from + 1, `${name}_renamed`);
      expect(rename.status).toBe("ok");
      if (rename.status === "ok") {
        expect(rename.plan.edits.map(({ from, to }) => ({ from, to }))).toEqual(
          [declarationRange, ...operandRanges].sort((left, right) => left.from - right.from || left.to - right.to)
        );
      }
    }
  });

  it("keeps shadowed names separate and leaves comments, strings, and prefixes out of rename edits", () => {
    const source = [
      "nui 1",
      "// ProbeLine comment text",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "line ProbeLineCopy = segment(start: @A, end: @B)",
      "const note: string = \"ProbeLine\"",
      "const rootTurn: number = angle(@ProbeLine.end, @ProbeLine.start)",
      "group OtherScope {",
      "  point C = coordinate(x: 20, y: 0)",
      "  point D = coordinate(x: 30, y: 0)",
      "  line ProbeLine = segment(start: @C, end: @D)",
      "  const localTurn: number = angle(@ProbeLine.end, @ProbeLine.start)",
      "}"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    expect(errorDiagnostics(compiled)).toEqual([]);

    const rootDeclaration = source.indexOf("line ProbeLine") + "line ".length;
    const localDeclaration = source.indexOf("line ProbeLine =", rootDeclaration + PROBE_NAME.length) + "line ".length;
    const localUses = rangesForAuthoredOperands(source, [
      "@ProbeLine.end",
      "@ProbeLine.start",
      "@ProbeLine.end",
      "@ProbeLine.start"
    ]).slice(2);
    const rootRename = session.rename(rootDeclaration + 1, "RenamedLine");
    expect(rootRename.status).toBe("ok");
    if (rootRename.status !== "ok") return;
    expect(rootRename.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      PROBE_NAME,
      PROBE_NAME,
      PROBE_NAME
    ]);
    expect(rootRename.plan.edits.some((edit) => edit.from === localDeclaration)).toBe(false);
    expect(rootRename.plan.edits.some((edit) => localUses.some((range) => edit.from === range.from))).toBe(false);
    const renamed = applyEdits(source, rootRename.plan.edits);
    expect(renamed).toContain("// ProbeLine comment text");
    expect(renamed).toContain("const note: string = \"ProbeLine\"");
    expect(renamed).toContain("line ProbeLineCopy =");
    expect(renamed).toContain("line ProbeLine = segment(start: @C, end: @D)");
    expect(renamed).toContain("angle(@ProbeLine.end, @ProbeLine.start)");
    expect(renamed).toContain("angle(@RenamedLine.end, @RenamedLine.start)");
  });

  it("rejects builtin renames that introduce a same-scope collision", () => {
    const collisionSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line ProbeLine = segment(start: @A, end: @B)",
      "line Taken = segment(start: @A, end: @B)",
      "const turn: number = angle(@ProbeLine.end, @ProbeLine.start)"
    ].join("\n");
    const collisionSession = createNuiLanguageSession(collisionSource);
    expect(collisionSession.rename(collisionSource.indexOf("line ProbeLine") + "line ".length + 1, "Taken")).toEqual({
      status: "rejected",
      rejection: expect.objectContaining({ reason: "same-scope-collision", conflictingName: "Taken" })
    });
  });

  it("fails closed when the current source is invalid", () => {
    const validSource = endpointFixtures[0]!.source;
    const session = createNuiLanguageSession(validSource);
    const invalidSource = validSource + "\nconst broken: number = angle(@Missing.end, @ProbeLine.start)";
    session.replaceSource(invalidSource);

    expect(session.rename(invalidSource.indexOf("line ProbeLine") + "line ".length + 1, "ProbeRenamed")).toEqual({
      status: "rejected",
      rejection: { reason: "unavailable" }
    });
  });
});
