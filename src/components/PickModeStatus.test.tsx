import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PickModeStatus } from "./PickModeStatus";

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
    useCadUiStore.setState({
      activeLinePickTarget: {
        elementId: target.id,
        parameterKey: "baseLineIds",
        draftLineIds: lines.map((item) => item.id)
      }
    });

    render(<PickModeStatus />);

    expect(screen.getByLabelText("選択済み 5 件")).toBeInTheDocument();
    expect(screen.getByTitle("⌘Enter / Ctrl+Enter で選択を完了")).toHaveTextContent("⌘↵");
    for (const name of ["線1", "線2", "線3", "線4"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText("線5")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("stays hidden while template insertion drives its own virtual-target picks", () => {
    useCadUiStore.setState({
      activeTemplateInsertion: {
        template: {
          id: "template",
          name: "袖",
          rootGroupId: "group",
          elements: [],
          inputs: [{ id: "point:p", kind: "point", label: "基準点", sourceElementId: "p" }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        inputValues: { "point:p": "" },
        currentInputId: "point:p",
        insertionIndex: 0,
        sourceInsertion: null,
        error: null
      },
      activePointPickTarget: {
        elementId: "__template-insertion-pick__",
        parameterKey: "point:p",
        insertionIndex: 0
      }
    });

    render(<PickModeStatus />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
