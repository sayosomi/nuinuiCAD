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

  it("gives an element-local numeric variable precedence over a same-named document typed binding (Task 52 B1/B2)", () => {
    const fixture = readParityFixture(repoRoot, "nui4-element-local-typed-name-collision.nui");
    const result = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));
    const point = fixture.elements.find((element) => element.name === "P")!;
    const text = fixture.elements.find((element) => element.name === "T")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(result.errors.filter((error) => error.elementId === point.id || error.elementId === text.id)).toEqual([]);
    expect(result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect(result.computedGeometry.get(text.id)).toMatchObject({ kind: "text", text: "幅は42mm" });
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
      expect(scalarBindingFor(fixture, payload, "localDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarBindingFor(fixture, payload, "parameterStartDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "parameterEndAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "localEndpointLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "measured")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);
});
