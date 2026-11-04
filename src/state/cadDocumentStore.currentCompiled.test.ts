import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const valid = "nui 1\nline A = segment(start: (0, 0), end: (20, 0))";
const incomplete = `${valid}\nreverse ()`;
const expectExactCurrent = () => {
  const state = useCadDocumentStore.getState();
  expect(state).toHaveProperty("currentCompiled");
  expect(state.currentCompiled.spans.sourceMap.source).toBe(state.sourceText.replace(/\r\n/g, "\n"));
  expect(state.currentCompiled.spans.sourceMap.sourceRevision).toBe(state.currentSourceRevision);
  expect(state.currentCompiled.statementMap?.sourceRevision).toBe(state.currentSourceRevision);
  return state;
};

describe("CadDocumentStore exact-current authoring metadata", () => {
  beforeEach(() => useCadDocumentStore.setState(initialCadDocumentState()));

  it("retains fatal current compilation separately from last-good geometry through edits and undo/redo", () => {
    useCadDocumentStore.getState().replaceTextDocument(valid, { currentFilePath: null, dirtySinceSave: false });
    const good = expectExactCurrent();
    useCadDocumentStore.getState().commitText(incomplete, "editor");
    const fatal = expectExactCurrent();
    expect(fatal.currentCompiled.document).toBeNull();
    expect(fatal.doc).toBe(good.doc);
    expect(fatal.docText).toBe(valid);
    useCadDocumentStore.getState().undo();
    expect(expectExactCurrent().sourceText).toBe(valid);
    useCadDocumentStore.getState().redo();
    expect(expectExactCurrent().sourceText).toBe(incomplete);
  });

  it("keeps exact metadata at cold reset, preview, model edit and authoritative history boundaries", () => {
    useCadDocumentStore.getState().replaceTextDocument(incomplete, { currentFilePath: null, dirtySinceSave: false });
    expect(expectExactCurrent().currentCompiled.document).toBeNull();
    useCadDocumentStore.getState().replaceTextDocument(valid, { currentFilePath: null, dirtySinceSave: false });
    const canonical = expectExactCurrent().currentCompiled;
    useCadDocumentStore.getState().setSourceEditorPreviewText(valid.replace("20", "30"));
    expect(expectExactCurrent().currentCompiled).toBe(canonical);
    useCadDocumentStore.getState().setSourceEditorPreviewText(null);
    const state = expectExactCurrent();
    state.updateElement(state.elements[0]!.id, { name: "Renamed" });
    expect(expectExactCurrent().sourceText).toContain("Renamed");
    useCadDocumentStore.getState().reconcileAuthoritativeHistory(valid, "undo");
    expect(expectExactCurrent().sourceText).toBe(valid);
  });
});
