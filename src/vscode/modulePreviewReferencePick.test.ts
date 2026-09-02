import { describe, expect, it } from "vitest";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";
import { modulePreviewReferencePickTargetFor } from "./modulePreviewReferencePick";
import { compileDslDocument } from "../dsl/dslDocument";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { parseDslSnapshot } from "../dsl/dslParser";
import { evaluateElements } from "../geometry/evaluate";
import { referencePickCandidates } from "../model/referencePickCandidates";

const compile = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 7 });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: 7,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `module-preview-pick:${index}`]))
  });
};

const previewFor = (source: string, needle: string, argumentsFor: readonly { name: string; expression: string }[] = [], ancestorContexts: readonly { definitionStatementId: string; arguments?: readonly { name: string; expression: string }[] }[] = []) => {
  const compiled = compile(source);
  const target = queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision: 7 },
    position: source.indexOf(needle) + Math.max(1, needle.length - 1),
    semantic: { sourceRevision: 7, compiled }
  });
  if (!target) throw new Error(`missing target ${needle}`);
  const root = compileModulePreviewRoot({
    source: { normalizedSource: source, sourceRevision: 7 },
    semantic: { sourceRevision: 7, compiled },
    target,
    arguments: argumentsFor,
    ancestorContexts
  });
  if (!root) throw new Error("preview did not compile");
  const evaluation = evaluateElements(root.compileResult.elements, buildModulePreviewEvaluationOptions(root));
  return { compiled, root, target, evaluation };
};

describe("Module Preview Reference Pick target and candidates", () => {
  it("uses exact top-level declaration scope and existing point/strict-line/path compatibility", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "line Straight = segment(start: @Top, end: (10, 0))",
      "curve Curve = bezier(start: @Top, end: (10, 10), startAngle: 0, startLength: 2, endAngle: 90, endLength: 2)",
      "module Pocket(anchor: point, strict: line, broad: path, scalar: number) {",
      "}",
      "point Forward = coordinate(x: 20, y: 0)"
    ].join("\n");
    const { root, evaluation } = previewFor(source, "module Pocket", [
      { name: "anchor", expression: "@Top" },
      { name: "strict", expression: "@Straight" },
      { name: "broad", expression: "@Curve" },
      { name: "scalar", expression: "1" }
    ]);
    const anchor = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: root.target.definitionStatementId,
      parameterIndex: 0
    });
    const strict = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: root.target.definitionStatementId,
      parameterIndex: 1
    });
    const broad = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: root.target.definitionStatementId,
      parameterIndex: 2
    });
    const scalar = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: root.target.definitionStatementId,
      parameterIndex: 3
    });
    expect(anchor?.sourceAnchor.scopeId).toBe("root");
    expect(anchor?.sourceAnchor.statementIndex).toBe(root.target.definitionStatementIndex);
    expect(anchor?.expectedGeometryInterface).toBe("point");
    expect(strict?.expectedGeometryInterface).toBe("line");
    expect(broad?.expectedGeometryInterface).toBe("path");
    expect(scalar).toBeNull();

    const pointCandidates = referencePickCandidates({ compiled: root.candidateCompiledDocument, evaluation, target: anchor! });
    const strictCandidates = referencePickCandidates({ compiled: root.candidateCompiledDocument, evaluation, target: strict! });
    const broadCandidates = referencePickCandidates({ compiled: root.candidateCompiledDocument, evaluation, target: broad! });
    expect(pointCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).toContain("Top");
    expect(strictCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).toContain("Straight");
    expect(strictCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).not.toContain("Curve");
    expect(broadCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).toEqual(
      expect.arrayContaining(["Straight", "Curve"])
    );
    expect(pointCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).not.toContain("Forward");
  });

  it("keeps caller-side nested Module geometry eligible while rejecting forward scope", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Outer(anchor: point) {",
      "  point Caller = coordinate(x: 5, y: 0)",
      "  module Inner(target: point) {",
      "  }",
      "  point Forward = coordinate(x: 10, y: 0)",
      "}"
    ].join("\n");
    const compiled = compile(source);
    const innerTarget = queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: source.indexOf("module Inner") + 4,
      semantic: { sourceRevision: 7, compiled }
    });
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    if (!innerTarget || !outer) throw new Error("missing nested target");
    const { root, evaluation } = previewFor(source, "module Inner", [
      { name: "target", expression: "@Caller" }
    ], [{ definitionStatementId: outer.statementId, arguments: [{ name: "anchor", expression: "@Top" }] }]);
    const target = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: innerTarget.definitionStatementId,
      parameterIndex: 0
    });
    const ancestorTarget = modulePreviewReferencePickTargetFor({
      root,
      definitionStatementId: outer.statementId,
      parameterIndex: 0
    });
    expect(target?.sourceAnchor.scopeId).toBe("module:module-preview-pick:2");
    expect(ancestorTarget?.sourceAnchor.scopeId).toBe("root");
    const candidates = referencePickCandidates({ compiled: root.candidateCompiledDocument, evaluation, target: target! });
    const references = candidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base);
    expect(references).toContain("Caller");
    expect(references).not.toContain("Forward");
    const ancestorCandidates = referencePickCandidates({
      compiled: root.candidateCompiledDocument,
      evaluation,
      target: ancestorTarget!
    });
    expect(ancestorCandidates.flatMap((candidate) => candidate.options).map((option) => option.reference.base)).toContain("Top");
  });
});
