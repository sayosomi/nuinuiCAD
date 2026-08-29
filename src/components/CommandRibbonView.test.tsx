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
      commandId: "toggleCanvasPointNames",
      icon: "circle",
      label: "Toggle Point Names",
      description: "Show or hide Canvas point names.",
      showLabel: true,
      available: true,
      pressed: true
    },
    {
      id: "zoom",
      type: "value",
      label: "Canvas status",
      description: "Current Canvas zoom and pointer position.",
      fields: [
        { label: "ZOOM", value: "123%" },
        { label: "X", value: "—" },
        { label: "Y", value: "—" }
      ]
    }
  ]
});

const domRectFor = (
  left: number,
  top: number,
  right: number,
  bottom: number
): DOMRect => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON: () => ({})
} as DOMRect);

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
    const describedBy = unavailable.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Unavailable: This command is unavailable."
    );
    expect(document.getElementById(describedBy!)).not.toHaveStyle({ position: "fixed" });
    expect(unavailable.closest(".command-ribbon")).not.toHaveClass("has-viewport-aware-tooltips");
    expect(unavailable).toHaveAttribute("title", "Unavailable: This command is unavailable.");
    fireEvent.focus(unavailable);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Unavailable: This command is unavailable."
    );
    expect(unavailable.querySelector("svg")?.getAttribute("style")).toMatch(/color:\s*currentcolor/i);
    fireEvent.click(unavailable);
    fireEvent.keyDown(unavailable, { key: "Enter" });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("renders orientation, pressed state, multi-field value text, and focus-associated tooltip content", () => {
    const screenView = render(
      <CommandRibbonView
        ribbon={ribbonFor("vertical")}
        iconResolver={() => Circle}
        onCommand={vi.fn()}
      />
    );
    const ribbon = screenView.container.querySelector(".command-ribbon");
    expect(ribbon).toHaveClass("is-vertical");
    expect(screen.getByRole("button", { name: "Toggle Point Names" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Toggle Point Names" }).querySelector("svg")?.getAttribute("style"))
      .toMatch(/color:\s*currentcolor/i);
    const status = screen.getByRole("status", {
      name: "Canvas status: ZOOM: 123%, X: —, Y: —"
    });
    expect(status).toBeInTheDocument();
    expect(status).not.toBeInstanceOf(HTMLButtonElement);
    expect(status).toHaveTextContent("ZOOM123%X—Y—");

    const names = screen.getByRole("button", { name: "Toggle Point Names" });
    const describedBy = names.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Toggle Point Names: Show or hide Canvas point names."
    );
    expect(names.querySelector(".command-ribbon-button > span")).toHaveTextContent("Toggle Point Names");
    fireEvent.focus(names);
    expect(document.getElementById(describedBy!)).toBeInTheDocument();
  });

  it("uses only the command label when its description is empty", () => {
    const view = render(
      <CommandRibbonView
        ribbon={{
          ...ribbonFor("horizontal"),
          items: [{
            id: "label-only",
            type: "command",
            commandId: "test.command",
            icon: "circle",
            label: "Go to Source",
            description: "",
            showLabel: false,
            available: true
          }]
        }}
        iconResolver={() => Circle}
      />
    );

    const button = screen.getByRole("button", { name: "Go to Source" });
    const tooltip = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(button).toHaveAttribute("title", "Go to Source");
    expect(tooltip?.textContent).toBe("Go to Source");
    expect(view.container.querySelector(".command-ribbon-tooltip")).toHaveTextContent("Go to Source");
  });

  it("keeps a one-item VS Code vertical Ribbon handle beside its item column", () => {
    const oneItemRibbon: CommandRibbonPresentation = {
      ...ribbonFor("vertical"),
      items: [ribbonFor("vertical").items[1]!],
      verticalHandlePlacement: "side"
    };
    const view = render(
      <CommandRibbonView ribbon={oneItemRibbon} iconResolver={() => Circle} />
    );

    expect(view.container.querySelector(".command-ribbon")).toHaveClass("is-vertical", "has-side-handle");
    expect(view.container.querySelector(".command-ribbon")?.children).toHaveLength(2);
    expect(view.container.querySelector(".command-ribbon-buttons")?.children).toHaveLength(1);
  });

  it("keeps multiple VS Code vertical Ribbon items in the item column", () => {
    const multiItemRibbon = { ...ribbonFor("vertical"), verticalHandlePlacement: "side" as const };
    const view = render(
      <CommandRibbonView ribbon={multiItemRibbon} iconResolver={() => Circle} />
    );

    expect(view.container.querySelector(".command-ribbon")).toHaveClass("has-side-handle");
    expect(view.container.querySelector(".command-ribbon-buttons")?.children).toHaveLength(3);
  });

  it("uses fresh viewport-aware placement for hover, focus, and unavailable commands", () => {
    const boundaryRef = { current: null as HTMLElement | null };
    let namesRect = domRectFor(100, 40, 140, 60);
    const view = render(
      <div ref={(node) => { boundaryRef.current = node; }}>
        <CommandRibbonView
          ribbon={ribbonFor("horizontal")}
          iconResolver={() => Circle}
          viewportAwareTooltips
          tooltipBoundaryRef={boundaryRef}
        />
      </div>
    );
    const boundary = boundaryRef.current!;
    vi.spyOn(boundary, "getBoundingClientRect").mockReturnValue(domRectFor(20, 10, 320, 200));

    const names = screen.getByRole("button", { name: "Toggle Point Names" });
    const unavailable = screen.getByRole("button", { name: "Unavailable" });
    const namesTooltip = document.getElementById(names.getAttribute("aria-describedby")!);
    const unavailableTooltip = document.getElementById(unavailable.getAttribute("aria-describedby")!);
    expect(namesTooltip).not.toBeNull();
    expect(unavailableTooltip).not.toBeNull();
    vi.spyOn(names, "getBoundingClientRect").mockImplementation(() => namesRect);
    vi.spyOn(unavailable, "getBoundingClientRect").mockReturnValue(domRectFor(250, 40, 290, 60));
    vi.spyOn(namesTooltip!, "getBoundingClientRect").mockReturnValue(domRectFor(0, 0, 120, 30));
    vi.spyOn(unavailableTooltip!, "getBoundingClientRect").mockReturnValue(domRectFor(0, 0, 120, 30));

    expect(view.container.querySelector(".command-ribbon")).toHaveClass("has-viewport-aware-tooltips");
    fireEvent.pointerEnter(names.closest(".command-ribbon-item-shell")!);
    expect(namesTooltip).toHaveStyle({ position: "fixed", left: "60px", top: "66px" });

    fireEvent.pointerLeave(names.closest(".command-ribbon-item-shell")!);
    fireEvent.focus(names);
    expect(namesTooltip).toHaveStyle({ position: "fixed", left: "60px", top: "66px" });

    fireEvent.blur(names);
    fireEvent.focus(unavailable);
    expect(unavailableTooltip).toHaveStyle({ position: "fixed", left: "194px", top: "66px" });

    fireEvent.blur(unavailable);
    namesRect = domRectFor(100, 160, 140, 180);
    fireEvent.pointerEnter(names.closest(".command-ribbon-item-shell")!);
    expect(namesTooltip).toHaveStyle({ position: "fixed", left: "60px", top: "124px" });
  });

  it("keeps the default vertical Ribbon on its existing top-handle layout", () => {
    const view = render(
      <CommandRibbonView ribbon={ribbonFor("vertical")} iconResolver={() => Circle} />
    );

    expect(view.container.querySelector(".command-ribbon")).toHaveClass("is-vertical");
    expect(view.container.querySelector(".command-ribbon")).not.toHaveClass("has-side-handle");
  });

  it("keeps the handle by default and omits only the handle in no-handle mode", () => {
    const view = render(
      <CommandRibbonView ribbon={ribbonFor("horizontal")} iconResolver={() => Circle} />
    );

    expect(view.container.querySelector(".command-ribbon-handle")).toBeInTheDocument();
    expect(view.container.querySelector(".command-ribbon-buttons")?.children).toHaveLength(3);

    view.rerender(
      <CommandRibbonView
        ribbon={ribbonFor("horizontal")}
        iconResolver={() => Circle}
        showHandle={false}
      />
    );

    expect(view.container.querySelector(".command-ribbon-handle")).toBeNull();
    expect(view.container.querySelector(".command-ribbon-buttons")?.children).toHaveLength(3);
    expect(view.container.querySelectorAll(".command-ribbon-button")).toHaveLength(2);
  });
});
