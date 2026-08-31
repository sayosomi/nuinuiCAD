import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { setCoordinatePointConversionQuery, startCoordinatePointConversionSession } from "../commands/coordinatePointConversionSession";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { VSCodeCoordinatePointConversionOverlay } from "./VSCodeCoordinatePointConversionOverlay";

const renderOverlay = (query = "") => {
  const source = [
    "nui 1",
    "point Base = coordinate(x: 0, y: 0)",
    "point Target = coordinate(x: 10, y: 5)"
  ].join("\n");
  const compiledDocument = compileFreshCanonicalText(source);
  if (compiledDocument.status === "fatal") throw new Error("expected a valid document");
  const evaluation = evaluateElements(compiledDocument.doc.document.elements, buildEvaluationOptions({
    compiledDocument: compiledDocument.doc,
    evaluationLimitIndex: undefined
  }));
  const targetId = compiledDocument.doc.document.elements.find((element) => element.name === "Target")!.id;
  const started = startCoordinatePointConversionSession({
    requestId: 1,
    documentUri: "file:///tmp/pattern.nui",
    documentVersion: 3,
    mode: "xy",
    origin: "canvas",
    targetIds: [targetId],
    snapshot: { document: compiledDocument, evaluation }
  });
  if (started.status !== "started") throw new Error("expected a conversion session");
  const session = query ? setCoordinatePointConversionQuery(started.session, query) : started.session;
  const viewport = window.document.createElement("div");
  viewport.tabIndex = 0;
  document.body.append(viewport);
  const callbacks = {
    onQuery: vi.fn(),
    onSelectBase: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };
  const view = render(
    <VSCodeCoordinatePointConversionOverlay
      canvasFocusRef={{ current: viewport }}
      viewportSize={{ width: 400, height: 300 }}
      canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
      canvasTheme={LEGACY_CANVAS_THEME}
      session={session}
      {...callbacks}
    />,
    { container: viewport }
  );
  return { baseKey: session.baseCandidates.find((candidate) =>
    candidate.sourceElementId === compiledDocument.doc.document.elements.find((element) => element.name === "Base")!.id
  )?.key, callbacks, session, viewport, view };
};

describe("VSCodeCoordinatePointConversionOverlay", () => {
  it("keeps the session mounted when the input loses focus", () => {
    const { viewport } = renderOverlay("@Base");
    fireEvent.blur(screen.getByRole("textbox"));
    expect(viewport.querySelector("[data-coordinate-point-conversion-ui='true']")).not.toBeNull();
  });

  it("applies a valid direct reference on Enter and cancels on Escape", () => {
    const { callbacks } = renderOverlay("@Base");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(callbacks.onSelectBase).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1);

    cleanup();
    const second = renderOverlay();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(second.callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(second.callbacks.onConfirm).not.toHaveBeenCalled();
  });

  it("hands a visual base-point hit to the conversion session", () => {
    const { baseKey, callbacks, viewport } = renderOverlay();
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 150, button: 0 });
    expect(callbacks.onSelectBase).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectBase.mock.calls[0]?.[0]).toBe(baseKey);
  });
});
