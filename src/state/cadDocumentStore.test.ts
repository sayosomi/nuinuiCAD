import { beforeEach, describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { commitDocumentChangeAndSelect } from "../commands/commitDocumentChangeAndSelect";
import { activePrintLayout, DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import {
  effectiveElements,
  effectiveEvaluationLimitIndex,
  initialCadDocumentState,
  useCadDocumentStore
} from "./cadDocumentStore";
import { useCadUiStore } from "./cadUiStore";

describe("cadDocumentStore file state", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("marks committed edits, undo, and redo as dirty", () => {
    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(false);

    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);

    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);

    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
  });

  it("applies command selection after commit and preserves it across undo then redo", () => {
    const before = useCadDocumentStore.getState();
    const beforeSelection = {
      selectedElementId: before.elements[1].id,
      selectedElementIds: [before.elements[1].id],
      selectionAnchorElementId: before.elements[1].id
    };
    useCadUiStore.getState().applySelection(before.elements, beforeSelection);

    const afterSelection = {
      selectedElementId: before.elements[0].id,
      selectedElementIds: [before.elements[0].id],
      selectionAnchorElementId: before.elements[0].id
    };
    commitDocumentChangeAndSelect({
      elements: before.elements.map((element, index) =>
        index === 0 ? { ...element, locked: true } : element
      )
    }, afterSelection);

    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    expect(useCadUiStore.getState()).toMatchObject(afterSelection);

    useCadDocumentStore.getState().undo();
    expect(useCadUiStore.getState()).toMatchObject(beforeSelection);
    useCadDocumentStore.getState().redo();
    expect(useCadUiStore.getState()).toMatchObject(afterSelection);
  });

  it("leaves selection unchanged when a command commit is rejected", () => {
    const state = useCadDocumentStore.getState();
    const selection = {
      selectedElementId: state.elements[1].id,
      selectedElementIds: [state.elements[1].id],
      selectionAnchorElementId: state.elements[1].id
    };
    useCadUiStore.getState().applySelection(state.elements, selection);
    // dsl2-cutover: v1-literal — 意図的な構文エラー(未閉じ括弧)。
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (", "test");

    const result = commitDocumentChangeAndSelect(
      { elements: state.elements.map((element) => ({ ...element, locked: true })) },
      {
        selectedElementId: state.elements[0].id,
        selectedElementIds: [state.elements[0].id],
        selectionAnchorElementId: state.elements[0].id
      }
    );

    expect(result.status).toBe("rejected");
    expect(useCadUiStore.getState()).toMatchObject(selection);
  });

  it("replaces the document, resets history, and normalizes invalid selection", () => {
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    expect(useCadDocumentStore.getState().past).toHaveLength(1);

    useCadDocumentStore.getState().replaceDocument(
      {
        elements: [sampleElements[1]],
        palette: useCadDocumentStore.getState().palette,
        visibilityRoles: [],
        visibilityProfiles: [defaultVisibilityProfile()],
        activeVisibilityProfileId: defaultVisibilityProfile().id,
        printLayouts: [DEFAULT_PRINT_LAYOUT],
        activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
        evaluationLimitIndex: 999
      },
      "/tmp/loaded.nuinui.json"
    );

    expect(useCadDocumentStore.getState()).toMatchObject({
      elements: [sampleElements[1]],
      evaluationLimitIndex: 1,
      past: [],
      future: [],
      currentFilePath: "/tmp/loaded.nuinui.json",
      dirtySinceSave: false
    });
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[1].id],
      selectionAnchorElementId: sampleElements[1].id,
    });
  });

  it("keeps file state outside the compiled document", () => {
    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );

    expect(useCadDocumentStore.getState().doc.document).not.toHaveProperty("currentFilePath");
    expect(useCadDocumentStore.getState().doc.document).not.toHaveProperty("dirtySinceSave");
  });

  it("keeps drag previews outside the committed document, history, and shadow text", () => {
    const before = useCadDocumentStore.getState();
    const previewElements = before.elements.map((element) =>
      element.id === before.elements[0].id
        ? ({ ...element, locked: true } as typeof element)
        : element
    );

    useCadDocumentStore.getState().previewDocumentChange({ elements: previewElements });

    const after = useCadDocumentStore.getState();
    expect(after.elements).toBe(before.elements);
    expect(after.previewElements).toBe(previewElements);
    expect(effectiveElements(after)).toBe(previewElements);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.dirtySinceSave).toBe(before.dirtySinceSave);
    expect(after.sourceText).toBe(before.sourceText);
    expect(after.doc).toBe(before.doc);
    expect(effectiveEvaluationLimitIndex(after)).toBe(before.evaluationLimitIndex);
  });

  it("uses a preview evaluation divider only when the preview caller supplies one", () => {
    const state = useCadDocumentStore.getState();
    useCadDocumentStore.getState().previewDocumentChange({
      elements: state.elements,
      evaluationLimitIndex: 1
    });

    expect(effectiveEvaluationLimitIndex(useCadDocumentStore.getState())).toBe(1);
    useCadDocumentStore.getState().clearPreviewDocumentChange();
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadDocumentStore.getState().previewEvaluationLimitIndex).toBeNull();
    expect(effectiveEvaluationLimitIndex(useCadDocumentStore.getState())).toBe(state.evaluationLimitIndex);
  });

  it("projects valid source-editor preview text without changing canonical text or history", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 12, y: 0 }
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const before = useCadDocumentStore.getState();

    useCadDocumentStore.getState().setSourceEditorPreviewText(dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 15, y: 0 }
    ]));

    const during = useCadDocumentStore.getState();
    expect(during.sourceText).toBe(source);
    expect(during.compiledDocumentRevision).toBe(before.compiledDocumentRevision);
    expect(during.past).toBe(before.past);
    expect(effectiveElements(during).find((element) => element.name === "A")).toMatchObject({ x: 15 });
    useCadDocumentStore.getState().setSourceEditorPreviewText(null);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
  });

  it("clears previews after every completion path, including a no-op commit", () => {
    const preview = () =>
      useCadDocumentStore.getState().previewDocumentChange({
        elements: useCadDocumentStore.getState().elements.map((element) => ({ ...element }))
      });
    const expectPreviewCleared = () =>
      expect(useCadDocumentStore.getState().previewElements).toBeNull();

    preview();
    useCadDocumentStore.getState().commitDocumentChange({});
    expectPreviewCleared();
    expect(useCadDocumentStore.getState().past).toHaveLength(0);

    preview();
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    expectPreviewCleared();

    preview();
    useCadDocumentStore.getState().undo();
    expectPreviewCleared();

    preview();
    useCadDocumentStore.getState().redo();
    expectPreviewCleared();

    preview();
    useCadDocumentStore.getState().replaceDocument(
      useCadDocumentStore.getState().doc.document,
      null
    );
    expectPreviewCleared();
  });

  it("tracks palette edits in document history", () => {
    useCadDocumentStore.getState().setDefaultColorId("cut-red");

    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("cut-red");
    expect(useCadDocumentStore.getState().past).toHaveLength(1);

    useCadDocumentStore.getState().undo();

    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("pattern-black");
  });

  it("adds, switches, duplicates, and deletes print layouts in document history", () => {
    useCadDocumentStore.getState().addPrintLayout();

    expect(useCadDocumentStore.getState().printLayouts).toHaveLength(2);
    const addedLayoutId = useCadDocumentStore.getState().printLayouts[1].id;
    expect(useCadDocumentStore.getState().activePrintLayoutId).toBe(addedLayoutId);
    expect(activePrintLayout(
      useCadDocumentStore.getState().printLayouts,
      useCadDocumentStore.getState().activePrintLayoutId
    ).id).toBe(addedLayoutId);

    useCadDocumentStore.getState().updatePrintLayout({ name: "袖のみ", columns: 4 });
    expect(activePrintLayout(
      useCadDocumentStore.getState().printLayouts,
      useCadDocumentStore.getState().activePrintLayoutId
    ).name).toBe("袖のみ");

    useCadDocumentStore.getState().setActivePrintLayoutId("print-layout-1");
    expect(activePrintLayout(
      useCadDocumentStore.getState().printLayouts,
      useCadDocumentStore.getState().activePrintLayoutId
    ).id).toBe("print-layout-1");

    useCadDocumentStore.getState().duplicatePrintLayout("print-layout-1");
    expect(useCadDocumentStore.getState().printLayouts).toHaveLength(3);
    const duplicatedLayoutId = useCadDocumentStore.getState().activePrintLayoutId;
    expect(useCadDocumentStore.getState().printLayouts.some((layout) => layout.id === duplicatedLayoutId)).toBe(true);

    useCadDocumentStore.getState().deletePrintLayout(duplicatedLayoutId);
    expect(useCadDocumentStore.getState().printLayouts).toHaveLength(2);
    expect(useCadDocumentStore.getState().past.length).toBeGreaterThan(0);
  });

  it("clears element color ids when deleting a palette color", () => {
    useCadDocumentStore.setState({
      elements: [{ ...sampleElements[0], colorId: "cut-red" }, ...sampleElements.slice(1)]
    });

    useCadDocumentStore.getState().deletePaletteColor("cut-red");

    expect(useCadDocumentStore.getState().elements[0].colorId).toBeUndefined();
    expect(useCadDocumentStore.getState().palette.colors.some((color) => color.id === "cut-red")).toBe(false);
  });
});
