import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument, type GeometryInputTarget, type ScalarExpressionResolvedGeometryTarget, type TypedScalarExpression } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { createRustStdioParityClient, fixtureFromSource, isRustEligibleFixture, optionsFor } from "./evaluationParitySupport";
import cases from "./fixtures/issue1408/cases.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFor = (id: string) => readFileSync(join(root, "test/fixtures/issue1408", `${id}.nui`), "utf8");
type Target = ScalarExpressionResolvedGeometryTarget | GeometryInputTarget |
  { kind: "geometryInputTarget"; target: GeometryInputTarget };

const endpointsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(endpointsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [...(record.kind === "geometryEndpoint" ? [record] : []), ...Object.values(record).flatMap(endpointsIn)];
};

// Follow only the compiler's canonical reference products, never source names.
const selectedLeaf = (input: EvaluateDocumentInput, target: Target, testCase: typeof cases[number], depth = 0): Target => {
  if (depth > 12) throw new Error(`${testCase.id}: cyclic fixture identity`);
  const indexValue = (expression: TypedScalarExpression | null): number => {
    if (expression?.kind === "numberLiteral") return expression.value;
    if (expression?.kind === "reference") {
      const declaration = input.bindingVersions?.versions.find((v) => v.bindingId === expression.bindingId && v.kind === "declare");
      if (declaration?.kind === "declare") return indexValue(declaration.initializer as TypedScalarExpression);
    }
    throw new Error(`${testCase.id}: missing canonical index`);
  };
  if (target.kind === "geometryCollectionIndex") {
    const index = indexValue(target.index);
    expect(index, testCase.id).toBe(testCase.identity.collection_index);
    const node = input.geometryCollectionNodes?.find((n) => n.collectionValueId === target.collectionValueId)?.value;
    if (node?.kind !== "leaf") throw new Error(`${testCase.id}: missing collection leaf`);
    expect(node.targets, testCase.id).toHaveLength(3);
    return selectedLeaf(input, node.targets[index], testCase, depth + 1);
  }
  if (target.kind === "geometryValue") {
    const node = input.geometryValueProgram?.find((n) => JSON.stringify(n.occurrence) === JSON.stringify(target.occurrence));
    if (node?.construction.kind !== "reference") throw new Error(`${testCase.id}: missing alias`);
    return selectedLeaf(input, node.construction.target, testCase, depth + 1);
  }
  if (target.kind === "geometryCarry") {
    const carry = input.bindingVersions?.immutableForGroups?.flatMap((g) => g.geometryCarries ?? []).find((c) => c.bindingId === target.bindingId);
    if (!carry) throw new Error(`${testCase.id}: missing carry`);
    expect(carry.initializerTarget, testCase.id).toEqual(carry.nextTarget);
    const instanceName = testCase.identity.module ?? testCase.identity.owner.split("::")[0];
    const instance = input.elements.find((e) => e.type === "moduleInstance" && e.name === instanceName);
    const materialization = input.moduleMaterialization?.instances.find((i) => i.instanceId === instance?.id);
    if (!materialization) throw new Error(`${testCase.id}: missing Module owner`);
    expect(input.geometryValueProgram?.some((n) => n.construction.kind === "reference" &&
      n.construction.target.kind === "geometryCarry" && n.construction.target.bindingId === target.bindingId &&
      JSON.stringify(n.occurrence.instancePath) === JSON.stringify(materialization.instancePath)), testCase.id).toBe(true);
    return selectedLeaf(input, carry.nextTarget as ScalarExpressionResolvedGeometryTarget, testCase, depth + 1);
  }
  if (target.kind === "forGroupOccurrence") {
    expect(indexValue(target.index), testCase.id).toBe(testCase.identity.occurrence);
  }
  return target;
};

const angleBetweenAxes = (axis: number) => Math.acos(Math.abs(Math.cos((axis - 7) * Math.PI / 180))) * 180 / Math.PI;

