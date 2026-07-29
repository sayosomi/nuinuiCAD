import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { buildConditionalGroupConditionsByElementId } from "../geometry/controlBooleanRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import { createCadElement } from "../model/elementFactory";
import { sampleElements } from "../sampleData";
import { initialCadDocumentState, useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
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
  jumpToPropertyBindingValue: vi.fn(() => true),
  jumpToTemplateHole: vi.fn(() => true),
  selectSourceSpan: vi.fn(() => true),
  jumpToParameterValue: vi.fn(() => true),
  applyPickCandidate: vi.fn(() => true),
  pickCandidateElementIds: vi.fn(() => []),
  openTextSearch: vi.fn(),
  closeTextSearch: vi.fn(),
  runtimeDiagnostics: vi.fn(() => []),
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

  it("shows referenced element names rather than internal IDs in parameter rows", () => {
    const { elements } = renderInspector("AB");
    const pointA = elements.find((candidate) => candidate.name === "A")!;
    const pointB = elements.find((candidate) => candidate.name === "B")!;
    const parameterGroup = screen.getByText("パラメーター").closest(".dependency-group")!;
    if (!(parameterGroup instanceof HTMLElement)) throw new Error("Missing parameter group");
    const startRow = within(parameterGroup).getByText("始点").closest(".inspector-row")!;
    const endRow = within(parameterGroup).getByText("終点").closest(".inspector-row")!;
    if (!(startRow instanceof HTMLElement) || !(endRow instanceof HTMLElement)) {
      throw new Error("Missing point reference row");
    }

    expect(within(startRow).getByText("A")).toBeInTheDocument();
    expect(within(endRow).getByText("B")).toBeInTheDocument();
    expect(startRow).not.toHaveTextContent(pointA.id);
    expect(endRow).not.toHaveTextContent(pointB.id);
  });

  it("resolves line, line-endpoint, and line-list references through one Inspector name lookup", () => {
    const intersection = createCadElement("intersectionPoint", sampleElements, {
      createId: () => "intersection-internal-id",
    });
    const division = createCadElement("lineDivisionPoint", sampleElements, {
      createId: () => "division-internal-id",
    });
    const offset = createCadElement("offsetLine", sampleElements, {
      createId: () => "offset-internal-id",
    });

    let view = renderInspectorElement(intersection, [...sampleElements, intersection]);
    expect(within(screen.getByText("線1").closest(".inspector-row")!).getByText("直線AB")).toBeInTheDocument();
    expect(within(screen.getByText("線2").closest(".inspector-row")!).getByText("直線BC")).toBeInTheDocument();
    view.unmount();

    view = renderInspectorElement(division, [...sampleElements, division]);
    expect(within(screen.getByText("端点").closest(".inspector-row")!).getByText("直線AB.start")).toBeInTheDocument();
    view.unmount();

    view = renderInspectorElement(offset, [...sampleElements, offset]);
    expect(within(screen.getByText("基準線").closest(".inspector-row")!).getByText("直線AB")).toBeInTheDocument();
    view.unmount();
  });

  it("shows unresolved references without exposing their internal IDs", () => {
    const line = {
      ...sampleElements.find((candidate) => candidate.type === "line")!,
      id: "line-with-missing-reference",
      name: "未解決の線",
      startPoint: { mode: "reference" as const, pointId: "missing-point-internal-id" },
    };
    const { unmount } = renderInspectorElement(line, [...sampleElements, line]);
    const startRow = screen.getByText("始点").closest(".inspector-row")!;
    if (!(startRow instanceof HTMLElement)) throw new Error("Missing start-point row");

    expect(within(startRow).getByText("未解決")).toBeInTheDocument();
    expect(startRow).not.toHaveTextContent("missing-point-internal-id");
    unmount();
  });

  it("selects and jumps to a clicked dependency row", () => {
    const { elements, handle } = renderInspector("AB");
    const pointA = elements.find((element) => element.name === "A")!;
    const parentGroup = screen.getByText("親要素").closest(".dependency-group")!;
    if (!(parentGroup instanceof HTMLElement)) throw new Error("Missing parent group");
    fireEvent.click(within(parentGroup).getByText("A").closest(".inspector-row")!);
    expect(useCadUiStore.getState().selectedElementId).toBe(pointA.id);
    expect(handle.jumpToElement).toHaveBeenCalledWith(pointA.id);
  });

  it("does not show escaped braces or typed template holes as unresolved geometry parents", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "const length: number = 12.3456",
      'const label: string = "前身頃"',
      'text Label = label(text: "\\{draft\\} {@label} {@length}" anchor: none size: 3)'
    ].join("\n"), "test");
    const elements = useCadDocumentStore.getState().elements;
    const label = elements.find((element) => element.name === "Label")!;
    const { unmount } = renderInspectorElement(label, elements);

    const parentGroup = screen.getByText("親要素").closest(".dependency-group");
    if (!(parentGroup instanceof HTMLElement)) throw new Error("Missing parent group");
    expect(within(parentGroup).getByText("親要素はありません。")).toBeInTheDocument();
    expect(within(parentGroup).queryByText(/未解決: (draft|label|length)/)).not.toBeInTheDocument();
    unmount();
  });

  it("shows a text template's raw source escapes instead of a re-serialized value", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      'const label: string = "前身頃"',
      'text Label = label(text: "\\{draft\\} {@label}\\n" anchor: none size: 3)'
    ].join("\n"), "test");
    const elements = useCadDocumentStore.getState().elements;
    const label = elements.find((element) => element.name === "Label")!;
    const { unmount } = renderInspectorElement(label, elements);

    const textRow = screen.getByText("テキスト").closest(".inspector-row");
    if (!(textRow instanceof HTMLElement)) throw new Error("Missing text row");
    expect(within(textRow).getByText("\\{draft\\} {@label}\\n")).toBeInTheDocument();
    expect(within(textRow).queryByText("\\\\{draft\\\\}")).not.toBeInTheDocument();
    unmount();
  });

  it("shows template source and its fresh runtime result without altering escapes or newlines", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "const length: number = 12.3456",
      'const label: string = "前身頃"',
      "point A = coordinate(x: 0 y: 0)",
      'text Label = label(text: "\\{draft\\} {@label} {@length}\\n" anchor: A size: 3)',
    ].join("\n"), "test");
    const state = useCadDocumentStore.getState();
    const textTemplates = buildTextTemplateEntriesByElementId({
      textTemplates: state.doc.textTemplates!,
      elementIdByStatementIndex: state.doc.statementMap.elementIdByStatementIndex,
    });
    const evaluation = evaluateElements(state.elements, {
      scalarProgram: state.doc.scalarProgram,
      textTemplateEntriesByElementId: textTemplates,
    });
    const label = state.elements.find((element) => element.name === "Label")!;
    const { unmount } = renderInspectorElement(label, state.elements);
    unmount();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    sourceEditorRef.current = makeHandle();
    const view = render(
      <InspectorPanel element={label} elements={state.elements} evaluation={evaluation} sourceEditorRef={sourceEditorRef} />,
    );

    const sourceRow = screen.getByText("テキスト（ソース）").closest(".inspector-row");
    const resultRow = screen.getByText("評価結果").closest(".inspector-row");
    const parameterList = sourceRow?.closest(".dependency-list");
    if (!(sourceRow instanceof HTMLElement) || !(resultRow instanceof HTMLElement) || !(parameterList instanceof HTMLElement)) {
      throw new Error("Missing text Inspector rows");
    }

    expect(sourceRow.parentElement?.parentElement).toBe(parameterList);
    expect(resultRow.parentElement?.parentElement).toBe(parameterList);
    expect(screen.getByText("\\{draft\\} {@label} {@length}\\n")).toBeInTheDocument();
    expect(resultRow.textContent).toBe("評価結果{draft} 前身頃 12.346\n");
    view.unmount();
  });

  it("keeps matching literal text as one row and hides stale runtime text", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "point A = coordinate(x: 0 y: 0)",
      'text Bare = label(text: "前身頃" anchor: A size: 3)',
    ].join("\n"), "test");
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const bare = state.elements.find((element) => element.name === "Bare")!;
    const sourceEditorRef = createRef<SourceEditorHandle>();
    sourceEditorRef.current = makeHandle();
    const view = render(
      <InspectorPanel element={bare} elements={state.elements} evaluation={evaluation} sourceEditorRef={sourceEditorRef} />,
    );

    expect(screen.getByText("テキスト")).toBeInTheDocument();
    expect(screen.queryByText("テキスト（ソース）")).not.toBeInTheDocument();
    expect(screen.queryByText("評価結果")).not.toBeInTheDocument();
    view.unmount();

    render(
      <InspectorPanel element={bare} elements={state.elements} evaluation={evaluation} isEvaluationStale sourceEditorRef={sourceEditorRef} />,
    );
    expect(screen.getByText("テキスト")).toBeInTheDocument();
    expect(screen.queryByText("評価結果")).not.toBeInTheDocument();
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

      act(() => {
        useCadUiStore.setState({
          activePointPickTarget: null,
          activeLinePickTarget: null,
          activeNumericReferencePickTarget: null,
        });
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

describe("InspectorPanel runtime values (Task 45)", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  const evaluateOptionsFor = (state: CadDocumentState): EvaluateElementsOptions => ({
    evaluationLimitIndex: state.doc.document.evaluationLimitIndex,
    scalarProgram: state.doc.scalarProgram,
    bindingVersions: state.doc.bindingVersions,
    statementInfoByElementId: state.doc.statementMap.byElementId,
    statementIdByStatementIndex: state.doc.statementMap.statementIdByStatementIndex,
    conditionalOwnerStatementIdByElementId: state.doc.bindingVersions
      ? conditionalOwnerIdByElementId(buildConditionalMutationOwners(
          state.doc.bindingVersions, state.doc.document.elements, state.doc.statementMap.byElementId,
          state.doc.statementMap.statementIdByStatementIndex
        ))
      : undefined,
    forGroupMutationOwnerByElementId: state.doc.bindingVersions
      ? forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
          state.doc.bindingVersions, state.doc.document.elements, state.doc.statementMap.byElementId,
          state.doc.statementMap.statementIdByStatementIndex
        ))
      : undefined,
    conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
      state.doc.conditionalGroupConditions ?? new Map(),
      state.doc.statementMap.elementIdByStatementIndex
    )
  });

  const renderInspectorForRuntimeBinding = (
    source: string,
    bindingName: string,
    props: { isEvaluationStale?: boolean } = {}
  ) => {
    useCadDocumentStore.getState().commitText(source, "test");
    const state = useCadDocumentStore.getState();
    const bindingId = state.doc.bindingAnalysis!.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === bindingName
    )!.id;
    useCadUiStore.getState().setSelectedBindingId(bindingId);
    const handle = makeHandle();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    sourceEditorRef.current = handle;
    const evaluation = evaluateElements(state.elements, evaluateOptionsFor(state));
    const view = render(
      <InspectorPanel
        element={null}
        elements={state.elements}
        evaluation={evaluation}
        isEvaluationStale={props.isEvaluationStale ?? false}
        sourceEditorRef={sourceEditorRef}
      />
    );
    return { bindingId, handle, unmount: view.unmount };
  };

  it("shows the final value and jumps to the initializer when the value row is clicked", () => {
    const { handle, bindingId } = renderInspectorForRuntimeBinding(
      ["nui 3", "let total: number = 1", "set total = 5"].join("\n"),
      "total"
    );

    expect(within(screen.getByText("最終値").closest(".inspector-row")!).getByText("5")).toBeInTheDocument();
    expect(screen.getByText("set履歴")).toBeInTheDocument();

    fireEvent.click(screen.getByText("最終値").closest(".inspector-row")!);
    expect(handle.jumpToBindingDeclarationPart).toHaveBeenCalledWith(bindingId, "initializer");
  });

  it("shows poisoned status and a diagnostic message when the final value is a runtime error", () => {
    renderInspectorForRuntimeBinding(["nui 3", "const bad: number = 1 / 0"].join("\n"), "bad");

    expect(within(screen.getByText("最終値").closest(".inspector-row")!).getByText("無効(poisoned)")).toBeInTheDocument();
    expect(screen.getByText("実行時値").closest(".dependency-group")!.querySelector(".inspector-diagnostic.error")).not.toBeNull();
  });

  it("shows unknown instead of the last value when the evaluation is stale, and hides consumer rows", () => {
    renderInspectorForRuntimeBinding(
      ["nui 3", "let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n"),
      "印刷",
      { isEvaluationStale: true }
    );

    expect(within(screen.getByText("最終値").closest(".inspector-row")!).getByText("不明(評価待ち)")).toBeInTheDocument();
    expect(screen.queryByText("参照元")).not.toBeInTheDocument();
  });

  it("lists a consumer row and jumps to its exact property value span when clicked", () => {
    const { handle } = renderInspectorForRuntimeBinding(
      ["nui 3", "let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n"),
      "印刷"
    );

    expect(screen.getByText("参照元")).toBeInTheDocument();
    const row = screen.getByText("G").closest(".inspector-row")!;
    fireEvent.click(row);

    expect(useCadUiStore.getState().selectedElementId).not.toBeNull();
    expect(handle.jumpToPropertyBindingValue).toHaveBeenCalled();
  });
});
