import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { evaluateElements } from "../geometry/evaluate";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
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

const renderInspector = (
  element: CadElement | null,
  elements = sampleElements,
  evaluation: EvaluationResult = evaluateElements(elements)
) => {
  const inspectorRef = createRef<InspectorPanelHandle>();
  const sourceHandle = makeSourceEditorHandle();
  const sourceEditorRef = { current: sourceHandle } as React.RefObject<SourceEditorHandle | null>;
  const view = render(
    <InspectorPanel
      ref={inspectorRef}
      element={element}
      elements={elements}
      evaluation={evaluation}
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

  it("uses the shared presentation status semantics for Inspector badges", () => {
    const point = { ...(sampleElements[0] as Extract<CadElement, { type: "freePoint" }>), visible: false, enabled: false, locked: true };
    const evaluation: EvaluationResult = {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [{ elementId: point.id, elementName: point.name, missingDependencyId: point.id, message: "評価エラー" }],
      warnings: []
    };
    const { container } = renderInspector(point, [point], evaluation);

    expect(screen.getByText("エラー")).toBeInTheDocument();
    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByText("非表示")).toBeInTheDocument();
    expect(container.querySelector(".inspector-status.ロック")).toBeInTheDocument();
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

  it("does not mirror parameter navigation into the legacy selectedParameterKey state", () => {
    const { inspectorRef } = renderInspector(sampleElements[3]);
    useCadStore.getState().setSelectedParameterKey("name");

    act(() => inspectorRef.current?.focusParameterRows());
    act(() => inspectorRef.current?.moveParameterRow(1));

    expect(useCadStore.getState().selectedParameterKey).toBe("name");
    expect(screen.getByRole("listbox", { name: "インスペクタ行" })).toHaveAttribute(
      "aria-activedescendant",
      "inspector-row-parameter-colorId"
    );
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
      "inspector-row-dependency-child-child-119"
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("keeps Inspector focus after a dependency Enter while moving the Source Editor cursor", () => {
    const { inspectorRef, sourceHandle } = renderInspector(sampleElements[3]);

    act(() => inspectorRef.current?.focusDependencyRows());
    const inspector = screen.getByRole("listbox", { name: "インスペクタ行" });
    expect(inspector).toHaveFocus();
    act(() => inspectorRef.current?.activateRow());

    expect(sourceHandle.jumpToElement).toHaveBeenCalledWith("point-a");
    expect(inspector).toHaveFocus();
    act(() => inspectorRef.current?.moveDependencyRow(1));
    expect(inspector).toHaveAttribute("aria-activedescendant", "inspector-row-dependency-parent-point-b");
    expect(inspector).toHaveFocus();
  });

  it("keeps unresolved parent diagnostics on the unresolved parent row", () => {
    const broken = {
      ...(sampleElements[3] as Extract<CadElement, { type: "line" }>),
      id: "broken-line",
      name: "Broken",
      startPoint: { mode: "reference" as const, pointId: "missing-point" }
    };
    const { container } = renderInspector(broken, [sampleElements[0], broken]);

    const unresolved = within(container.querySelector(".dependency-row.unresolved")!).getByText(/未解決: missing-point/);
    expect(unresolved).toBeInTheDocument();
    expect(container.querySelector(".dependency-row.unresolved .dependency-issue.error")).toBeInTheDocument();
  });

  it("labels fatal source presentation as last-good without attaching live parse diagnostics", () => {
    useCadStore.setState({
      docText: "nui 1\npoint A = (0, 0)",
      sourceText: "nui 1\npoint A = (",
      diagnostics: [{ severity: "error", line: 2, column: 13, message: "未完了の入力です。" }]
    });

    renderInspector(sampleElements[0]);

    expect(screen.getByText("評価: last-good")).toBeInTheDocument();
    expect(screen.queryByText("未完了の入力です。")).not.toBeInTheDocument();
  });
});
