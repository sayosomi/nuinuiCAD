import { describe, expect, it } from "vitest";
import {
  canvasModalCanvasCommandAllowed,
  canvasModalCanvasOperationAllowed,
  canvasModalModeFor,
  pickModeCanvasCommandAllowed,
  pickModeCanvasCommandAllowedForActive,
  pickModeCanvasOperationAllowed,
  pickModeCanvasOperationForCommand
} from "./pickModeCanvasPolicy";

const activeSession = {
  kind: "point" as const,
  targetElementId: "target",
  targetParameterKey: "point",
  selectionCardinality: "single" as const,
  draft: []
};

describe("Pick Mode Canvas operation policy", () => {
  it.each([
    ["create-coordinate-point", false],
    ["normal-selection", false],
    ["rectangle-selection", false],
    ["point-drag", false],
    ["bezier-drag", false],
    ["clear-selection", false],
    ["document-mutation", false],
    ["workflow-start", false],
    ["undo", false],
    ["redo", false],
    ["pan", true],
    ["zoom", true],
    ["reset-view", true],
    ["fit-drawing", true],
    ["presentation-toggle", true],
    ["pick", true],
    ["reveal", true],
    ["focus", true]
  ] as const)("classifies %s as %s while Pick is active", (operation, allowed) => {
    expect(pickModeCanvasOperationAllowed(operation, activeSession)).toBe(allowed);
  });

  it("allows every operation when Pick is inactive", () => {
    expect(pickModeCanvasOperationAllowed("document-mutation", null)).toBe(true);
    expect(pickModeCanvasOperationAllowed("undo", undefined)).toBe(true);
  });

  it.each([
    ["clearCanvasSelection", "clear-selection"],
    ["resetCanvasView", "reset-view"],
    ["fitDrawing", "fit-drawing"],
    ["toggleCanvasPointNames", "presentation-toggle"],
    ["toggleCanvasGrid", "presentation-toggle"],
    ["configureCanvasGrid", "presentation-toggle"],
    ["toggleCanvasGridSnap", "presentation-toggle"],
    ["editCanvasRibbon", "workflow-start"],
    ["zoomInCanvas", "zoom"],
    ["undo", "undo"],
    ["redo", "redo"],
    ["applySelectedPickCandidate", "pick"],
    ["cancelPickMode", "pick"],
    ["addLine", "document-mutation"]
  ] as const)("classifies Canvas command %s as %s", (commandId, operation) => {
    expect(pickModeCanvasOperationForCommand(commandId)).toBe(operation);
  });

  it("keeps Pick commands available while rejecting ordinary Canvas commands", () => {
    expect(pickModeCanvasCommandAllowed("applySelectedPickCandidate", activeSession)).toBe(true);
    expect(pickModeCanvasCommandAllowed("finishPickMode", activeSession)).toBe(true);
    expect(pickModeCanvasCommandAllowed("cancelPickMode", activeSession)).toBe(true);
    expect(pickModeCanvasCommandAllowed("fitDrawing", activeSession)).toBe(true);
    expect(pickModeCanvasCommandAllowed("editCanvasRibbon", activeSession)).toBe(false);
    expect(pickModeCanvasCommandAllowed("clearCanvasSelection", activeSession)).toBe(false);
    expect(pickModeCanvasCommandAllowed("undo", activeSession)).toBe(false);
    expect(pickModeCanvasCommandAllowed("addLine", activeSession)).toBe(false);
  });

  it("applies the same command classification to an externally active Source Pick", () => {
    expect(pickModeCanvasCommandAllowedForActive("applySelectedPickCandidate", true)).toBe(true);
    expect(pickModeCanvasCommandAllowedForActive("fitDrawing", true)).toBe(true);
    expect(pickModeCanvasCommandAllowedForActive("clearCanvasSelection", true)).toBe(false);
    expect(pickModeCanvasCommandAllowedForActive("undo", true)).toBe(false);
    expect(pickModeCanvasCommandAllowedForActive("addLine", true)).toBe(false);
    expect(pickModeCanvasCommandAllowedForActive("addLine", false)).toBe(true);
  });

  it("allows only coordinate-point creation, navigation, presentation, focus, and history in coordinate mode", () => {
    const mode = canvasModalModeFor({ pickModeActive: false, coordinatePointCreationActive: true });
    expect(mode).toBe("coordinate-point-creation");
    for (const operation of ["create-coordinate-point", "pan", "zoom", "reset-view", "fit-drawing", "presentation-toggle", "focus", "undo", "redo"] as const) {
      expect(canvasModalCanvasOperationAllowed(operation, mode)).toBe(true);
    }
    for (const operation of ["normal-selection", "rectangle-selection", "point-drag", "bezier-drag", "clear-selection", "document-mutation", "workflow-start", "pick", "reveal"] as const) {
      expect(canvasModalCanvasOperationAllowed(operation, mode)).toBe(false);
    }
    expect(canvasModalCanvasCommandAllowed("undo", mode)).toBe(true);
    expect(canvasModalCanvasCommandAllowed("redo", mode)).toBe(true);
    expect(canvasModalCanvasCommandAllowed("clearCanvasSelection", mode)).toBe(false);
    expect(canvasModalModeFor({ pickModeActive: true, coordinatePointCreationActive: true })).toBe("pick");
  });
});
