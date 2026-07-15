import { beforeEach, describe, expect, it } from "vitest";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  applyPickedLine,
  applyPickedNumericReference,
  applyPickedPoint,
  applySelectedPickCandidate,
  finishLinePick,
  selectPickCandidateByOffset
} from "./pickCommands";
import {
  cancelCommandLineStepEdit,
  confirmCommandLineSession,
  skipCommandLineStep,
  startCommandLineCreation,
  startCommandLineStepEdit,
  startCommandLineNumericReferencePick,
  submitCommandLineInput
} from "./commandLineSessionCommands";
import { COMMAND_LINE_PICK_TARGET_ID } from "./commandLinePickRouting";

const source = [
  "nui 1",
  "point A = (0, 0)",
  "point B = (100, 0)",
  "line AB = A -> B"
].join("\n");

const byName = (name: string) => {
  const element = useCadDocumentStore.getState().elements.find((item) => item.name === name);
  if (!element) throw new Error(`Missing ${name}`);
  return element;
};

describe("command-line pick routing", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
  });

  it("fills point, endpoint, line, line-list, and numeric steps without mutating the document", () => {
    const pointA = byName("A");
    const pointB = byName("B");
    const line = byName("AB");
    const beforeText = useCadDocumentStore.getState().sourceText;
    const beforePast = useCadDocumentStore.getState().past.length;

    expect(startCommandLineCreation("line")).toBe(true);
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({
      elementId: COMMAND_LINE_PICK_TARGET_ID,
      parameterKey: "startPoint",
      insertionIndex: 3
    });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual(referenceAnchor(pointA.id));
    expect(useCadUiStore.getState().activePointPickTarget?.parameterKey).toBe("endPoint");
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(useCadUiStore.getState().commandLineSession?.args.endPoint).toEqual(referenceAnchor(pointB.id));
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();

    expect(startCommandLineCreation("lineDivisionPoint")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: derivedAnchor(line.id, "start") });
    expect(useCadUiStore.getState().commandLineSession?.args.endpoint).toEqual({
      lineId: line.id,
      endpointKey: "start"
    });

    expect(startCommandLineCreation("splitLine")).toBe(true);
    applyPickedLine({ pickedLineId: line.id });
    expect(useCadUiStore.getState().commandLineSession?.args.baseLineId).toBe(line.id);

    expect(startCommandLineCreation("offsetLine")).toBe(true);
    applyPickedLine({ pickedLineId: line.id });
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([line.id]);
    finishLinePick();
    expect(useCadUiStore.getState().commandLineSession?.args.baseLineIds).toEqual([line.id]);
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();

    expect(startCommandLineCreation("angleLengthLine")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(startCommandLineNumericReferencePick()).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      parameterKey: "angleDeg",
      property: "startTangentAngleDeg"
    });
    applyPickedNumericReference({ numericReferenceExpression: `${line.id}.length` });

    expect(startCommandLineNumericReferencePick()).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      parameterKey: "length",
      property: "length"
    });
    applyPickedNumericReference({ numericReferenceExpression: `${line.id}.length` });
    expect(useCadUiStore.getState().commandLineSession?.args.angleDeg).toEqual({
      kind: "expression",
      expression: `${line.id}.length`
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(beforeText);
    expect(useCadDocumentStore.getState().past).toHaveLength(beforePast);
  });

  it("uses the existing pick cursor acceptance path and clears draft state on re-entry", () => {
    const line = byName("AB");
    const beforePast = useCadDocumentStore.getState().past.length;
    const beforeText = useCadDocumentStore.getState().sourceText;

    expect(startCommandLineCreation("line")).toBe(true);
    selectPickCandidateByOffset(1);
    expect(useCadUiStore.getState().activePickCursor).not.toBeNull();
    applySelectedPickCandidate();
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual(referenceAnchor(byName("A").id));

    expect(startCommandLineCreation("offsetLine")).toBe(true);
    applyPickedLine({ pickedLineId: line.id });
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([line.id]);
    expect(startCommandLineCreation("line")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      recipe: { type: "line" },
      currentStepIndex: 0,
      args: {}
    });
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activePickCursor).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(beforeText);
    expect(useCadDocumentStore.getState().past).toHaveLength(beforePast);
  });

  it("keeps completed progress isolated while every pick route edits a step", () => {
    const pointA = byName("A");
    const pointB = byName("B");
    const line = byName("AB");

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    const completedLine = useCadUiStore.getState().commandLineSession!;

    expect(startCommandLineStepEdit(0)).toBe(true);
    selectPickCandidateByOffset(1);
    applySelectedPickCandidate();
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completedLine.currentStepIndex,
      editingStepIndex: null,
      args: { endPoint: referenceAnchor(pointB.id) }
    });
    expect(startCommandLineStepEdit(1)).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completedLine.currentStepIndex,
      editingStepIndex: null,
      args: { startPoint: referenceAnchor(pointA.id), endPoint: referenceAnchor(pointB.id) }
    });

    expect(startCommandLineCreation("lineDivisionPoint")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: derivedAnchor(line.id, "start") });
    expect(submitCommandLineInput("0.5")).toBe(true);
    expect(skipCommandLineStep()).toBe(true);
    const completedDivision = useCadUiStore.getState().commandLineSession!;
    expect(startCommandLineStepEdit(1)).toBe(true);
    expect(startCommandLineNumericReferencePick()).toBe(true);
    applyPickedNumericReference({ numericReferenceExpression: `${line.id}.length` });
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completedDivision.currentStepIndex,
      editingStepIndex: null,
      args: {
        endpoint: { lineId: line.id, endpointKey: "start" },
        ratio: { kind: "expression", expression: `${line.id}.length` }
      }
    });
    expect(startCommandLineStepEdit(1)).toBe(true);
    expect(skipCommandLineStep()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completedDivision.currentStepIndex,
      editingStepIndex: null,
      args: { endpoint: { lineId: line.id, endpointKey: "start" }, ratio: 1 }
    });

    expect(startCommandLineCreation("offsetLine")).toBe(true);
    applyPickedLine({ pickedLineId: line.id });
    finishLinePick();
    expect(submitCommandLineInput("5")).toBe(true);
    expect(skipCommandLineStep()).toBe(true);
    const completedOffset = useCadUiStore.getState().commandLineSession!;
    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.editingDraft).not.toBe(
      completedOffset.args.baseLineIds
    );
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([line.id]);
    applyPickedLine({ pickedLineId: line.id });
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([]);
    expect(useCadUiStore.getState().commandLineSession?.args.baseLineIds).toEqual([line.id]);
    expect(cancelCommandLineStepEdit()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completedOffset.currentStepIndex,
      editingStepIndex: null,
      args: { baseLineIds: [line.id] }
    });
  });

  it("normalizes generated forGroup references with the planned parent group and no target metadata", () => {
    const elements: CadElement[] = [
      {
        id: "loop", name: "繰り返し", type: "forGroup", visible: true, enabled: true,
        variableName: "i", start: 0, count: 2, step: 1, showGenerated: true
      },
      {
        id: "point-template", name: "", type: "freePoint", visible: true, enabled: true,
        parentGroupId: "loop", x: 0, y: 0
      },
      {
        id: "inside", name: "内側", type: "offsetPoint", visible: true, enabled: true,
        parentGroupId: "loop", fromPoint: referenceAnchor("point-template"), dx: 10, dy: 0
      }
    ];
    useCadDocumentStore.setState({ elements, sourceRevision: 10 });
    useCadUiStore.getState().setGroupFold("loop", { expanded: true });

    expect(startCommandLineCreation("line", { currentCursorElementId: () => "inside" })).toBe(true);
    expect(useCadUiStore.getState().activePointPickTarget).toEqual({
      elementId: COMMAND_LINE_PICK_TARGET_ID,
      parameterKey: "startPoint",
      insertionIndex: 2
    });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor("point-template@loop:1") });
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual(referenceAnchor("point-template"));
    applyPickedPoint({ pickedPointAnchor: { mode: "coordinate", x: 20, y: 0 } });
    expect(skipCommandLineStep()).toBe(true);
    expect(confirmCommandLineSession()).toBe(true);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === "point-template")?.name).toBe("点");
  });
});
