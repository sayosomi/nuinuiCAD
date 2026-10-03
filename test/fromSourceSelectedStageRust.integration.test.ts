import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("SAY-446 from(source:) selected stages over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("keeps root aliases and asymmetric sibling Module stage inputs isolated", async () => {
    const evaluate = async (reordered: boolean) => {
      const first = "instance First = M(g: @A.base, p: @C.base)";
      const second = "instance Second = M(g: @A.moved, p: @C.moved)";
      const fixture = fixtureFromSource([
        "nui 1",
        "line A = segment(start: (11, 23), end: (20, 35))",
        "move A as moved (from: (11, 23), to: (31, 45))",
        "curve C = bezier(start: (2, 7), end: (12, 7), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
        "move C as moved (from: (2, 7), to: (22, 27))",
        "module M(g: line, p: path) {",
        "  line Material = from(source: @g)",
        "  path PathMaterial = from(source: @p)",
        "}",
        ...(reordered ? [second, first] : [first, second]),
        "const RootBase: line = @A.base",
        "line RootMaterial = from(source: @RootBase)",
        "line DirectBase = from(source: @A.base)",
        "line DirectFinal = from(source: @A)",
        "path DirectNamedPath = from(source: @C.moved)"
      ].join("\n"));
      const options = optionsFor(fixture);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const result = evaluationPayloadToResult(rustPayload);
      const geometries = (name: string) => fixture.elements
        .filter((candidate) => candidate.name === name)
        .map((element) => result.computedGeometry.get(element.id));
      const expectSiblingLines = (name: string) => {
        expect(geometries(name)).toEqual(expect.arrayContaining([
          expect.objectContaining({ start: expect.objectContaining({ x: 11, y: 23 }), end: expect.objectContaining({ x: 20, y: 35 }) }),
          expect.objectContaining({ start: expect.objectContaining({ x: 31, y: 45 }), end: expect.objectContaining({ x: 40, y: 57 }) })
        ]));
      };
      const expectSiblingPaths = (name: string) => {
        expect(geometries(name)).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "bezierCurve", segments: [expect.objectContaining({ start: expect.objectContaining({ x: 2, y: 7 }), end: expect.objectContaining({ x: 12, y: 7 }) })] }),
          expect.objectContaining({ kind: "bezierCurve", segments: [expect.objectContaining({ start: expect.objectContaining({ x: 22, y: 27 }), end: expect.objectContaining({ x: 32, y: 27 }) })] })
        ]));
      };
      expect(result.errors).toEqual([]);
      expect(geometries("RootMaterial")[0]).toMatchObject({ start: { x: 11, y: 23 }, end: { x: 20, y: 35 } });
      expect(geometries("DirectBase")[0]).toMatchObject({ start: { x: 11, y: 23 }, end: { x: 20, y: 35 } });
      expect(geometries("DirectFinal")[0]).toMatchObject({ start: { x: 31, y: 45 }, end: { x: 40, y: 57 } });
      expect(geometries("DirectNamedPath")[0]).toMatchObject({
        kind: "bezierCurve", segments: [expect.objectContaining({ start: expect.objectContaining({ x: 22, y: 27 }), end: expect.objectContaining({ x: 32, y: 27 }) })]
      });
      expectSiblingLines("Material");
      expectSiblingPaths("PathMaterial");
    };

    await evaluate(false);
    await evaluate(true);
  }, 30000);
});
