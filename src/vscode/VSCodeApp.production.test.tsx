import { act, render, waitFor } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { VSCodeApp } from "./VSCodeApp";

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: () => <div data-testid="production-canvas" />
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const source = [
  "nui 4",
  "modifier Guide {",
  "  state: visible,",
  "}",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 100, y: 0)",
  "point Derived [Guide] = between(",
  "  start: @A,",
  "  end: @B,",
  "  ratio: 0.25,",
  ")"
].join("\n");

const baseSource = [
  "nui 4",
  "point BC0 = coordinate(x: 0, y: 140)",
  "point BC1 = coordinate(x: 100, y: 140)",
  "line BaseCurrent = segment(",
  "  start: @BC0,",
  "  end: @BC1,",
  ")",
  "move(",
  "  targets: [@BaseCurrent],",
  "  from: (0, 140),",
  "  to: (20, 170),",
  ")"
].join("\n");

const rustBinary = process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(
  process.cwd(),
  "rust-evaluator/target/debug/evaluation_stdio"
);

const productionApi = () => {
  const api = {
    postMessage: vi.fn((message: { type?: string; id?: number; input?: unknown }) => {
      if (message.type !== "rustEvaluationRequest" || message.id === undefined) return;
      const response = JSON.parse(execFileSync(rustBinary, [], {
        encoding: "utf8",
        input: `${JSON.stringify({ id: message.id, input: message.input })}\n`
      })) as { id: number; payload: unknown };
      queueMicrotask(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationResponse", id: response.id, payload: response.payload }
        }));
      });
    })
  };
  return api;
};

const expectBakedSource = () => {
  const lines = useCadDocumentStore.getState().sourceText.split("\n");
  const derivedStartLine = lines.findIndex((line) => line === "point Derived [Guide] = between(");
  const derivedEndLine = lines.findIndex((line, index) => index > derivedStartLine && line === ")");
  expect(derivedEndLine).toBeGreaterThanOrEqual(0);
  expect(lines[derivedEndLine + 1]).toBe("point Derived_bake [Guide] = coordinate(x: 25, y: 0)");
};

const expectBaseBakedSource = () => {
  const lines = useCadDocumentStore.getState().sourceText.split("\n");
  const baseStartLine = lines.findIndex((line) => line === "line BaseCurrent = segment(");
  const baseEndLine = lines.findIndex((line, index) => index > baseStartLine && line === ")");
  expect(baseEndLine).toBeGreaterThanOrEqual(0);
  expect(lines[baseEndLine + 1]).toBe("line BaseCurrent_bake = segment(start: (0, 140), end: (100, 140))");
  expect(lines[baseEndLine + 2]).toBe("move(");
};

describe.skipIf(!existsSync(rustBinary))("VS Code production Bake path", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  const replaceSource = async (
    api: ReturnType<typeof productionApi>,
    sourceText = source,
    expectedElementName = "Derived"
  ) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      await Promise.resolve();
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "rustEvaluationRequest"
    })));
    await waitFor(() => expect(useCadDocumentStore.getState().elements.some((element) => element.name === expectedElementName)).toBe(true));
  };

  it("bakes the selected Derived point through Canvas using the production Rust response", async () => {
    const api = productionApi();
    render(<VSCodeApp api={api} />);
    await replaceSource(api);
    const derived = useCadDocumentStore.getState().elements.find((element) => element.name === "Derived")!;
    publishTestCanvasSelectionEligibility();
    useCadUiStore.getState().setSelectedElementId(derived.id);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "bakeCurrentShape" }
      }));
      await Promise.resolve();
    });

    expectBakedSource();
  }, 30_000);

  it("bakes the cursor-resolved Derived point through Source using the production Rust response", async () => {
    const api = productionApi();
    render(<VSCodeApp api={api} />);
    await replaceSource(api);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 1,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("Derived"),
          mode: "current"
        }
      }));
      await Promise.resolve();
    });

    expectBakedSource();
  }, 30_000);

  it("bakes the BaseCurrent pre-move snapshot through Source using the production Rust response", async () => {
    const api = productionApi();
    render(<VSCodeApp api={api} />);
    await replaceSource(api, baseSource, "BaseCurrent");

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 1,
          documentVersion: 1,
          normalizedSourceOffset: baseSource.indexOf("BaseCurrent"),
          mode: "base"
        }
      }));
      await Promise.resolve();
    });

    expectBaseBakedSource();
  }, 30_000);
});
