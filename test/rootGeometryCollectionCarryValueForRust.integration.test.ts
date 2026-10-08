import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GeometryInputCollectionNode } from "@nuinuicad/nui-language";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElements } from "../src/geometry/evaluate";
import {
  geometryCollectionLengthForNode,
  resolveGeometryCollectionMemberForNode
} from "../src/geometry/scalarProgramEvaluation";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  optionsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let rustStdio: ReturnType<typeof createRustStdioParityClient>;

const evaluateBoth = async (fixture: EvaluationFixture) => {
  if (!fixture.compiled) throw new Error("fixture has no compiled document");
  expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(isRustEligibleFixture(fixture)).toBe(true);
  const options = optionsFor(fixture);
  const typescript = evaluateElements(fixture.elements, options);
  const payload = await rustStdio.evaluate(fixture.elements, options);
  return { typescript, rust: evaluationPayloadToResult(payload), options };
};

const selectedGeometry = (fixture: EvaluationFixture, geometries: ReadonlyMap<string, unknown>, name: string) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`fixture has no element ${name}`);
  return geometries.get(element.id);
};

describe("root geometry collection carry value-for through persistent Rust", () => {
  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  });

  afterAll(() => {
    rustStdio?.dispose();
  });

  it("maps the incoming point carry and selects the committed point", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const initial: point[] = [(1, 2)]",
      "for i in range(min: 0, max: 0, step: 1) carry points: point[] = @initial {",
      "  const mapped: point[] = for item in @points { @item }",
      "  next points = @mapped",
      "}",
      "line Selected = segment(start: @points[0], end: (4, 5))"
    ].join("\n"));
    const { typescript, rust, options } = await evaluateBoth(fixture);

    expect(typescript.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(selectedGeometry(fixture, typescript.computedGeometry, "Selected")).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 4, y: 5 }
    });
    expect(selectedGeometry(fixture, rust.computedGeometry, "Selected")).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 4, y: 5 }
    });

    const carries = [...(options.bindingVersions!.immutableForGroups.values())]
      .flatMap((plan) => plan.geometryCollectionCarries ?? [])
    const mappedNode = [...options.geometryCollectionNodesByValueId!.values()]
      .find((candidate) => candidate.kind === "geometryValueMap");
    const carry = carries.find((candidate) => candidate.collectionValueId === mappedNode?.source.valueId);
    expect(carry).toBeDefined();
    expect(mappedNode).toMatchObject({
      kind: "geometryValueMap",
      source: { kind: "value", valueId: carry!.collectionValueId },
      sourceStatementId: expect.any(String),
      binderId: expect.stringContaining("geometry-value-for-binder"),
      program: expect.any(Object)
    });
  }, 30_000);

  it("keeps mapped generations on their incoming snapshot while carries swap together", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const first: point[] = [(1, 2)]",
      "const second: point[] = [(10, 20)]",
      "for i in range(min: 0, max: 1, step: 1) carry a: point[] = @first carry b: point[] = @second carry steady: point[] = @first {",
      "  const mapped: point[] = for item in @b { coordinate(x: @item.x + 1, y: @item.y) }",
      "  next a = @mapped",
      "  next b = @a",
      "  next steady = @steady",
      "}",
      "line Selected = segment(start: @a[0], end: @b[0])",
      "line Steady = segment(start: @steady[0], end: (0, 0))"
    ].join("\n"));
    const { typescript, rust } = await evaluateBoth(fixture);

    expect(typescript.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const geometries of [typescript.computedGeometry, rust.computedGeometry]) {
      expect(selectedGeometry(fixture, geometries, "Selected")).toMatchObject({
        kind: "line",
        start: { x: 2, y: 2 },
        end: { x: 11, y: 20 }
      });
      expect(selectedGeometry(fixture, geometries, "Steady")).toMatchObject({
        kind: "line",
        start: { x: 1, y: 2 }
      });
    }
  }, 30_000);

  it("keeps line-to-path carry assignability and selected mapped members", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@Base]",
      "for i in range(min: 0, max: 0, step: 1) carry paths: path[] = @lines {",
      "  const mapped: path[] = for item in @paths { @item }",
      "  next paths = @mapped",
      "}",
      "line Selected = offset(sources: [@paths[0]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const { typescript, rust } = await evaluateBoth(fixture);

    expect(typescript.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(selectedGeometry(fixture, typescript.computedGeometry, "Selected")).toMatchObject({
      kind: "offsetLine"
    });
    expect(selectedGeometry(fixture, rust.computedGeometry, "Selected")).toMatchObject({
      kind: "offsetLine"
    });
  }, 30_000);

  it("keeps mapped carry sources separate across Module instances", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Shift(dx: number) {",
      "  point Initial = coordinate(x: @dx, y: 2)",
      "  const initial: point[] = [@Initial]",
      "  for i in range(min: 0, max: 0, step: 1) carry points: point[] = @initial {",
      "    const mapped: point[] = for item in @points { coordinate(x: @item.x + 1, y: @item.y) }",
      "    next points = @mapped",
      "  }",
      "  export const result: point[] = for item in @points { @item }",
      "}",
      "instance A = Shift(dx: 1)",
      "instance B = Shift(dx: 10)",
      "line UseA = segment(start: @A::result[0], end: (0, 0))",
      "line UseB = segment(start: @B::result[0], end: (0, 0))"
    ].join("\n"));
    const { typescript, rust } = await evaluateBoth(fixture);

    expect(typescript.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const geometries of [typescript.computedGeometry, rust.computedGeometry]) {
      expect(selectedGeometry(fixture, geometries, "UseA")).toMatchObject({ kind: "line", start: { x: 2, y: 2 } });
      expect(selectedGeometry(fixture, geometries, "UseB")).toMatchObject({ kind: "line", start: { x: 11, y: 2 } });
    }
  }, 60_000);

  it("returns unavailable for a runtime collection-map cycle", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const initial: point[] = [(1, 2)]",
      "for i in range(min: 0, max: 0, step: 1) carry points: point[] = @initial {",
      "  const mapped: point[] = for item in @points { @item }",
      "  next points = @mapped",
      "}",
      "line Selected = segment(start: @points[0], end: (4, 5))"
    ].join("\n"));
    const node = [...optionsFor(fixture).geometryCollectionNodesByValueId!.values()]
      .find((candidate) => candidate.kind === "geometryValueMap");
    if (!node || node.kind !== "geometryValueMap") throw new Error("compiler omitted geometry map node");
    const cycle: GeometryInputCollectionNode = {
      ...node,
      source: { kind: "value", valueId: "runtime-cycle" }
    };
    const environment = () => ({ lookupBinding: () => undefined } as never);
    expect(geometryCollectionLengthForNode(cycle, environment, () => cycle)).toBeUndefined();
    expect(resolveGeometryCollectionMemberForNode(
      cycle,
      0,
      environment,
      { resolveSourceCollectionNode: () => cycle }
    )).toBeUndefined();
  });
});
