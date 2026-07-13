import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { evaluateElements } from "../geometry/evaluate";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { useCadStore } from "../state/useCadStore";
import type { CadElement } from "../types/geometry";
import { InspectorPanel, type InspectorPanelHandle } from "./InspectorPanel";

const makeSourceEditorHandle = (overrides: Partial<SourceEditorHandle> = {}): SourceEditorHandle => ({
  focus: vi.fn(),
  getText: vi.fn(() => ""),
  setEvaluation: vi.fn(),
  jumpToElement: vi.fn(),
  jumpToParameterValue: vi.fn(() => true),
  applyPickCandidate: vi.fn(() => true),
  pickCandidateElementIds: vi.fn(() => []),
  openTextSearch: vi.fn(),
  closeTextSearch: vi.fn(),
  focusSearch: vi.fn(),
  ...overrides
});

const renderInspector = (element: CadElement | null, elements = sampleElements) => {
  const inspectorRef = createRef<InspectorPanelHandle>();
  const sourceHandle = makeSourceEditorHandle();
  const sourceEditorRef = { current: sourceHandle } as React.RefObject<SourceEditorHandle | null>;
  const view = render(
    <InspectorPanel
      ref={inspectorRef}
      element={element}
      elements={elements}
      evaluation={evaluateElements(elements)}
      sourceEditorRef={sourceEditorRef}
      onExit={vi.fn()}
    />
  );
  return { ...view, inspectorRef, sourceHandle };
};

beforeEach(() => {
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    diagnostics: []
  });
});

afterEach(() => vi.restoreAllMocks());

describe("InspectorPanel", () => {
  it("is structurally read-only while showing shared presentation data", () => {
    const { container } = renderInspector(sampleElements[3]);
    const panel = screen.getByRole("region", { name: "インスペクタ" });

    expect(within(panel).getByText("親・free point")).toBeInTheDocument();
    expect(within(panel.querySelector(".element-info-grid")!).getByText("始点")).toBeInTheDocument();
    expect(container.querySelector(".inspector-panel input, .inspector-panel textarea, .inspector-panel select, .inspector-panel [contenteditable='true']")).toBeNull();
  });

  it("uses activeRowKey safely across navigation and selected-element changes", async () => {
    const { inspectorRef, rerender, sourceHandle } = renderInspector(sampleElements[3]);
    act(() => inspectorRef.current?.focusParameterRows());

    act(() => inspectorRef.current?.moveParameterRow(1));
    expect(screen.getByRole("listbox", { name: "インスペクタ行" })).toHaveAttribute(
      "aria-activedescendant",
      "inspector-row-parameter-colorId"
    );
    act(() => inspectorRef.current?.activateRow());
    expect(sourceHandle.jumpToParameterValue).toHaveBeenCalledWith("line-ab", "colorId");

    rerender(
      <InspectorPanel
        ref={inspectorRef}
        element={sampleElements[0]}
        elements={sampleElements}
        evaluation={evaluateElements(sampleElements)}
        sourceEditorRef={{ current: sourceHandle }}
        onExit={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole("listbox", { name: "インスペクタ行" })).toHaveAttribute(
      "aria-activedescendant",
      "inspector-row-parameter-name"
    ));
  });

  it("routes dependency-row activation through selection and the Source Editor handle", () => {
    const { inspectorRef, sourceHandle } = renderInspector(sampleElements[3]);

    act(() => inspectorRef.current?.focusDependencyRows());
    act(() => inspectorRef.current?.activateRow());

    expect(useCadStore.getState().selectedElementId).toBe("point-a");
    expect(sourceHandle.jumpToElement).toHaveBeenCalledWith("point-a");
  });

  it("keeps long dependency lists keyboard-reachable and scrolls the active row into view", () => {
    const root = sampleElements[0];
    const children = Array.from({ length: 120 }, (_, index) => ({
      id: `child-${index}`,
      name: `子 ${index}`,
      type: "offsetPoint" as const,
      visible: true,
      enabled: true,
      fromPointId: root.id,
      dx: index,
      dy: 0
    }));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const { inspectorRef } = renderInspector(root, [root, ...children]);

    act(() => inspectorRef.current?.focusDependencyRows());
    for (let index = 0; index < 119; index += 1) act(() => inspectorRef.current?.moveDependencyRow(1));

    expect(screen.getByRole("listbox", { name: "インスペクタ行" })).toHaveAttribute(
      "aria-activedescendant",
      "inspector-row-child-child-119"
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
