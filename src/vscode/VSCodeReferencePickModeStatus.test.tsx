import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { compileDslDocument } from "../dsl/dslDocument";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { VSCodeReferencePickModeStatus } from "./VSCodeReferencePickModeStatus";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";

const source = [
  "nui 1",
  "line AB = segment(start: @A, end: @B)",
  "line AC = segment(start: @A, end: @C)",
  "point Cross = intersection(",
  "  line1: @AB,",
  "  line2: @AC,",
  "  index: 0,",
  "  extensions: false",
  ")"
].join("\n");

const sourceRevision = 17;
const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
const compiled = compileDslDocument(source, {
  preparsed: parsed,
  assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `status-test:${index}`]))
});
const targetPosition = source.indexOf("@AB") + 1;
const target = queryDslReferencePickTarget({
  source: { normalizedSource: source, sourceRevision },
  position: targetPosition,
  semantic: { sourceRevision, sourceText: source, compiled }
});

if (!target) throw new Error("status fixture did not produce a Reference Pick target");

const sessionFor = (overrides: Partial<VscodeReferencePickCanvasSession> = {}) => ({
  request: {
    requestId: 1,
    documentUri: "file:///status.nui",
    documentVersion: 1,
    targetProof: {}
  },
  target,
  candidates: [],
  draft: {
    expectedGeometryInterface: target.expectedGeometryInterface,
    role: target.role,
    multiplicity: target.multiplicity,
    hover: null,
    draftReferences: [{ base: "AB" }],
    numericProperty: null,
    status: "active"
  },
  ...overrides
} as unknown as VscodeReferencePickCanvasSession);

describe("VSCodeReferencePickModeStatus", () => {
  it("projects the exact-current Cross / line1 target and canonical draft into the shared shell", () => {
    const onFinish = vi.fn();
    render(
      <VSCodeReferencePickModeStatus
        session={sessionFor()}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={onFinish}
      />
    );

    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    expect(screen.getByText("Cross / line1")).toBeInTheDocument();
    expect(screen.getByText("Canvasから線を選択")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@AB");
    expect(screen.queryByLabelText("選択済み 1 件")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "選択を完了" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["point", "Canvasから点を選択"],
    ["line", "Canvasから線を選択"]
  ] as const)("uses the Canvas-only instruction for a single %s Reference Pick", (kind, instruction) => {
    const view = render(
      <VSCodeReferencePickModeStatus
        session={sessionFor({
          target: { ...target, expectedGeometryInterface: kind }
        })}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={vi.fn()}
      />
    );

    expect(screen.getByText(instruction)).toBeInTheDocument();
    view.unmount();
  });

  it("projects multiple references into the shared ordered draft controls", () => {
    const onMoveDraftEntry = vi.fn();
    const onRemoveDraftEntry = vi.fn();
    const view = render(
      <VSCodeReferencePickModeStatus
        session={sessionFor({
          target: { ...target, multiplicity: "multiple" },
          draft: {
            expectedGeometryInterface: target.expectedGeometryInterface,
            role: target.role,
            multiplicity: "multiple",
            hover: null,
            draftReferences: [{ base: "AB" }, { base: "AC" }, { base: "AB", pointKey: "start" }],
            numericProperty: null,
            status: "active"
          }
        })}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={vi.fn()}
        onMoveDraftEntry={onMoveDraftEntry}
        onRemoveDraftEntry={onRemoveDraftEntry}
      />
    );

    expect(screen.getByLabelText("選択済み 3 件")).toHaveTextContent("@AB");
    expect(screen.getByLabelText("選択済み 3 件")).toHaveTextContent("@AC");
    expect(screen.queryByLabelText("現在の選択")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "@ACを上へ移動" }));
    fireEvent.click(screen.getByRole("button", { name: "@ABを削除" }));
    expect(onMoveDraftEntry).toHaveBeenCalledWith('["AC",null]', 0);
    expect(onRemoveDraftEntry).toHaveBeenCalledWith('["AB",null]');
    view.unmount();
  });

  it("shows a complete canonical numeric-property expression", () => {
    const numericSession = sessionFor({
      target: {
        ...target,
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        numericProperty: { kind: "propertySelectionRequired" }
      },
      draft: {
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        multiplicity: "single",
        hover: null,
        draftReferences: [],
        numericProperty: {
          target: { kind: "propertySelectionRequired" },
          stage: "draft",
          selectedGeometry: { candidateElementId: "AB", reference: { base: "AB" } },
          properties: ["length"],
          draft: { candidateElementId: "AB", reference: { base: "AB" }, property: "length" }
        },
        status: "active"
      }
    });

    render(
      <VSCodeReferencePickModeStatus
        session={numericSession}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={vi.fn()}
      />
    );

    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@AB.length");
    expect(screen.queryByLabelText("選択済み 1 件")).toBeNull();
  });

  it("isolates the shared Source panel from the overlay capture listeners while keeping Finish usable", () => {
    const onFinish = vi.fn();
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const viewport = document.createElement("div");
    viewport.tabIndex = 0;
    document.body.append(viewport);

    const view = render(
      <>
        <VSCodeReferencePickModeStatus
          session={sessionFor()}
          context={{
            source: { normalizedSource: source, sourceRevision },
            compiled
          }}
          onFinish={onFinish}
        />
        <VSCodeReferencePickOverlay
          canvasFocusRef={{ current: viewport }}
          viewportSize={{ width: 640, height: 480 }}
          canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
          canvasTheme={LEGACY_CANVAS_THEME}
          elements={[]}
          evaluation={emptyEvaluationResult([])}
          visibilityProfiles={[]}
          activeVisibilityProfileId={null}
          session={sessionFor()}
          onHover={onHover}
          onSelect={onSelect}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
      { container: viewport }
    );

    const finish = screen.getByRole("button", { name: "選択を完了" });
    fireEvent.pointerMove(finish, { clientX: 20, clientY: 20 });
    expect(onHover).not.toHaveBeenCalled();

    fireEvent.pointerDown(finish, { button: 0, clientX: 20, clientY: 20 });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(finish);
    expect(onFinish).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(onSelect).toHaveBeenCalledTimes(1);

    view.unmount();
    viewport.remove();
  });
});
