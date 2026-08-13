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
});
