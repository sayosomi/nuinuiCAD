import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { roundTrip } from "../dsl/dslDocumentTestUtils";
import { createCadElement } from "../model/elementFactory";
import { choiceAfterStep } from "../dsl/dslValueStep";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { CadElement, ComputedLine } from "../types/geometry";
import { evaluateElements } from "./evaluate";

const sourceFor = (kind: "external" | "internal", side: "left" | "right") => [
  "nui 4",
  "point C1 = coordinate(x: 0, y: 0)",
  "point C2 = coordinate(x: 60, y: 0)",
  "arc A = arc(center: @C1, radius: 20, start: 40, end: 80)",
  "arc B = arc(center: @C2, radius: 10, start: 210, end: 250)",
  `line T = commonTangent(first: @A, second: @B, kind: ${kind}, side: ${side})`
].join("\n");

const evaluateSource = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  const tangent = compiled.document!.elements.find((element) => element.name === "T")!;
  const result = evaluateElements(compiled.document!.elements, {
    statementInfoByElementId: compiled.statementMap!.byElementId
  });
  return { compiled, tangent, result, geometry: result.computedGeometry.get(tangent.id) as ComputedLine | undefined };
};

const crossFromFirstCenter = (line: ComputedLine) => 60 * line.start.y;

const expectTangent = (line: ComputedLine, kind: "external" | "internal", side: "left" | "right") => {
  expect(line.kind).toBe("line");
  expect(line.startPointId).toBeNull();
  expect(line.endPointId).toBeNull();
  expect(Math.hypot(line.start.x, line.start.y)).toBeCloseTo(20, 10);
  expect(Math.hypot(line.end.x - 60, line.end.y)).toBeCloseTo(10, 10);
  const tx = line.end.x - line.start.x;
  const ty = line.end.y - line.start.y;
  expect(tx * line.start.x + ty * line.start.y).toBeCloseTo(0, 9);
  expect(side === "left" ? crossFromFirstCenter(line) : -crossFromFirstCenter(line)).toBeGreaterThan(0);
  expect(kind === "external" ? line.start.y * line.end.y : -line.start.y * line.end.y).toBeGreaterThan(0);
};

