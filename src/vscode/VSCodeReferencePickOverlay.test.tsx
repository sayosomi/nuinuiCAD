import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import type { ReferencePickHover } from "../model/referencePickSession";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";

const sessionFor = ({
  expectedGeometryInterface = "line",
  role = "geometry",
  multiplicity = "single",
  draftReferences = []
}: {
  expectedGeometryInterface?: "point" | "line" | "path";
  role?: "geometry" | "endpoint" | "numericPropertyBase";
  multiplicity?: "single" | "multiple";
  draftReferences?: readonly { base: string; pointKey?: string }[];
} = {}): VscodeReferencePickCanvasSession => ({
  request: {},
  target: {
    expectedGeometryInterface,
    role,
    multiplicity
  },
  candidates: [],
  draft: {
    expectedGeometryInterface,
    role,
    multiplicity,
    hover: null,
    draftReferences,
    status: "active"
  }
} as unknown as VscodeReferencePickCanvasSession);

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
    />
  );
  return { viewport, callbacks, view };
};

describe("VSCodeReferencePickOverlay", () => {
  it("uses the Canvas bottom-right transient hint region and theme contract", () => {
    const { viewport, view } = renderOverlay(sessionFor());
    const status = screen.getByRole("status");

    expect(status).toHaveAttribute("data-reference-pick-hint-position", "bottom-right");
    expect(status.style.position).toBe("absolute");
    expect(status.style.right).toBe("0px");
    expect(status.style.bottom).toBe("0px");
    expect(status).toHaveStyle({ background: LEGACY_CANVAS_THEME.background });
    expect(status).toHaveStyle({ color: LEGACY_CANVAS_THEME.foreground });
    expect(screen.getByText("Line target")).toBeInTheDocument();
    expect(screen.getByText("Enter")).toBeInTheDocument();
    expect(screen.getAllByText("Done").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

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

    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(viewport, { key: "Escape" });
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
});
