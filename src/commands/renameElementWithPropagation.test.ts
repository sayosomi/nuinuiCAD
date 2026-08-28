import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { cancelStaleCommandLineSession, startCommandLineCreation } from "./commandLineSessionCommands";
import { assertRenameBridgeCommit } from "./renameBridgeDevAssert";
import { renameElementWithPropagation } from "./renameElementWithPropagation";

const seed = (sourceText: string) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
  publishTestCanvasSelectionEligibility();
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
};

const elementId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

const changedLines = (before: string, after: string) => before.split("\n").flatMap((line, index) =>
  line === after.split("\n")[index] ? [] : [index + 1]
);

describe("renameElementWithPropagation", () => {
  let unregister = () => {};

  beforeEach(() => {
    unregister = () => {};
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => unregister());

  it("patches only target and direct, derived, and expression reference statements", () => {
    // Written in v2's canonical vertical-call shape (one arg per physical
    // line) on purpose: renameElementWithPropagation's dev assertion requires
    // an in-place line patch, so a source statement that isn't already
    // canonical (e.g. a compact single-line call) would force the patcher to
    // insert/remove lines to reach canonical shape on any text change.
    const source = [
      "nui 4",
      "// keep this comment",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(",
      "  x: 10,",
      "  y: 0,",
      ")",
      "line L = segment(",
      "  start: @A,",
      "  end: @B,",
      ") // target comment",
      "",
      "point Derived = offset(",
      "  from: @L.start,",
      "  dx: 1,",
      "  dy: 0,",
      ") // derived comment",
      "point LengthUser = offset(",
      "  from: @A,",
      "  dx: @L.length,",
      "  dy: 0,",
      ") // expression comment",
      "extend(",
      "  end: @L.end,",
      "  to: @A,",
      ")",
      "// leave this alone"
    ].join("\n");
    seed(source);
    const before = useCadDocumentStore.getState().sourceText;

    expect(renameElementWithPropagation(elementId("L"), "Seam")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    expect(changedLines(before, after)).toEqual([11, 17, 23, 27]);
    expect(after).toContain("// keep this comment\n");
    expect(after).toContain("\n\npoint Derived");
    expect(after).toContain("// leave this alone");
    expect(useCadDocumentStore.getState().sourceUpdate).toMatchObject({
      revision: useCadDocumentStore.getState().sourceRevision,
      kind: "model-patch"
    });
  });

  it("patches a layout block with a group rename while preserving unrelated lines", () => {
    const source = [
      "nui 4",
      "// unchanged before group",
      "group G {",
      "}",
      "",
      "layout Layout {",
      "  place @G(",
      "    at: (0, 0),",
      "    angle: 0,",
      "    mirror: false,",
      "    )",
      "}",
      "// unchanged after layout"
    ].join("\n");
    seed(source);
    const before = useCadDocumentStore.getState().sourceText;

    expect(renameElementWithPropagation(elementId("G"), "Pattern")).toBe(true);

    const document = useCadDocumentStore.getState();
    const after = document.sourceText;
    // The layout is patched as one block, although only its place reference changes text.
    expect(changedLines(before, after)).toEqual([3, 7]);
    expect(document.sourceUpdate).toMatchObject({
      kind: "model-patch",
      splices: expect.arrayContaining([expect.objectContaining({ startLine: 6, endLine: 12 })])
    });
    expect(after).toContain("// unchanged before group");
    expect(after).toContain("// unchanged after layout");
  });

  it("treats an already canonical same-name rename as a successful no-op", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    seed(source);
    const id = elementId("A");
    useCadUiStore.getState().setSelectedElementIds([id]);
    useCadUiStore.getState().setCommandErrorMessage("previous error");
    const before = useCadDocumentStore.getState();
    const selectionBefore = useCadUiStore.getState().selectedElementIds;

    expect(renameElementWithPropagation(id, "A")).toBe(true);

    const after = useCadDocumentStore.getState();
    expect(after.sourceText).toBe(before.sourceText);
    expect(after.past).toBe(before.past);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.sourceUpdate).toBe(before.sourceUpdate);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
  });

  it("preserves a noncanonical same-name line without a bridge commit or dev assertion", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0) // hand-written spacing";
    seed(source);
    const id = elementId("A");
    const before = useCadDocumentStore.getState();

    expect(renameElementWithPropagation(id, "A")).toBe(true);

    const after = useCadDocumentStore.getState();
    expect(after.sourceText).toBe(source);
    expect(after.past).toBe(before.past);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.sourceUpdate).toBe(before.sourceUpdate);
  });

  it("keeps only the dirty-buffer flush history and revision when its name is unchanged", () => {
    seed("nui 4\npoint A = coordinate(x: 0, y: 0)");
    const id = elementId("A");
    let pending = true;
    let flushedState: ReturnType<typeof useCadDocumentStore.getState> | null = null;
    const flushedText = "nui 4\npoint A = coordinate(x: 5, y: 5)";
    unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush: () => {
        pending = false;
        useCadDocumentStore.getState().commitText(flushedText, "editor");
        flushedState = useCadDocumentStore.getState();
        return "flushed";
      }
    });

    expect(renameElementWithPropagation(id, "A")).toBe(true);

    const after = useCadDocumentStore.getState();
    expect(flushedState).not.toBeNull();
    expect(after.sourceText).toBe(flushedText);
    expect(after.past).toBe(flushedState!.past);
    expect(after.past).toHaveLength(1);
    expect(after.sourceRevision).toBe(flushedState!.sourceRevision);
    expect(after.sourceUpdate).toBe(flushedState!.sourceUpdate);
    expect(after.sourceUpdate.kind).toBe("editor");
  });

  it("flushes pending text, then analyzes and patches the flushed document", () => {
    seed("nui 4\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\npoint User = offset(\n  from: @A,\n  dx: 1,\n  dy: 0\n)");
    const id = elementId("A");
    let pending = true;
    unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush: () => {
        pending = false;
        useCadDocumentStore.getState().commitText(
          "nui 4\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\npoint User = offset(\n  from: @A,\n  dx: 9,\n  dy: 0\n)",
          "editor"
        );
        return "flushed";
      }
    });

    expect(renameElementWithPropagation(id, "Renamed")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain("from: @Renamed");
    expect(useCadDocumentStore.getState().sourceText).toContain("dx: 9");
    // The typing burst && the rename are distinct commits; the rename itself is one entry.
    expect(useCadDocumentStore.getState().past).toHaveLength(2);
  });

  it("rejects composition and error-source requests without a rename mutation", () => {
    seed("nui 4\npoint A = coordinate(x: 0, y: 0)");
    const id = elementId("A");
    const compositionBefore = useCadDocumentStore.getState();
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush: () => "blocked-composition"
    });

    expect(renameElementWithPropagation(id, "Blocked")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(compositionBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(compositionBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("日本語入力");

    unregister();
    seed("nui 4\npoint A = coordinate(");
    const errorBefore = useCadDocumentStore.getState();
    expect(renameElementWithPropagation(id, "Broken")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(errorBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(errorBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("DSLテキストにエラー");
  });

  it("rejects a collision without changing selection or history, then permits a retry", () => {
    seed("nui 4\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\npoint B = coordinate(\n  x: 1,\n  y: 0\n)");
    const id = elementId("A");
    useCadUiStore.getState().setSelectedElementIds([id]);
    const selectionBefore = useCadUiStore.getState().selectedElementIds;
    const documentBefore = useCadDocumentStore.getState();

    expect(renameElementWithPropagation(id, "B")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(documentBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(documentBefore.past);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("6行目");

    expect(renameElementWithPropagation(id, "Renamed")).toBe(true);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === id)?.name).toBe("Renamed");
  });

  it("uses one rename snapshot, restores text and selection through undo/redo, and stales an active session", () => {
    const source = "nui 4\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\npoint User = offset(\n  from: @A,\n  dx: 1,\n  dy: 0\n)";
    seed(source);
    const id = elementId("A");
    useCadUiStore.getState().setSelectedElementIds([id]);
    expect(startCommandLineCreation("freePoint")).toBe(true);
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(renameElementWithPropagation(id, "Renamed")).toBe(true);
    const renamed = useCadDocumentStore.getState().sourceText;
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    expect(useCadUiStore.getState().selectedElementId).toBe(id);
    expect(cancelStaleCommandLineSession()).toBe(true);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadUiStore.getState().selectedElementId).toBe(id);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(renamed);
    expect(useCadUiStore.getState().selectedElementId).toBe(id);
  });
});

describe("assertRenameBridgeCommit", () => {
  it("fails in development for fallback, patch-line, and reference-stability violations", () => {
    const before = compileDslDocument("nui 4\npoint A = coordinate(x: 0, y: 0)\npoint User = offset(from: @A, dx: 1, dy: 0)");
    const after = compileDslDocument("nui 4\npoint A = coordinate(x: 0, y: 0)\npoint User = offset(from: @A, dx: 2, dy: 0)");
    expect(before.document).not.toBeNull();
    expect(after.document).not.toBeNull();

    expect(() => assertRenameBridgeCommit({
      before,
      after,
      expectedPatchedLines: [2],
      beforeSourceRevision: 4,
      afterSourceRevision: 6,
      sourceUpdate: { revision: 5, kind: "model-patch", splices: [{ startLine: 2, endLine: 2, replacementLines: ["x"] }] }
    })).toThrow("cannot be matched");
    expect(() => assertRenameBridgeCommit({
      before,
      after,
      expectedPatchedLines: [2],
      beforeSourceRevision: 4,
      afterSourceRevision: 5,
      sourceUpdate: { revision: 5, kind: "reset" }
    })).toThrow("fell back");
    expect(() => assertRenameBridgeCommit({
      before,
      after,
      expectedPatchedLines: [2],
      beforeSourceRevision: 4,
      afterSourceRevision: 5,
      sourceUpdate: { revision: 5, kind: "model-patch", splices: [{ startLine: 3, endLine: 3, replacementLines: ["x"] }] }
    })).toThrow("unexpected lines");
    expect(() => assertRenameBridgeCommit({
      before,
      after,
      expectedPatchedLines: [2],
      beforeSourceRevision: 4,
      afterSourceRevision: 5,
      sourceUpdate: { revision: 5, kind: "model-patch", splices: [{ startLine: 2, endLine: 2, replacementLines: ["x"] }] }
    })).toThrow("changed reference resolution");
  });
});
