import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationResult } from "../types/geometry";
import { referencePickCandidates } from "./referencePickCandidates";

const REVISION = 41;

const compileSource = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `reference-pick:${index}`]))
  });
};

const evaluateSource = (compiled: CompiledDslDocument): EvaluationResult => {
  if (!compiled.document || !compiled.statementMap) throw new Error("reference-pick fixture did not compile");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
};

const targetAt = (source: string, compiled: CompiledDslDocument, fragment: string) => {
  const fragmentStart = source.indexOf(fragment);
  if (fragmentStart < 0) throw new Error(`missing target fragment: ${fragment}`);
  const referenceOffset = fragment.indexOf("@");
  const position = fragmentStart + (referenceOffset >= 0 ? referenceOffset + 1 : fragment.length);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position,
    semantic: { sourceRevision: REVISION, compiled }
  });
  if (!target) throw new Error(`no reference-pick target for: ${fragment}`);
  return target;
};

const referenceBases = (candidates: ReturnType<typeof referencePickCandidates>) =>
  candidates.flatMap((candidate) => candidate.options.map((option) => option.reference.base));

describe("referencePickCandidates", () => {
  it("uses strict line/path assignability, source order, and current Canvas visibility", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line, broad: path) {",
      "}",
      "instance X = M(straight: @Straight, broad: @Curve)",
      "line Later = segment(start: @A, end: @B)"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateSource(compiled);

    const strictTarget = targetAt(source, compiled, "straight: @Straight");
    const strict = referencePickCandidates({ compiled, evaluation, target: strictTarget });
    expect(referenceBases(strict)).toContain("Straight");
    expect(referenceBases(strict)).not.toContain("Curve");
    expect(referenceBases(strict)).not.toContain("Later");

    const broadTarget = targetAt(source, compiled, "broad: @Curve");
    const broad = referencePickCandidates({ compiled, evaluation, target: broadTarget });
    expect(referenceBases(broad)).toEqual(expect.arrayContaining(["Straight", "Curve"]));
    expect(referenceBases(broad)).not.toContain("Later");

    const straightId = compiled.document!.elements.find((element) => element.name === "Straight")!.id;
    const hiddenEvaluation: EvaluationResult = {
      ...evaluation,
      effectiveVisibleElementIds: new Set(
        [...(evaluation.effectiveVisibleElementIds ?? [])].filter((elementId) => elementId !== straightId)
      )
    };
    expect(referenceBases(referencePickCandidates({
      compiled,
      evaluation: hiddenEvaluation,
      target: broadTarget
    }))).not.toContain("Straight");
  });

  it("offers canonical point references and restricts endpoint-only targets to line endpoints", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point Offset = offset(from: @A, dx: 2, dy: 0)",
      "point On = onLine(from: @Base.start, distance: 5)"
    ].join("\n");
    const compiled = compileSource(source);
    const evaluation = evaluateSource(compiled);

    const pointTarget = targetAt(source, compiled, "from: @A");
    const pointReferences = referencePickCandidates({ compiled, evaluation, target: pointTarget })
      .flatMap((candidate) => candidate.options.map((option) => option.reference));
    expect(pointReferences).toContainEqual({ base: "A" });
    expect(pointReferences).toContainEqual({ base: "Base", pointKey: "start" });
    expect(pointReferences).toContainEqual({ base: "Base", pointKey: "end" });

    const endpointTarget = targetAt(source, compiled, "from: @Base.start");
    const endpointOptions = referencePickCandidates({ compiled, evaluation, target: endpointTarget })
      .flatMap((candidate) => candidate.options);
    expect(endpointOptions.length).toBeGreaterThan(0);
    expect(endpointOptions.every((option) =>
      option.kind === "point" &&
      option.reference.pointKey !== undefined &&
      (option.reference.pointKey === "start" || option.reference.pointKey === "end")
    )).toBe(true);
  });

  it("authors safe Module export references and private local references from Source anchors", () => {
    const source = [
      "nui 4",
      "module Maker() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance Root = Maker()",
      "line RootUse = offset(sources: [@Root::Out], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "module LocalModule() {",
      "  line Local = segment(start: (0, 0), end: (5, 0))",
      "  line LocalUse = offset(sources: [@Local], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance LocalInstance = LocalModule()"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateSource(compiled);

    const rootTarget = targetAt(source, compiled, "sources: [@Root::Out]");
    expect(referenceBases(referencePickCandidates({ compiled, evaluation, target: rootTarget })))
      .toContain("Root::Out");

    const localTarget = targetAt(source, compiled, "sources: [@Local]");
    expect(referenceBases(referencePickCandidates({ compiled, evaluation, target: localTarget })))
      .toContain("Local");
    expect(referenceBases(referencePickCandidates({ compiled, evaluation, target: rootTarget })))
      .not.toContain("Local");
  });
});
