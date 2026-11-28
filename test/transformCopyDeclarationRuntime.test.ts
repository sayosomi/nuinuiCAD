import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateWithRustOptions, fixtureFromSource, normalizeParityPayload, optionsFor } from "./evaluationParitySupport";

const sources = `nui 1
layer finished
layer construction
style outline {
  color: foreground,
}
style guide {
  lineType: dashed,
}

line Shoulder = segment(start: (10, 0), end: (20, 0))
line Side = segment(start: (40, 30), end: (40, 10))
line Dart = segment(start: (-5, 12), end: (0, 3))`;

const evaluate = (source: string) => {
  const fixture = fixtureFromSource(source);
  const options = optionsFor(fixture);
  const payload = evaluateElementsReferencePayload(fixture.elements, options);
  if (import.meta.env.VITE_RUN_RUST_PARITY === "1") {
    expect(normalizeParityPayload(evaluateWithRustOptions(process.cwd(), fixture.elements, options))).toEqual(normalizeParityPayload(payload));
  }
  const result = evaluationPayloadToResult(payload);
  return { fixture, result };
};

const expectEndpoints = (
  evaluated: ReturnType<typeof evaluate>,
  name: string,
  coordinates: [number, number, number, number]
) => {
  const element = evaluated.fixture.elements.find((item) => item.name === name);
  expect(element, name).toBeDefined();
  const geometry = evaluated.result.computedGeometry.get(element!.id);
  expect(geometry, name).toBeDefined();
  expect(geometry).toHaveProperty("start");
  expect(geometry).toHaveProperty("end");
  const { start, end } = geometry as { start: { x: number; y: number }; end: { x: number; y: number } };
  [start.x, start.y, end.x, end.y].forEach((value, index) => expect(value).toBeCloseTo(coordinates[index], 8));
};

describe("#1757 named transformCopy", () => {
  it.each([
    "shoulder: Shoulder, side: Side, dart[guide] in construction: Dart",
    "dart[guide] in construction: Dart, side: Side, shoulder: Shoulder"
  ])("copies the exact disconnected fixture independently with parts [%s]", (parts) => {
    const evaluated = evaluate(`${sources}

transformCopy Copied[outline] in finished(
  startPoint: (0, 0),
  endPoint: (100, 50),
  scale: 1,
  angleDeg: 90,
  mirrorX: false,
  parts: [${parts},],
)`);
    expect(evaluated.fixture.compiled!.diagnostics).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expect(evaluated.result.geometryValueErrors).toEqual([]);
    expectEndpoints(evaluated, "shoulder", [100, 60, 100, 70]);
    expectEndpoints(evaluated, "side", [70, 90, 90, 90]);
    expectEndpoints(evaluated, "dart", [88, 45, 97, 50]);
    expectEndpoints(evaluated, "Shoulder", [10, 0, 20, 0]);
    expectEndpoints(evaluated, "Side", [40, 30, 40, 10]);
    expectEndpoints(evaluated, "Dart", [-5, 12, 0, 3]);
    expect(evaluated.fixture.elements.some((element) => element.name === "Copied")).toBe(false);
  });

  it.each<[string, [number, number, number, number]]>([
    ["", [12, 20, 12, 23]],
    ["angleDeg: 90,", [10, 22, 7, 22]],
    ["scale: 2,", [14, 20, 14, 26]],
    ["mirrorX: true,", [8, 20, 8, 23]],
    ["mirrorX: true, scale: 2, angleDeg: 90,", [10, 16, 4, 16]]
  ])("uses the evaluated startPoint when endPoint is omitted (%s)", (args, endpoints) => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (12, 20), end: (12, 23))
transformCopy Implicit(startPoint: (10, 20), ${args} parts: [implicit: L])
transformCopy Explicit(startPoint: (10, 20), endPoint: (10, 20), ${args} parts: [explicit: L])`);
    expect(evaluated.fixture.compiled!.diagnostics).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expect(evaluated.result.geometryValueErrors).toEqual([]);
    expectEndpoints(evaluated, "implicit", endpoints);
    expectEndpoints(evaluated, "explicit", endpoints);
  });
});

describe("Base connectivity controls", () => {
  it("rejects disconnected sources in the legacy drawable evaluator", () => {
    const { result } = evaluate(`${sources}
line Copied = transformCopy(startPoint: (0, 0), endPoint: (100, 50), scale: 1, angleDeg: 90, mirrorX: false, baseLines: [Shoulder, Side, Dart])`);
    expect(result.errors.map((error) => error.message)).toEqual([expect.stringMatching(/連続|接続/)]);
  });

  it("copies the first source alone at the independent coordinates", () => {
    const evaluated = evaluate(`${sources}
line Copied = transformCopy(startPoint: (0, 0), endPoint: (100, 50), scale: 1, angleDeg: 90, mirrorX: false, baseLines: [Shoulder])`);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "Copied", [100, 60, 100, 70]);
  });
});

describe("#1757 dependencies", () => {
  it.each(["before", "after"])("applies a copied member's later move with a scalar %s the declaration", (position) => {
    const angle = "const angle: number = -45";
    const evaluated = evaluate(`nui 1
${position === "before" ? angle : ""}
line L = segment(start: (0, 0), end: (20, 0))
transformCopy C(startPoint: (0, 0), parts: [copy: L])
${position === "after" ? angle : ""}
move C::copy(from: (0, 0), to: (0, 0), angleDeg: angle)`);
    expect(evaluated.fixture.compiled!.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "L", [0, 0, 20, 0]);
    expectEndpoints(evaluated, "copy", [0, 0, Math.sqrt(200), -Math.sqrt(200)]);
  });

  it("captures separate source recipes and isolates later source and part edits", () => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (0, 0), end: (20, 0))
move L(from: (0, 0), to: (0, 10))
transformCopy C(startPoint: (0, 0), endPoint: (20, 0), parts: [first: L, second: L])
move L(from: (0, 0), to: (0, 30))
move C::second(from: (0, 0), to: (0, -10))`);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "L", [0, 40, 20, 40]);
    expectEndpoints(evaluated, "first", [20, 10, 40, 10]);
    expectEndpoints(evaluated, "second", [20, 0, 40, 0]);
  });

  it("keeps healthy siblings when the other member's source cannot resolve", () => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (0, 0), end: (20, 0))
transformCopy C(startPoint: (0, 0), parts: [bad: Missing, good: L])`);
    expect(evaluated.fixture.compiled!.diagnostics).toHaveLength(1);
    expect(evaluated.fixture.compiled!.diagnostics[0]?.isolatedExtractPart?.boundary).toBe("source");
    expect(evaluated.result.errors).toHaveLength(1);
    expectEndpoints(evaluated, "good", [0, 0, 20, 0]);
    expect(evaluated.result.computedGeometry.has(evaluated.fixture.elements.find(element => element.name === "bad")!.id)).toBe(false);
  });
});
