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

describe("SAY-453 caller-qualified Module export stages over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("matches base, final, named, path, derived-point, and Module-selected export references", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Root = segment(start: (0, 0), end: (9, 12))",
      "move Root as rootShifted(from: (0, 0), to: (2, 3))",
      "line RootBase = from(source: @Root.base)",
      "line RootNamed = from(source: @Root.rootShifted)",
      "module Producer() {",
      "  export line L = segment(start: (0, 0), end: (9, 12))",
      "  move L as shifted(from: (0, 0), to: (5, 7))",
      "  move L as finish(from: (5, 7), to: (8, 11))",
      "  export curve P = bezier(start: (1, 2), end: (7, 2), startAngle: 45, startLength: 2, endAngle: 135, endLength: 2)",
      "  move P as pathShifted(from: (1, 2), to: (3, 4))",
      "  move P as pathFinish(from: (3, 4), to: (6, 8))",
      "  export const Selected: line = @L.shifted",
      "}",
      "instance I = Producer()",
      "line PlainLine = from(source: @I::L)",
      "line BaseLine = from(source: @I::L.base)",
      "line FinalLine = from(source: @I::L.final)",
      "line NamedLine = from(source: @I::L.shifted)",
      "path BasePath = from(source: @I::P.base)",
      "path FinalPath = from(source: @I::P.final)",
      "path NamedPath = from(source: @I::P.pathShifted)",
      "line SelectedLine = from(source: @I::Selected)",
      "point Start = offset(from: @I::L.start, dx: 0, dy: 0)",
      "point End = offset(from: @I::L.end, dx: 0, dy: 0)",
      "point SelectedStart = offset(from: @I::Selected.start, dx: 0, dy: 0)",
      "point SelectedEnd = offset(from: @I::Selected.end, dx: 0, dy: 0)",
      "line Caller = segment(start: (0, 0), end: (9, 12))",
      "move Caller as viaExport(from: @I::L.start, to: @I::L.end)"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled caller-qualified stage fixture");
    const analysis = fixture.compiled.doc.moduleSemanticAnalysis;
    if (!analysis) throw new Error("missing Module semantic analysis");
    const references = [...analysis.rootGeometryReferencesByStatementId.values()].flat().map((site) => site.reference);
    const referenceFor = (source: string) => references.find((reference) => reference.source.includes(source));
    for (const [source, stagePath] of [
      ["@I::L.base", ["base"]],
      ["@I::L.final", ["final"]],
      ["@I::L.shifted", ["shifted"]],
      ["@I::P.base", ["base"]],
      ["@I::P.final", ["final"]],
      ["@I::P.pathShifted", ["pathShifted"]]
    ] as const) {
      expect(referenceFor(source)?.target).toMatchObject({ kind: "deferredModuleExport", stagePath });
      expect(referenceFor(source)?.target).not.toHaveProperty("pointKey");
    }
    expect(referenceFor("@I::L.start")).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", pointKey: "start" }
    });
    expect(referenceFor("@I::L.start")?.target).not.toHaveProperty("stagePath");
    expect(referenceFor("@I::L.end")).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", pointKey: "end" }
    });
    expect(referenceFor("@I::L.end")?.target).not.toHaveProperty("stagePath");
    expect(referenceFor("@I::Selected.start")).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", pointKey: "start" }
    });
    expect(referenceFor("@I::Selected.start")?.target).not.toHaveProperty("stagePath");
    expect(referenceFor("@I::Selected.end")).toMatchObject({
      role: "derivedPoint",
      target: { kind: "deferredModuleExport", pointKey: "end" }
    });
    expect(referenceFor("@I::Selected.end")?.target).not.toHaveProperty("stagePath");
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      const geometry = (name: string) => {
        const element = fixture.elements.find((candidate) => candidate.name === name);
        if (!element) throw new Error(`missing geometry ${name}`);
        return result.computedGeometry.get(element.id);
      };
      expect(geometry("BaseLine")).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 9, y: 12 } });
      expect(Math.hypot(9, 12)).toBe(15);
      expect(geometry("FinalLine")).toMatchObject({ start: { x: 8, y: 11 }, end: { x: 17, y: 23 } });
      expect(geometry("NamedLine")).toMatchObject({ start: { x: 5, y: 7 }, end: { x: 14, y: 19 } });
      expect(geometry("PlainLine")).toMatchObject({ start: { x: 8, y: 11 }, end: { x: 17, y: 23 } });
      expect(geometry("SelectedLine")).toMatchObject({ start: { x: 5, y: 7 }, end: { x: 14, y: 19 } });
      expect(geometry("RootBase")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 9, y: 12 } });
      expect(geometry("RootNamed")).toMatchObject({ start: { x: 2, y: 3 }, end: { x: 11, y: 15 } });
      expect(geometry("BasePath")).toMatchObject({
        kind: "bezierCurve",
        segments: [expect.objectContaining({
          start: expect.objectContaining({ x: 1, y: 2 }),
          end: expect.objectContaining({ x: 7, y: 2 })
        })]
      });
      expect(geometry("NamedPath")).toMatchObject({
        kind: "bezierCurve",
        segments: [expect.objectContaining({
          start: expect.objectContaining({ x: 3, y: 4 }),
          end: expect.objectContaining({ x: 9, y: 4 })
        })]
      });
      expect(geometry("FinalPath")).toMatchObject({
        kind: "bezierCurve",
        segments: [expect.objectContaining({
          start: expect.objectContaining({ x: 6, y: 8 }),
          end: expect.objectContaining({ x: 12, y: 8 })
        })]
      });
      expect(geometry("Start")).toMatchObject({ kind: "point", x: 8, y: 11 });
      expect(geometry("End")).toMatchObject({ kind: "point", x: 17, y: 23 });
      expect(geometry("SelectedStart")).toMatchObject({ kind: "point", x: 5, y: 7 });
      expect(geometry("SelectedEnd")).toMatchObject({ kind: "point", x: 14, y: 19 });
    }
  }, 30000);
});
