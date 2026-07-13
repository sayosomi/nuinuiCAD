import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { evaluateElements } from "../geometry/evaluate";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { InspectorPanel } from "./InspectorPanel";

const source = [
  "nui 1",
  "point A = (0, 0)",
  "point B = offset A dx=10 dy=20",
  "line AB = A -> B"
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

const renderInspector = (elementName: string) => {
  const elements = useCadDocumentStore.getState().elements;
  const element = elements.find((candidate) => candidate.name === elementName)!;
  const handle = makeHandle();
  const sourceEditorRef = createRef<SourceEditorHandle>();
  sourceEditorRef.current = handle;
  render(
    <InspectorPanel
      element={element}
      elements={elements}
      evaluation={evaluateElements(elements)}
      sourceEditorRef={sourceEditorRef}
    />
  );
  return { element, elements, handle };
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
      parameterKey: "dx"
    });
    expect(handle.jumpToParameterValue).not.toHaveBeenCalled();
  });
});
