// Task 43: click/Tab/Inspector-jump navigation over typed declaration/set fields,
// property bindings, && text template holes, built on the compile-time span indices in
// statementRangeIndex.ts. Mirrors the fixture/harness conventions of
// sourceEditorController.test.ts's own "value-span click selection" /
// "Tab/Shift-Tab value-span navigation" describes &&
// sourceEditorController.bindingSelection.test.ts's jumpToBindingDeclaration tests.
import { EditorSelection } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BindingId } from "../scalars/bindingCatalog";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import * as dslValueSpansModule from "../dsl/dslValueSpans";
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

const statementIndexOfElement = (name: string): number => {
  const doc = useCadDocumentStore.getState().doc;
  const element = doc.document.elements.find((candidate) => candidate.name === name)!;
  return doc.statementMap.byElementId.get(element.id)!.statementIndex;
};

const setUp = () => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
};

describe("SourceEditorController Task 43: typed declaration Tab/click navigation", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 4", "const flag: boolean = true"].join("\n");

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
    const multilineSource = ["nui 4", "let total: number = (", "  1 + 2", ")"].join("\n");
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

  const source = ["nui 4", "let total: number = 0", "set total = @total + 1"].join("\n");

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
    "nui 4",
    'const label: string = "A"',
    'text T = label(text: "prefix ${@label} suffix", anchor: none, size: 3)'
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
    expect(selectedText(internals)).toBe('"prefix ${@label} suffix"');
    controller.destroy();
  });

  it("keeps resolving the hole precisely after a dirty edit elsewhere shifts its position (no recompile, no re-parse)", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const initialText = internals.view.state.doc.toString();
    const insertPos = initialText.indexOf("nui 4") + "nui 4".length;
    internals.view.dispatch({ changes: { from: insertPos, insert: "\n# a dirty comment line" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("# a dirty comment line");

    expect(clickAt(internals, text.indexOf("@label") + 1)).toBe(true);
    expect(selectedText(internals)).toBe("@label");
    controller.destroy();
  });
});

