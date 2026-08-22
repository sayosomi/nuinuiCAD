import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { commitDocumentChangeAndSelect } from "../commands/commitDocumentChangeAndSelect";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import { isGroupElement, isGroupExpanded } from "../model/groups";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  initialCadDocumentState,
  useCadDocumentStore
} from "./cadDocumentStore";
import { useCadUiStore } from "./cadUiStore";
import {
  abortBenchmarkSample,
  beginBenchmarkSample,
  beginPreviewMutation,
  beginRustRoundTrip,
  beginSourceChange,
  capturePointerMoveEntry,
  claimPointerMoveEntry,
  drainCompletedBenchmarkSamples
} from "../performance/benchmarkInstrumentation";

describe("cadDocumentStore file state", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  afterEach(() => {
    abortBenchmarkSample();
    drainCompletedBenchmarkSamples();
  });

  it("starts and binds source timing only for editor-origin commits", () => {
    beginBenchmarkSample("source-edit-v1");
    const source = dslTextForElements([
      { id: "editor-point", name: "EditorPoint", type: "freePoint", activity: "visible", x: 10, y: 0 }
    ]);

    useCadDocumentStore.getState().commitText(source, "editor");

    expect(beginSourceChange()).toBeNull();
    expect(beginRustRoundTrip(useCadDocumentStore.getState().elements)).not.toBeNull();
  });

  it("does not let a non-editor commit claim a source sample before an editor commit", () => {
    beginBenchmarkSample("source-edit-v1");
    const fileSource = dslTextForElements([
      { id: "file-point", name: "FilePoint", type: "freePoint", activity: "visible", x: 1, y: 0 }
    ]);
    const editorSource = dslTextForElements([
      { id: "editor-point", name: "EditorPoint", type: "freePoint", activity: "visible", x: 2, y: 0 }
    ]);

    useCadDocumentStore.getState().commitText(fileSource, "file");
    useCadDocumentStore.getState().commitText(editorSource, "editor");

    expect(beginSourceChange()).toBeNull();
    expect(beginRustRoundTrip(useCadDocumentStore.getState().elements)).not.toBeNull();
  });

  it("starts preview timing and binds elements only after a matching point claim", () => {
    beginBenchmarkSample("point-drag-v1");
    const firstPreviewElements = useCadDocumentStore.getState().elements.map((element) => ({ ...element }));

    expect(useCadDocumentStore.getState().previewDocumentChange({ elements: firstPreviewElements })).toEqual({
      status: "applied"
    });
    expect(beginPreviewMutation()).toBeNull();

    const pointerEntry = capturePointerMoveEntry();
    expect(claimPointerMoveEntry(pointerEntry, "point")).toBe(true);

    const matchingPreviewElements = useCadDocumentStore.getState().elements.map((element) => ({
      ...element,
      ...(element.type === "freePoint" && typeof element.x === "number" ? { x: element.x + 1 } : {})
    }));
    expect(useCadDocumentStore.getState().previewDocumentChange({ elements: matchingPreviewElements })).toEqual({
      status: "applied"
    });
    expect(beginRustRoundTrip(matchingPreviewElements)).not.toBeNull();
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
        index === 1 ? { ...element, activity: "disabled" } : element
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
      { elements: state.elements.map((element) => ({ ...element, activity: "disabled" })) },
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
        layouts: [],
        printOutputs: [],
        svgOutputs: [],
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
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null,
    });
  });

  it("seeds every nested group collapsed on load, but never re-seeds on undo/redo", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "  group Inner {",
      "    point A = coordinate(x: 0, y: 0)",
      "  }",
      "  if (true) {",
      "    point B = coordinate(x: 1, y: 1)",
      "  }",
      "}"
    ].join("\n");

    useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: "/tmp/loaded.nui",
      dirtySinceSave: false
    });

    const elements = useCadDocumentStore.getState().elements;
    const groupIds = elements.filter(isGroupElement).map((element) => element.id);
    expect(groupIds).toHaveLength(3);
    const loadedFolds = useCadUiStore.getState().groupFoldById;
    // Nested groups at every depth are covered: the document element array is flat.
    expect(groupIds.every((id) => isGroupExpanded(id, loadedFolds) === false)).toBe(true);
    // Non-group elements get no entry at all.
    expect(loadedFolds.size).toBe(groupIds.length);

    const inner = elements.find((element) => element.name === "Inner")!;
    useCadUiStore.getState().setGroupFold(inner.id, { expanded: true });
    useCadDocumentStore.getState().commitText(`${source}\n// note`, "test");
    useCadDocumentStore.getState().undo();
    useCadDocumentStore.getState().redo();

    // Fold state is presentation, not document content: undo/redo must leave it alone.
    expect(isGroupExpanded(inner.id, useCadUiStore.getState().groupFoldById)).toBe(true);
  });

  it("leaves a group created after load expanded", () => {
    useCadDocumentStore.getState().replaceTextDocument("nui 4\npoint A = coordinate(x: 0, y: 0)", {
      currentFilePath: "/tmp/loaded.nui",
      dirtySinceSave: false
    });

    useCadDocumentStore.getState().commitText(
      ["nui 4", "point A = coordinate(x: 0, y: 0)", "group Fresh {", "}"].join("\n"),
      "test"
    );

    const fresh = useCadDocumentStore.getState().elements.find((element) => element.name === "Fresh")!;
    expect(useCadUiStore.getState().groupFoldById.has(fresh.id)).toBe(false);
    expect(isGroupExpanded(fresh.id, useCadUiStore.getState().groupFoldById)).toBe(true);
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
        ? ({ ...element, activity: "disabled" } as typeof element)
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
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 12, y: 0 }
    ]);
    useCadDocumentStore.getState().commitText(source, "test");
    const before = useCadDocumentStore.getState();

    useCadDocumentStore.getState().setSourceEditorPreviewText(dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 15, y: 0 }
    ]));

    const during = useCadDocumentStore.getState();
    expect(during.sourceText).toBe(source);
    expect(during.compiledDocumentRevision).toBe(before.compiledDocumentRevision);
    expect(during.past).toBe(before.past);
    expect(effectiveElements(during).find((element) => element.name === "A")).toMatchObject({ x: 15 });
    expect(during.previewCompiledDocument?.document.elements).toBe(during.previewElements);
    expect(effectiveCompiledDocument(during)).toBe(during.previewCompiledDocument);
    useCadDocumentStore.getState().setSourceEditorPreviewText(null);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadDocumentStore.getState().previewCompiledDocument).toBeNull();
    expect(effectiveCompiledDocument(useCadDocumentStore.getState())).toBe(useCadDocumentStore.getState().doc);
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

  it("keeps legacy palette UI edits outside canonical document history", () => {
    useCadDocumentStore.getState().setDefaultColorId("cut-red");
    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("cut-red");
    expect(useCadDocumentStore.getState().past).toHaveLength(0);

    useCadDocumentStore.getState().deletePaletteColor("guide-blue");
    expect(useCadDocumentStore.getState().palette.colors.some((color) => color.id === "guide-blue")).toBe(false);
    expect(useCadDocumentStore.getState().past).toHaveLength(0);
  });
});
