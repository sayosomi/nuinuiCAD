// Task 43: click/Tab/Inspector-jump navigation over typed declaration/set fields and
// text template holes, built on the compile-time span indices in statementRangeIndex.ts.
// Mirrors the fixture/harness conventions of sourceEditorController.test.ts's own
// "value-span click selection" / "Tab/Shift-Tab value-span navigation" describes and
// sourceEditorController.bindingSelection.test.ts's jumpToBindingDeclaration tests.
import { EditorSelection } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BindingId } from "../scalars/bindingCatalog";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: {
      doc: { toString: () => string; line: (n: number) => { from: number; to: number } };
      selection: { main: { head: number; from: number; to: number; empty: boolean } };
    };
    dispatch: (spec: unknown) => void;
  };
  handleValueClick: (event: MouseEvent, view: ControllerInternals["view"]) => boolean;
  navigateValueSpan: (direction: "next" | "previous") => boolean;
};

const clickEvent = (init?: MouseEventInit) => new MouseEvent("mouseup", { button: 0, ...init });

const clickAt = (internals: ControllerInternals, pos: number, init?: MouseEventInit) => {
  internals.view.dispatch({ selection: EditorSelection.cursor(pos) });
  return internals.handleValueClick(clickEvent(init), internals.view);
};

const selectedText = (internals: ControllerInternals) => {
  const main = internals.view.state.selection.main;
  return internals.view.state.doc.toString().slice(main.from, main.to);
};

const typedBindingId = (name: string): BindingId =>
  useCadDocumentStore
    .getState()
    .doc.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name)!.id;

const setUp = () => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
};

describe("SourceEditorController Task 43: typed declaration Tab/click navigation", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 3", "const flag: boolean = true"].join("\n");

  it("Tab cycles name -> type -> initializer -> wraps to name, on a line dslDocumentValueSpansAt itself reports as having no spans", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // Positioned before the "const" keyword itself (not on any tracked span), so the
    // first "next" advances to the nearest following span rather than skipping past it.
    const lineStart = internals.view.state.doc.line(2).from;
    internals.view.dispatch({ selection: EditorSelection.cursor(lineStart) });

    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("flag");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("boolean");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("true");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("flag");
    expect(internals.navigateValueSpan("previous")).toBe(true);
    expect(selectedText(internals)).toBe("true");
    controller.destroy();
  });

  it("does not change the document, CM history, or Canvas/binding selection", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: EditorSelection.cursor(internals.view.state.doc.line(2).from) });
    const before = {
      text: internals.view.state.doc.toString(),
      sourceText: useCadDocumentStore.getState().sourceText,
      selectionSubject: useCadUiStore.getState().selectionSubject
    };

    expect(internals.navigateValueSpan("next")).toBe(true);

    expect(internals.view.state.doc.toString()).toBe(before.text);
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadUiStore.getState().selectionSubject).toEqual(before.selectionSubject);
    controller.destroy();
  });

  it("clicking directly on the type or initializer selects exactly that sub-span", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();

    expect(clickAt(internals, text.indexOf("boolean") + 2)).toBe(true);
    expect(selectedText(internals)).toBe("boolean");

    expect(clickAt(internals, text.indexOf("true") + 1)).toBe(true);
    expect(selectedText(internals)).toBe("true");
    controller.destroy();
  });

  it("leaves the initializer span null (fail-closed), while name/type stay reachable, when the initializer spans a continuation line", () => {
    const multilineSource = ["nui 3", "let total: number = (", "  1 + 2", ")"].join("\n");
    useCadDocumentStore.getState().commitText(multilineSource, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: EditorSelection.cursor(internals.view.state.doc.line(2).from) });

    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("total");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("number");
    // The multi-segment initializer is excluded; Tab wraps straight back to name
    // instead of ever landing inside the continuation-line initializer.
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("total");
    controller.destroy();
  });

  it("jumpToBindingDeclarationPart selects the type/initializer span and focuses the editor", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("flag");

    expect(controller.jumpToBindingDeclarationPart(bindingId, "initializer")).toBe(true);
    expect(selectedText(internals)).toBe("true");
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId });
    controller.destroy();
  });

  it("jumpToBindingDeclarationPart returns false, without moving the cursor, for an unknown binding id", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const before = internals.view.state.selection.main.head;

    expect(controller.jumpToBindingDeclarationPart("binding:does-not-exist", "type")).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("does not jump while composing", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const content = parent.querySelector(".cm-content")!;
    const bindingId = typedBindingId("flag");
    fireEvent.compositionStart(content);

    expect(controller.jumpToBindingDeclarationPart(bindingId, "initializer")).toBe(false);

    fireEvent.compositionEnd(content);
    controller.destroy();
  });
});

describe("SourceEditorController Task 43: set statement Tab/click navigation", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 3", "let total: number = 0", "set total = @total + 1"].join("\n");

  it("Tab cycles target -> expression -> wraps to target on a set statement line", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const setLineStart = text.lastIndexOf("set total");
    internals.view.dispatch({ selection: EditorSelection.cursor(setLineStart) });

    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("total");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("@total + 1");
    expect(internals.navigateValueSpan("next")).toBe(true);
    expect(selectedText(internals)).toBe("total");
    controller.destroy();
  });

  it("clicking on the RHS expression selects exactly that sub-span", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();

    expect(clickAt(internals, text.lastIndexOf("@total") + 1)).toBe(true);
    expect(selectedText(internals)).toBe("@total + 1");
    controller.destroy();
  });
});

describe("SourceEditorController Task 43: text template hole click precision", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = [
    "nui 3",
    'const label: string = "A"',
    'text T = label(text: "prefix {@label} suffix" anchor: none size: 3)'
  ].join("\n");

  it("clicking inside the hole selects just the reference, excluding braces", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();

    expect(clickAt(internals, text.indexOf("@label") + 1)).toBe(true);
    expect(selectedText(internals)).toBe("@label");
    controller.destroy();
  });

  it("clicking elsewhere in the same string still selects the whole legacy string span", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();

    expect(clickAt(internals, text.indexOf("prefix") + 1)).toBe(true);
    expect(selectedText(internals)).toBe('"prefix {@label} suffix"');
    controller.destroy();
  });

  it("keeps resolving the hole precisely after a dirty edit elsewhere shifts its position (no recompile, no re-parse)", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const initialText = internals.view.state.doc.toString();
    const insertPos = initialText.indexOf("nui 3") + "nui 3".length;
    internals.view.dispatch({ changes: { from: insertPos, insert: "\n# a dirty comment line" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("# a dirty comment line");

    expect(clickAt(internals, text.indexOf("@label") + 1)).toBe(true);
    expect(selectedText(internals)).toBe("@label");
    controller.destroy();
  });
});
