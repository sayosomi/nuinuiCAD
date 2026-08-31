// Task 44: Alt+←/→ boolean-toggle/choice-cycle stepping for typed const/let
// declaration initializers && `set` RHS literals, reusing the existing
// editorTransaction commit/undo/gesture machinery (see sourceEditorValueStep.test.ts
// for the legacy CadElement-parameter equivalent this mirrors) && the Task 43
// span indices, plus a freshness gate on doc.bindingAnalysis/doc.setStatements
// for `set` target resolution (see stepTypedSourceValue in sourceEditorController.ts).
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  stepSourceValue: (direction: 1 | -1) => boolean;
  startPickFromSelection: () => boolean;
};

const openEditor = (initialSource: string) => {
  useCadDocumentStore.getState().commitText(initialSource, "test");
  const parent = document.createElement("div");
  document.body.append(parent);
  const controller = new SourceEditorController(parent);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  return { controller, parent, view };
};

/** Selects the (0-based) `occurrence`-th match of `token` as a collapsed cursor. */
const selectToken = (view: EditorView, token: string, occurrence = 0) => {
  const text = view.state.doc.toString();
  let pos = -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    pos = text.indexOf(token, from);
    expect(pos).toBeGreaterThanOrEqual(0);
    from = pos + 1;
  }
  view.dispatch({ selection: EditorSelection.cursor(pos) });
};

const selectedText = (view: EditorView) => {
  const main = view.state.selection.main;
  return view.state.doc.toString().slice(main.from, main.to);
};

const stepEvent = (direction: 1 | -1, repeat = false) => ({
  key: direction > 0 ? "ArrowRight" : "ArrowLeft",
  code: direction > 0 ? "ArrowRight" : "ArrowLeft",
  altKey: true,
  repeat
});

const pressStep = (view: EditorView, direction: 1 | -1) => {
  fireEvent.keyDown(view.contentDOM, stepEvent(direction));
  fireEvent.keyUp(view.contentDOM, stepEvent(direction));
};

