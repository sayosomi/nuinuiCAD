import { EditorSelection, Transaction } from "@codemirror/state";
import { createDslCompletionSource, type DslAutocompleteOptions } from "./cmAutocomplete";
import { describe, expect, it, beforeEach } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: { doc: { toString: () => string }; selection: { main: { head: number } } };
    dispatch: (spec: unknown) => void;
  };
  autocompleteOptions: () => DslAutocompleteOptions;
  moduleSemanticRanges: {
    statementRanges?: ReadonlyMap<number, { from: number; to: number }>;
  };
};

const controllerInternals = (controller: SourceEditorController) => controller as unknown as ControllerInternals;

const completionAt = async (controller: SourceEditorController, position: number) => {
  const internals = controllerInternals(controller);
  const source = createDslCompletionSource(internals.autocompleteOptions());
  return source({ state: internals.view.state, pos: position, explicit: true } as never);
};

const insertAt = (controller: SourceEditorController, from: number, insert: string) => {
  const internals = controllerInternals(controller);
  internals.view.dispatch({
    changes: { from, insert },
    selection: EditorSelection.cursor(from + insert.length),
    annotations: Transaction.userEvent.of("input.type")
  });
  return from + insert.length;
};

describe("SourceEditorController module semantic target priority", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  it("prefers a module source target over a materialized child and clears it while dirty", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point Private = coordinate(x: 0, y: 0)",
      "}",
      "instance I = M()"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { doc: { toString: () => string } } } };
    const privateOffset = source.indexOf("Private");
    internals.view.dispatch({ selection: EditorSelection.cursor(privateOffset), annotations: Transaction.addToHistory.of(false) });
    const target = controller.currentCursorModuleSemanticTarget();
    expect(target?.kind).toBe("moduleSource");
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().renameModuleSemanticPromptTarget).toEqual(target);
    useCadUiStore.getState().setRenameModuleSemanticPromptTarget(null);
    internals.view.dispatch({ changes: { from: 0, to: 0, insert: "# " }, annotations: Transaction.addToHistory.of(false) });
    expect(controller.currentCursorModuleSemanticTarget()).toBeNull();
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticResolution: controller.currentCursorModuleSemanticResolution,
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("semantic metadata");
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    controller.destroy();
  });

  it("navigates callee, argument label, and qualified export member to exact source declarations", () => {
    const source = [
      "nui 4",
      "module M(width: number) {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "  export const value: number = 1",
      "}",
      "instance I = M(width: 1)",
      "point X = offset(from: @I::Public, dx: 1, dy: 0)",
      "const scalar: number = @I::value"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { selection: { main: { from: number; to: number } }; doc: { sliceString: (from: number, to: number) => string } } } };
    const moveTo = (text: string, start = 0) => {
      const offset = source.indexOf(text, start);
      internals.view.dispatch({ selection: EditorSelection.cursor(offset), annotations: Transaction.addToHistory.of(false) });
    };
    moveTo("M(width", source.indexOf("module I"));
    const callee = controller.currentCursorModuleSemanticTarget();
    expect(callee?.kind).toBe("moduleDefinition");
    expect(controller.jumpToModuleSemanticTarget(callee!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("M");
    moveTo("width: 1", source.indexOf("module I"));
    const parameter = controller.currentCursorModuleSemanticTarget();
    expect(parameter?.kind).toBe("moduleParameter");
    expect(controller.jumpToModuleSemanticTarget(parameter!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("width");
    moveTo("Public", source.indexOf("I::"));
    const exported = controller.currentCursorModuleSemanticTarget();
    expect(exported?.kind).toBe("moduleSource");
    expect(controller.jumpToModuleSemanticTarget(exported!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("Public");

    moveTo("value", source.indexOf("@I::value"));
    const scalarExport = controller.currentCursorModuleSemanticTarget();
    expect(scalarExport).toEqual({ kind: "moduleSource", statementId: expect.any(String) });
    expect(controller.jumpToModuleSemanticTarget(scalarExport!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("value");

    moveTo("I", source.indexOf("@I::value") + 1);
    expect(controller.currentCursorModuleSemanticTarget()?.kind).toBe("moduleInstance");
    controller.destroy();
  });

  it("bridges a module default document binding back to the existing BindingId declaration", () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number = @outer) {",
      "}",
      "instance I = M()"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { doc: { sliceString: (from: number, to: number) => string }; selection: { main: { from: number; to: number } } } } };
    const reference = source.indexOf("@outer") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(reference), annotations: Transaction.addToHistory.of(false) });
    const target = controller.currentCursorModuleSemanticTarget();
    expect(target?.kind).toBe("documentBinding");
    expect(controller.jumpToModuleSemanticTarget(target!)).toBe(true);
    expect(internals.view.state.selection.main.from).toBe(source.indexOf("const outer"));
    controller.destroy();
  });

  it("keeps root qualified references stale-safe when their token is replaced", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "instance I = M()",
      "point X = offset(from: @I::Public, dx: 1, dy: 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { selection: { main: { from: number; to: number } } } } };
    const publicOffset = source.indexOf("Public", source.indexOf("I::"));
    internals.view.dispatch({ selection: EditorSelection.cursor(publicOffset), annotations: Transaction.addToHistory.of(false) });
    const cleanTarget = controller.currentCursorModuleSemanticTarget();
    expect(cleanTarget?.kind).toBe("moduleSource");
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticResolution: controller.currentCursorModuleSemanticResolution,
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().renameModuleSemanticPromptTarget).toEqual(cleanTarget);
    useCadUiStore.getState().setRenameModuleSemanticPromptTarget(null);

    internals.view.dispatch({
      changes: { from: publicOffset, to: publicOffset + "Public".length, insert: "Replaced" },
      selection: EditorSelection.cursor(publicOffset + "Replaced".length),
      annotations: Transaction.addToHistory.of(false)
    });
    expect(controller.currentCursorModuleSemanticTarget()).toBeNull();
    expect(controller.currentCursorModuleSemanticResolution().kind).toBe("stale");
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticResolution: controller.currentCursorModuleSemanticResolution,
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("semantic metadata");
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    controller.destroy();
  });

  it("maps a dirty new Module body statement through the controller's real completion site", async () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number) {",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const closeOffset = source.indexOf("\n}", source.indexOf("module M"));
    const cursor = insertAt(controller, closeOffset, "\n  const inside: number = @");
    const internals = controllerInternals(controller);
    const site = internals.autocompleteOptions().moduleCompletionSiteAt?.(cursor, "moduleBody");
    expect(site).not.toBeNull();
    expect(site?.scopeId).toMatch(/^module:/);
    const result = await completionAt(controller, cursor);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("width");
    expect(labels).not.toContain("outer");
    controller.destroy();
  });

  it("uses source order for a new body declaration after an existing Module local", async () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number) {",
      "  const first: number = 1",
      "  const later: number = 2",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const firstIndex = useCadDocumentStore.getState().doc.statements.findIndex((statement) => statement.name === "first");
    const laterOffset = source.indexOf("  const later");
    const inserted = "  const second: number = @\n";
    insertAt(controller, laterOffset, inserted);
    const cursor = laterOffset + inserted.indexOf("@") + 1;
    const internals = controllerInternals(controller);
    const site = internals.autocompleteOptions().moduleCompletionSiteAt?.(cursor, "moduleBody");
    expect(site?.sourceOrderIndex).toBe(firstIndex + 1);
    const result = await completionAt(controller, cursor);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("first");
    expect(labels).not.toContain("second");
    expect(labels).not.toContain("later");
    expect(labels).not.toContain("outer");
    controller.destroy();
  });

  it("does not map a new statement typed after Enter onto the previous statement range", async () => {
    const source = [
      "nui 4",
      "module M(width: number) {",
      "  const first: number = 1",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controllerInternals(controller);
    const firstIndex = useCadDocumentStore.getState().doc.statements.findIndex((statement) => statement.name === "first");
    const firstEnd = source.indexOf("\n", source.indexOf("const first"));
    const cursor = insertAt(controller, firstEnd, "\n  const second: number = @");
    const site = internals.autocompleteOptions().moduleCompletionSiteAt?.(cursor, "moduleBody");
    const mappedFirst = site && internals.moduleSemanticRanges.statementRanges?.get(firstIndex);
    expect(mappedFirst && cursor >= mappedFirst.from && cursor <= mappedFirst.to).toBe(false);
    expect(site?.sourceOrderIndex).toBe(firstIndex + 1);
    const result = await completionAt(controller, cursor);
    expect(result?.options.map((option) => option.label)).toContain("width");
    controller.destroy();
  });

  it.each([
    ["group", "group G (printEnabled: true) {\n}", "group G"],
    ["if", "if (true) {\n}", "if Branch"],
    ["for", "for i in range(from: 0, count: 1, step: 1) {\n}", "for Loop"]
  ])("keeps Module ownership for a new statement inside nested %s scope", async (_kind, nested, marker) => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number) {",
      "  const first: number = 1",
      `  ${nested}`,
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const nestedClose = source.indexOf("\n}", source.indexOf(marker));
    const cursor = insertAt(controller, nestedClose, "\n    const inside: number = @");
    const result = await completionAt(controller, cursor);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("width");
    expect(labels).toContain("first");
    expect(labels).not.toContain("outer");
    controller.destroy();
  });

  it("unions Module completion into new template, set, and numeric body statements", async () => {
    const cases = [
      {
        insert: `\n  text Label = label(text: "width=\${@}", anchor: (0, 0))`,
        cursorOffset: "\n  text Label = label(text: \"width=${@".length,
        expected: "width"
      },
      {
        insert: "\n  set first = @",
        cursorOffset: "\n  set first = @".length,
        expected: "width"
      },
      {
        insert: "\n  point P = coordinate(x: @, y: 0)",
        cursorOffset: "\n  point P = coordinate(x: @".length,
        expected: "@width"
      }
    ] as const;
    for (const testCase of cases) {
      useCadDocumentStore.setState(initialCadDocumentState());
      useCadUiStore.setState(initialCadUiState());
      const source = [
        "nui 4",
        "module M(width: number) {",
        "  const first: number = 1",
        "}"
      ].join("\n");
      useCadDocumentStore.getState().commitText(source, "test");
      const controller = new SourceEditorController(document.createElement("div"));
      const closeOffset = source.indexOf("\n}", source.indexOf("module M"));
      insertAt(controller, closeOffset, testCase.insert);
      const cursor = closeOffset + testCase.cursorOffset;
      const result = await completionAt(controller, cursor);
      const labels = result?.options.map((option) => option.label) ?? [];
      expect(labels).toContain(testCase.expected);
      controller.destroy();
    }
  });

  it("preserves generic typed completion outside Modules while dirty Module structure fails closed", async () => {
    const ordinarySource = [
      "nui 4",
      "const outer: number = 10",
      "point P = coordinate(x: 0, y: 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(ordinarySource, "test");
    const ordinaryController = new SourceEditorController(document.createElement("div"));
    const ordinaryClose = ordinarySource.length;
    const ordinaryCursor = insertAt(ordinaryController, ordinaryClose, "\nconst inside: number = @");
    const ordinaryLabels = (await completionAt(ordinaryController, ordinaryCursor))?.options.map((option) => option.label) ?? [];
    expect(ordinaryLabels).toContain("outer");
    ordinaryController.destroy();

    const moduleSource = [
      "nui 4",
      "module M(width: number) {",
      "  const inside: number = @width",
      "}"
    ].join("\n");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(moduleSource, "test");
    const moduleController = new SourceEditorController(document.createElement("div"));
    const moduleInternals = controllerInternals(moduleController);
    const brace = moduleSource.indexOf("{");
    moduleInternals.view.dispatch({ changes: { from: brace, insert: " " }, selection: EditorSelection.cursor(moduleSource.indexOf("@width") + 1) });
    const liveCursor = moduleSource.indexOf("@width") + 3;
    const unsafeSite = moduleInternals.autocompleteOptions().moduleCompletionSiteAt?.(liveCursor, "moduleBody");
    expect(unsafeSite).toBeNull();
    const unsafeLabels = (await completionAt(moduleController, liveCursor))?.options.map((option) => option.label) ?? [];
    expect(unsafeLabels).not.toContain("width");
    moduleController.destroy();
  });

  it("maps a dirty new Module call and new argument through the controller site", async () => {
    const lastGood = [
      "nui 4",
      "module M(width: number, optional: number = 0) {",
      "}",
      "module First() {",
      "}",
      "module Forward() {",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(lastGood, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const forwardOffset = lastGood.indexOf("module Forward");
    const newCallCursor = insertAt(controller, forwardOffset, "instance I = F\n");
    const callLabels = (await completionAt(controller, newCallCursor - 1))?.options.map((option) => option.label) ?? [];
    expect(callLabels).toContain("First");
    expect(callLabels).not.toContain("Forward");
    controller.destroy();

    const existingCall = [
      "nui 4",
      "module M(width: number, optional: number = 0) {",
      "}",
      "instance I = M(width: 1)"
    ].join("\n");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(existingCall, "test");
    const argumentController = new SourceEditorController(document.createElement("div"));
    const closeParen = existingCall.lastIndexOf(")");
    const argumentCursor = insertAt(argumentController, closeParen, ", optional: ");
    const argumentLabels = (await completionAt(argumentController, argumentCursor))?.options.map((option) => option.label) ?? [];
    expect(argumentLabels).toContain("0");
    argumentController.destroy();
  });
});
