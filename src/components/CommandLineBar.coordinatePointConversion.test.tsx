import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { startCoordinatePointConversionSession } from "../commands/coordinatePointConversionSession";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";
import { webviewCanvasPresentationFor } from "../vscode/webviewCanvasPresentation";
import { CommandLineBar } from "./CommandLineBar";

const conversionSession = () => {
  const source = [
    "nui 1",
    "point Base = coordinate(x: 0, y: 0)",
    "point Target = coordinate(x: 10, y: 5)"
  ].join("\n");
  const compiled = compileFreshCanonicalText(source);
  if (compiled.status === "fatal") throw new Error("expected a valid document");
  const evaluation = evaluateElements(compiled.doc.document.elements, buildEvaluationOptions({
    compiledDocument: compiled.doc,
    evaluationLimitIndex: undefined
  }));
  const targetId = compiled.doc.document.elements.find((element) => element.name === "Target")!.id;
  const started = startCoordinatePointConversionSession({
    requestId: 9,
    documentUri: "file:///tmp/pattern.nui",
    documentVersion: 3,
    mode: "xy",
    origin: "canvas",
    targetIds: [targetId],
    snapshot: { document: compiled, evaluation }
  });
  if (started.status !== "started") throw new Error("expected a conversion session");
  return started.session;
};

describe("CommandLineBar coordinate point conversion", () => {
  it("keeps the conversion session on blur and applies a direct base on Enter", () => {
    const callbacks = {
      onQuery: vi.fn(),
      onSelectBase: vi.fn(),
      onStartPick: vi.fn(),
      onConfirm: vi.fn(),
      onCancel: vi.fn()
    };
    render(
      <CommandLineBar
        coordinatePointConversion={{
          session: { ...conversionSession(), query: "@Base" },
          ...callbacks
        }}
      />
    );

    const input = screen.getByRole("textbox", { name: "Coordinate conversion base reference" });
    fireEvent.blur(input);
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(callbacks.onSelectBase).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("uses shared suggestions and Canvas pick/cancel actions", () => {
    const callbacks = {
      onQuery: vi.fn(),
      onSelectBase: vi.fn(),
      onStartPick: vi.fn(),
      onConfirm: vi.fn(),
      onCancel: vi.fn()
    };
    render(
      <CommandLineBar
        coordinatePointConversion={{
          session: { ...conversionSession(), query: "@Ba" },
          ...callbacks
        }}
      />
    );

    expect(screen.getByRole("listbox", { name: "Coordinate conversion base suggestions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Canvasで選択" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(callbacks.onStartPick).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it("uses the Extension Host presentation for English coordinate-conversion chrome", () => {
    render(
      <CommandLineBar
        presentation={webviewCanvasPresentationFor(webviewPresentationFor("en"))}
        coordinatePointConversion={{
          session: { ...conversionSession(), query: "@Ba" },
          onQuery: vi.fn(),
          onSelectBase: vi.fn(),
          onStartPick: vi.fn(),
          onConfirm: vi.fn(),
          onCancel: vi.fn()
        }}
      />
    );

    expect(screen.getByRole("textbox", { name: "Coordinate conversion base reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick on Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply (Enter)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel (Esc)" })).toBeInTheDocument();
  });
});
