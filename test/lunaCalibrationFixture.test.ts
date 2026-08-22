import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectNuiDocument } from "../mcp-server/src/documentSnapshot";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { fixtureFromSource, optionsFor } from "./evaluationParitySupport";

const calibrationFixturePath = path.resolve(
  process.cwd(),
  ".agents/skills/nuinuicad-luna-mcp-e2e/fixtures/calibration.nui"
);

const expectedLines = [
  "line CAL_UNIQUE = segment(start: (0, 0), end: (40, 0))",
  "line CAL_AMBIG_A = segment(start: (0, 30), end: (30, 30))",
  "line CAL_AMBIG_B = segment(start: (0, 50), end: (30, 50))"
] as const;

const expectedNames = ["CAL_UNIQUE", "CAL_AMBIG_A", "CAL_AMBIG_B"] as const;

describe("Luna MCP E2E calibration fixture", () => {
  it("preserves the controlled nui4 compile/evaluate and identity oracle", async () => {
    const source = readFileSync(calibrationFixturePath, "utf8");

    for (const line of expectedLines) {
      expect(source.split(line)).toHaveLength(2);
    }

    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(fixture.compiled?.bindingIssueDiagnostics ?? []).toEqual([]);

    const evaluation = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.warnings).toEqual([]);

    const controlledElements = fixture.elements.filter((element) =>
      expectedNames.includes(element.name as (typeof expectedNames)[number])
    );
    expect(controlledElements).toHaveLength(3);
    expect(controlledElements.map((element) => element.name).sort()).toEqual([...expectedNames].sort());
    expect(controlledElements.every((element) => element.type === "line")).toBe(true);

    const inspected = await inspectNuiDocument(calibrationFixturePath);
    expect(inspected.compileStatus).toBe("valid");
    expect(inspected.diagnostics.compile).toEqual([]);
    expect(inspected.diagnostics.binding).toEqual([]);

    const inspectedControlled = inspected.summary.elements.filter((element) =>
      expectedNames.includes(element.name as (typeof expectedNames)[number])
    );
    expect(inspectedControlled).toHaveLength(3);
    expect(inspectedControlled.map((element) => element.name).sort()).toEqual([...expectedNames].sort());
    expect(inspectedControlled.every((element) => element.type === "line")).toBe(true);
    expect(inspectedControlled.every((element) => /^line-mcp-/.test(element.id))).toBe(true);
    expect(new Set(inspectedControlled.map((element) => element.id))).toHaveSize(3);
  });
});
