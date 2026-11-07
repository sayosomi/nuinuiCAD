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

describe("SAY-447 Module-local named stages over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("agrees on Module line/path checkpoints, nested branches, and reordered declarations", async () => {
    const sourceFor = (reordered: boolean) => [
      "nui 1",
      "line Root = segment(start: (0, 0), end: (10, 0))",
      "move @Root(from: (0, 0), to: (2, 0))",
      "const RootOut: line = @Root",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  const BaseOut: line = @L",
      ...(reordered
        ? [
            "  const Out: line = @CapturedOut",
            "  move @L(from: (0, 0), to: (7, -3))",
            "  const CapturedOut: line = @L"
          ]
        : [
            "  move @L(from: (0, 0), to: (7, -3))",
            "  const CapturedOut: line = @L",
            "  const Out: line = @CapturedOut"
          ]),
      "  const FinalOut: line = @L",
      "  curve P = bezier(start: (3, 9), end: (13, 9), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
      "  move @P(from: (0, 0), to: (4, -2))",
      "  const PathOut: path = @P",
      "  line BranchLine = segment(start: (2, 4), end: (12, 4))",
      "  move @BranchLine(from: (0, 0), to: (2, 0))",
      "  line Branch = from(source: @BranchLine)",
      "  move @Branch(from: (0, 0), to: (1, 1))",
      "  const NestedOut: line = @Branch",
      "}",
      "instance I = M()"
    ].join("\n");

    for (const reordered of [false, true]) {
      const fixture = fixtureFromSource(sourceFor(reordered));
      const options = optionsFor(fixture);
      const analysis = fixture.compiled?.doc.moduleSemanticAnalysis;
      if (!analysis) throw new Error("missing Module semantic analysis");
      const valueByName = (name: string) => {
        const value = analysis.geometryValues.find((candidate) => candidate.name === name);
        if (!value) throw new Error(`missing geometry value ${name}`);
        return value;
      };
      expect(valueByName("Out").initializer?.target).toMatchObject({ kind: "geometryValue" });
      expect(valueByName("BaseOut").initializer?.target).toMatchObject({ kind: "sourceGeometry", stagePath: ["base"] });
      for (const name of ["FinalOut", "PathOut", "NestedOut", "RootOut"]) {
        expect(valueByName(name).initializer?.target).toMatchObject({ kind: "sourceGeometry", stagePath: [expect.stringMatching(/^\$prefix:/)] });
      }
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const results = [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)];
      const instance = analysis.instances.find((candidate) => candidate.name === "I");
      if (!instance) throw new Error("missing Module instance I");
      for (const result of results) {
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        const evaluated = (name: string) => {
          const semantic = valueByName(name);
          const expectedInstancePath = semantic.ownerModuleDefinitionStatementId === null ? [] : [instance.statementId];
          return [...(result.computedGeometryValues?.values() ?? [])].find((entry) =>
            entry.occurrence.sourceStatementId === semantic.statementId &&
            entry.occurrence.instancePath.length === expectedInstancePath.length &&
            entry.occurrence.instancePath.every((part, index) => part === expectedInstancePath[index])
          )?.value;
        };
        expect(evaluated("Out")).toMatchObject({
          kind: "line", start: { x: 18, y: 20 }, end: { x: 27, y: 32 }
        });
        expect(evaluated("BaseOut")).toMatchObject({
          kind: "line", start: { x: 11, y: 23 }, end: { x: 20, y: 35 }
        });
        expect(evaluated("FinalOut")).toMatchObject({
          kind: "line", start: { x: 18, y: 20 }, end: { x: 27, y: 32 }
        });
        expect(evaluated("RootOut")).toMatchObject({
          kind: "line", start: { x: 2, y: 0 }, end: { x: 12, y: 0 }
        });
        expect(evaluated("PathOut")).toMatchObject({
          kind: "bezierCurve", segments: [expect.objectContaining({ start: { x: 7, y: 7 }, end: { x: 17, y: 7 } })]
        });
        expect(evaluated("NestedOut")).toMatchObject({
          kind: "line", start: { x: 5, y: 5 }, end: { x: 15, y: 5 }
        });
      }
    }
  }, 30000);
});
