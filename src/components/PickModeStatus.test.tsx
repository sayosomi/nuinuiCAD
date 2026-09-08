import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PickModeStatus } from "./PickModeStatus";
import { pickModeSessionForTarget } from "../model/pickModeSession";
import { referenceAnchor } from "../model/pointAnchors";

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

  it("shows the first four draft line names and the remaining count", () => {
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
    for (const name of ["線1", "線2", "線3", "線4"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText("線5")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
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

});
