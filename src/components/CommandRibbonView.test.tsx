import { Circle } from "lucide-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandRibbonView, type CommandRibbonPresentation } from "./CommandRibbonView";

const ribbonFor = (orientation: "horizontal" | "vertical"): CommandRibbonPresentation => ({
  id: "ribbon",
  label: "Canvas Ribbon",
  x: null,
  y: 12,
  orientation,
  iconSize: 16,
  items: [
    {
      id: "unavailable",
      type: "command",
      commandId: "unknown.command",
      icon: "circle",
      label: "Unavailable",
      description: "This command is unavailable.",
      showLabel: false,
      available: false
    },
    {
      id: "names",
      type: "command",
      commandId: "toggleCanvasElementNames",
      icon: "circle",
      label: "Names",
      description: "Toggle element names.",
      showLabel: true,
      available: true,
      pressed: true
    },
    {
      id: "zoom",
      type: "value",
      label: "Zoom",
      description: "Current Canvas zoom.",
      value: "1.23 px/mm"
    }
  ]
});

describe("CommandRibbonView", () => {
  it("keeps unavailable commands focusable and does not execute them", () => {
    const onCommand = vi.fn();
    render(
      <CommandRibbonView
        ribbon={ribbonFor("horizontal")}
        iconResolver={() => Circle}
        onCommand={onCommand}
      />
    );

    const unavailable = screen.getByRole("button", { name: "Unavailable" });
    expect(unavailable).not.toBeDisabled();
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unavailable);
    fireEvent.keyDown(unavailable, { key: "Enter" });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("renders orientation, pressed state, value text, and focus-associated tooltip content", () => {
    const screenView = render(
      <CommandRibbonView
        ribbon={ribbonFor("vertical")}
        iconResolver={() => Circle}
        onCommand={vi.fn()}
      />
    );
    const ribbon = screenView.container.querySelector(".command-ribbon");
    expect(ribbon).toHaveClass("is-vertical");
    expect(screen.getByRole("button", { name: "Names" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "Zoom: 1.23 px/mm" })).toBeInTheDocument();

    const names = screen.getByRole("button", { name: "Names" });
    const describedBy = names.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Names: Toggle element names.");
    fireEvent.focus(names);
    expect(document.getElementById(describedBy!)).toBeInTheDocument();
  });
});
