import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("SAY-457 concrete arc tangentOffset over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("matches analytic arc tangents across direction, endpoints, named stages, and controls", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 10, start: 0, end: 180, direction: counterclockwise)",
      "point Reproducer = tangentOffset(line: @A, base: @A.start, angle: 0, distance: 5)",
      "point CcwEnd = tangentOffset(line: @A, base: @A.end, angle: 0, distance: 5)",
      "arc Cw = arc(center: (0, 0), radius: 10, start: 0, end: 270, direction: clockwise)",
      "point CwStart = tangentOffset(line: @Cw, base: @Cw.start, angle: 0, distance: 5)",
      "point CwEnd = tangentOffset(line: @Cw, base: @Cw.end, angle: 0, distance: 5)",
      "arc NonSemi = arc(center: (0, 0), radius: 10, start: 33.3, end: 121.7, direction: counterclockwise)",
      "point NonSemiStart = tangentOffset(line: @NonSemi, base: @NonSemi.start, angle: 0, distance: 2)",
      "point Zero = tangentOffset(line: @A, base: @A.start, angle: 0, distance: 0)",
      "arc R = arc(center: (0, 0), radius: 10, start: 0, end: 180, direction: counterclockwise)",
      "reverse R as reversed()",
      "point ReversedStart = tangentOffset(line: @R.reversed, base: @R.reversed.start, angle: 0, distance: 5)",
      "line Straight = segment(start: (0, 0), end: (10, 0))",
      "point StraightStart = tangentOffset(line: @Straight, base: @Straight.start, angle: 0, distance: 5)"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled SAY-457 fixture");
    expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      const pointFor = (name: string) => {
        const element = fixture.elements.find((candidate) => candidate.name === name);
        if (!element) throw new Error(`missing point ${name}`);
        const point = result.computedGeometry.get(element.id);
        expect(point).toMatchObject({ kind: "point" });
        return point as { x: number; y: number };
      };

      expect(pointFor("Reproducer").x).toBeCloseTo(10, 10);
      expect(pointFor("Reproducer").y).toBeCloseTo(5, 10);
      expect(pointFor("CcwEnd").x).toBeCloseTo(-10, 10);
      expect(pointFor("CcwEnd").y).toBeCloseTo(-5, 10);
      expect(pointFor("CwStart").x).toBeCloseTo(10, 10);
      expect(pointFor("CwStart").y).toBeCloseTo(-5, 10);
      expect(pointFor("CwEnd").x).toBeCloseTo(-5, 10);
      expect(pointFor("CwEnd").y).toBeCloseTo(-10, 10);

      const angle = 33.3 * Math.PI / 180;
      expect(pointFor("NonSemiStart").x).toBeCloseTo(10 * Math.cos(angle) - 2 * Math.sin(angle), 10);
      expect(pointFor("NonSemiStart").y).toBeCloseTo(10 * Math.sin(angle) + 2 * Math.cos(angle), 10);
      expect(pointFor("Zero").x).toBeCloseTo(10, 10);
      expect(pointFor("Zero").y).toBeCloseTo(0, 10);
      expect(pointFor("ReversedStart").x).toBeCloseTo(-10, 10);
      expect(pointFor("ReversedStart").y).toBeCloseTo(5, 10);
      expect(pointFor("StraightStart").x).toBeCloseTo(5, 10);
      expect(pointFor("StraightStart").y).toBeCloseTo(0, 10);
    }
  }, 30000);
});
