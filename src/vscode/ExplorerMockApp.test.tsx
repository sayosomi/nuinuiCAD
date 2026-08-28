import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExplorerMockApp } from "./ExplorerMockApp";

const api = { postMessage: () => undefined };

const expand = (id: string) => {
  const row = screen.getByTestId(`geometry-row-${id}`);
  const disclosure = row.querySelector(".explorer-mock-disclosure");
  if (!disclosure) throw new Error(`Missing disclosure for ${id}`);
  fireEvent.click(disclosure);
};

const expandFrontPanel = () => {
  expand("source-bodice");
  expand("group-pattern");
  expand("module-front");
};

describe("ExplorerMockApp", () => {
  it("starts collapsed, shows tab counts, and reveals an alternate conditional branch locally", () => {
    render(<ExplorerMockApp api={api} />);

    expect(screen.getByRole("tab", { name: /Elements/ })).toHaveTextContent("Elements");
    expect(screen.getByRole("tab", { name: /Modifiers 5/ })).toBeInTheDocument();
    expect(screen.getByTestId("geometry-row-source-bodice")).toBeInTheDocument();
    expect(screen.queryByTestId("geometry-row-group-pattern")).not.toBeInTheDocument();

    expand("source-bodice");
    expand("group-pattern");
    expect(screen.getByTestId("geometry-row-branch-fit")).toBeInTheDocument();
    expect(screen.queryByTestId("geometry-row-branch-fit-alt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Reveal alternate branch"));
    expect(screen.getByTestId("geometry-row-branch-fit-alt")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hide alternate branch"));
    expect(screen.queryByTestId("geometry-row-branch-fit-alt")).not.toBeInTheDocument();
  });

  it("supports search, AND filters, contextual hierarchy, flat results, and Select All without clearing selection", () => {
    render(<ExplorerMockApp api={api} />);
    expandFrontPanel();

    fireEvent.click(screen.getByTestId("geometry-row-front-neck"));
    expect(screen.getByTestId("geometry-detail")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search Explorer Mock"), { target: { value: "point" } });
    expect(screen.getByText("2 results")).toBeInTheDocument();
    expect(screen.getByTestId("geometry-row-front-neck")).toHaveAttribute("data-match", "true");
    expect(screen.getByTestId("geometry-row-module-front")).toHaveAttribute("data-match", "false");
    expect(screen.getByRole("button", { name: "Select All" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByTestId("geometry-selection-summary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(screen.queryByTestId("geometry-row-module-front")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hierarchy" }));

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByLabelText("Diagnostics"));
    expect(screen.getByRole("button", { name: /Diagnostics/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search Explorer Mock"), { target: { value: "No such geometry" } });
    expect(screen.getByText("Selection Detail")).toBeInTheDocument();
  });

  it("supports plain, toggle, and range selection plus independent tab selection and detail height", () => {
    render(<ExplorerMockApp api={api} />);
    expandFrontPanel();

    fireEvent.click(screen.getByTestId("geometry-row-front-neck"));
    fireEvent.click(screen.getByTestId("geometry-row-front-shoulder"), { metaKey: true });
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("geometry-row-front-armhole"), { shiftKey: true });
    expect(screen.getByText("3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("geometry-row-front-armhole"), { metaKey: true });
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Modifiers 5/ }));
    expect(screen.queryByLabelText("Geometry detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("modifier-row-modifier-base"));
    expect(screen.getByTestId("modifier-detail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Elements/ }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByTestId("geometry-selection-summary")).toBeInTheDocument();

    const divider = screen.getByRole("separator", { name: "Resize Selection Detail" });
    fireEvent.pointerDown(divider, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 430, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 430, pointerId: 1 });
    const elementsDetail = screen.getByRole("region", { name: "Selection Detail" });
    expect(Number.parseInt(elementsDetail.getAttribute("style")?.match(/height: (\d+)px/)?.[1] ?? "0", 10)).toBeGreaterThan(260);
  });

  it("supports scoped top-level tab interaction without capturing wheel input from the list", () => {
    render(<ExplorerMockApp api={api} />);
    const strip = screen.getByTestId("top-tab-strip");
    const elementsTab = screen.getByRole("tab", { name: /Elements/ });
    const modifiersTab = screen.getByRole("tab", { name: /Modifiers/ });

    expect(elementsTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(modifiersTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(strip, { key: "Home" });
    expect(elementsTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(strip, { key: "End" });
    expect(modifiersTab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(elementsTab);
    fireEvent.wheel(strip, { deltaX: 40, deltaY: 1 });
    expect(modifiersTab).toHaveAttribute("aria-selected", "true");

    fireEvent.wheel(screen.getByRole("region", { name: "Modifiers list" }), { deltaY: -40 });
    expect(modifiersTab).toHaveAttribute("aria-selected", "true");
  });

  it("opens scoped geometry detail tabs by click, keyboard, and wheel without changing the detail body scroll", () => {
    render(<ExplorerMockApp api={api} />);
    expandFrontPanel();
    fireEvent.click(screen.getByTestId("geometry-row-front-neck"));
    const strip = screen.getByTestId("detail-tab-strip");
    expect(screen.getByTestId("geometry-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    expect(screen.getByTestId("dependencies-detail")).toBeInTheDocument();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(screen.getByTestId("presentation-detail")).toBeInTheDocument();
    fireEvent.wheel(strip, { deltaY: -40 });
    expect(screen.getByTestId("dependencies-detail")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Direct inputs"));
    expect(screen.getByTestId("dependencies-detail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Presentation" }));
    fireEvent.click(screen.getByText("Cascade / history"));
    expect(screen.queryByText("Active drawing profile")).not.toBeInTheDocument();
  });

  it("keeps zero-use and Profile-only Modifiers and renders multi-Modifier comparison", () => {
    render(<ExplorerMockApp api={api} />);
    fireEvent.click(screen.getByRole("tab", { name: /Modifiers 5/ }));
    fireEvent.click(screen.getByTestId("modifier-row-modifier-seam-guide"));
    expect(screen.getByText(/Static fixture: this Modifier has no current uses/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("modifier-row-modifier-profile"), { ctrlKey: true });
    expect(screen.getByTestId("modifier-selection-summary")).toBeInTheDocument();
    expect(screen.getByText("Comparison")).toBeInTheDocument();
    expect(screen.getByText(/Profile comparison/)).toBeInTheDocument();
    expect(screen.getByText("Print")).toBeInTheDocument();
    expect(screen.getByText(/Profile Hem: #fb7185/)).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.queryByText(/Seam Guide:/)).not.toBeInTheDocument();
    expect(screen.getByTestId("modifier-row-modifier-seam-guide")).toBeInTheDocument();
    expect(screen.getByTestId("modifier-row-modifier-profile")).toHaveTextContent("Profile only");

    fireEvent.click(screen.getByTestId("modifier-row-modifier-base"));
    fireEvent.click(screen.getByTestId("modifier-row-modifier-profile"), { ctrlKey: true });
    expect(screen.getByText(/Profile Hem: #fb7185/)).toBeInTheDocument();
    expect(screen.queryByText(/Base Line Style:/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modifier-row-modifier-base"));
    fireEvent.click(screen.getByTestId("modifier-row-modifier-seam-guide"), { ctrlKey: true });
    expect(screen.queryByText(/Profile comparison/)).not.toBeInTheDocument();
  });

  it("keeps local context menus and reference activation inside the mock", () => {
    render(<ExplorerMockApp api={api} />);
    expandFrontPanel();
    fireEvent.click(screen.getByTestId("geometry-row-front-neck-curve"));
    fireEvent.click(screen.getByRole("button", { name: /Modifier provenance/ }));
    expect(screen.getByTestId("modifier-row-modifier-contrast")).toHaveClass("is-selected");
    fireEvent.contextMenu(screen.getByTestId("modifier-row-modifier-contrast"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Inspect" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" }));
    expect(screen.getByRole("status")).toHaveTextContent("local to this mock");
  });
});
