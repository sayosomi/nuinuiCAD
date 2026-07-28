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
  jumpToElementEnd: vi.fn(),
  jumpToBindingDeclaration: vi.fn(() => true),
  jumpToBindingDeclarationPart: vi.fn(() => true),
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

describe("InspectorPanel typed declaration metadata", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  const renderInspectorForBinding = (source: string, bindingName: string) => {
    useCadDocumentStore.getState().commitText(source, "test");
    const bindingId = useCadDocumentStore
      .getState()
      .doc.bindingAnalysis!.catalog.bindings.find(
        (binding) => binding.kind === "typed" && binding.name === bindingName,
      )!.id;
    useCadUiStore.getState().setSelectedBindingId(bindingId);
    const handle = makeHandle();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    sourceEditorRef.current = handle;
    const elements = useCadDocumentStore.getState().elements;
    const view = render(
      <InspectorPanel
        element={null}
        elements={elements}
        evaluation={evaluateElements(elements)}
        sourceEditorRef={sourceEditorRef}
      />,
    );
    return { bindingId, handle, unmount: view.unmount };
  };

  it("shows kind/type/initializer/ID rows for a selected typed const, and clears any element selection", () => {
    renderInspectorForBinding(["nui 3", "const width: number = 12"].join("\n"), "width");

    expect(screen.getByText("width")).toBeInTheDocument();
    expect(within(screen.getByText("種別").closest(".inspector-row")!).getByText("const")).toBeInTheDocument();
    expect(within(screen.getByText("型").closest(".inspector-row")!).getByText("number")).toBeInTheDocument();
    expect(within(screen.getByText("初期化式").closest(".inspector-row")!).getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("要素を選択してください。")).not.toBeInTheDocument();
    expect(screen.queryByText("無効")).not.toBeInTheDocument();
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
  });

  it("jumps to the declaration when the declaration row is clicked", () => {
    const { handle, bindingId } = renderInspectorForBinding(
      ["nui 3", "let shown: boolean = true"].join("\n"),
      "shown",
    );

    fireEvent.click(screen.getByText("shown").closest(".inspector-row")!);

    expect(handle.jumpToBindingDeclaration).toHaveBeenCalledWith(bindingId);
  });

  it("jumps to just the type/initializer sub-span (Task 43) when those rows are clicked, not the whole declaration", () => {
    const { handle, bindingId } = renderInspectorForBinding(
      ["nui 3", "let shown: boolean = true"].join("\n"),
      "shown",
    );

    fireEvent.click(screen.getByText("型").closest(".inspector-row")!);
    expect(handle.jumpToBindingDeclarationPart).toHaveBeenCalledWith(bindingId, "type");

    fireEvent.click(screen.getByText("初期化式").closest(".inspector-row")!);
    expect(handle.jumpToBindingDeclarationPart).toHaveBeenCalledWith(bindingId, "initializer");

    expect(handle.jumpToBindingDeclaration).not.toHaveBeenCalled();
  });

  it("falls back to the whole-statement jump when the type/initializer sub-span does not resolve", () => {
    const { handle, bindingId } = renderInspectorForBinding(
      ["nui 3", "let shown: boolean = true"].join("\n"),
      "shown",
    );
    vi.mocked(handle.jumpToBindingDeclarationPart).mockReturnValue(false);

    fireEvent.click(screen.getByText("初期化式").closest(".inspector-row")!);

    expect(handle.jumpToBindingDeclarationPart).toHaveBeenCalledWith(bindingId, "initializer");
    expect(handle.jumpToBindingDeclaration).toHaveBeenCalledWith(bindingId);
  });

  it("does not attach a click handler to the non-span kind/ID rows", () => {
    const { handle } = renderInspectorForBinding(
      ["nui 3", "let shown: boolean = true"].join("\n"),
      "shown",
    );

    fireEvent.click(screen.getByText("種別").closest(".inspector-row")!);

    expect(handle.jumpToBindingDeclaration).not.toHaveBeenCalled();
    expect(handle.jumpToBindingDeclarationPart).not.toHaveBeenCalled();
  });

  it("shows an invalid marker and diagnostic message for an invalid declaration", () => {
    renderInspectorForBinding(
      ["nui 3", "const broken: number = @missing", "const valid: number = 3"].join("\n"),
      "broken",
    );

    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByText(/未定義の変数/)).toBeInTheDocument();
  });

  it("keeps a recoverable invalid let's metadata visible without an invalid marker being required", () => {
    renderInspectorForBinding(["nui 3", "let base: number = 1", "let derived: number = @base"].join("\n"), "derived");

    expect(screen.getByText("derived")).toBeInTheDocument();
    expect(screen.queryByText("無効")).not.toBeInTheDocument();
  });

  it("shows the empty state when neither an element nor a binding is selected", () => {
    useCadDocumentStore.getState().commitText(["nui 3", "const width: number = 12"].join("\n"), "test");
    const handle = makeHandle();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    sourceEditorRef.current = handle;
    const elements = useCadDocumentStore.getState().elements;
    render(
      <InspectorPanel
        element={null}
        elements={elements}
        evaluation={evaluateElements(elements)}
        sourceEditorRef={sourceEditorRef}
      />,
    );

    expect(screen.getByText("要素を選択してください。")).toBeInTheDocument();
  });

  it("does not render a typed declaration section while an ordinary element is selected", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    renderInspector("B");

    expect(screen.queryByText("宣言")).not.toBeInTheDocument();
  });
});
