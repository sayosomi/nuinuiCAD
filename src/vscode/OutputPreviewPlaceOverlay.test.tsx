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

  it("skips the picker for one hit but opens the shared overlap presentation for multiple hits", () => {
    render(
      <OutputPreviewPlaceOverlay
        projections={[
          projection({ placeId: "a", groupName: "Front" }),
          projection({ placeId: "b", groupName: "Back" })
        ]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 1 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Place Front" }));
    expect(screen.getByRole("listbox", { name: "Overlapping place handles" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);

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