describe("SourceEditor typed value step (Task 44)", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => vi.restoreAllMocks());

  it("toggles a boolean declaration initializer in both directions", () => {
    const source = ["nui 1", "let flag: boolean = true"].join("\n");
    const { controller, parent, view } = openEditor(source);

    selectToken(view, "true");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("flag: boolean = false");
    expect(selectedText(view)).toBe("false");

    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText).toContain("flag: boolean = true");
    controller.destroy();
    parent.remove();
  });

  it("cycles a choice declaration initializer in declared order, wrapping at both ends", () => {
    const source = ["nui 1", "let dir: choice(right, left, center) = right"].join("\n");
    const { controller, parent, view } = openEditor(source);

    // "right" also appears in the type annotation (occurrence 0); the initializer is occurrence 1.
    selectToken(view, "right", 1);
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("let dir: choice(right, left, center) = left");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("let dir: choice(right, left, center) = center");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("let dir: choice(right, left, center) = right");
    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("let dir: choice(right, left, center) = center");
    controller.destroy();
    parent.remove();
  });

  it("steps a numeric declaration initializer by the default one-unit step", () => {
    const source = ["nui 1", "const length: number = 12.3456"].join("\n");
    const { controller, parent, view } = openEditor(source);

    selectToken(view, "12.3456");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("length: number = 13.3456");
    expect(selectedText(view)).toBe("13.3456");

    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText).toContain("length: number = 12.3456");
    expect(selectedText(view)).toBe("12.3456");
    controller.destroy();
    parent.remove();
  });

  it("uses declaration step and bounds, including recovery from an out-of-range initializer", () => {
    const source = [
      "nui 1",
      "let capped: number(step: 5, min: 0, max: 200) = 250",
      "let floored: number(step: 5, min: 0, max: 200) = -20"
    ].join("\n");
    const { controller, parent, view } = openEditor(source);

    selectToken(view, "250");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("max: 200) = 250");
    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText).toContain("max: 200) = 200");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("max: 200) = 200");

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("-20") + 1) });
    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe(
      "let floored: number(step: 5, min: 0, max: 200) = -20"
    );
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe(
      "let floored: number(step: 5, min: 0, max: 200) = 0"
    );
    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe(
      "let floored: number(step: 5, min: 0, max: 200) = 0"
    );
    controller.destroy();
    parent.remove();
  });

  it("writes an exponent-free decimal when a small min bound clamps the initializer", () => {
    const source = ["nui 1", "let floor: number(step: 1, min: 0.0000001) = 0.00"].join("\n");
    const { controller, parent, view } = openEditor(source);
    selectToken(view, "0.00", 1);

    pressStep(view, 1);

    const result = useCadDocumentStore.getState().sourceText;
    expect(result).toContain("= 0.0000001");
    expect(result).not.toMatch(/1e-7\.00/i);
    controller.destroy();
    parent.remove();
  });

  it("keeps a held out-of-range recovery and subsequent valid step as one Undo step", () => {
    const source = ["nui 1", "let capped: number(step: 5, max: 200) = 250"].join("\n");
    const { controller, parent, view } = openEditor(source);
    selectToken(view, "250");
    const pastBefore = useCadDocumentStore.getState().past.length;

    fireEvent.keyDown(view.contentDOM, stepEvent(-1));
    fireEvent.keyDown(view.contentDOM, stepEvent(-1, true));
    fireEvent.keyUp(view.contentDOM, stepEvent(-1));

    expect(useCadDocumentStore.getState().sourceText).toContain("max: 200) = 195");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    controller.destroy();
    parent.remove();
  });

  it("consumes every held numeric initializer step with normalized formatting", () => {
    const source = ["nui 1", "const length: number = 12.3400"].join("\n");
    const { controller, parent, view } = openEditor(source);

    selectToken(view, "12.3400");
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1))).toBe(false);
    expect(selectedText(view)).toBe("13.34");
    const step = vi.spyOn(controller as unknown as ControllerInternals, "stepSourceValue");
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1, true))).toBe(false);
    expect(step).toHaveLastReturnedWith(true);
    expect(selectedText(view)).toBe("14.34");
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1, true))).toBe(false);
    expect(step).toHaveLastReturnedWith(true);
    expect(selectedText(view)).toBe("15.34");

    fireEvent.keyUp(view.contentDOM, stepEvent(1));
    expect(useCadDocumentStore.getState().sourceText).toContain("length: number = 15.34");
    controller.destroy();
    parent.remove();
  });

  it("steps a `set` statement's boolean/choice RHS via the target binding's resolved declared type", () => {
    const booleanSource = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
    const { controller: booleanController, parent: booleanParent, view: booleanView } = openEditor(booleanSource);
    selectToken(booleanView, "true", 1);
    pressStep(booleanView, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("set flag = false");
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(1)).toBe("let flag: boolean = true");
    booleanController.destroy();
    booleanParent.remove();

    const choiceSource = ["nui 1", "let dir: choice(right, left) = right", "set dir = right"].join("\n");
    const { controller: choiceController, parent: choiceParent, view: choiceView } = openEditor(choiceSource);
    // "right" occurs in the type annotation (0), the initializer (1), && the set RHS (2).
    selectToken(choiceView, "right", 2);
    pressStep(choiceView, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("set dir = left");
    choiceController.destroy();
    choiceParent.remove();
  });

  it("does not step when the cursor is on a declaration's name/type span, or a set statement's target span", () => {
    const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
    const { controller, parent, view } = openEditor(source);

    selectToken(view, "flag"); // the declaration's own name
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(1)).toBe("let flag: boolean = true");

    selectToken(view, "boolean"); // the type annotation
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(1)).toBe("let flag: boolean = true");

    selectToken(view, "flag", 1); // the set statement's own target name
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("set flag = true");
    controller.destroy();
    parent.remove();
  });

  it("does not step immediately after a live edit inside the declaration itself, before recompile (Task 43 span drop)", () => {
    const source = ["nui 1", "let flag: boolean = true"].join("\n");
    const { controller, parent, view } = openEditor(source);
    const internals = controller as unknown as ControllerInternals;

    const truePos = view.state.doc.toString().indexOf("true");
    view.dispatch({ changes: { from: truePos + 4, insert: "x" } }); // "true" -> "truex", still inside the statement
    view.dispatch({ selection: EditorSelection.cursor(truePos) });

    const before = view.state.doc.toString();
    expect(internals.stepSourceValue(1)).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    controller.destroy();
    parent.remove();
  });

  it("steps a numeric `set` RHS using its target declaration's numeric metadata", () => {
    const source = ["nui 1", "let count: number(step: 0.5) = 1", "set count = 2.00"].join("\n");
    const { controller, parent, view } = openEditor(source);
    selectToken(view, "2.00");
    pressStep(view, 1);
    expect(view.state.doc.toString().split("\n").at(-1)).toBe("set count = 2.5");
    expect(selectedText(view)).toBe("2.5");
    controller.destroy();
    parent.remove();
  });

  it("keeps Canvas/evaluation input live through a held repeat but creates exactly one Undo step on keyup", () => {
    const source = ["nui 1", "let flag: boolean = true"].join("\n");
    const { controller, parent, view } = openEditor(source);
    selectToken(view, "true");
    const before = useCadDocumentStore.getState();

    fireEvent.keyDown(view.contentDOM, stepEvent(1));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));

    const during = useCadDocumentStore.getState();
    expect(during.sourceText).toBe(before.sourceText);
    expect(during.past).toHaveLength(before.past.length);
    expect(view.state.doc.toString()).toContain("flag: boolean = false"); // true -> false -> true -> false

    fireEvent.keyUp(view.contentDOM, stepEvent(1));
    expect(useCadDocumentStore.getState().sourceText).toContain("flag: boolean = false");
    expect(useCadDocumentStore.getState().past).toHaveLength(before.past.length + 1);
    controller.destroy();
    parent.remove();
  });

  it("still steps a literal (non-@binding) boolean/choice property attribute via the existing legacy path in a nui 1 document", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const { controller, parent, view } = openEditor(source);

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("side: right") + "side: ".length) });
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("side: left");

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("closed: false") + "closed: ".length) });
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("closed: true");
    controller.destroy();
    parent.remove();
  });

  it("does not step an @binding-valued property attribute (reference stepping is out of scope)", () => {
    const source = [
      "nui 1",
      "const 方向: choice(right, left) = right",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const { controller, parent, view } = openEditor(source);

    const atPos = view.state.doc.toString().indexOf("@方向") + 1;
    view.dispatch({ selection: EditorSelection.cursor(atPos) });
    const before = view.state.doc.toString();
    pressStep(view, 1);
    expect(view.state.doc.toString()).toBe(before);
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    controller.destroy();
    parent.remove();
  });

  it("never triggers a Canvas pick for a typed declaration/set-statement selection", () => {
    const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
    const { controller, parent, view } = openEditor(source);
    const internals = controller as unknown as ControllerInternals;

    const truePos = view.state.doc.toString().indexOf("true");
    view.dispatch({ selection: EditorSelection.range(truePos, truePos + 4) }); // full "true" span, non-collapsed

    expect(internals.startPickFromSelection()).toBe(false);
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toBeNull();
    controller.destroy();
    parent.remove();
  });

  describe("set target staleness (doc.bindingAnalysis/doc.setStatements freshness gate)", () => {
    it("no-ops when a same-named binding is inserted before the set statement, uncommitted", () => {
      const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
      const { controller, parent, view } = openEditor(source);
      const internals = controller as unknown as ControllerInternals;

      const insertPos = view.state.doc.line(1).to + 1; // start of line 2, before the original declaration
      view.dispatch({ changes: { from: insertPos, insert: "let flag: number = 9\n" } });
      const shiftedPos = view.state.doc.toString().lastIndexOf("true");
      view.dispatch({ selection: EditorSelection.cursor(shiftedPos) });

      const before = view.state.doc.toString();
      expect(internals.stepSourceValue(1)).toBe(false);
      expect(view.state.doc.toString()).toBe(before);
      controller.destroy();
      parent.remove();
    });

    it("no-ops when the target declaration is renamed away before the set statement, uncommitted", () => {
      const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
      const { controller, parent, view } = openEditor(source);
      const internals = controller as unknown as ControllerInternals;

      const namePos = view.state.doc.toString().indexOf("flag");
      view.dispatch({ changes: { from: namePos, to: namePos + "flag".length, insert: "renamed" } });
      const setRhsPos = view.state.doc.toString().lastIndexOf("true");
      view.dispatch({ selection: EditorSelection.cursor(setRhsPos) });

      const before = view.state.doc.toString();
      expect(internals.stepSourceValue(1)).toBe(false);
      expect(view.state.doc.toString()).toBe(before);
      controller.destroy();
      parent.remove();
    });

    it("no-ops when the target declaration is deleted before the set statement, uncommitted", () => {
      const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
      const { controller, parent, view } = openEditor(source);
      const internals = controller as unknown as ControllerInternals;

      const declarationLine = view.state.doc.line(2);
      view.dispatch({ changes: { from: declarationLine.from, to: declarationLine.to + 1, insert: "" } });
      const setRhsPos = view.state.doc.toString().lastIndexOf("true");
      view.dispatch({ selection: EditorSelection.cursor(setRhsPos) });

      const before = view.state.doc.toString();
      expect(internals.stepSourceValue(1)).toBe(false);
      expect(view.state.doc.toString()).toBe(before);
      controller.destroy();
      parent.remove();
    });

    it("steps using the new target's declared type once the edit actually recompiles", () => {
      const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
      const { controller, parent, view } = openEditor(source);
      const internals = controller as unknown as ControllerInternals;

      const nextSource = ["nui 1", "let flag: choice(a, b) = a", "set flag = a"].join("\n");
      useCadDocumentStore.getState().commitText(nextSource, "test");

      const rhsPos = view.state.doc.toString().lastIndexOf("a");
      view.dispatch({ selection: EditorSelection.cursor(rhsPos) });
      expect(internals.stepSourceValue(1)).toBe(true);
      expect(useCadDocumentStore.getState().sourceText.split("\n").at(-1)).toBe("set flag = b");
      controller.destroy();
      parent.remove();
    });

    it("no-ops on a semantically-inert whitespace edit before the set statement, until the next compile", () => {
      const source = ["nui 1", "let flag: boolean = true", "set flag = true"].join("\n");
      const { controller, parent, view } = openEditor(source);
      const internals = controller as unknown as ControllerInternals;

      const insertPos = view.state.doc.line(1).to; // end of the "nui 1" header line
      view.dispatch({ changes: { from: insertPos, insert: "   " } });
      const setRhsPos = view.state.doc.toString().lastIndexOf("true");
      view.dispatch({ selection: EditorSelection.cursor(setRhsPos) });

      const before = view.state.doc.toString();
      expect(internals.stepSourceValue(1)).toBe(false);
      expect(view.state.doc.toString()).toBe(before);
      controller.destroy();
      parent.remove();
    });
  });
});
