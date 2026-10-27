import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { cells, legalVariants, invalidVariants } from "./fixtures/issue1410/cases";
import adjacent from "./fixtures/issue1410/adjacent.json";
import { createRustStdioParityClient, optionsFor } from "./evaluationParitySupport";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recordsIn = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(recordsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(recordsIn)];
};

describe("Issue #1410 closed high-order lineAngle contract", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  beforeAll(() => { rust = createRustStdioParityClient(root); }, 120_000);
  afterAll(() => rust?.dispose());

  it("retains every original Cartesian cell and its independent oracle", () => {
    expect(cells).toHaveLength(668);
    expect(new Set(cells.map(c => c.id)).size).toBe(668);
    expect(Object.fromEntries(["A", "B", "C", "D", "E", "F"].map(s =>
      [s, cells.filter(c => c.suite === s).length]))).toEqual({ A: 72, B: 96, C: 324, D: 96, E: 32, F: 48 });
  });

  for (const cell of [...cells, ...adjacent, ...legalVariants, ...invalidVariants]) it(`${cell.id} ${JSON.stringify(cell.factors)}`, async () => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), cell.source);
    const diagnostics = compiled.diagnostics.filter(d => d.severity === "error");
    if (cell.expected === "diagnostic" && diagnostics.length) {
      expect(diagnostics.every(d => d.physicalSpan?.segments.length)).toBe(true);
      expect(diagnostics.some(d => d.code?.includes("geometry"))).toBe(true);
      return;
    }
    expect(diagnostics, cell.id).toEqual([]);
    const fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
    const options = optionsFor(fixture);
    const prepared = prepareRustEvaluation(fixture.elements, options);
    expect(prepared.rustEligible, cell.id).toBe(true);
    const doc = fixture.compiled!.doc;
    const resultBinding = doc.bindingAnalysis!.catalog.bindings.find(b => b.kind === "typed" && b.name === "result")!;
    const resultStatement = doc.scalarProgram!.statements.find(s => s.bindingId === resultBinding.id)!;
    const call = resultStatement.declaration.initializer;
    if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error(`${cell.id}: missing canonical call`);
    const [selected, axis] = call.args;
    if (selected?.kind !== "geometryEndpoint" || axis?.kind !== "geometryEndpoint") throw new Error("missing endpoints");
    expect(selected.target, cell.id).toBeTruthy();
    expect(axis.target, cell.id).toBeTruthy();
    const wire = JSON.parse(JSON.stringify(prepared.input));
    expect(recordsIn(wire)).toContainEqual(selected);
    expect(recordsIn(wire)).toContainEqual(axis);
    if (cell.expected !== "diagnostic" && cell.suite !== "adjacent" && cell.suite !== "contrast") {
      expect(selected.endpointKey).toBe(cell.factors.endpoint);
      const occurrences = recordsIn(wire).filter(r => r.kind === "forGroupOccurrence" && typeof r.templateElementId === "string");
      expect(occurrences.length, cell.id).toBeGreaterThan(0);
      // Exact compiler template IDs survive the wire; the source name alone
      // cannot identify a selected Module instance or generated occurrence.
      for (const occurrence of occurrences) expect(fixture.elements.some(e => e.id === occurrence.templateElementId)).toBe(true);
      expect(recordsIn(wire).filter(r => r.kind === "geometryCarry").length).toBeGreaterThan(0);
      if (cell.suite === "C") {
        expect(selected.target?.kind).toBe("geometryCollectionIndex");
        expect(recordsIn(wire).some(r => r.kind === "leaf" && Array.isArray(r.targets) && r.targets.length === 3)).toBe(true);
      }
      if (cell.suite === "F") {
        const instance = fixture.elements.find(e => e.type === "moduleInstance" && e.name === cell.factors.instance)!;
        expect(selected.target?.kind).toBe("geometryCarry");
        if (selected.target?.kind === "geometryCarry") {
          const instancePath = prepared.input.moduleMaterialization!.instances.find(i => i.instanceId === instance.id)!.instancePath;
          expect(instancePath.every(part => selected.target?.kind === "geometryCarry" && selected.target.bindingId.includes(part))).toBe(true);
        }
      }
    }
    // Real production Node -> persistent evaluation_stdio. No mocks/fallback.
    const results = [evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options)),
      evaluationPayloadToResult(await rust.evaluateInput(prepared.input))];
    for (const result of results) {
      const scalar = result.computedScalarBindings?.get(resultBinding.id);
      if (cell.expected === "diagnostic") {
        expect(scalar, cell.id).toMatchObject({ status: "error" });
        expect(result.errors.length, cell.id).toBeGreaterThan(0);
        if ("contractInvalid" in cell && cell.contractInvalid) {
          expect(result.errors.some(error => error.message.includes("evaluation-collection-index-unavailable")), cell.id).toBe(true);
        }
        continue;
      }
      expect(result.errors, cell.id).toEqual([]);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${cell.id}: ${JSON.stringify(scalar)}`);
      expect(scalar.value.value, `${cell.id}: ${cell.oracle}`).toBeCloseTo(cell.expected as number, 6);
      expect(scalar.value.value).toBeGreaterThanOrEqual(-1e-10);
      expect(scalar.value.value).toBeLessThanOrEqual(90);
      if ("previousExpected" in cell && typeof cell.previousExpected === "number") {
        const incoming = doc.bindingAnalysis!.catalog.bindings.find(b => b.kind === "typed" && b.name === "incoming")!;
        const previous = result.computedScalarBindings?.get(incoming.id);
        if (previous?.status !== "ok" || previous.value.kind !== "number") throw new Error(`${cell.id}: missing snapshot`);
        expect(previous.value.value, cell.id).toBeCloseTo(cell.previousExpected, 6);
      }
    }
  }, 30_000);
});
