import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { EvaluateElementsOptions } from "../src/geometry/evaluate";
import type { ModuleMaterializationSnapshot } from "@nuinuicad/nui-language";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const elementByName = (fixture: Fixture, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`element "${name}" not found`);
  return element;
};

const instanceSnapshot = (
  fixture: Fixture,
  options: EvaluateElementsOptions,
  instanceName: string
): ModuleMaterializationSnapshot => {
  const instance = elementByName(fixture, instanceName);
  const snapshot = options.moduleMaterialization?.instanceBaseGeometrySnapshots.find(
    (candidate) => candidate.instanceId === instance.id
  );
  if (!snapshot) throw new Error(`Module instance "${instanceName}" has no compiler-derived snapshot`);
  return snapshot;
};

const descendantByName = (fixture: Fixture, snapshot: ModuleMaterializationSnapshot, name: string) => {
  const element = snapshot.descendantIds
    .map((id) => fixture.elements.find((candidate) => candidate.id === id))
    .find((candidate) => candidate?.name === name);
  if (!element) throw new Error(`Module descendant "${name}" not found in ${snapshot.instanceId}`);
  return element;
};

const resultFor = (payload: EvaluationPayload) => evaluationPayloadToResult(payload);
const typedBindingIdForName = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return binding.id;
};

