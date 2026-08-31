import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvaluationPayload } from "../../src/geometry/evaluationPayload";
import type { EvaluateDocumentInput } from "../../src/geometry/rustEvaluationInput";
import { loadFreshNuiDocumentSnapshot } from "../src/documentSnapshot";
import { evaluateNuiDocument } from "../src/documentEvaluation";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const writeFixture = async (source: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-evaluate-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "sample.nui");
  await writeFile(filePath, source, "utf8");
  return filePath;
};

const payloadFor = (
  input: EvaluateDocumentInput,
  overrides: Partial<EvaluationPayload> = {}
): EvaluationPayload => ({
  computedGeometry: input.elements.map((element, index) => ({
    kind: "point",
    elementId: element.id,
    name: element.name,
    x: index + 1,
    y: index + 2
  })),
  errors: [],
  warnings: [],
  evaluatedElementIds: input.elements.map((element) => element.id),
  evaluationLimitIndex: input.evaluationLimitIndex ?? input.elements.length,
  effectiveVisibleElementIds: input.elements.map((element) => element.id),
  effectiveEnabledElementIds: input.elements.map((element) => element.id),
  ...overrides
});

const twoPointSource = [
  "nui 1",
  "point A = coordinate(x: 1, y: 2)",
  "point B = offset(from: @A, dx: 3, dy: 4)"
].join("\n");

describe("document_evaluate", () => {
  it("prepares the exact-current compiled document for Rust and stays compact by default", async () => {
    const filePath = await writeFixture("nui 1\npoint A = coordinate(x: 1, y: 2)");
    let captured: EvaluateDocumentInput | null = null;
    const result = await evaluateNuiDocument(filePath, {}, {
      transport: async (input) => {
        captured = input;
        return payloadFor(input);
      }
    });

    expect(result).toMatchObject({ status: "evaluated", rustEligible: true, compileStatus: "valid" });
    expect(captured?.elements).toHaveLength(1);
    expect(captured?.elements[0]).toMatchObject({ name: "A", type: "freePoint" });
    expect(result.evaluation?.errors).toEqual([]);
    expect(result.evaluation?.warnings).toEqual([]);
    expect(result.evaluation).not.toHaveProperty("computedGeometry");
    expect(result.evaluation).not.toHaveProperty("evaluatedElementIds");
  });

  it("reports Rust ineligibility without calling the transport", async () => {
    const filePath = await writeFixture("nui 1\npoint A = coordinate(x: 1, y: 2)");
    const transport = vi.fn(async (input: EvaluateDocumentInput) => payloadFor(input));
    const result = await evaluateNuiDocument(filePath, {}, {
      transport,
      prepareEvaluation: (elements) => ({ rustEligible: false, input: { elements } })
    });

    expect(result).toMatchObject({ status: "ineligible", rustEligible: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it("distinguishes an unavailable process from a transport failure", async () => {
    const filePath = await writeFixture("nui 1\npoint A = coordinate(x: 1, y: 2)");
    const unavailableTransport = vi.fn(async (input: EvaluateDocumentInput) => payloadFor(input));
    const unavailable = await evaluateNuiDocument(filePath, {}, {
      transport: unavailableTransport,
      transportAvailable: () => false
    });
    expect(unavailable).toMatchObject({ status: "process-unavailable", rustEligible: true });
    expect(unavailableTransport).not.toHaveBeenCalled();

    const failed = await evaluateNuiDocument(filePath, {}, {
      transport: async () => { throw new Error("transport exploded"); }
    });
    expect(failed).toMatchObject({ status: "failed", rustEligible: true, message: "transport exploded" });
  });

  it("returns stale when source identity changes during asynchronous Rust work", async () => {
    const filePath = await writeFixture("nui 1\npoint A = coordinate(x: 1, y: 2)");
    const result = await evaluateNuiDocument(filePath, {}, {
      transport: async (input) => {
        await writeFile(filePath, "nui 1\npoint A = coordinate(x: 9, y: 9)", "utf8");
        return payloadFor(input);
      }
    });

    expect(result).toMatchObject({ status: "stale", rustEligible: true });
    expect(result.evaluation).toBeUndefined();
  });

  it("filters requested geometry while preserving structured errors and warnings", async () => {
    const filePath = await writeFixture(twoPointSource);
    const snapshot = await loadFreshNuiDocumentSnapshot(filePath);
    const elements = snapshot.currentCompiled.document?.elements;
    if (!elements || elements.length !== 2) throw new Error("Expected two compiled fixture elements.");
    const [first, second] = elements;

    const result = await evaluateNuiDocument(filePath, {
      requestedElementIds: [second!.id],
      includeEvaluatedElementIds: true
    }, {
      transport: async (input) => payloadFor(input, {
        errors: [{
          elementId: first!.id,
          elementName: first!.name,
          missingDependencyId: second!.id,
          missingDependencyName: second!.name,
          message: "structured error"
        }],
        warnings: [{
          elementId: second!.id,
          elementName: second!.name,
          message: "structured warning"
        }]
      })
    });

    expect(result.status).toBe("evaluated");
    expect(result.evaluation?.computedGeometry).toEqual([
      expect.objectContaining({ elementId: second!.id, name: second!.name })
    ]);
    expect(result.evaluation?.errors).toEqual([
      expect.objectContaining({ elementId: first!.id, message: "structured error" })
    ]);
    expect(result.evaluation?.warnings).toEqual([
      expect.objectContaining({ elementId: second!.id, message: "structured warning" })
    ]);
    expect(result.evaluation?.evaluatedElementIds).toEqual([first!.id, second!.id]);
  });
});