describe("SourceEditorController Task 43: typed property click/jump is reparse-free", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 4", "let flag: boolean = true", "group G (printEnabled: @flag) {", "}"].join("\n");

  it("resolves a bound property click via the PropertyBindingRangeIndex alone, never calling the legacy re-parsing span lookup", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const spy = vi.spyOn(dslValueSpansModule, "dslDocumentValueSpansAt");

    expect(clickAt(internals, text.indexOf("@flag") + 1)).toBe(true);

    expect(selectedText(internals)).toBe("@flag");
    expect(spy).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("a click on the statement's own name (not a property binding) still resolves through the legacy path, untouched", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const namePos = text.indexOf("group G") + "group ".length;
    const spy = vi.spyOn(dslValueSpansModule, "dslDocumentValueSpansAt");

    // Same non-value-position outcome the existing legacy test suite already
    // documents for an element's own name - unaffected by the property short-circuit.
    expect(clickAt(internals, namePos)).toBe(false);

    expect(spy).toHaveBeenCalled();
    controller.destroy();
  });

  it("falls through (still correctly) to the live legacy path once an edit anywhere in the owning statement drops the property index entry - never a stale/wrong span", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const initialText = internals.view.state.doc.toString();
    // Edits the group's own name, not the bound value - the whole statement (and so
    // every property binding span it owns) is dropped from the compile-time index,
    // per Task 43's fail-closed contract, well before the next compile.
    const nameEnd = initialText.indexOf("group G") + "group G".length;
    internals.view.dispatch({ changes: { from: nameEnd, insert: "X" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("group GX");
    const spy = vi.spyOn(dslValueSpansModule, "dslDocumentValueSpansAt");

    expect(clickAt(internals, text.indexOf("@flag") + 1)).toBe(true);

    // Correct (live-reparsed), not stale - the token itself never moved.
    expect(selectedText(internals)).toBe("@flag");
    expect(spy).toHaveBeenCalled();
    controller.destroy();
  });

  it("a partial edit inside the bound value itself also drops the index entry, so the click resolves through the live legacy path", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const initialText = internals.view.state.doc.toString();
    const flagEnd = initialText.indexOf("@flag") + "@flag".length;
    internals.view.dispatch({ changes: { from: flagEnd, insert: "x" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("@flagx");
    const spy = vi.spyOn(dslValueSpansModule, "dslDocumentValueSpansAt");

    expect(clickAt(internals, text.indexOf("@flagx") + 1)).toBe(true);

    expect(selectedText(internals)).toBe("@flagx");
    expect(spy).toHaveBeenCalled();
    controller.destroy();
  });
});

describe("SourceEditorController Task 43: dirty-source fail-closed semantics for field/hole entries", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("Tab no-ops (never selects a stale field) once any edit lands inside a typed declaration statement, even before the next compile", () => {
    const source = ["nui 4", "const flag: boolean = true"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    // Edits the keyword itself - not any one field's own span - proving the whole
    // statement's fields drop together, not just the field nearest the edit.
    internals.view.dispatch({ changes: { from: internals.view.state.doc.line(2).from, insert: "#" } });
    const text = internals.view.state.doc.toString();
    internals.view.dispatch({ selection: EditorSelection.cursor(text.indexOf("flag")) });

    expect(internals.navigateValueSpan("next")).toBe(false);
    expect(internals.view.state.selection.main.empty).toBe(true);
    controller.destroy();
  });

  it("Tab no-ops once any edit lands inside a set statement, even before the next compile", () => {
    const source = ["nui 4", "let total: number = 0", "set total = @total + 1"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const setLineStart = text.lastIndexOf("set total");
    internals.view.dispatch({ changes: { from: setLineStart, insert: "#" } });
    const dirtyText = internals.view.state.doc.toString();
    internals.view.dispatch({ selection: EditorSelection.cursor(dirtyText.lastIndexOf("total")) });

    expect(internals.navigateValueSpan("next")).toBe(false);
    controller.destroy();
  });

  it("clicking on a template hole's opening brace selects the inner content, not the outer brace-inclusive span || the whole string", () => {
    const source = ["nui 4", 'const label: string = "A"', 'text T = label(text: "${@label}", anchor: none, size: 3)'].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const openBrace = text.indexOf("${@label}");

    expect(clickAt(internals, openBrace)).toBe(true);

    expect(selectedText(internals)).toBe("@label");
    controller.destroy();
  });

  it("falls back to the whole (freshly re-parsed) string, not a stale hole position, once an edit elsewhere in the statement drops the hole index", () => {
    const source = ["nui 4", 'const label: string = "A"', 'text T = label(text: "prefix ${@label} suffix", anchor: none, size: 3)'].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const initialText = internals.view.state.doc.toString();
    // Edits the element's own name, well outside the hole itself but still inside
    // the owning `text T = label(...)` statement.
    const nameEnd = initialText.indexOf("text T") + "text T".length;
    internals.view.dispatch({ changes: { from: nameEnd, insert: "X" } });
    const text = internals.view.state.doc.toString();
    expect(text).toContain("text TX");

    expect(clickAt(internals, text.indexOf("@label") + 1)).toBe(true);

    // The live re-parse still finds the whole (unmoved) string correctly - not a
    // guessed, wrong, || otherwise stale position.
    expect(selectedText(internals)).toBe('"prefix ${@label} suffix"');
    controller.destroy();
  });
});

describe("SourceEditorController Task 45: jumpToPropertyBindingValue", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 4", "let flag: boolean = true", "group G (printEnabled: @flag) {", "}"].join("\n");

  it("selects the exact `@name` value span for the occurrence's own key", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("G"), "printEnabled");

    expect(controller.jumpToPropertyBindingValue(occurrenceKey)).toBe(true);

    expect(selectedText(internals)).toBe("@flag");
    controller.destroy();
  });

  it("no-ops (does not move the cursor) for an occurrence key that does not resolve", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const before = internals.view.state.selection.main.head;

    expect(controller.jumpToPropertyBindingValue("999:printEnabled")).toBe(false);

    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("no-ops once an edit anywhere in the owning statement drops the entry - never a wrong position", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("G"), "printEnabled");
    const before = internals.view.state.selection.main.head;
    const nameEnd = internals.view.state.doc.toString().indexOf("group G") + "group G".length;
    internals.view.dispatch({ changes: { from: nameEnd, insert: "X" } });

    expect(controller.jumpToPropertyBindingValue(occurrenceKey)).toBe(false);

    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("does not jump while composing", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const content = parent.querySelector(".cm-content")!;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("G"), "printEnabled");
    fireEvent.compositionStart(content);

    expect(controller.jumpToPropertyBindingValue(occurrenceKey)).toBe(false);

    fireEvent.compositionEnd(content);
    controller.destroy();
  });
});

describe("SourceEditorController Task 45: jumpToTemplateHole", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 4", 'const label: string = "A"', 'text T = label(text: "prefix ${@label} suffix", anchor: none, size: 3)'].join("\n");

  it("selects exactly the hole's inner (brace-interior) span for the given holeIndex", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("T"), "text");

    expect(controller.jumpToTemplateHole(occurrenceKey, 0)).toBe(true);

    expect(selectedText(internals)).toBe("@label");
    controller.destroy();
  });

  it("no-ops for a holeIndex that does not exist on this occurrence", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("T"), "text");
    const before = internals.view.state.selection.main.head;

    expect(controller.jumpToTemplateHole(occurrenceKey, 5)).toBe(false);

    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("no-ops once an edit anywhere in the owning statement drops the entry", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const occurrenceKey = propertyBindingOccurrenceKey(statementIndexOfElement("T"), "text");
    const before = internals.view.state.selection.main.head;
    const nameEnd = internals.view.state.doc.toString().indexOf("text T") + "text T".length;
    internals.view.dispatch({ changes: { from: nameEnd, insert: "X" } });

    expect(controller.jumpToTemplateHole(occurrenceKey, 0)).toBe(false);

    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });
});
