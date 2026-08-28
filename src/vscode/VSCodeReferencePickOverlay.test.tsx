import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import type { ReferencePickCandidate } from "../model/referencePickCandidates";
import type { ReferencePickHover } from "../model/referencePickSession";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";

const sessionFor = ({
  expectedGeometryInterface = "line",
  role = "geometry",
  multiplicity = "single",
  draftReferences = [],
  candidates = [],
  status = "active"
}: {
  expectedGeometryInterface?: "point" | "line" | "path";
  role?: "geometry" | "endpoint" | "numericPropertyBase";
  multiplicity?: "single" | "multiple";
  draftReferences?: readonly { base: string; pointKey?: string }[];
  candidates?: readonly ReferencePickCandidate[];
  status?: "active" | "confirmed" | "canceled";
} = {}): VscodeReferencePickCanvasSession => ({
  request: {},
  target: {
    expectedGeometryInterface,
    role,
    multiplicity
  },
  candidates,
  draft: {
    expectedGeometryInterface,
    role,
    multiplicity,
    hover: null,
    draftReferences,
    status
  }
} as unknown as VscodeReferencePickCanvasSession);

const pointCandidate = ({
  elementId,
  reference,
  label = reference.pointKey ?? reference.base,
  x = 0,
  y = 0,
  anchor = { mode: "reference", pointId: elementId }
}: {
  elementId: string;
  reference: { base: string; pointKey?: string };
  label?: string;
  x?: number;
  y?: number;
  anchor?: { mode: "reference"; pointId: string } | { mode: "derived"; elementId: string; pointKey: string };
}): ReferencePickCandidate => ({
  elementId,
  actualGeometryInterface: "point",
  options: [{
    kind: "point",
    label,
    anchor,
    point: { kind: "point", elementId, name: label, x, y },
    reference
  }]
});

type OverlayCallbacks = {
  onHover: (hover: ReferencePickHover | null) => void;
  onSelect: (selection: ReferencePickHover | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const renderOverlay = (
  session: VscodeReferencePickCanvasSession,
  overrides: Partial<OverlayCallbacks> = {}
) => {
  const viewport = document.createElement("div");
  viewport.tabIndex = 0;
  document.body.append(viewport);
  const callbacks: OverlayCallbacks = {
    onHover: overrides.onHover ?? vi.fn<(hover: ReferencePickHover | null) => void>(),
    onSelect: overrides.onSelect ?? vi.fn<(selection: ReferencePickHover | null) => void>(),
    onConfirm: overrides.onConfirm ?? vi.fn<() => void>(),
    onCancel: overrides.onCancel ?? vi.fn<() => void>()
  };
  const view = render(
    <VSCodeReferencePickOverlay
      canvasFocusRef={{ current: viewport }}
      viewportSize={{ width: 640, height: 480 }}
      canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
      canvasTheme={LEGACY_CANVAS_THEME}
      elements={[]}
      evaluation={emptyEvaluationResult([])}
      visibilityProfiles={[]}
      activeVisibilityProfileId={null}
      session={session}
      onHover={callbacks.onHover}
      onSelect={callbacks.onSelect}
      onConfirm={callbacks.onConfirm}
      onCancel={callbacks.onCancel}
    />,
    { container: viewport }
  );
  return { viewport, callbacks, view };
};

describe("VSCodeReferencePickOverlay", () => {
  it("reuses the Canvas bottom-right transient hint and theme contract", () => {
    const { viewport, view } = renderOverlay(sessionFor());
    const status = screen.getByRole("status");

    expect(status).toHaveClass("point-drag-axis-lock-hint");
    expect(status).toHaveAttribute("data-reference-pick-hint-position", "bottom-right");
    expect(status.style.right).toBe("0px");
    expect(status.style.bottom).toBe("0px");
    expect(status.style.getPropertyValue("--canvas-background")).toBe(LEGACY_CANVAS_THEME.background);
    expect(status.style.getPropertyValue("--canvas-foreground")).toBe(LEGACY_CANVAS_THEME.foreground);
    expect(screen.getByText("Line target")).toBeInTheDocument();
    expect(screen.getByText("Pick · Line")).toBeInTheDocument();
    const frame = document.querySelector("[data-reference-pick-frame='true']");
    expect(frame).toHaveAttribute("style", expect.stringContaining("border: 2px solid var(--canvas-accent)"));
    expect(document.querySelector("[data-reference-pick-badge='true']")).not.toBeNull();
    expect(screen.getByText("Enter Done")).toBeInTheDocument();
    expect(screen.getByText("Esc Cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(document.activeElement).toBe(viewport);

    view.unmount();
    viewport.remove();
  });

  it("routes Enter confirm and Escape cancel through the active Canvas session", () => {
    const onConfirm = vi.fn<() => void>();
    const onCancel = vi.fn<() => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({ draftReferences: [{ base: "Straight" }] }),
      { onConfirm, onCancel }
    );

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeEnabled();
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    done.focus();
    fireEvent.keyDown(done, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    view.unmount();
    viewport.remove();
  });

  it("labels endpoint and numeric-base targets without introducing a property chooser", () => {
    const first = renderOverlay(sessionFor({
      expectedGeometryInterface: "point",
      role: "endpoint"
    }));
    expect(screen.getByText("Endpoint target")).toBeInTheDocument();
    first.view.unmount();
    first.viewport.remove();

    const second = renderOverlay(sessionFor({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase"
    }));
    expect(screen.getByText("Geometry base target")).toBeInTheDocument();
    expect(screen.queryByText(/length|angle/i)).not.toBeInTheDocument();
    second.view.unmount();
    second.viewport.remove();
  });

  it("opens an exact-reference popup for overlapping point hits without changing the draft", () => {
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [
          pointCandidate({ elementId: "C", reference: { base: "C" } }),
          pointCandidate({
            elementId: "Arc",
            reference: { base: "Arc", pointKey: "center" },
            anchor: { mode: "derived", elementId: "Arc", pointKey: "center" },
            label: "center"
          })
        ]
      }),
      { onSelect }
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Reference Pick point candidates" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /@C/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /@Arc\.center/ })).toBeInTheDocument();

    fireEvent.keyDown(viewport, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Reference Pick point candidates" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const arcOption = screen.getByRole("option", { name: /@Arc\.center/ });
    fireEvent.pointerDown(arcOption, { button: 0 });
    fireEvent.click(arcOption);
    expect(onSelect).toHaveBeenCalledWith({
      candidateElementId: "Arc",
      reference: { base: "Arc", pointKey: "center" }
    });

    view.unmount();
    viewport.remove();
  });

  it("selects a single point hit directly", () => {
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [pointCandidate({ elementId: "C", reference: { base: "C" } })]
      }),
      { onSelect }
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });

    expect(onSelect).toHaveBeenCalledWith({ candidateElementId: "C", reference: { base: "C" } });
    expect(screen.queryByRole("listbox", { name: "Reference Pick point candidates" })).toBeNull();

    view.unmount();
    viewport.remove();
  });

  it("does not render Pick chrome after the session is terminal", () => {
    const { viewport, view } = renderOverlay(sessionFor({ status: "canceled" }));

    expect(document.querySelector("[data-reference-pick-frame='true']")).toBeNull();
    expect(document.querySelector("[data-reference-pick-badge='true']")).toBeNull();

    view.unmount();
    viewport.remove();
  });
});
