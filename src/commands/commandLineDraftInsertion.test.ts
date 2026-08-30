import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import {
  confirmCommandLineSession,
  startCommandLineCreation,
  submitCommandLineInput
} from "./commandLineSessionCommands";

describe("command-line creation: draft (incomplete) statement insertion", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Anchors the session at the physical end of the current document, mirroring
   * the other Source-Editor-anchored tests in commandLineSessionCommands.test.ts. */
  const startAnchored = (type: Parameters<typeof startCommandLineCreation>[0]) => {
    const document = useCadDocumentStore.getState();
    const lineCount = document.sourceText.split("\n").length;
    return startCommandLineCreation(type, {
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: lineCount,
        lineCount,
        elementId: null
      })
    });
  };

  it("inserts a fully-blank segment line as a draft skeleton, in one undo entry", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(startAnchored("line")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true); // name
    expect(submitCommandLineInput("")).toBe(true); // start
    expect(submitCommandLineInput("")).toBe(true); // end
    expect(confirmCommandLineSession()).toBe(true);

    const document = useCadDocumentStore.getState();
    expect(document.past.length).toBe(pastBefore + 1);
    expect(document.sourceText).toContain([
      "line = segment(",
      "  start: ,",
      "  end: ,",
      ")"
    ].join("\n"));
    // Nothing compiles into an element for a wholly blank statement, so the
    // usual post-creation "select the new element" step never applies.
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("renders a blank lineReferenceList as `sources: `, never `sources: []`, end to end", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startAnchored("offsetLine")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true); // name
    expect(submitCommandLineInput("")).toBe(true); // sources
    expect(submitCommandLineInput("")).toBe(true); // distance
    expect(confirmCommandLineSession()).toBe(true);

    const sourceText = useCadDocumentStore.getState().sourceText;
    expect(sourceText).toContain("sources: ,");
    expect(sourceText).not.toContain("sources: []");
  });

  it("keeps a declared numeric default genuinely blank inside an otherwise-blank draft", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startAnchored("divisionPoint")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true); // name
    expect(submitCommandLineInput("")).toBe(true); // startPoint - blank
    expect(submitCommandLineInput("")).toBe(true); // endPoint - blank
    expect(submitCommandLineInput("")).toBe(true); // ratio - declared default remains genuinely blank
    expect(confirmCommandLineSession()).toBe(true);

    const sourceText = useCadDocumentStore.getState().sourceText;
    expect(sourceText).toContain("start: ,");
    expect(sourceText).toContain("end: ,");
    expect(sourceText).toContain("ratio: ,");
  });

  it("does not block confirmation on an unresolved value, and commits the raw expression as-is", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startAnchored("freePoint")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true); // name - blank
    expect(submitCommandLineInput("@doesNotExist + 5")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true); // y - blank
    expect(confirmCommandLineSession()).toBe(true);

    expect(useCadDocumentStore.getState().sourceText).toContain("x: @doesNotExist + 5");
  });

  it("reports diagnostics for the incomplete statement through the normal compile pipeline", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startAnchored("line")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(confirmCommandLineSession()).toBe(true);

    expect(useCadDocumentStore.getState().diagnostics.length).toBeGreaterThan(0);
  });

  it("moves Source Editor focus to the end of the inserted draft, without touching Canvas selection", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 4", "point A = coordinate(x: 0, y: 0)"].join("\n"),
      "test"
    );
    publishTestCanvasSelectionEligibility();
    const pointA = useCadDocumentStore.getState().elements[0]!;
    useCadUiStore.getState().setSelectedElementId(pointA.id);

    const focusSourceEditorAtLineEnd = vi.fn();
    const document = useCadDocumentStore.getState();
    expect(startCommandLineCreation("line", {
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 2,
        lineCount: document.sourceText.split("\n").length,
        elementId: pointA.id
      })
    })).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(confirmCommandLineSession({ focusSourceEditorAtLineEnd })).toBe(true);

    // 4 inserted lines: header, start, end, close.
    expect(focusSourceEditorAtLineEnd).toHaveBeenCalledTimes(1);
    const calledLine = focusSourceEditorAtLineEnd.mock.calls[0]![0] as number;
    const lines = useCadDocumentStore.getState().sourceText.split("\n");
    expect(lines[0]).toBe("nui 4");
    expect(lines[1]).toBe("point A = coordinate(x: 0, y: 0)");
    expect(lines[calledLine - 1]).toBe(")");

    expect(useCadUiStore.getState().selectedElementId).toBe(pointA.id);
  });

  it("indents a blank-completing draft one level inside an existing group", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 4", "group G {", "  point A = coordinate(x: 0, y: 0)", "}"].join("\n"),
      "test"
    );
    const group = useCadDocumentStore.getState().elements.find((element) => element.type === "group")!;
    useCadUiStore.getState().setGroupFold(group.id, { expanded: true });
    const pointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    const document = useCadDocumentStore.getState();
    const cursorLine = document.sourceText.split("\n").findIndex((line) => line.includes("point A")) + 1;

    expect(startCommandLineCreation("line", {
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: cursorLine,
        lineCount: document.sourceText.split("\n").length,
        elementId: pointA.id
      })
    })).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(confirmCommandLineSession()).toBe(true);

    const sourceText = useCadDocumentStore.getState().sourceText;
    expect(sourceText).toContain([
      "  line = segment(",
      "    start: ,",
      "    end: ,",
      "  )"
    ].join("\n"));
  });

  it("blocks a blank-completing draft when there is no known Source Editor insertion line", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startCommandLineCreation("line")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);
    expect(submitCommandLineInput("")).toBe(true);

    const sourceBefore = useCadDocumentStore.getState().sourceText;
    expect(confirmCommandLineSession()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(useCadUiStore.getState().commandLineSession?.error).toContain("Source Editor");
  });

  it("still commits a fully-filled creation without a known Source Editor insertion line (regression)", () => {
    useCadDocumentStore.getState().commitText("nui 4", "test");
    expect(startCommandLineCreation("freePoint")).toBe(true);
    submitCommandLineInput("");
    submitCommandLineInput("1");
    submitCommandLineInput("2");

    expect(confirmCommandLineSession()).toBe(true);
    expect(useCadDocumentStore.getState().elements).toHaveLength(1);
  });
});
