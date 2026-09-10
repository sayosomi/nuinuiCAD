import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PickModeStatus, PickModeStatusView } from "./PickModeStatus";
import { pickModeSessionForTarget } from "../model/pickModeSession";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";

const line = (id: string, name: string): CadElement => ({
  id,
  name,
  type: "line",
  activity: "visible",
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  endPoint: { mode: "coordinate", x: 10, y: 0 }
});

describe("PickModeStatus", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("stays hidden when a semantic target is only pick-capable", () => {
    const activeLinePickTarget = {
      elementId: "offset",
      parameterKey: "baseLineIds",
      selectionCardinality: "ordered-multiple" as const
    };
    useCadUiStore.setState({ activeLinePickTarget });

    render(<PickModeStatus />);

    expect(screen.queryByText("PICK MODE")).not.toBeInTheDocument();
  });

  it("shows the complete ordered draft in exact order", () => {
    const lines = Array.from({ length: 5 }, (_, index) => line(`line-${index + 1}`, `線${index + 1}`));
    const target: CadElement = {
      id: "offset",
      name: "オフセット線",
      type: "offsetLine",
      activity: "visible",
      baseLineIds: [],
      offset: 10,
      side: "left",
      closed: false
    };
    useCadDocumentStore.setState({ elements: [...lines, target] });
    const activeLinePickTarget = {
        elementId: target.id,
        parameterKey: "baseLineIds",
        selectionCardinality: "ordered-multiple" as const
    };
    useCadUiStore.setState({
      activeLinePickTarget,
      activePickModeSession: pickModeSessionForTarget("line", activeLinePickTarget, "ordered-multiple", lines.map((item) => ({
        kind: "line" as const,
        key: item.id,
        lineId: item.id
      })))
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("選択済み 5 件")).toBeInTheDocument();
    expect(screen.getByTitle("Enter で選択を完了")).toHaveTextContent("↵");
    for (const name of ["線1", "線2", "線3", "線4", "線5"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("uses native ordered-draft controls and restores focus through shared draft mutations", () => {
    const lines = Array.from({ length: 3 }, (_, index) => line(`line-${index + 1}`, `線${index + 1}`));
    const target: CadElement = {
      id: "offset",
      name: "オフセット線",
      type: "offsetLine",
      activity: "visible",
      baseLineIds: [],
      offset: 10,
      side: "left",
      closed: false
    };
    const activeLinePickTarget = {
      elementId: target.id,
      parameterKey: "baseLineIds",
      selectionCardinality: "ordered-multiple" as const
    };
    useCadDocumentStore.setState({ elements: [...lines, target] });
    useCadUiStore.setState({
      activeLinePickTarget,
      activePickModeSession: pickModeSessionForTarget("line", activeLinePickTarget, "ordered-multiple", lines.map((item) => ({
        kind: "line" as const,
        key: item.id,
        lineId: item.id
      })))
    });

    render(<PickModeStatus />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).not.toHaveAttribute("tabindex");
      expect(within(row).getAllByRole("button")).toHaveLength(3);
    }
    expect(screen.getByRole("button", { name: "線1を上へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "線1を下へ移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線1を削除" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線2を上へ移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線2を下へ移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線2を削除" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線3を上へ移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "線3を下へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "線3を削除" })).toBeEnabled();

    fireEvent.keyDown(rows[1]!, { key: "ArrowDown" });
    expect(useCadUiStore.getState().activePickModeSession?.draft.map((entry) => entry.key)).toEqual([
      "line-1",
      "line-2",
      "line-3"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "線3を上へ移動" }));
    expect(useCadUiStore.getState().activePickModeSession?.draft.map((entry) => entry.key)).toEqual([
      "line-1",
      "line-3",
      "line-2"
    ]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "線3を上へ移動" }));

    fireEvent.click(screen.getByRole("button", { name: "線3を下へ移動" }));
    expect(useCadUiStore.getState().activePickModeSession?.draft.map((entry) => entry.key)).toEqual([
      "line-1",
      "line-2",
      "line-3"
    ]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "線3を削除" }));

    fireEvent.click(screen.getByRole("button", { name: "線2を削除" }));
    expect(useCadUiStore.getState().activePickModeSession?.draft.map((entry) => entry.key)).toEqual([
      "line-1",
      "line-3"
    ]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "線3を削除" }));

    fireEvent.click(screen.getByRole("button", { name: "線3を削除" }));
    expect(useCadUiStore.getState().activePickModeSession?.draft.map((entry) => entry.key)).toEqual([
      "line-1"
    ]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "線1を削除" }));

    fireEvent.click(screen.getByRole("button", { name: "線1を削除" }));
    expect(useCadUiStore.getState().activePickModeSession?.draft).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "選択を完了" }));
  });

  it("keeps ordered-draft wheel input local without preventing native scrolling", () => {
    const ancestorWheel = vi.fn();

    render(
      <div onWheel={ancestorWheel}>
        <PickModeStatusView
          model={{
            targetLabel: "Cross / line1",
            instruction: "Canvasから線を選択",
            orderedDraft: {
              entries: [{ key: "line-1", label: "線1" }],
              count: 1,
              onMove: vi.fn(),
              onRemove: vi.fn()
            },
            onFinish: vi.fn()
          }}
        />
      </div>
    );

    const actionButton = screen.getByRole("button", { name: "線1を削除" });
    const wheelEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 24 });
    actionButton.dispatchEvent(wheelEvent);

    expect(ancestorWheel).not.toHaveBeenCalled();
    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  it("finishes the exact order currently shown by the panel", () => {
    const lines = [line("line-1", "線1"), line("line-2", "線2")];
    const target: CadElement = {
      id: "offset",
      name: "オフセット線",
      type: "offsetLine",
      activity: "visible",
      baseLineIds: [],
      offset: 10,
      side: "left",
      closed: false
    };
    const activeLinePickTarget = {
      elementId: target.id,
      parameterKey: "baseLineIds",
      selectionCardinality: "ordered-multiple" as const
    };
    useCadDocumentStore.setState({ elements: [...lines, target] });
    useCadUiStore.setState({
      activeLinePickTarget,
      activePickModeSession: pickModeSessionForTarget("line", activeLinePickTarget, "ordered-multiple", lines.map((item) => ({
        kind: "line" as const,
        key: item.id,
        lineId: item.id
      })))
    });

    render(<PickModeStatus />);
    fireEvent.click(screen.getByRole("button", { name: "線1を下へ移動" }));
    fireEvent.click(screen.getByRole("button", { name: "選択を完了" }));

    expect(useCadDocumentStore.getState().elements.find((element) => element.id === target.id)).toMatchObject({
      baseLineIds: ["line-2", "line-1"]
    });
    expect(useCadUiStore.getState().activePickModeSession).toBeNull();
  });

  it("shows a virtual ordered point-list session from the shared draft", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "points",
      selectionCardinality: "ordered-multiple" as const
    };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target, "ordered-multiple", [{
        kind: "point",
        key: "point",
        anchor: referenceAnchor("point-a")
      }])
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("選択済み 1 件")).toBeInTheDocument();
    expect(screen.getByText("__command-line__ / points")).toBeInTheDocument();
  });

  it("shows a virtual ordered line-list session from the shared draft", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "baseLineIds",
      selectionCardinality: "ordered-multiple" as const
    };
    useCadUiStore.setState({
      activeLinePickTarget: target,
      activePickModeSession: pickModeSessionForTarget("line", target, "ordered-multiple", [{
        kind: "line",
        key: "line",
        lineId: "line-a"
      }])
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("選択済み 1 件")).toBeInTheDocument();
    expect(screen.getByText("__command-line__ / baseLineIds")).toBeInTheDocument();
  });

  it("shows the current single point draft using its source identity", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "point"
    };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target, "single", [{
        kind: "point",
        key: "point-ref",
        anchor: derivedAnchor("runtime-line", "start"),
        sourceReference: { base: "I::Out", pointKey: "start" }
      }])
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@I::Out.start");
  });

  it("shows the current single line draft using its source identity", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "line"
    };
    useCadUiStore.setState({
      activeLinePickTarget: target,
      activePickModeSession: pickModeSessionForTarget("line", target, "single", [{
        kind: "line",
        key: "line-ref",
        lineId: "runtime-line",
        sourceReference: { base: "I::Out" }
      }])
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@I::Out");
  });

  it("shows the complete current numeric-reference expression", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "length",
      mode: "replace" as const,
      property: "length" as const
    };
    const expression = "@I::Out.length + 12.5";
    useCadUiStore.setState({
      activeNumericReferencePickTarget: target,
      activePickModeSession: pickModeSessionForTarget("numeric-reference", target, "single", [{
        kind: "numeric-reference",
        key: "numeric-ref",
        expression
      }])
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("現在の選択")).toHaveTextContent(expression);
  });

  it("does not fabricate a current value for empty single or numeric drafts", () => {
    const target = {
      elementId: "__command-line__",
      parameterKey: "point"
    };
    useCadUiStore.setState({
      activePointPickTarget: target,
      activePickModeSession: pickModeSessionForTarget("point", target)
    });

    const { unmount } = render(<PickModeStatus />);
    expect(screen.queryByLabelText("現在の選択")).not.toBeInTheDocument();
    unmount();

    const lineTarget = {
      elementId: "__command-line__",
      parameterKey: "line"
    };
    useCadUiStore.setState({
      activeLinePickTarget: lineTarget,
      activePickModeSession: pickModeSessionForTarget("line", lineTarget)
    });

    const { unmount: unmountLine } = render(<PickModeStatus />);
    expect(screen.queryByLabelText("現在の選択")).not.toBeInTheDocument();
    unmountLine();

    const numericTarget = {
      elementId: "__command-line__",
      parameterKey: "length",
      mode: "replace" as const,
      property: "length" as const
    };
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: numericTarget,
      activePickModeSession: pickModeSessionForTarget("numeric-reference", numericTarget)
    });

    render(<PickModeStatus />);
    expect(screen.queryByLabelText("現在の選択")).not.toBeInTheDocument();
  });

  it("uses an externally supplied Finish callback through the shared view", () => {
    const onFinish = vi.fn();

    render(
      <PickModeStatusView
        model={{
          targetLabel: "Cross / line1",
          instruction: "Canvasから線を選択",
          currentSelection: "@AB",
          onFinish
        }}
      />
    );

    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    expect(screen.getByText("Cross / line1")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@AB");
    fireEvent.click(screen.getByRole("button", { name: "選択を完了" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["point", "Canvasから点を選択"],
    ["line", "Canvasから線を選択"]
  ] as const)("uses the Canvas-only instruction for a single %s Pick", (kind, instruction) => {
    const target = kind === "point"
      ? { elementId: "__command-line__", parameterKey: "point" as const }
      : { elementId: "__command-line__", parameterKey: "line" as const };
    useCadUiStore.setState({
      activePointPickTarget: kind === "point" ? target : null,
      activeLinePickTarget: kind === "line" ? target : null,
      activePickModeSession: pickModeSessionForTarget(kind, target)
    });

    render(<PickModeStatus />);

    expect(screen.getByText(instruction)).toBeInTheDocument();
  });

});
