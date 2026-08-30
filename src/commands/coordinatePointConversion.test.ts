import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText, type CanonicalDocumentValue } from "../document/canonicalDocument";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  applyCoordinatePointConversionPlan,
  coordinatePointConversionBaseCandidates,
  coordinatePointConversionTargetEligibility,
  planCoordinatePointConversion,
  type CoordinatePointConversionSnapshot
} from "./coordinatePointConversion";
import type { ComputedPoint } from "../types/geometry";

const compile = (source: string): CanonicalDocumentValue => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result;
};

const snapshotFor = (document: CanonicalDocumentValue): CoordinatePointConversionSnapshot => ({
  document,
  evaluation: evaluateElements(document.doc.document.elements, buildEvaluationOptions({
    compiledDocument: document.doc,
    evaluationLimitIndex: undefined
  }))
});

const elementId = (document: CanonicalDocumentValue, name: string) =>
  document.doc.document.elements.find((element) => element.name === name)!.id;

describe("coordinate point conversion", () => {
  it("finds a shared legal base and preserves the target source identity when converting XY", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 10, y: 20, state: hidden)",
      "point Target = coordinate(x: 30, y: 5)",
      "line Use = segment(start: @Target, end: @Base)"
    ].join("\n");
    const document = compile(source);
    const snapshot = snapshotFor(document);
    const baseId = elementId(document, "Base");
    const targetId = elementId(document, "Target");
    const candidates = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [targetId] });
    const base = candidates.find((candidate) => candidate.sourceElementId === baseId)!;

    expect(base).toBeDefined();
    const plan = planCoordinatePointConversion({ snapshot, targetIds: [targetId], base, mode: "xy" });
    expect(plan.classification).toBe("all-success");
    expect(plan.successfulTargetIds).toEqual([targetId]);

    const applied = applyCoordinatePointConversionPlan(plan, snapshot);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.document.sourceText).toContain("point Target = offset(");
    expect(applied.document.sourceText).toContain("from: @Base");
    expect(applied.document.sourceText).toContain("dx: 20");
    expect(applied.document.sourceText).toContain("dy: -15");
    expect(applied.document.sourceText).toContain("line Use = segment(start: @Target, end: @Base)");
    expect(applied.document.sourceText).not.toContain("id:");

    const target = applied.document.doc.document.elements.find((element) => element.id === targetId)!;
    expect(target.name).toBe("Target");
    expect(applied.document.doc.statementMap.byElementId.get(targetId)?.statementIndex).toBe(
      document.doc.statementMap.byElementId.get(targetId)?.statementIndex
    );
    const reevaluated = snapshotFor(applied.document).evaluation;
    expect(reevaluated.computedGeometry.get(targetId)).toMatchObject({ kind: "point", x: 30, y: 5 });
  });

  it("accepts constant scalar expressions but rejects binding-dependent expressions", () => {
    const constant = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 2 + 3, y: -4 + 1)"
    ].join("\n"));
    const constantSnapshot = snapshotFor(constant);
    const constantTarget = elementId(constant, "Target");
    expect(coordinatePointConversionTargetEligibility(constantSnapshot, constantTarget).eligible).toBe(true);

    const bound = compile([
      "nui 4",
      "const width: number = 10",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: @width, y: 1)"
    ].join("\n"));
    const boundTarget = elementId(bound, "Target");
    expect(coordinatePointConversionTargetEligibility(snapshotFor(bound), boundTarget)).toMatchObject({
      eligible: false,
      reason: { code: "target-not-eligible" }
    });
  });

  it("rejects an already-relational point as a conversion target", () => {
    const document = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = offset(from: @Base, dx: 10, dy: 5)"
    ].join("\n"));
    const targetId = elementId(document, "Target");

    expect(coordinatePointConversionTargetEligibility(snapshotFor(document), targetId)).toMatchObject({
      eligible: false,
      reason: { code: "target-not-eligible" }
    });
  });

  it("rejects a coordinate point whose scalar depends on a geometry property", () => {
    const document = compile([
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "point Target = coordinate(x: @AB.length, y: 0)"
    ].join("\n"));
    const targetId = elementId(document, "Target");

    expect(coordinatePointConversionTargetEligibility(snapshotFor(document), targetId)).toMatchObject({
      eligible: false,
      reason: { code: "target-not-eligible" }
    });
  });

  it("rejects a for-generated runtime coordinate point", () => {
    const document = compile([
      "nui 4",
      "for i in range(from: 0, count: 1, step: 1) {",
      "  point Generated = coordinate(x: @i * 10, y: 5)",
      "}"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const loop = document.doc.document.elements.find((element) => element.type === "forGroup");
    const template = document.doc.document.elements.find((element) => element.name === "Generated");
    const generatedRow = snapshot.evaluation.forGroupGeneratedRows?.find((row) =>
      row.forGroupId === loop?.id && row.templateElementId === template?.id
    );
    if (!loop || !template || !generatedRow) throw new Error("expected a materialized for-generated point");

    const generatedId = generatedRow.generatedElementId;
    expect(document.doc.statementMap.byElementId.has(generatedId)).toBe(false);
    expect(coordinatePointConversionTargetEligibility(snapshot, generatedId)).toMatchObject({
      eligible: false,
      reason: { code: "target-not-found" }
    });
  });

  it("rejects a Module-instance-generated runtime coordinate point", () => {
    const document = compile([
      "nui 4",
      "module Maker() {",
      "  export point Generated = coordinate(x: 10, y: 5)",
      "}",
      "instance Root = Maker()"
    ].join("\n"));
    const runtimePoint = document.doc.moduleMaterialization?.executionStatements.find((entry) =>
      entry.type === "freePoint" && entry.statement.kind === "element" &&
      entry.statement.name === "Generated" && entry.origin?.kind === "moduleBody"
    );
    if (!runtimePoint) throw new Error("expected a materialized Module-generated point");

    const runtimeId = runtimePoint.runtimeElementId;
    expect(document.doc.moduleMaterialization?.originByRuntimeElementId.has(runtimeId)).toBe(true);
    expect(document.doc.statementMap.byElementId.has(runtimeId)).toBe(false);
    expect(coordinatePointConversionTargetEligibility(snapshotFor(document), runtimeId)).toMatchObject({
      eligible: false,
      reason: { code: "target-not-found" }
    });
  });

  it("preserves modifiers, common attributes, explicit ids, and existing references", () => {
    const document = compile([
      "nui 4",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point Base = coordinate(x: 10, y: 20)",
      "group G {",
      "  point Target [Guide] = coordinate(x: 30, y: 5, state: hidden, id: \"target-fixed\")",
      "  line Use = segment(start: @Target, end: @Base)",
      "}"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const targetId = elementId(document, "Target");
    const parentGroupId = document.doc.document.elements.find((element) => element.name === "Target")?.parentGroupId;
    expect(targetId).toBe('"target-fixed"');
    const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [targetId] })
      .find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!;
    expect(base).toBeDefined();
    const applied = applyCoordinatePointConversionPlan(
      planCoordinatePointConversion({ snapshot, targetIds: [targetId], base, mode: "xy" }),
      snapshot
    );
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.document.sourceText).toContain("point Target [Guide] = offset(");
    expect(applied.document.sourceText).toContain("state: hidden");
    expect(applied.document.sourceText).toContain("id: \"target-fixed\"");
    expect(applied.document.sourceText).toContain("  line Use = segment(start: @Target, end: @Base)");
    expect(applied.document.doc.document.elements.find((element) => element.id === targetId)?.name).toBe("Target");
    expect(applied.document.doc.document.elements.find((element) => element.id === targetId)?.parentGroupId).toBe(parentGroupId);
  });

  it("retains a Module-derived endpoint candidate and uses its canonical qualified reference", () => {
    const document = compile([
      "nui 4",
      "module Maker() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance Root = Maker()",
      "point Target = coordinate(x: 8, y: -6)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const targetId = elementId(document, "Target");
    const candidates = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [targetId] });
    const moduleBase = candidates.find((candidate) =>
      [...candidate.referencesByTargetId.values()].some((reference) =>
        reference.base === "Root::Out" && reference.pointKey === "start"
      )
    );

    expect(moduleBase).toBeDefined();
    expect(moduleBase?.referencesByTargetId.get(targetId)).toEqual({ base: "Root::Out", pointKey: "start" });
    if (!moduleBase) return;
    const plan = planCoordinatePointConversion({ snapshot, targetIds: [targetId], base: moduleBase, mode: "xy" });
    expect(plan.splices.flatMap((splice) => splice.replacementLines).join("\n")).toContain("from: @Root::Out.start");
    const applied = applyCoordinatePointConversionPlan(plan, snapshot);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(snapshotFor(applied.document).evaluation.computedGeometry.get(targetId)).toMatchObject({
      kind: "point",
      x: 8,
      y: -6
    });
  });

  it("uses source-order candidates and intersects candidates across targets", () => {
    const document = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "line Guide = segment(start: @A, end: @B)",
      "point TargetA = coordinate(x: 10, y: 10)",
      "point TargetB = coordinate(x: 20, y: 20)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const targetIds = [elementId(document, "TargetA"), elementId(document, "TargetB")];
    const candidates = coordinatePointConversionBaseCandidates({ snapshot, targetIds });

    expect(candidates.some((candidate) => candidate.sourceElementId === elementId(document, "A"))).toBe(true);
    expect(candidates.some((candidate) => candidate.sourceElementId === elementId(document, "Guide") && candidate.anchor.mode === "derived")).toBe(true);
    expect(candidates.every((candidate) => !targetIds.includes(candidate.sourceElementId))).toBe(true);
  });

  it("computes normalized polar angles in all quadrants and handles coincidence", () => {
    const document = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Q1 = coordinate(x: 1, y: 1)",
      "point Q3 = coordinate(x: -1, y: -1)",
      "point Same = coordinate(x: 0, y: 0)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [elementId(document, "Q1")] })
      .find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!;
    const q1 = planCoordinatePointConversion({ snapshot, targetIds: [elementId(document, "Q1")], base, mode: "angle-distance" });
    const q3 = planCoordinatePointConversion({ snapshot, targetIds: [elementId(document, "Q3")], base: coordinatePointConversionBaseCandidates({ snapshot, targetIds: [elementId(document, "Q3")] }).find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!, mode: "angle-distance" });
    const same = planCoordinatePointConversion({ snapshot, targetIds: [elementId(document, "Same")], base: coordinatePointConversionBaseCandidates({ snapshot, targetIds: [elementId(document, "Same")] }).find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!, mode: "angle-distance" });

    const q1Text = q1.splices.flatMap((splice) => splice.replacementLines).join("\n");
    const q3Text = q3.splices.flatMap((splice) => splice.replacementLines).join("\n");
    const sameText = same.splices.flatMap((splice) => splice.replacementLines).join("\n");
    expect(q1Text).toContain("angle: 45");
    expect(q1Text).toContain("distance: 1.4142135623730951");
    expect(q3Text).toContain("angle: 225");
    expect(sameText).toContain("angle: 0");
    expect(sameText).toContain("distance: 0");

    const polarApplied = applyCoordinatePointConversionPlan(q1, snapshot);
    expect(polarApplied.status).toBe("applied");
    if (polarApplied.status === "applied") {
      expect(polarApplied.document.sourceText).toContain("point Q1 = polar(");
      expect(snapshotFor(polarApplied.document).evaluation.computedGeometry.get(elementId(document, "Q1")))
        .toMatchObject({ kind: "point", y: 1 });
      expect((snapshotFor(polarApplied.document).evaluation.computedGeometry.get(elementId(document, "Q1")) as ComputedPoint).x)
        .toBeCloseTo(1, 12);
    }
  });

  it("classifies skipped targets and rejects a stale apply", () => {
    const original = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Good = coordinate(x: 1, y: 0)",
      "const width: number = 10",
      "point Bad = coordinate(x: @width, y: 0)"
    ].join("\n"));
    const snapshot = snapshotFor(original);
    const goodId = elementId(original, "Good");
    const badId = elementId(original, "Bad");
    const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [goodId] })
      .find((candidate) => candidate.sourceElementId === elementId(original, "Base"))!;
    const plan = planCoordinatePointConversion({ snapshot, targetIds: [goodId, badId], base, mode: "xy" });
    expect(plan.classification).toBe("partial-success");
    expect(plan.skippedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: badId, reason: expect.objectContaining({ code: "target-not-eligible" }) })
    ]));

    const changed = compile(original.sourceText.replace("x: 1", "x: 2"));
    const stale = applyCoordinatePointConversionPlan(plan, snapshotFor(changed));
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.reason.code).toBe("stale-source");
  });

  it("revalidates the current evaluation before applying a plan", () => {
    const document = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 3, y: 4)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [elementId(document, "Target")] })
      .find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!;
    const plan = planCoordinatePointConversion({
      snapshot,
      targetIds: [elementId(document, "Target")],
      base,
      mode: "angle-distance"
    });
    const targetId = elementId(document, "Target");
    const changedGeometry = new Map(snapshot.evaluation.computedGeometry);
    const currentPoint = changedGeometry.get(targetId) as ComputedPoint;
    changedGeometry.set(targetId, { ...currentPoint, x: currentPoint.x + 1 });
    const staleEvaluation = applyCoordinatePointConversionPlan(plan, {
      document,
      evaluation: { ...snapshot.evaluation, computedGeometry: changedGeometry }
    });

    expect(staleEvaluation.status).toBe("rejected");
    if (staleEvaluation.status === "rejected") expect(staleEvaluation.reason.code).toBe("revalidation-failed");
  });

  it("preserves identities by source statement order when targetIds are reversed", () => {
    const document = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point First = coordinate(x: 3, y: 4)",
      "point Second = coordinate(x: -5, y: 12)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const firstId = elementId(document, "First");
    const secondId = elementId(document, "Second");
    const targetIds = [secondId, firstId];
    const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds })
      .find((candidate) => candidate.sourceElementId === elementId(document, "Base"))!;
    const plan = planCoordinatePointConversion({ snapshot, targetIds, base, mode: "xy" });
    const applied = applyCoordinatePointConversionPlan(plan, snapshot);

    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(elementId(applied.document, "First")).toBe(firstId);
    expect(elementId(applied.document, "Second")).toBe(secondId);
    expect(applied.document.sourceText).not.toContain("id:");
  });

  it("rejects using the target as its own base and distinguishes all-skipped", () => {
    const document = compile([
      "nui 4",
      "point Target = coordinate(x: 1, y: 2)"
    ].join("\n"));
    const snapshot = snapshotFor(document);
    const targetId = elementId(document, "Target");
    const targetBase = coordinatePointConversionBaseCandidates({ snapshot, targetIds: [targetId] })
      .find((candidate) => candidate.sourceElementId === targetId);
    expect(targetBase).toBeUndefined();

    const plan = planCoordinatePointConversion({
      snapshot,
      targetIds: [targetId],
      base: {
        key: `reference:${targetId}`,
        sourceElementId: targetId,
        anchor: { mode: "reference", pointId: targetId },
        point: snapshot.evaluation.computedGeometry.get(targetId) as ComputedPoint,
        referencesByTargetId: new Map()
      },
      mode: "xy"
    });
    expect(plan.classification).toBe("all-skipped");
    expect(plan.skippedTargets[0]?.reason.code).toBe("base-is-target");
    expect(applyCoordinatePointConversionPlan(plan, snapshot).status).toBe("noop");

    const withBase = compile([
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 1, y: 2)"
    ].join("\n"));
    const withBaseSnapshot = snapshotFor(withBase);
    const withBaseId = elementId(withBase, "Base");
    const withTargetId = elementId(withBase, "Target");
    const withBaseCandidate = coordinatePointConversionBaseCandidates({ snapshot: withBaseSnapshot, targetIds: [withTargetId] })
      .find((candidate) => candidate.sourceElementId === withBaseId)!;
    const missingBaseEvaluation = {
      ...withBaseSnapshot.evaluation,
      computedGeometry: new Map(withBaseSnapshot.evaluation.computedGeometry)
    };
    missingBaseEvaluation.computedGeometry.delete(withBaseId);
    const missingBasePlan = planCoordinatePointConversion({
      snapshot: { document: withBaseSnapshot.document, evaluation: missingBaseEvaluation },
      targetIds: [withTargetId],
      base: withBaseCandidate,
      mode: "xy"
    });
    expect(missingBasePlan.classification).toBe("all-skipped");
    expect(missingBasePlan.skippedTargets[0]?.reason.code).toBe("base-not-evaluated");
  });
});
