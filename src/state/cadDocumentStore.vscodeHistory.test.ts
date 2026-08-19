import { beforeEach, describe, expect, it } from "vitest";
import { clearCanvasSelection, selectElement } from "../commands/selectionCommands";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "./cadDocumentStore";

const sourceFor = (x: number) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
  { id: "c", name: "C", type: "freePoint", activity: "visible", x: 20, y: 0 }
]);

const reset = () => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  useCadDocumentStore.getState().replaceTextDocument(sourceFor(0), {
    currentFilePath: "/tmp/history.nui",
    dirtySinceSave: false
  });
  useCadDocumentStore.setState({ past: [], future: [] });
};

const ids = () => useCadDocumentStore.getState().elements.map((element) => element.id);

describe("VS Code Canvas selection history", () => {
  beforeEach(reset);

  it("records replace, toggle, range, and clear with exact primary and anchor fields", () => {
    const [a, b, c] = ids();
    selectElement(a!, "replace", true);
    selectElement(b!, "toggle", true);
    selectElement(c!, "range", true);

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: c,
      selectedElementIds: [b, c],
      selectionAnchorElementId: b
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(3);

    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: b,
      selectedElementIds: [a, b],
      selectionAnchorElementId: b
    });
    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: a,
      selectedElementIds: [a],
      selectionAnchorElementId: a
    });
    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: b,
      selectedElementIds: [a, b],
      selectionAnchorElementId: b
    });

    selectElement(c!, "range", true);
    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(false);
    selectElement(c!, "replace", true);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(4);
    clearCanvasSelection(true);
    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: c,
      selectedElementIds: [c],
      selectionAnchorElementId: c
    });
  });

  it("does not record a selection no-op and keeps outer source redo after a selection edit", () => {
    const [a, b] = ids();
    selectElement(a!, "replace", true);
    const before = useCadDocumentStore.getState().selectionPast.length;
    selectElement(a!, "replace", true);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(before);

    useCadDocumentStore.getState().commitText(sourceFor(1), "editor");
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    expect(useCadDocumentStore.getState().future).toHaveLength(0);

    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(0), "undo")).toBe("reconciled");
    selectElement(b!, "replace", true);
    expect(useCadDocumentStore.getState().future).toHaveLength(1);
    expect(useCadDocumentStore.getState().selectionFuture).toHaveLength(0);

    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(1), "redo")).toBe("reconciled");
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceFor(1));
  });

  it("keeps a new Source Editor edit as the normal source branch after native Undo", () => {
    useCadDocumentStore.getState().commitText(sourceFor(1), "editor");
    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(0), "undo")).toBe("reconciled");

    useCadDocumentStore.getState().commitText(sourceFor(2), "editor");

    expect(useCadDocumentStore.getState().future).toEqual([]);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceFor(2));
  });
});

describe("VS Code Canvas point-drag chronology", () => {
  beforeEach(reset);

  it("restores an unselected point's old selection before native source Redo", () => {
    const [a, b] = ids();
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(sourceFor(40), "editor");

    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(0), "undo")).toBe("reconciled");
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: a,
      selectedElementIds: [a],
      selectionAnchorElementId: a
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceFor(0));

    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(40), "redo")).toBe("reconciled");
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceFor(40));
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
  });

  it("keeps an already-selected point selected through one source Undo/Redo", () => {
    const [, b] = ids();
    useCadUiStore.getState().setSelectedElementId(b!);
    useCadDocumentStore.getState().commitText(sourceFor(40), "editor");

    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(0), "undo")).toBe("reconciled");
    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory(sourceFor(40), "redo")).toBe("reconciled");
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
  });

  it("fails closed when an authoritative source does not match the adjacent checkpoint", () => {
    useCadDocumentStore.getState().commitText(sourceFor(40), "editor");

    expect(useCadDocumentStore.getState().reconcileAuthoritativeHistory("nui 4\n// host won", "undo")).toBe("reset");
    expect(useCadDocumentStore.getState().sourceText).toBe("nui 4\n// host won");
    expect(useCadDocumentStore.getState().past).toEqual([]);
    expect(useCadDocumentStore.getState().future).toEqual([]);
    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);
  });
});
