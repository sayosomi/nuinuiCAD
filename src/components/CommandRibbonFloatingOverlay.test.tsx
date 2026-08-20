import { Circle } from "lucide-react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CommandRibbonFloatingOverlay
} from "./CommandRibbonFloatingOverlay";
import { clampRibbonPosition } from "./commandRibbonFloatingGeometry";
import type { CommandRibbonPresentation } from "./CommandRibbonView";

const ribbon: CommandRibbonPresentation = {
  id: "ribbon",
  label: "Ribbon",
  x: 12,
  y: 12,
  orientation: "horizontal",
  iconSize: 16,
  items: [{
    id: "long-label",
    type: "command",
    commandId: "command",
    icon: "circle",
    label: "A visible label that affects the rendered width",
    description: "Description",
    showLabel: true,
    available: true
  }]
};

describe("CommandRibbonFloatingOverlay", () => {
  it("clamps against the measured rendered size, including visible labels", () => {
    expect(clampRibbonPosition(999, 999, { width: 320, height: 180 }, { width: 220, height: 48 })).toEqual({
      x: 92,
      y: 124
    });
  });

  it("commits a drag once on pointerup and does not persist resize reclamping", () => {
    const onPositionChange = vi.fn();
    const onPositionCommit = vi.fn();
    const view = render(
      <CommandRibbonFloatingOverlay
        ribbons={[ribbon]}
        viewportSize={{ width: 320, height: 180 }}
        iconResolver={() => Circle}
        onPositionChange={onPositionChange}
        onPositionCommit={onPositionCommit}
      />
    );
    const handle = screen.getByRole("button", { name: "Ribbonを移動" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 999, clientY: 999 });
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 999, clientY: 999 });

    expect(onPositionChange).toHaveBeenCalled();
    expect(onPositionCommit).toHaveBeenCalledTimes(1);
    const committed = onPositionCommit.mock.calls[0]?.[1] as { x: number; y: number };
    expect(committed.x).toBeLessThan(320);
    expect(committed.y).toBeLessThan(180);

    const commitsBeforeResize = onPositionCommit.mock.calls.length;
    act(() => {
      view.rerender(
        <CommandRibbonFloatingOverlay
          ribbons={[ribbon]}
          viewportSize={{ width: 180, height: 100 }}
          iconResolver={() => Circle}
          onPositionChange={onPositionChange}
          onPositionCommit={onPositionCommit}
        />
      );
    });
    expect(onPositionCommit).toHaveBeenCalledTimes(commitsBeforeResize);
  });

  it("positions a viewport-aware tooltip without committing Ribbon movement", () => {
    const onPositionCommit = vi.fn();
    const view = render(
      <CommandRibbonFloatingOverlay
        ribbons={[ribbon]}
        viewportSize={{ width: 320, height: 180 }}
        iconResolver={() => Circle}
        viewportAwareTooltips
        onPositionCommit={onPositionCommit}
      />
    );
    const boundary = view.container.querySelector(".command-ribbon-layer")!;
    const button = screen.getByRole("button", { name: "A visible label that affects the rendered width" });
    const tooltip = document.getElementById(button.getAttribute("aria-describedby")!)!;
    vi.spyOn(boundary, "getBoundingClientRect").mockReturnValue({
      left: 40,
      top: 20,
      right: 360,
      bottom: 200,
      width: 320,
      height: 180
    } as DOMRect);
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 40,
      right: 240,
      bottom: 72,
      width: 140,
      height: 32
    } as DOMRect);
    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 120,
      bottom: 30,
      width: 120,
      height: 30
    } as DOMRect);

    fireEvent.pointerEnter(button.closest(".command-ribbon-item-shell")!);

    expect(tooltip).toHaveStyle({ position: "fixed", left: "110px", top: "78px" });
    expect(onPositionCommit).not.toHaveBeenCalled();
  });
});
