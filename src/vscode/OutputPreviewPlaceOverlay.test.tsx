import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import { OutputPreviewPlaceOverlay } from "./OutputPreviewPlaceOverlay";

const sourceText = `${".".repeat(80)}group`;

const projection = ({
  placeId,
  groupName,
  draggable = true,
  x = 0
}: {
  placeId: string;
  groupName: string;
  draggable?: boolean;
  x?: number;
}) => ({
  placeId,
  sourceRevision: 1,
  layoutId: "layout",
  layoutName: "Pattern",
  groupId: `group-${placeId}`,
  groupName,
  transformedOrigin: { x, y: 0 },
  drawables: [],
  statementRange: { from: 20, to: 40 },
  authored: {
    group: {
      text: `@${groupName}`,
      sourceSpan: { sourceRevision: 1, segments: [{ from: 2, to: 10 }] },
      references: [],
      targetRange: { from: 80, to: 85 }
    },
    at: {
      text: draggable ? "(10, 20)" : "(@x, 20)",
      sourceSpan: { sourceRevision: 1, segments: [{ from: 10, to: 18 }] },
      references: [],
      x: null,
      y: null
    }
  },
  dragability: draggable
    ? { draggable: true, literals: { x: 10, y: 20 } }
    : {
        draggable: false,
        reason: {
          code: "at-not-direct-finite-numeric-literals",
          issues: [{ axis: "x", reason: "not-direct-numeric-literal" }]
        }
      }
}) as unknown as OutputPlaceProjection;

afterEach(() => cleanup());

describe("OutputPreviewPlaceOverlay", () => {
  it("uses grab only for draggable handles and shows the non-draggable reason on hover", () => {
    const onHighlight = vi.fn();
    render(
      <OutputPreviewPlaceOverlay
        projections={[
          projection({ placeId: "a", groupName: "Front" }),
          projection({ placeId: "b", groupName: "Back", draggable: false, x: 30 })
        ]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={onHighlight}
      />
    );

    const front = screen.getByRole("button", { name: "Place Front" });
    const back = screen.getByRole("button", { name: "Place Back" });
    expect(front).toHaveStyle({ cursor: "grab" });
    expect(back).toHaveStyle({ cursor: "default" });

    fireEvent.pointerEnter(back);
    expect(screen.getByText(/Cannot drag:/)).toBeTruthy();
    expect(onHighlight).toHaveBeenLastCalledWith("b");
  });

  it("skips the picker for a single handle hit", () => {
    render(
      <OutputPreviewPlaceOverlay
        projections={[
          projection({ placeId: "a", groupName: "Front" }),
          projection({ placeId: "b", groupName: "Back", x: 30 })
        ]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Place Front" }));
    expect(screen.queryByRole("listbox", { name: "Overlapping place handles" })).toBeNull();
    expect(screen.getByLabelText("Place details for Front")).toBeTruthy();
  });

  it("publishes the supplied VS Code place context on handles and details", () => {
    const placeContextMenuData = JSON.stringify({
      webviewSection: "place",
      preventDefaultContextMenuItems: true
    });
    render(
      <OutputPreviewPlaceOverlay
        projections={[projection({ placeId: "a", groupName: "Front" })]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        placeContextMenuData={placeContextMenuData}
      />
    );

    const handle = screen.getByRole("button", { name: "Place Front" });
    expect(handle).toHaveAttribute("data-vscode-context", placeContextMenuData);
    fireEvent.click(handle);
    expect(screen.getByLabelText("Place details for Front"))
      .toHaveAttribute("data-vscode-context", placeContextMenuData);
  });

  it("clears a pinned handle detail with Escape and returns focus to the viewport", () => {
    const focusViewport = vi.fn();
    render(
      <OutputPreviewPlaceOverlay
        projections={[projection({ placeId: "a", groupName: "Front" })]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        focusViewport={focusViewport}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Place Front" }));
    expect(screen.getByLabelText("Place details for Front")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByLabelText("Place details for Front")).toBeNull();
    expect(focusViewport).toHaveBeenCalledOnce();
  });

  it("clears a pinned handle detail when the host requests it", () => {
    const { rerender } = render(
      <OutputPreviewPlaceOverlay
        projections={[projection({ placeId: "a", groupName: "Front" })]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        clearInteractionKey={0}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Place Front" }));
    expect(screen.getByLabelText("Place details for Front")).toBeTruthy();
    rerender(
      <OutputPreviewPlaceOverlay
        projections={[projection({ placeId: "a", groupName: "Front" })]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        clearInteractionKey={1}
      />
    );

    expect(screen.queryByLabelText("Place details for Front")).toBeNull();
  });

  it("opens the shared overlap presentation for multiple hits and resolves candidates from current handles", () => {
    const projections = [
      projection({ placeId: "a", groupName: "Front" }),
      projection({ placeId: "b", groupName: "Back" })
    ];
    const onNavigate = vi.fn();
    const onHighlight = vi.fn();
    const { rerender } = render(
      <OutputPreviewPlaceOverlay
        projections={projections}
        sourceText={sourceText}
        viewportSize={{ width: 800, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={onNavigate}
        onHighlightPlaceIdChange={onHighlight}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Place Front" }));
    const picker = screen.getByRole("listbox", { name: "Overlapping place handles" });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(picker).toHaveStyle({ left: "412px" });

    rerender(
      <OutputPreviewPlaceOverlay
        projections={projections}
        sourceText={sourceText}
        viewportSize={{ width: 800, height: 300 }}
        viewport={{ panX: 40, panY: 0, zoom: 1 }}
        onNavigate={onNavigate}
        onHighlightPlaceIdChange={onHighlight}
      />
    );
    expect(screen.getByRole("listbox", { name: "Overlapping place handles" })).toHaveStyle({ left: "452px" });

    fireEvent.wheel(screen.getByRole("listbox", { name: "Overlapping place handles" }), { deltaY: 24 });
    expect(screen.getByRole("option", { name: /Back/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("option", { name: /Back/ }));
    expect(screen.queryByRole("listbox", { name: "Overlapping place handles" })).toBeNull();
    expect(screen.getByLabelText("Place details for Back")).toBeTruthy();
  });

  it("navigates group and place rows with the exact supplied normalized ranges", () => {
    const onNavigate = vi.fn();
    render(
      <OutputPreviewPlaceOverlay
        projections={[projection({ placeId: "a", groupName: "Front" })]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={onNavigate}
        onHighlightPlaceIdChange={vi.fn()}
      />
    );

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Place Front" }));
    fireEvent.click(screen.getByRole("button", { name: "Front" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ from: 80, to: 85 });

    fireEvent.click(screen.getByRole("button", { name: "placed in Pattern" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ from: 20, to: 40 });
  });
});
