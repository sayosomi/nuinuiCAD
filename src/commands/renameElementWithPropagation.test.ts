import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { cancelStaleCommandLineSession, startCommandLineCreation } from "./commandLineSessionCommands";
import { assertRenameBridgeCommit } from "./renameBridgeDevAssert";
import { renameElementWithPropagation } from "./renameElementWithPropagation";

const seed = (sourceText: string) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
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
    const source = [
      "nui 1",
      "# keep this comment",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line L = A -> B # target comment",
      "",
      "point Derived = offset L.start dx=1 dy=0 # derived comment",
      "var Length = L.length # expression comment",
      "line Extended = extend L.end to=A",
      "# leave this alone"
    ].join("\n");
    seed(source);
    const before = useCadDocumentStore.getState().sourceText;

    expect(renameElementWithPropagation(elementId("L"), "Seam")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    expect(changedLines(before, after)).toEqual([5, 7, 8, 9]);
    expect(after).toContain("# keep this comment\n");
    expect(after).toContain("\n\npoint Derived");
    expect(after).toContain("# leave this alone");
    expect(useCadDocumentStore.getState().sourceUpdate).toMatchObject({
      revision: useCadDocumentStore.getState().sourceRevision,
      kind: "model-patch"
    });
  });

  it("patches a print layout block with a group rename while preserving unrelated lines", () => {
    const source = [
      "nui 1",
      "# unchanged before group",
      "group G {",
      "}",
      "",
      "printLayout Layout output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place G at=(0, 0) angle=0 mirrorX=false",
      "}",
      "# unchanged after layout"
    ].join("\n");
    seed(source);
    const before = useCadDocumentStore.getState().sourceText;

    expect(renameElementWithPropagation(elementId("G"), "Pattern")).toBe(true);

    const document = useCadDocumentStore.getState();
    const after = document.sourceText;
    // printLayout is patched as one block, although only its place line changes text.
    expect(changedLines(before, after)).toEqual([3, 7]);
    expect(document.sourceUpdate).toMatchObject({
      kind: "model-patch",
      splices: expect.arrayContaining([expect.objectContaining({ startLine: 6, endLine: 8 })])
    });
    expect(after).toContain("# unchanged before group");
    expect(after).toContain("# unchanged after layout");
  });

  it("flushes pending text, then analyzes and patches the flushed document", () => {
    seed("nui 1\npoint A = (0, 0)\npoint User = offset A dx=1 dy=0");
    const id = elementId("A");
    let pending = true;
    unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush: () => {
        pending = false;
        useCadDocumentStore.getState().commitText(
          "nui 1\npoint A = (0, 0)\npoint User = offset A dx=9 dy=0",
          "editor"
        );
        return "flushed";
      }
    });

    expect(renameElementWithPropagation(id, "Renamed")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain("offset Renamed dx=9");
    // The typing burst and the rename are distinct commits; the rename itself is one entry.
    expect(useCadDocumentStore.getState().past).toHaveLength(2);
  });

  it("rejects composition and error-source requests without a rename mutation", () => {
    seed("nui 1\npoint A = (0, 0)");
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
    seed("nui 1\npoint A = (");
    const errorBefore = useCadDocumentStore.getState();
    expect(renameElementWithPropagation(id, "Broken")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(errorBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(errorBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("DSLテキストにエラー");
  });

  it("rejects a collision without changing selection or history, then permits a retry", () => {
    seed("nui 1\npoint A = (0, 0)\npoint B = (1, 0)");
    const id = elementId("A");
    useCadUiStore.getState().setSelectedElementIds([id]);
    const selectionBefore = useCadUiStore.getState().selectedElementIds;
    const documentBefore = useCadDocumentStore.getState();

    expect(renameElementWithPropagation(id, "B")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(documentBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(documentBefore.past);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("3行目");

    expect(renameElementWithPropagation(id, "Renamed")).toBe(true);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === id)?.name).toBe("Renamed");
  });

  it("uses one rename snapshot, restores text and selection through undo/redo, and stales an active session", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint User = offset A dx=1 dy=0";
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
    const before = compileDslDocument("nui 1\npoint A = (0, 0)\npoint User = offset A dx=1 dy=0");
    const after = compileDslDocument("nui 1\npoint A = (0, 0)\npoint User = offset A dx=2 dy=0");
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