describe("Issue #1408 generated occurrence, selected stage and Module carry", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  beforeAll(() => { rust = createRustStdioParityClient(root); }, 120_000);
  afterAll(() => rust?.dispose());

  const evaluate = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((d) => d.severity === "error"), source).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const input = buildRustEvaluationInput(fixture.elements, options);
    const ts = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options));
    const production = evaluationPayloadToResult(await rust.evaluateInput(input));
    const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((b) => b.kind === "typed" && b.name === "result");
    if (!binding) throw new Error("missing result binding");
    return { fixture, input, ts, production, binding };
  };

  it.each(cases)("$id keeps the retained oracle and exact compiler identity", async (testCase) => {
    const { fixture, input, ts, production, binding } = await evaluate(sourceFor(testCase.id));
    const call = fixture.compiled?.doc.scalarProgram?.statements.find((s) => s.bindingId === binding.id)?.declaration.initializer;
    if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error("missing lineAngle call");
    const [a, b] = call.args;
    if (a?.kind !== "geometryEndpoint" || b?.kind !== "geometryEndpoint" || !a.target || !b.target) throw new Error("missing endpoints");
    expect(a.endpointKey).toBe(testCase.endpoint);
    expect(b.endpointKey).toBe("start");
    expect(endpointsIn(input)).toContainEqual(a);
    expect(endpointsIn(input)).toContainEqual(b);
    const leaf = selectedLeaf(input, a.target, testCase);
    expect("stagePath" in leaf ? leaf.stagePath : undefined).toEqual(testCase.identity.stage);
    const ownerId = "templateElementId" in leaf ? leaf.templateElementId :
      "statementId" in leaf ? leaf.statementId : "elementId" in leaf ? leaf.elementId : undefined;
    const owner = fixture.elements.find((e) => e.id === ownerId);
    if (testCase.identity.occurrence !== undefined) {
      expect(leaf.kind).toBe("forGroupOccurrence");
      expect(owner?.name).toBe("Generated");
    } else {
      const [instance, name] = testCase.identity.owner.split("::");
      expect(owner?.name).toBe(name);
      expect(owner?.parentGroupId).toBe(fixture.elements.find((e) => e.type === "moduleInstance" && e.name === instance)?.id);
    }
    expect(b.target).toMatchObject({ statementId: fixture.elements.find((e) => e.name === "Axis")?.id });
    // Retained independent oracle: arc radius + 90°, cubic endpoint derivative,
    // authored stage rotations, and reversal's endpoint swap. K06 uses B'(.37).
    expect(angleBetweenAxes(testCase.tangent_axis_deg)).toBeCloseTo(testCase.expected, 10);
    for (const result of [ts, production]) {
      expect(result.errors, testCase.id).toEqual([]);
      const scalar = result.computedScalarBindings?.get(binding.id);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${testCase.id}: ${JSON.stringify(scalar)}`);
      expect(scalar.value.value, testCase.id).toBeCloseTo(testCase.expected, 6);
    }
  }, 30_000);

  it.each([0, 3])("preserves flattened nested occurrence %i through the same Module", async (index) => {
    const source = sourceFor("R01")
      .replace("  arc Generated", "  for j in range(min: 0, max: 1, step: 1) {\n  arc Generated")
      .replaceAll("@i * 120", "(@i * 2 + @j) * 120")
      .replaceAll("@i * 11", "(@i * 2 + @j) * 11")
      .replace("}\nmodule", "  }\n}\nmodule")
      .replace("@Generated[0]", `@Generated[${index}]`);
    const { ts, production, binding } = await evaluate(source);
    for (const result of [ts, production]) {
      expect(result.errors).toEqual([]);
      const scalar = result.computedScalarBindings?.get(binding.id);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(JSON.stringify(scalar));
      expect(scalar.value.value).toBeCloseTo(angleBetweenAxes(128 + index * 11), 6);
    }
  }, 30_000);

  it.each(["2", "-1", "0.5"])('rejects invalid occurrence "%s" without selecting the last row', async (index) => {
    const source = sourceFor("R01").replace("@Generated[0]", `@Generated[${index}]`);
    const { ts, production, binding } = await evaluate(source);
    for (const result of [ts, production]) {
      expect(result.computedScalarBindings?.get(binding.id)).toMatchObject({ status: "error" });
      expect(result.errors.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("rejects a missing occurrence index at the Module parameter boundary", () => {
    const source = sourceFor("R01").replace("@Generated[0]", "@Generated");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    expect(compiled.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error", code: "module-undefined-geometry-reference", physicalSpan: expect.any(Object)
    }));
  });

  it.each([1, 2])("preserves simultaneous Module carry snapshots over %i iterations", async (iterations) => {
    const source = sourceFor("R01")
      .replace("module Forward(source: path)", "module Forward(source: path, other: path)")
      .replace("max: 0, step: 1) carry edge: path = @source", `max: ${iterations - 1}, step: 1) carry edge: path = @source carry previous: path = @other`)
      .replace("next edge = @source", "next edge = @previous\n    next previous = @edge")
      .replace("source: @Generated[0].flipped)", "source: @Generated[0].flipped, other: @Generated[1].flipped)");
    const { ts, production, binding } = await evaluate(source);
    for (const result of [ts, production]) {
      expect(result.errors).toEqual([]);
      const scalar = result.computedScalarBindings?.get(binding.id);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(JSON.stringify(scalar));
      expect(scalar.value.value).toBeCloseTo(iterations === 1 ? 48 : 59, 6);
    }
  }, 30_000);
});
