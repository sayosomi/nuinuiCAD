import { beforeEach, describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import {
  currentDocumentSnapshot,
  effectiveElements,
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
        printLayout: DEFAULT_PRINT_LAYOUT,
        evaluationLimitIndex: 999,
        selectedElementId: "missing",
        selectedElementIds: ["missing"],
        selectionAnchorElementId: "missing",
        selectedParameterKey: "x"
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
      selectedParameterKey: "name"
    });
  });

  it("does not include file state in document snapshots", () => {
    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );

    expect(currentDocumentSnapshot(useCadDocumentStore.getState(), useCadUiStore.getState())).not.toHaveProperty("currentFilePath");
    expect(currentDocumentSnapshot(useCadDocumentStore.getState(), useCadUiStore.getState())).not.toHaveProperty("dirtySinceSave");
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
      currentDocumentSnapshot(useCadDocumentStore.getState(), useCadUiStore.getState()),
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
    expect(useCadDocumentStore.getState().printLayout.id).toBe(addedLayoutId);

    useCadDocumentStore.getState().updatePrintLayout({ name: "袖のみ", columns: 4 });
    expect(useCadDocumentStore.getState().printLayout.name).toBe("袖のみ");

    useCadDocumentStore.getState().setActivePrintLayoutId("print-layout-1");
    expect(useCadDocumentStore.getState().printLayout.id).toBe("print-layout-1");

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