describe("SAY-506 Module failure atomicity over persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (fixture: Fixture, evaluationLimitIndex?: number) => {
    if (!fixture.compiled) throw new Error("expected canonical compiled fixture");
    expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const baseOptions = optionsFor(fixture);
    const options = evaluationLimitIndex === undefined
      ? baseOptions
      : { ...baseOptions, evaluationLimitIndex };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    return { options, tsPayload, rustPayload };
  };

  it("withholds failed scalar exports and dependent root bindings while keeping independent scalars", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Failing() {",
      "  export const Good: number = 7",
      "  point Bad = coordinate(x: 1 / 0, y: 0)",
      "}",
      "module Valid() {",
      "  export const Good: number = 11",
      "  export point Mark = coordinate(x: 3, y: 4)",
      "}",
      "instance A = Failing()",
      "instance B = Valid()",
      "const Leaked: number = @A::Good",
      "const Chained: number = @Leaked + 1",
      "const Independent: number = 13",
      "const ValidB: number = @B::Good"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshotA = instanceSnapshot(fixture, options, "A");
    const bad = descendantByName(fixture, snapshotA, "Bad");
    const snapshotB = instanceSnapshot(fixture, options, "B");
    const bindingIds = new Map([
      ["A::Good", typedBindingIdForName(fixture, "A::Good")],
      ["Leaked", typedBindingIdForName(fixture, "Leaked")],
      ["Chained", typedBindingIdForName(fixture, "Chained")],
      ["Independent", typedBindingIdForName(fixture, "Independent")],
      ["B::Good", typedBindingIdForName(fixture, "B::Good")],
      ["ValidB", typedBindingIdForName(fixture, "ValidB")]
    ]);

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: bad.id, elementName: "Bad" });
      expect(result.errors[0]?.message).toContain("除算");
      expect(result.instanceBaseGeometry?.has(snapshotA.instanceId)).toBe(false);
      expect(result.instanceBaseGeometry?.get(snapshotB.instanceId)).toHaveLength(1);
      expect(result.computedScalarBindings?.has(bindingIds.get("A::Good")!)).toBe(false);
      expect(result.computedScalarBindings?.has(bindingIds.get("Leaked")!)).toBe(false);
      expect(result.computedScalarBindings?.has(bindingIds.get("Chained")!)).toBe(false);
      expect(result.computedScalarBindings?.get(bindingIds.get("Independent")!)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 13 }
      });
      expect(result.computedScalarBindings?.get(bindingIds.get("B::Good")!)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 11 }
      });
      expect(result.computedScalarBindings?.get(bindingIds.get("ValidB")!)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 11 }
      });
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
    }
  }, 60_000);

  it("does not publish partial geometry or exports from the canonical failed instance", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export point Good = coordinate(x: 1, y: 2)",
      "  point Bad = coordinate(x: 1 / 0, y: 0)",
      "}",
      "instance A = M()",
      "line Use = segment(start: @A::Good, end: (0, 0))"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshot = instanceSnapshot(fixture, options, "A");
    const good = descendantByName(fixture, snapshot, "Good");
    const bad = descendantByName(fixture, snapshot, "Bad");
    const use = elementByName(fixture, "Use");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: bad.id, elementName: "Bad" });
      expect(result.errors[0]?.message).toContain("除算");
      expect(result.instanceBaseGeometry?.has(snapshot.instanceId)).toBe(false);
      expect(result.computedGeometry.has(good.id)).toBe(false);
      expect(result.computedGeometry.has(bad.id)).toBe(false);
      expect(result.computedGeometry.has(use.id)).toBe(false);
      expect(result.errors.some((error) => error.elementId === use.id)).toBe(false);
      expect(result.geometryValueErrors ?? []).toEqual([]);
    }
  }, 60_000);

  it("fails an instance when a consumed Module numeric parameter evaluates to sqrt(-1)", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(amount: number) {",
      "  export point Good = coordinate(x: 1, y: 2)",
      "  point Bad = coordinate(x: @amount, y: 0)",
      "}",
      "instance A = M(amount: sqrt(-1))",
      "line Use = segment(start: @A::Good, end: (0, 0))"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshot = instanceSnapshot(fixture, options, "A");
    const good = descendantByName(fixture, snapshot, "Good");
    const bad = descendantByName(fixture, snapshot, "Bad");
    const use = elementByName(fixture, "Use");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: bad.id, elementName: "Bad" });
      expect(result.instanceBaseGeometry?.has(snapshot.instanceId)).toBe(false);
      expect(result.computedGeometry.has(good.id)).toBe(false);
      expect(result.computedGeometry.has(use.id)).toBe(false);
      expect(result.errors.some((error) => error.elementId === use.id)).toBe(false);
    }
  }, 60_000);

  it("fails A while preserving B and suppressing only A's dependent consumer", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(x: number) {",
      "  export point Good = coordinate(x: @x + 1, y: 2)",
      "  point Bad = coordinate(x: 1 / @x, y: 0)",
      "}",
      "instance A = M(x: 0)",
      "instance B = M(x: 2)",
      "line UseA = segment(start: @A::Good, end: (0, 0))",
      "line UseB = segment(start: @B::Good, end: (0, 0))"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshotA = instanceSnapshot(fixture, options, "A");
    const snapshotB = instanceSnapshot(fixture, options, "B");
    const goodA = descendantByName(fixture, snapshotA, "Good");
    const badA = descendantByName(fixture, snapshotA, "Bad");
    const goodB = descendantByName(fixture, snapshotB, "Good");
    const badB = descendantByName(fixture, snapshotB, "Bad");
    const useA = elementByName(fixture, "UseA");
    const useB = elementByName(fixture, "UseB");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: badA.id, elementName: "Bad" });
      expect(result.instanceBaseGeometry?.has(snapshotA.instanceId)).toBe(false);
      expect(result.instanceBaseGeometry?.get(snapshotB.instanceId)).toHaveLength(2);
      expect(result.computedGeometry.has(goodA.id)).toBe(false);
      expect(result.computedGeometry.has(badA.id)).toBe(false);
      expect(result.computedGeometry.get(goodB.id)).toMatchObject({ kind: "point", x: 3, y: 2 });
      expect(result.computedGeometry.has(badB.id)).toBe(true);
      expect(result.computedGeometry.has(useA.id)).toBe(false);
      expect(result.computedGeometry.get(useB.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 2 },
        end: { x: 0, y: 0 }
      });
      expect(result.errors.some((error) => error.elementId === useA.id || error.elementId === useB.id)).toBe(false);
    }
  }, 60_000);

  it("keeps fully valid instance geometry, exports, and consumers", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export point Good = coordinate(x: 3, y: 4)",
      "  line Other = segment(start: (0, 0), end: (2, 0))",
      "}",
      "instance A = M()",
      "line Use = segment(start: @A::Good, end: (0, 0))"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshot = instanceSnapshot(fixture, options, "A");
    const good = descendantByName(fixture, snapshot, "Good");
    const other = descendantByName(fixture, snapshot, "Other");
    const use = elementByName(fixture, "Use");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(result.instanceBaseGeometry?.get(snapshot.instanceId)).toHaveLength(2);
      expect(result.computedGeometry.get(good.id)).toMatchObject({ kind: "point", x: 3, y: 4 });
      expect(result.computedGeometry.get(other.id)).toMatchObject({ kind: "line" });
      expect(result.computedGeometry.get(use.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 0, y: 0 }
      });
    }
  }, 60_000);

  it("preserves independent root geometry and diagnostics without adding a failed-export error", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export point Good = coordinate(x: 1, y: 2)",
      "  point Bad = coordinate(x: 1 / 0, y: 0)",
      "}",
      "instance A = M()",
      "line Use = segment(start: @A::Good, end: (0, 0))",
      "point Independent = coordinate(x: 5, y: 6)",
      "point RootBad = coordinate(x: 1 / 0, y: 0)"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshot = instanceSnapshot(fixture, options, "A");
    const bad = descendantByName(fixture, snapshot, "Bad");
    const use = elementByName(fixture, "Use");
    const independent = elementByName(fixture, "Independent");
    const rootBad = elementByName(fixture, "RootBad");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((error) => error.elementId)).toEqual(expect.arrayContaining([bad.id, rootBad.id]));
      expect(result.computedGeometry.has(use.id)).toBe(false);
      expect(result.errors.some((error) => error.elementId === use.id)).toBe(false);
      expect(result.computedGeometry.get(independent.id)).toMatchObject({ kind: "point", x: 5, y: 6 });
    }
  }, 60_000);

  it("does not treat disabled, inactive, or unselected lazy descendants as failures", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  if (false) {",
      "    line Inactive = segment(start: (0, 0), end: (1 / 0, 0))",
      "  }",
      "  line Disabled = segment(start: (0, 0), end: (1 / 0, 0), enabled: false)",
      "  const chosen: point = if (false) { coordinate(x: 1 / 0, y: 9) } else { coordinate(x: 3, y: 4) }",
      "  export point Good = from(source: @chosen)",
      "}",
      "instance A = M()",
      "line Use = segment(start: @A::Good, end: (0, 0))"
    ].join("\n"));
    const { options, tsPayload, rustPayload } = await evaluateBoth(fixture);
    const snapshot = instanceSnapshot(fixture, options, "A");
    const good = descendantByName(fixture, snapshot, "Good");
    const inactive = descendantByName(fixture, snapshot, "Inactive");
    const disabled = descendantByName(fixture, snapshot, "Disabled");
    const use = elementByName(fixture, "Use");

    for (const payload of [tsPayload, rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(result.instanceBaseGeometry?.get(snapshot.instanceId)).toHaveLength(1);
      expect(result.computedGeometry.get(good.id)).toMatchObject({ kind: "point", x: 3, y: 4 });
      expect(result.computedGeometry.has(inactive.id)).toBe(false);
      expect(result.computedGeometry.has(disabled.id)).toBe(false);
      expect(result.computedGeometry.get(use.id)).toMatchObject({ kind: "line", start: { x: 3, y: 4 } });
      expect([...(result.computedGeometryValues?.values() ?? [])].map((entry) => entry.value)).toContainEqual({
        kind: "point",
        x: 3,
        y: 4
      });
    }
  }, 60_000);

  it("keeps zero, partial, and full limits atomic for a failed instance", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export point Good = coordinate(x: 1, y: 2)",
      "  point Bad = coordinate(x: 1 / 0, y: 0)",
      "}",
      "instance A = M()",
      "line Use = segment(start: @A::Good, end: (0, 0))"
    ].join("\n"));
    const fullOptions = optionsFor(fixture);
    const snapshot = instanceSnapshot(fixture, fullOptions, "A");
    const indexById = new Map(fixture.elements.map((element, index) => [element.id, index]));
    const descendantIndices = snapshot.descendantIds.map((id) => indexById.get(id));
    if (descendantIndices.some((index) => index === undefined)) throw new Error("snapshot must reference compiled elements");
    const partialLimit = Math.max(...descendantIndices as number[]) + 1;
    const zero = await evaluateBoth(fixture, 0);
    const partial = await evaluateBoth(fixture, partialLimit);
    const full = await evaluateBoth(fixture, fixture.elements.length);
    const good = descendantByName(fixture, snapshot, "Good");
    const bad = descendantByName(fixture, snapshot, "Bad");
    const use = elementByName(fixture, "Use");

    for (const payload of [zero.tsPayload, zero.rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toEqual([]);
      expect(result.evaluatedElementIds).toEqual(new Set());
      expect(result.computedGeometry.size).toBe(0);
      expect(result.instanceBaseGeometry?.has(snapshot.instanceId)).toBe(false);
    }
    for (const payload of [partial.tsPayload, partial.rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: bad.id, elementName: "Bad" });
      expect(result.evaluatedElementIds.has(use.id)).toBe(false);
      expect(result.computedGeometry.has(good.id)).toBe(false);
      expect(result.instanceBaseGeometry?.has(snapshot.instanceId)).toBe(false);
    }
    for (const payload of [full.tsPayload, full.rustPayload]) {
      const result = resultFor(payload);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ elementId: bad.id, elementName: "Bad" });
      expect(result.computedGeometry.has(good.id)).toBe(false);
      expect(result.computedGeometry.has(use.id)).toBe(false);
      expect(result.instanceBaseGeometry?.has(snapshot.instanceId)).toBe(false);
    }
  }, 60_000);
});
