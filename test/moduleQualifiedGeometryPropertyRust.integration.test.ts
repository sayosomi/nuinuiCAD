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

describe("SAY-451 caller-qualified Module geometry properties over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  it("matches direct and materialized export length fields per Module instance", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Direct() {",
      "  export line B = segment(start: (0, 0), end: (9, 12))",
      "}",
      "instance I = Direct()",
      "point P = coordinate(x: @I::B.length, y: 0)",
      "module Materialized(end: point) {",
      "  line A = segment(start: (0, 0), end: @end)",
      "  export line B = from(source: @A)",
      "}",
      "instance First = Materialized(end: (3, 4))",
      "instance Second = Materialized(end: (5, 12))",
      "point FirstLength = coordinate(x: @First::B.length, y: 0)",
      "point SecondLength = coordinate(x: @Second::B.length, y: 0)"
    ].join("\n"));
    if (!fixture.compiled) throw new Error("expected compiled SAY-451 fixture");
    expect(fixture.compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
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
      expect(geometry("P")).toMatchObject({ kind: "point", x: 15, y: 0 });
      expect(geometry("FirstLength")).toMatchObject({ kind: "point", x: 5, y: 0 });
      expect(geometry("SecondLength")).toMatchObject({ kind: "point", x: 13, y: 0 });
    }
  }, 30000);
});