describe("commonTangent", () => {
  it.each(["external", "internal"] as const)("evaluates %s left/right from full supporting circles", (kind) => {
    const left = evaluateSource(sourceFor(kind, "left"));
    const right = evaluateSource(sourceFor(kind, "right"));
    expect(left.result.errors).toEqual([]);
    expect(right.result.errors).toEqual([]);
    expectTangent(left.geometry!, kind, "left");
    expectTangent(right.geometry!, kind, "right");
    expect(right.geometry!.start.y).toBeCloseTo(-left.geometry!.start.y, 10);
    expect(right.geometry!.end.y).toBeCloseTo(-left.geometry!.end.y, 10);
  });

  it("round-trips the canonical DSL construction", () => {
    const { document, text, parsed } = roundTrip(sourceFor("internal", "right"));
    const tangent = document.elements.find((element) => element.name === "T");
    expect(tangent).toMatchObject({ type: "commonTangentLine", kind: "internal", side: "right" });
    expect(text).toContain("line T = commonTangent(");
    expect(text).toContain("first: @A,");
    expect(text).toContain("second: @B,");
    expect(text).toContain("kind: internal,");
    expect(text).toContain("side: right,");
    expect(parsed.elements.find((element) => element.name === "T")).toMatchObject({ type: "commonTangentLine", kind: "internal", side: "right" });
  });

  it("uses first->second orientation when arguments are swapped", () => {
    const normal = evaluateSource(sourceFor("external", "left")).geometry!;
    const swapped = evaluateSource(sourceFor("external", "left").replace("first: @A, second: @B", "first: @B, second: @A")).geometry!;
    expect(Math.hypot(swapped.start.x - 60, swapped.start.y)).toBeCloseTo(10, 10);
    expect(Math.hypot(swapped.end.x, swapped.end.y)).toBeCloseTo(20, 10);
    expect(normal.start.x).not.toBeCloseTo(swapped.start.x, 5);
  });

  it("accepts arc/through/corner outputs rather than authored arc type only", () => {
    const source = [
      "nui 4",
      "point O = coordinate(x: 0, y: 0)",
      "point A1 = coordinate(x: 80, y: 0)",
      "point A2 = coordinate(x: 60, y: 20)",
      "point A3 = coordinate(x: 40, y: 0)",
      "point P1 = coordinate(x: 60, y: -20)",
      "point P2 = coordinate(x: 60, y: 20)",
      "point P3 = coordinate(x: 80, y: 0)",
      "line L1 = segment(start: @P1, end: @P2)",
      "line L2 = segment(start: @P2, end: @P3)",
      "arc Direct = arc(center: @O, radius: 20, start: 10, end: 20)",
      "arc Through = through(point1: @A1, point2: @A2, point3: @A3, start: 30, end: 40)",
      "arc Corner = corner(end1: @L1.end, end2: @L2.start, radius: 5, index: 0)",
      "line T = commonTangent(first: @Direct, second: @Through, kind: external, side: left)",
      "line T2 = commonTangent(first: @Direct, second: @Corner, kind: external, side: right)"
    ].join("\n");
    const { result } = evaluateSource(source);
    expect(result.errors).toEqual([]);
  });

  it("reports exact non-arc, invalid-radius, concentric/coincident, missing-kind, and collapsed diagnostics", () => {
    const base: CadElement[] = [
      { id: "c1", name: "C1", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "c2", name: "C2", type: "freePoint", activity: "visible", x: 10, y: 0 },
      { id: "a", name: "A", type: "arcLine", activity: "visible", centerPoint: { mode: "reference", pointId: "c1" }, radius: 5, startAngleDeg: 0, endAngleDeg: 10 },
      { id: "b", name: "B", type: "arcLine", activity: "visible", centerPoint: { mode: "reference", pointId: "c2" }, radius: 5, startAngleDeg: 0, endAngleDeg: 10 },
      { id: "straight", name: "Straight", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "c1" }, endPoint: { mode: "reference", pointId: "c2" } }
    ];
    const tangent = (overrides: Partial<Extract<CadElement, { type: "commonTangentLine" }>> = {}): CadElement => ({
      id: "t", name: "T", type: "commonTangentLine", activity: "visible", firstLineId: "a", secondLineId: "b", kind: "external", side: "left", ...overrides
    });

    expect(evaluateElements([...base, tangent({ firstLineId: "straight" })]).errors.at(-1)?.message)
      .toBe("first に円弧が指定されていません。共通接線には円弧を指定してください。");
    expect(evaluateElements([...base.map((element) => element.id === "a" ? { ...element, radius: 0 } as CadElement : element), tangent()]).errors.at(-1)?.message)
      .toBe("first の半径が0以下です。共通接線には半径のある円弧を指定してください。");
    expect(evaluateElements([...base.map((element) => element.id === "c2" ? { ...element, x: 0 } as CadElement : element), tangent()]).errors.at(-1)?.message)
      .toBe("2つの円が同一円のため、共通接線を1本に決定できません。");
    expect(evaluateElements([...base.map((element) => element.id === "c2" ? { ...element, x: 0 } as CadElement : element).map((element) => element.id === "b" ? { ...element, radius: 4 } as CadElement : element), tangent()]).errors.at(-1)?.message)
      .toBe("2つの円が同心円のため、共通接線は存在しません。");
    expect(evaluateElements([...base, tangent({ kind: "internal" })]).errors.at(-1)?.message)
      .toBe("2つの接点が一致するため、有限長の共通接線として表現できません。2つの円の位置・半径または kind を変更してください。");
    expect(evaluateElements([...base.map((element) => element.id === "c2" ? { ...element, x: 9 } as CadElement : element), tangent({ kind: "internal" })]).errors.at(-1)?.message)
      .toBe("kind: internal の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。");
  });

  it("steps kind and side forward/backward with wrap", () => {
    const element = createCadElement("commonTangentLine", []);
    const kind = findParameterDefinition(element, "kind")!;
    const side = findParameterDefinition(element, "side")!;
    expect(choiceAfterStep("external", kind.choiceOptions!, 1)).toBe("internal");
    expect(choiceAfterStep("internal", kind.choiceOptions!, 1)).toBe("external");
    expect(choiceAfterStep("external", kind.choiceOptions!, -1)).toBe("internal");
    expect(choiceAfterStep("left", side.choiceOptions!, 1)).toBe("right");
    expect(choiceAfterStep("right", side.choiceOptions!, 1)).toBe("left");
    expect(choiceAfterStep("left", side.choiceOptions!, -1)).toBe("right");
  });
});
