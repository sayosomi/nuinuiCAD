import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import type { EvaluationResult } from "../types/geometry";

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  errors: []
};

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    selectedElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    selectedDependencyJumpIndex: 0,
    showShortcutHelp: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: []
  });
};

const renderRightPanel = () =>
  render(
    <RightPanel
      evaluation={emptyEvaluation}
      isParameterEditMode={false}
      isDependencyJumpMode={false}
      registerParameterControl={() => undefined}
    />
  );

const renderLeftPanel = () =>
  render(
    <LeftPanel
      evaluation={emptyEvaluation}
      elementListFocusRef={createRef<HTMLDivElement>()}
    />
  );

const dragDataTransfer = () => {
  const data: Record<string, string> = {};
  return {
    dropEffect: "",
    effectAllowed: "",
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => {
      data[type] = value;
    }
  } as unknown as DataTransfer;
};

const dragNumericInput = (
  input: HTMLElement,
  {
    button = 1,
    fromX = 0,
    toX
  }: {
    button?: number;
    fromX?: number;
    toX: number;
  }
) => {
  fireEvent.pointerDown(input, { button, clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(input, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(input, { clientX: toX, pointerId: 1 });
};

describe("LeftPanel numeric input dragging", () => {
  beforeEach(() => {
    resetStore();
  });

  it("increments a numeric parameter after an 8px middle-button drag to the right", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 8 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 51 });
  });

  it("decrements a numeric parameter after an 8px middle-button drag to the left", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { fromX: 8, toX: 0 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 49 });
  });

  it("applies one parameter step for each full 8px of middle-button drag", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 16 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 52 });
  });

  it("does not change a numeric parameter below the drag threshold", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 7 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("ignores left-button drags", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { button: 0, toX: 16 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("uses the selected parameter's configured numeric step", () => {
    useCadStore.setState({
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 2.5 }
        },
        ...sampleElements.slice(1)
      ]
    });
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 8 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 52.5 });
  });
});

describe("LeftPanel element list dragging", () => {
  beforeEach(() => {
    resetStore();
  });

  it("reorders elements by dragging a handle before another row", () => {
    renderLeftPanel();
    const dataTransfer = dragDataTransfer();
    const handle = screen.getByLabelText("点Aを並び替え");
    const targetRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(targetRow).toBeInstanceOf(HTMLElement);

    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(targetRow!, { dataTransfer });
    fireEvent.drop(targetRow!, { dataTransfer });

    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      "point-b",
      "point-c",
      "point-a",
      "line-ab"
    ]);
    expect(useCadStore.getState().selectedElementId).toBe("point-a");
    expect(useCadStore.getState().past).toHaveLength(1);
  });
});
