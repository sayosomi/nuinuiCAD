import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { resolveVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { VSCodeApp } from "./VSCodeApp";

const evaluationState = vi.hoisted(() => ({
  current: null as EvaluationEngineState | null
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async () => ({}))
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => {
    if (!evaluationState.current) throw new Error("evaluation state not prepared");
    return evaluationState.current;
  }
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: () => <div />
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const emptyEvaluation = (): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: []
} as EvaluationResult);

const source = [
  "nui 1",
  "modifier Guide {",
  "  color: #999999,",
  "}"
].join("\n");

const publicationsFor = (api: { postMessage: ReturnType<typeof vi.fn> }) => api.postMessage.mock.calls
  .map(([message]) => message)
  .filter((message) => message?.type === "canvasThemePublication");

describe("VSCodeApp Canvas theme publication", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    evaluationState.current = {
      evaluation: emptyEvaluation(),
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "rust",
      source: "rust",
      status: "ready",
      rustEligible: true,
      isStale: false,
      error: null
    };
  });

  it("publishes no guessed initial value, then publishes the actual parseable background for the current source version", async () => {
    const cssValues: Record<string, string> = {
      "--vscode-editor-background": "#ffffff",
      "--vscode-editor-foreground": "#000000"
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: (property: string) => cssValues[property] ?? ""
    } as CSSStyleDeclaration));
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    expect(publicationsFor(api)).toEqual([]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasThemeChanged", generation: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    expect(publicationsFor(api)).toEqual([{
      type: "canvasThemePublication",
      documentVersion: 7,
      generation: 7,
      theme: resolveVSCodeCanvasTheme({
        getPropertyValue: (property: string) => cssValues[property] ?? ""
      })
    }]);
  });

  it("publishes a refreshed background only after a theme refresh and fails closed for an unparseable value", async () => {
    const cssValues: Record<string, string> = {
      "--vscode-editor-background": "#ffffff",
      "--vscode-editor-foreground": "#000000"
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: (property: string) => cssValues[property] ?? ""
    } as CSSStyleDeclaration));
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasThemeChanged", generation: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 3 }
      }));
    });

    api.postMessage.mockClear();
    cssValues["--vscode-editor-background"] = "#000000";
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "canvasThemeChanged", generation: 2 } }));
    });
    expect(publicationsFor(api)).toEqual([{
      type: "canvasThemePublication",
      documentVersion: 3,
      generation: 2,
      theme: expect.objectContaining({ background: "#000000" })
    }]);

    api.postMessage.mockClear();
    cssValues["--vscode-editor-background"] = "var(--missing)";
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "canvasThemeChanged", generation: 3 } }));
    });
    expect(publicationsFor(api)).toEqual([]);
  });
});
