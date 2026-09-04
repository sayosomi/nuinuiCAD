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
  const position = fragmentStart + (referenceOffset >= 0 ? referenceOffset + 2 : fragment.length);
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

  it("curates endpoint-aware numeric properties for line, arc, and Bezier subgeometry", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 30, y: 0)",
      "point C = coordinate(x: 15, y: 10)",
      "line Line = segment(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 20, start: 0, end: 90)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5, intermediates: [@C:45:5:5:slot-a; @A:45:5:5:slot-b])",
      "point Use = offset(from: @A, dx: @Line.length, dy: 0)"
    ].join("\n");
    const compiled = compileSource(source);
    const evaluation = evaluateSource(compiled);
    const target = targetAt(source, compiled, "@Line.length");
    const candidates = referencePickCandidates({ compiled, evaluation, target });

    const optionsFor = (name: string) => {
      const geometry = [...evaluation.computedGeometry.values()].find((item) => item.name === name);
      const candidate = candidates.find((item) => item.elementId === geometry?.elementId);
      if (!candidate) throw new Error("missing numeric candidate: " + name);
      return candidate.options.filter((option) => option.kind === "numericProperty");
    };
    const propertiesFor = (name: string, subgeometry: string) => {
      const requested = JSON.parse(subgeometry) as { kind: string; anchor?: { pointKey?: string } };
      const option = optionsFor(name).find((item) =>
        item.subgeometry.kind === requested.kind &&
        (requested.kind !== "point" ||
          (item.subgeometry.kind === "point" && item.subgeometry.anchor.pointKey === requested.anchor?.pointKey))
      );
      if (!option || option.kind !== "numericProperty") throw new Error("missing numeric option: " + name + "/" + subgeometry);
      return option.properties;
    };

    expect(propertiesFor("Line", JSON.stringify({ kind: "body" }))).toEqual(["length"]);
    expect(propertiesFor("Line", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Line", pointKey: "start" }
    }))).toEqual([
      "startPoint.x", "startPoint.y", "startAngleDeg"
    ]);
    expect(propertiesFor("Line", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Line", pointKey: "end" }
    }))).toEqual([
      "endPoint.x", "endPoint.y", "endAngleDeg"
    ]);

    expect(propertiesFor("Arc", JSON.stringify({ kind: "body" }))).toEqual([
      "length", "radius", "sweepAngleDeg"
    ]);
    expect(propertiesFor("Arc", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Arc", pointKey: "start" }
    }))).toEqual([
      "startPoint.x", "startPoint.y", "startAngleDeg", "startRadiusAngleDeg"
    ]);
    expect(propertiesFor("Arc", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Arc", pointKey: "end" }
    }))).toEqual([
      "endPoint.x", "endPoint.y", "endAngleDeg", "endRadiusAngleDeg"
    ]);
    expect(propertiesFor("Arc", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Arc", pointKey: "center" }
    }))).toEqual(["centerPoint.x", "centerPoint.y"]);

    expect(propertiesFor("Curve", JSON.stringify({ kind: "body" }))).toEqual(["length"]);
    expect(propertiesFor("Curve", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Curve", pointKey: "start" }
    }))).toEqual([
      "startPoint.x", "startPoint.y", "startAngleDeg", "startHandleAngleDeg", "startHandleLength"
    ]);
    expect(propertiesFor("Curve", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Curve", pointKey: "end" }
    }))).toEqual([
      "endPoint.x", "endPoint.y", "endAngleDeg", "endHandleAngleDeg", "endHandleLength"
    ]);
    expect(propertiesFor("Curve", JSON.stringify({
      kind: "point", anchor: { mode: "derived", elementId: "Curve", pointKey: "intermediate:slot-a" }
    }))).toEqual([
      "intermediatePoints[1].x",
      "intermediatePoints[1].y",
      "intermediatePoints[1].incomingHandleAngleDeg",
      "intermediatePoints[1].incomingHandleLength",
      "intermediatePoints[1].outgoingHandleAngleDeg",
      "intermediatePoints[1].outgoingHandleLength"
    ]);

    const curveGeometry = [...evaluation.computedGeometry.values()].find((item) => item.name === "Curve");
    if (!curveGeometry || curveGeometry.kind !== "bezierCurve") throw new Error("missing Bezier geometry");
    const reorderedEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry).set(curveGeometry.elementId, {
        ...curveGeometry,
        intermediateSlotIds: ["slot-b", "slot-a"]
      })
    };
    const reorderedOptions = referencePickCandidates({ compiled, evaluation: reorderedEvaluation, target })
      .find((candidate) => candidate.elementId === curveGeometry.elementId)?.options
      .filter((option) => option.kind === "numericProperty") ?? [];
    const reorderedIntermediate = (stableId: string) => reorderedOptions.find((option) =>
      option.kind === "numericProperty" &&
      option.subgeometry.kind === "point" &&
      option.subgeometry.anchor.pointKey === "intermediate:" + stableId
    );
    expect(reorderedIntermediate("slot-a")?.properties).toEqual([
      "intermediatePoints[2].x",
      "intermediatePoints[2].y",
      "intermediatePoints[2].incomingHandleAngleDeg",
      "intermediatePoints[2].incomingHandleLength",
      "intermediatePoints[2].outgoingHandleAngleDeg",
      "intermediatePoints[2].outgoingHandleLength"
    ]);
    expect(reorderedIntermediate("slot-b")?.properties).toEqual([
      "intermediatePoints[1].x",
      "intermediatePoints[1].y",
      "intermediatePoints[1].incomingHandleAngleDeg",
      "intermediatePoints[1].incomingHandleLength",
      "intermediatePoints[1].outgoingHandleAngleDeg",
      "intermediatePoints[1].outgoingHandleLength"
    ]);

    const allProperties = optionsFor("Curve").flatMap((option) =>
      option.kind === "numericProperty" ? option.properties : []
    );
    expect(allProperties).not.toContain("startTangentAngleDeg");
    expect(allProperties).not.toContain("endTangentAngleDeg");
  });

  it("filters unavailable intermediate angles while retaining zero current lengths", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 30, y: 0)",
      "point C = coordinate(x: 15, y: 10)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5, intermediates: [@C:45:5:5:slot-a])",
      "point Use = offset(from: @A, dx: @Curve.intermediatePoints[1].x, dy: 0)"
    ].join("\n");
    const compiled = compileSource(source);
    const evaluation = evaluateSource(compiled);
    const curveGeometry = [...evaluation.computedGeometry.values()].find((item) => item.name === "Curve");
    if (!curveGeometry || curveGeometry.kind !== "bezierCurve") throw new Error("missing Bezier geometry");
    const zeroHandleEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry).set(curveGeometry.elementId, {
        ...curveGeometry,
        segments: [
          { ...curveGeometry.segments[0], control2: curveGeometry.segments[0].end },
          { ...curveGeometry.segments[1], control1: curveGeometry.segments[1].start }
        ]
      })
    };
    const target = targetAt(source, compiled, "@Curve.intermediatePoints[1].x");
    const options = referencePickCandidates({ compiled, evaluation: zeroHandleEvaluation, target })
      .flatMap((candidate) => candidate.options)
      .flatMap((option) => option.kind === "numericProperty" && option.subgeometry.kind === "point" && option.subgeometry.anchor.pointKey === "intermediate:slot-a" ? [option] : []);
    expect(options).toHaveLength(1);
    expect(options[0]?.properties).toEqual([
      "intermediatePoints[1].x",
      "intermediatePoints[1].y",
      "intermediatePoints[1].incomingHandleLength",
      "intermediatePoints[1].outgoingHandleLength"
    ]);
  });

  it("filters non-finite computed numeric values without making support a second authority", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Line = segment(start: @A, end: @B)",
      "point Use = offset(from: @A, dx: @Line.length, dy: 0)"
    ].join("\n");
    const compiled = compileSource(source);
    const evaluation = evaluateSource(compiled);
    const lineGeometry = [...evaluation.computedGeometry.values()].find((item) => item.name === "Line");
    if (!lineGeometry || lineGeometry.kind !== "line") throw new Error("missing line geometry");
    const nonFiniteEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry).set(lineGeometry.elementId, {
        ...lineGeometry,
        length: Number.NaN
      })
    };
    const target = targetAt(source, compiled, "@Line.length");
    const options = referencePickCandidates({ compiled, evaluation: nonFiniteEvaluation, target })
      .flatMap((candidate) => candidate.options)
      .filter((option) => option.kind === "numericProperty");

    expect(options.some((option) => option.subgeometry.kind === "body")).toBe(false);
    expect(options.some((option) => option.properties.includes("startPoint.x"))).toBe(true);
    expect(options.flatMap((option) => option.properties)).not.toContain("length");
  });
});
