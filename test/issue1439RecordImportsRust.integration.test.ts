import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildRecordImport } from "./issue1439Support";
import { createRustStdioParityClient, fixtureFromSource, normalizeParityPayload } from "./evaluationParitySupport";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";

const read = (name: string) => readFileSync(`test/fixtures/issue-1439/${name}`, "utf8");
let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 120_000);
afterAll(() => { rust?.dispose(); });

for (const rootName of ["root.nui", "same-document.nui", "wrappers.nui"]) it(`preserves ${rootName} nested fields, collections, optionals and asymmetric Modules in reference and persistent Rust`, async () => {
  const { graph, analysis, compiled, errors } = await buildRecordImport(read(rootName), Object.fromEntries(
    ["seam.nui", "facade.nui", "modules.nui"].map(name => [name, read(name)])
  ));
  expect(graph.valid, JSON.stringify([...graph.nodes.values()].map(n => ({ id: n.documentId, errors: n.sourceDiagnostics })))).toBe(true);
  expect(analysis.valid, JSON.stringify(analysis.diagnostics)).toBe(true);
  expect(errors).toEqual([]);
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) throw new Error("fixture failed to compile");
  const document = { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion };
  const elements = document.document.elements;
  const options = buildEvaluationOptions({ compiledDocument: document });
  const prepared = prepareRustEvaluation(elements, options);
  expect(prepared.rustEligible).toBe(true);
  const expected = rootName === "wrappers.nui"
    ? { selectedWidth: 31, conditionalWidth: 41, firstWidth: 47, secondWidth: 17, rowWidth: 17, nestedWidth: 59, factoryWidth: 67, forwardedMaybeWidth: 17, absentRowsLength: 71, presentRowsLength: 1, nestedFactoryWidth: 79, nestedFactoryAbsent: 101, nestedFactoryLength: 1, relayedWidth: 17 }
    : JSON.parse(read("observations.json")) as Record<string, number>;
  const assertObservations = (payload: EvaluationPayload) => {
    const result = evaluationPayloadToResult(payload);
    for (const [name, value] of Object.entries(expected)) {
      const binding = compiled.bindingAnalysis?.catalog.bindings.find(b => b.name === name);
      expect(binding, name).toBeDefined();
      expect(result.computedScalarBindings?.get(binding!.id), `${name}: ${JSON.stringify(result.computedScalarBindings?.get(binding!.id))}`).toMatchObject({ status: "ok", value: { kind: "number", value } });
    }
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors ?? []).toEqual([]);
    if (rootName !== "wrappers.nui") {
      const point = elements.find(e => e.name === "Result");
      expect(point).toBeDefined();
      expect(result.computedGeometry.get(point!.id)).toMatchObject({ x: 30, y: 36 });
    }
  };
  const reference = evaluateElementsReferencePayload(elements, options);
  assertObservations(reference);
  const production = await rust.evaluateInput(prepared.input);
  assertObservations(production);
  expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference));
});

it("same-document control uses the ordinary compiler", () => {
  expect(() => fixtureFromSource(read("same-document.nui"))).not.toThrow();
});
