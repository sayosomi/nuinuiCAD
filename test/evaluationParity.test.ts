import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { printableGroups } from "../src/print/printGeometry";
import { activePrintLayout, resolvePrintLayout } from "../src/print/printLayout";
import {
  evaluateWithRustFixture,
  isCurrentReleaseFixture,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  parityFixtureNames,
  readParityFixture,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const fixtureNames = runRustParity ? parityFixtureNames(repoRoot) : [];

const printGroupIdsFor = (fixture: ReturnType<typeof readParityFixture>, payload: ReturnType<typeof evaluateWithRustFixture>) => {
  const doc = fixture.compiled?.doc;
  if (!doc) return [];
  return printableGroups(
    doc.document.elements,
    { propertyBindings: doc.propertyBindings, byElementId: doc.statementMap.byElementId, materializedPropertyBindings: doc.materializedPropertyBindings },
    evaluationPayloadToResult(payload).computedScalarBindings
  ).map((group) => group.id);
};

const scalarBindingFor = (
  fixture: ReturnType<typeof readParityFixture>,
  payload: ReturnType<typeof evaluateWithRustFixture>,
  name: string
) => {
  const binding = fixture.compiled?.doc?.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const expectScalarNumberClose = (
  value: ReturnType<typeof scalarBindingFor>,
  expected: number
): void => {
  expect(value?.status).toBe("ok");
  if (value?.status !== "ok" || value.value.kind !== "number") throw new Error("expected a numeric scalar success");
  expect(value.value.value).toBeCloseTo(expected, 10);
};

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  it.each(fixtureNames)("%s matches the TypeScript reference payload", (name: string) => {
    const fixture = readParityFixture(repoRoot, name);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    if (!isCurrentReleaseFixture(name)) return;
    expect(isRustEligibleFixture(fixture), `${name} must use the production Rust route`).toBe(true);
    expect(normalizeParityPayload(runtimeDiagnosticsFor(fixture, rustPayload))).toEqual(
      normalizeParityPayload(runtimeDiagnosticsFor(fixture, tsPayload))
    );
    expect(printGroupIdsFor(fixture, rustPayload)).toEqual(printGroupIdsFor(fixture, tsPayload));
  }, 30000);

  it("evaluates Label and Bare through the Rust-first declarations/templates fixture", () => {
    const fixture = readParityFixture(repoRoot, "nui4-declarations-templates.nui");
    const result = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));
    const label = fixture.elements.find((element) => element.type === "text" && element.name === "Label")!;
    const bare = fixture.elements.find((element) => element.type === "text" && element.name === "Bare")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(result.errors.filter((error) => error.elementId === label.id || error.elementId === bare.id)).toEqual([]);
    expect(result.computedGeometry.get(label.id)).toMatchObject({ kind: "text", text: "{draft} 前身頃 12.346\n" });
    expect(result.computedGeometry.get(bare.id)).toMatchObject({ kind: "text", text: "前身頃" });
  }, 30000);

  it("keeps tangentOffset curveSide literal, choice binding, and pathReverse parity", () => {
    const fixture = readParityFixture(repoRoot, "nui4-tangent-offset-curve-side.nui");
    const options = optionsFor(fixture);
    const ts = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options));
    const rust = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(rust.errors).toEqual(ts.errors);
    for (const name of ["Convex", "Concave", "Bound", "ReverseConvex"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "point" });
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset points");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
    const convex = fixture.elements.find((candidate) => candidate.name === "Convex")!;
    const concave = fixture.elements.find((candidate) => candidate.name === "Concave")!;
    const reverseConvex = fixture.elements.find((candidate) => candidate.name === "ReverseConvex")!;
    for (const [element, x, y] of [[convex, 5, 8.5], [concave, 5, 6.5], [reverseConvex, 5, 8.5]] as const) {
      const geometry = ts.computedGeometry.get(element.id);
      expect(geometry).toMatchObject({ kind: "point" });
      if (geometry?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(geometry.x).toBeCloseTo(x, 10);
      expect(geometry.y).toBeCloseTo(y, 10);
    }

    for (const name of ["Split", "TrimCurve", "ExtendCurve"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
      expect(rust.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
    }
    for (const name of ["SplitOffset", "TrimOffset", "ExtendOffset"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(tsPoint).toMatchObject({ kind: "point" });
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
  }, 30000);

  it("materializes printLayout-local bindings after stop through the Rust-first payload", () => {
    const fixture = readParityFixture(repoRoot, "nui4-print-layout-local-stop.nui");
    const options = optionsFor(fixture);
    const tsEvaluation = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options));
    const rustEvaluation = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));
    const compiled = fixture.compiled!.doc!;
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const numericBindingLookup = {
      numericBindings: compiled.numericBindings ?? new Map(),
      byKey: compiled.statementMap.byKey,
      bindingVersions: compiled.bindingVersions
    };
    const resolve = (evaluation: typeof tsEvaluation) => resolvePrintLayout({
      layout,
      elements: compiled.document.elements,
      evaluation,
      numericBindingLookup
    }).placements[0];
    const placeBinding = [...(compiled.numericBindings?.values() ?? [])]
      .find((binding) => binding.parameterKey === "x");

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(placeBinding?.references).toHaveLength(1);
    expect(rustEvaluation.computedScalarBindings?.get(placeBinding!.references[0].bindingId)).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 30 }
    });
    expect(resolve(tsEvaluation)).toMatchObject({ x: 30, y: 30 });
    expect(resolve(rustEvaluation)).toMatchObject({ x: 30, y: 30 });
  }, 30000);

  it("asserts arithmetic operators and printLayout/place values through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-arithmetic-operators.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "powerBasic")).toMatchObject({ status: "ok", value: { kind: "number", value: 8 } });
      expect(scalarBindingFor(fixture, payload, "remainderBasic")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "powerRightAssociative")).toMatchObject({ status: "ok", value: { kind: "number", value: 512 } });
      expect(scalarBindingFor(fixture, payload, "powerUnaryPrecedence")).toMatchObject({ status: "ok", value: { kind: "number", value: -4 } });
      expect(scalarBindingFor(fixture, payload, "powerNegativeExponent")).toMatchObject({ status: "ok", value: { kind: "number", value: 0.25 } });
    }

    const compiled = fixture.compiled!.doc!;
    const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
    const numericBindingLookup = {
      numericBindings: compiled.numericBindings ?? new Map(),
      byKey: compiled.statementMap.byKey,
      bindingVersions: compiled.bindingVersions
    };
    const resolve = (payload: typeof tsPayload) => resolvePrintLayout({
      layout,
      elements: compiled.document.elements,
      evaluation: evaluationPayloadToResult(payload),
      numericBindingLookup
    });

    for (const payload of [tsPayload, rustPayload]) {
      const resolved = resolve(payload);
      expect(resolved).toMatchObject({
        columns: 8,
        rows: 2,
        overlapMm: 0.25,
        scale: 0.25,
        svgCanvasWidthMm: 8,
        svgCanvasHeightMm: 2
      });
      expect(resolved.placements[0]).toMatchObject({ x: 8, y: 2, angleDeg: 32 });
    }
  }, 30000);

  it("asserts nui4 builtin scalar values and runtime errors in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "absValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "minValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
      expect(scalarBindingFor(fixture, payload, "maxValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 20 } });
      expect(scalarBindingFor(fixture, payload, "sqrtValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "roundPositive")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "roundNegative")).toMatchObject({ status: "ok", value: { kind: "number", value: -2 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimalCoefficientBoundary")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 9484088218495944 }
      });
      expect(scalarBindingFor(fixture, payload, "roundCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "floorDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.34 } });
      expect(scalarBindingFor(fixture, payload, "floorCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "ceilDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "ceilCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1300 } });
      expect(scalarBindingFor(fixture, payload, "roundToValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.5 } });
      expect(scalarBindingFor(fixture, payload, "roundToNonFiniteResult")).toMatchObject({
        status: "error",
        issueCode: "evaluation-non-finite-result"
      });
      expect(scalarBindingFor(fixture, payload, "closeValue")).toMatchObject({ status: "ok", value: { kind: "boolean", value: true } });
      expect(scalarBindingFor(fixture, payload, "nestedValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "referenceArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "geometryArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "sqrtInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
      expect(scalarBindingFor(fixture, payload, "roundToInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
      expect(scalarBindingFor(fixture, payload, "closeInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
      const offset = fixture.elements.find((element) => element.name === "BuiltinOffset")!;
      const template = fixture.elements.find((element) => element.name === "BuiltinTemplate")!;
      const evaluated = evaluationPayloadToResult(payload);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id || error.elementId === template.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "丸め=10" });
    }
  }, 30000);

  it("asserts nui4 trigonometric scalar, geometry, module, text, and print values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-trigonometric-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["sin30", 0.5], ["cos60", 0.5], ["tan45", 1],
        ["asinHalf", 30], ["acosHalf", 60], ["atanOne", 45],
        ["atan2Right", 0], ["atan2Up", 90], ["atan2Left", 180], ["atan2Down", 270],
        ["atan2Diagonal", 45], ["atan2Zero", 0], ["nestedTrig", 30], ["referenceTrig", -1]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      for (const name of [
        "tanInvalid90", "tanInvalid270", "tanInvalidNegative90",
        "asinInvalidLow", "asinInvalidHigh", "acosInvalidLow", "acosInvalidHigh"
      ] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-invalid-builtin-argument"
        });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const offset = fixture.elements.find((element) => element.name === "TrigOffset")!;
      const template = fixture.elements.find((element) => element.name === "TrigTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      expect(evaluated.computedGeometry.get(origin.id)).toMatchObject({ kind: "point" });
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(0.5, 10);
      expect(originGeometry.y).toBeCloseTo(0.5, 10);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "sin30=0.5" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      expect(moduleGeometry).toMatchObject({ kind: "point", y: 0 });
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(0.5, 10);

      const compiled = fixture.compiled!.doc!;
      const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
      const resolved = resolvePrintLayout({
        layout,
        elements: compiled.document.elements,
        evaluation: evaluated,
        numericBindingLookup: {
          numericBindings: compiled.numericBindings ?? new Map(),
          byKey: compiled.statementMap.byKey,
          bindingVersions: compiled.bindingVersions
        }
      });
      expect(resolved).toMatchObject({ columns: 8, rows: 2 });
      expect(resolved.overlapMm).toBeCloseTo(0.5, 10);
      expect(resolved.scale).toBeCloseTo(1, 10);
      expect(resolved.placements[0]).toMatchObject({ x: 8, y: 2 });
      expect(resolved.placements[0]?.angleDeg).toBeCloseTo(45, 10);
    }
  }, 30000);

  it("asserts nui4 spreadAngle named arguments, domains, module, text, and print values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-spread-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const expected = 11.4783409545;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const name of ["spreadBasic", "spreadReversed", "spreadReferences", "mutableSpread"] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      expect(scalarBindingFor(fixture, payload, "spreadZero")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "spreadStraight")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      for (const name of [
        "spreadInvalidLengthZero",
        "spreadInvalidLengthNegative",
        "spreadInvalidNegative",
        "spreadInvalidTooLarge"
      ] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-invalid-builtin-argument"
        });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const template = fixture.elements.find((element) => element.name === "SpreadTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(expected, 10);
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "angle=11.478" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(expected, 10);

      const compiled = fixture.compiled!.doc!;
      const layout = activePrintLayout(compiled.document.printLayouts, compiled.document.activePrintLayoutId);
      const resolved = resolvePrintLayout({
        layout,
        elements: compiled.document.elements,
        evaluation: evaluated,
        numericBindingLookup: {
          numericBindings: compiled.numericBindings ?? new Map(),
          byKey: compiled.statementMap.byKey,
          bindingVersions: compiled.bindingVersions
        }
      });
      expect(resolved.columns).toBe(11);
      expect(resolved.rows).toBe(1);
      expect(resolved.overlapMm).toBe(0);
      expect(resolved.scale).toBe(1);
      expect(resolved.svgCanvasWidthMm).toBeCloseTo(expected, 10);
      expect(resolved.svgCanvasHeightMm).toBe(20);
      expect(resolved.placements[0]?.x).toBeCloseTo(expected, 10);
      expect(resolved.placements[0]?.y).toBe(0);
      expect(resolved.placements[0]?.angleDeg).toBeCloseTo(expected, 10);
      expect(resolved.placements[0]?.mirrorX).toBe(false);
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts nui4 geometry builtin values and mutation through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "distanceFive")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceZero")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceTen")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 10 }
      });
      expect(scalarBindingFor(fixture, payload, "disabledDistance")).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-builtin-unavailable"
      });
      expect(scalarBindingFor(fixture, payload, "derivedDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 7 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedAngle")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 135 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedLineDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "angleRight")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "angleUp")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "angleLeft")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "angleDown")).toMatchObject({ status: "ok", value: { kind: "number", value: 270 } });
      expect(scalarBindingFor(fixture, payload, "angleDiagonal")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "angleSame")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "lineDistanceHorizontal")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 3 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceVertical")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      const diagonal = scalarBindingFor(fixture, payload, "lineDistanceDiagonal");
      expect(diagonal?.status).toBe("ok");
      if (diagonal?.status !== "ok" || diagonal.value.kind !== "number") {
        throw new Error("lineDistanceDiagonal must be a numeric success");
      }
      expect(diagonal.value.value).toBeCloseTo(Math.SQRT2, 12);
      expect(scalarBindingFor(fixture, payload, "lineDistanceOnLine")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceZero")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
      expect(scalarBindingFor(fixture, payload, "mutationValue")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "evaluation-geometry-builtin-unavailable",
          message: "組み込み関数のgeometry引数を評価できません。参照先のgeometryが有効で、正常に評価済みか確認してください。",
          origin: "runtime"
        })
      ]));
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts lineAngle semantics and errors through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-line-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "parallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "diagonal45"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "perpendicular"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reversedParallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "directed135"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "spatiallySeparated"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseFirst"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseSecond"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "swapped"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "polarAngle"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "setValue"), 90);
      expect(scalarBindingFor(fixture, payload, "zeroFirst")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
      expect(scalarBindingFor(fixture, payload, "zeroSecond")).toMatchObject({
        status: "error",
        issueCode: "evaluation-invalid-builtin-argument"
      });
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts module geometry builtin lowering values and parity through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-module-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "radius")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "direction")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "height")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "lineAngleValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "localDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarBindingFor(fixture, payload, "parameterStartDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "parameterEndAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "localEndpointLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "measured")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "rootLineAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts root set geometry builtin resolution with an unrelated module through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui4-module-root-set-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "distanceValue"), 5);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "angleValue"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineDistanceValue"), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineAngleValue"), 90);
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);
});
