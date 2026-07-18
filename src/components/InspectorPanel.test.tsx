import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { evaluateElements } from "../geometry/evaluate";
import { createCadElement } from "../model/elementFactory";
import { sampleElements } from "../sampleData";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement, CadElementType } from "../types/geometry";
import { InspectorPanel } from "./InspectorPanel";

const source = [
  "nui 2",
  "point A = coordinate(x: 0 y: 0)",
  "point B = offset(from: A dx: 10 dy: 20)",
  "line AB = segment(start: A end: B)"
].join("\n");

const makeHandle = (): SourceEditorHandle => ({
  focus: vi.fn(),
  getText: vi.fn(() => source),
  setEvaluation: vi.fn(),
  jumpToElement: vi.fn(),
  jumpToParameterValue: vi.fn(() => true),
  applyPickCandidate: vi.fn(() => true),
  pickCandidateElementIds: vi.fn(() => []),
  openTextSearch: vi.fn(),
  closeTextSearch: vi.fn(),
  focusSearch: vi.fn()
});

const renderInspectorElement = (element: CadElement, elements: CadElement[]) => {
  const handle = makeHandle();
  const sourceEditorRef = createRef<SourceEditorHandle>();
  sourceEditorRef.current = handle;
  const view = render(
    <InspectorPanel
      element={element}
      elements={elements}
      evaluation={evaluateElements(elements)}
      sourceEditorRef={sourceEditorRef}
    />
  );
  return { element, handle, unmount: view.unmount };
};

const renderInspector = (elementName: string) => {
  const elements = useCadDocumentStore.getState().elements;
  const element = elements.find((candidate) => candidate.name === elementName)!;
  return { elements, ...renderInspectorElement(element, elements) };
};

const renderFactoryInspector = (type: CadElementType) => {
  const element = createCadElement(type, sampleElements, {
    createId: () => `inspector-${type}`,
  });
  const elements = [...sampleElements, element];
  useCadDocumentStore.setState({ elements });
  return renderInspectorElement(element, elements);
};

describe("InspectorPanel mouse-only actions", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
  });

  it("jumps from a clicked parameter row to the Source Editor value span", () => {
    const { element, handle } = renderInspector("B");
    fireEvent.click(screen.getByText("dx").closest(".inspector-row")!);
    expect(handle.jumpToParameterValue).toHaveBeenCalledWith(element.id, "dx");
  });

  it("selects and jumps to a clicked dependency row", () => {
    const { elements, handle } = renderInspector("AB");
    const pointA = elements.find((element) => element.name === "A")!;
    fireEvent.click(screen.getByText("A").closest(".inspector-row")!);
    expect(useCadUiStore.getState().selectedElementId).toBe(pointA.id);
    expect(handle.jumpToElement).toHaveBeenCalledWith(pointA.id);
  });

  it("starts Canvas pick only from the row button and keeps the panel non-navigable", () => {
    const { element, handle } = renderInspector("B");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.querySelector("[aria-activedescendant]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "基準点を選択" }));
    expect(useCadUiStore.getState().activePointPickTarget).toEqual({
      elementId: element.id,
      parameterKey: "fromPoint"
    });

    fireEvent.click(screen.getByRole("button", { name: "dxを選択" }));
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: element.id,
      parameterKey: "dx",
      property: "length"
    });
    expect(handle.jumpToParameterValue).not.toHaveBeenCalled();
  });

  it("starts an angle-shaped parameter's pick on an angle measurement instead of length", () => {
    const { element } = renderFactoryInspector("angleLengthLine");
    fireEvent.click(screen.getByRole("button", { name: "角度を選択" }));
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: element.id,
      parameterKey: "angleDeg",
      property: "startTangentAngleDeg"
    });

    fireEvent.click(screen.getByRole("button", { name: "長さを選択" }));
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: element.id,
      parameterKey: "length",
      property: "length"
    });
  });

  it("keeps explicit Canvas-pick buttons for every supported parameter kind", () => {
    const cases: Array<{
      type: CadElementType;
      buttonName: string;
      target: "point" | "line" | "numeric";
      parameterKey: string;
    }> = [
      { type: "offsetPoint", buttonName: "基準点を選択", target: "point", parameterKey: "fromPoint" },
      { type: "lineDivisionPoint", buttonName: "端点を選択", target: "point", parameterKey: "endpoint" },
      { type: "intersectionPoint", buttonName: "線1を選択", target: "line", parameterKey: "line1Id" },
      { type: "offsetLine", buttonName: "基準線を選択", target: "line", parameterKey: "baseLineIds" },
      { type: "freePoint", buttonName: "xを選択", target: "numeric", parameterKey: "x" },
    ];

    for (const testCase of cases) {
      const { element, handle, unmount } = renderFactoryInspector(testCase.type);
      fireEvent.click(screen.getByRole("button", { name: testCase.buttonName }));

      const target = testCase.target === "point"
        ? useCadUiStore.getState().activePointPickTarget
        : testCase.target === "line"
          ? useCadUiStore.getState().activeLinePickTarget
          : useCadUiStore.getState().activeNumericReferencePickTarget;
      expect(target).toMatchObject({
        elementId: element.id,
        parameterKey: testCase.parameterKey,
      });
      expect(handle.jumpToParameterValue).not.toHaveBeenCalled();

      useCadUiStore.setState({
        activePointPickTarget: null,
        activeLinePickTarget: null,
        activeNumericReferencePickTarget: null,
      });
      unmount();
    }
  });

  it("does not render a pick button for non-pickable parameters", () => {
    renderInspector("B");
    const nameRow = screen.getByText("名前").closest(".inspector-row");
    if (!(nameRow instanceof HTMLElement)) throw new Error("Missing name row");
    expect(within(nameRow).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the existing IME composition guard when a pick button is clicked", () => {
    const unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush: () => "blocked-composition",
    });
    try {
      const { handle } = renderInspector("B");
      fireEvent.click(screen.getByRole("button", { name: "基準点を選択" }));

      expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
      expect(handle.jumpToParameterValue).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});
