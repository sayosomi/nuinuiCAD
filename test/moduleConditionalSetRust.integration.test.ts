import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { initialCadDocumentState, useCadDocumentStore } from "../src/state/cadDocumentStore";
import {
  evaluateWithRustFixture,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const exactFalseSource = [
  "nui 3",
  "",
  "point 外の点 = coordinate(x: 0, y: 0)",
  "",
  "module M() {",
  "  let 値: number = 0",
  "  if 条件 (false) {",
  "    set 値 = 1",
  "  }",
  "}",
  "",
  "module I = M()"
].join("\n");

const exactTrueSource = exactFalseSource.replace("false", "true");

const independentInstancesSource = [
  "nui 3",
  "module M(enabled: boolean) {",
  "  let 値: number = 0",
  "  if 条件 (@enabled) {",
  "    set 値 = 1",
  "  }",
  "  point P = coordinate(x: @値, y: 0)",
  "}",
  "module False = M(enabled: false)",
  "module True = M(enabled: true)"
].join("\n");

const evaluatedPoints = (fixture: ReturnType<typeof fixtureFromSource>, payload: ReturnType<typeof evaluateWithRustFixture>) => {
  const result = evaluationPayloadToResult(payload);
  return fixture.elements.filter((element) => element.name === "P").map((element) => result.computedGeometry.get(element.id));
};

describe("Rust-first Module conditional set runtime", () => {
  it("accepts the exact no-geometry reproduction and preserves the outside point", () => {
    const fixture = fixtureFromSource(exactFalseSource);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    expect(input.scalarProgram).toBeUndefined();
    expect(input.bindingVersions).toBeDefined();

    const payload = evaluateWithRustFixture(process.cwd(), fixture);
    const result = evaluationPayloadToResult(payload);
    const outside = fixture.elements.find((element) => element.name === "外の点");
    expect(result.errors).toEqual([]);
    expect(outside && result.computedGeometry.get(outside.id)).toMatchObject({ kind: "point", x: 0, y: 0 });
  }, 30000);

  it("accepts the true literal variant with the same source layout", () => {
    const fixture = fixtureFromSource(exactTrueSource);
    const payload = evaluateWithRustFixture(process.cwd(), fixture);
    const result = evaluationPayloadToResult(payload);
    const outside = fixture.elements.find((element) => element.name === "外の点");
    expect(result.errors).toEqual([]);
    expect(outside && result.computedGeometry.get(outside.id)).toMatchObject({ kind: "point", x: 0, y: 0 });
  }, 30000);

  it("keeps the compiled mutation positions through the application document store", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText(independentInstancesSource, "test");
    const document = useCadDocumentStore.getState().doc;
    expect(document.bindingVersions).toBeDefined();
    expect(document.scalarExecutionPositionByRuntimeElementId).toBeDefined();
    expect(document.moduleConditionalOwnerStatementIdByElementId?.size).toBe(2);
    expect([...document.scalarExecutionPositionByRuntimeElementId!.keys()]).toEqual(
      document.document.elements.map((element) => element.id)
    );

    useCadDocumentStore.getState().setSourceEditorPreviewText(exactTrueSource);
    const preview = useCadDocumentStore.getState().previewCompiledDocument;
    expect(preview?.bindingVersions).toBeDefined();
    expect(preview?.moduleConditionalOwnerStatementIdByElementId?.size).toBe(1);
    expect(preview?.scalarExecutionPositionByRuntimeElementId).toBeDefined();
    expect([...preview!.scalarExecutionPositionByRuntimeElementId!.keys()]).toEqual(
      preview!.document.elements.map((element) => element.id)
    );
  });

  it("matches TS/Rust for true and false Module instances without sharing state", () => {
    const fixture = fixtureFromSource(independentInstancesSource);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(process.cwd(), fixture);

    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(evaluatedPoints(fixture, rustPayload)).toEqual([
      expect.objectContaining({ kind: "point", x: 0, y: 0 }),
      expect.objectContaining({ kind: "point", x: 1, y: 0 })
    ]);
    const input = buildRustEvaluationInput(fixture.elements, options);
    expect(input.bindingVersions?.versions.some((version) =>
      JSON.stringify(version.control).includes("conditionalBranch")
    )).toBe(true);
    expect(input.bindingVersions?.conditionalOwners).toHaveLength(2);
  }, 30000);

  it("evaluates the convex-notch manual fixture through the Rust/parity payload", () => {
    const source = readFileSync("docs/module/manual-fixtures/nui3-convex-notch.nui", "utf8");
    const fixture = fixtureFromSource(source);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRustFixture(process.cwd(), fixture);

    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(tsPayload.errors).toEqual([]);
    expect(rustPayload.errors).toEqual([]);
  }, 30000);
});
