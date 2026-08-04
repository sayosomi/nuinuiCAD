import { redo, undo, history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { TypedVariableQuickFixDescriptor } from "../scalars/typedVariableQuickFixes";
import { buildTypedVariableLintActions, type TypedVariableQuickFixActionDeps } from "./typedVariableQuickFixActions";

let liveViews: EditorView[] = [];
afterEach(() => {
  for (const view of liveViews) view.destroy();
  liveViews = [];
});

const makeView = (doc: string) => {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [history()] }) });
  liveViews.push(view);
  return view;
};

const baseDeps = (overrides: Partial<TypedVariableQuickFixActionDeps> = {}): TypedVariableQuickFixActionDeps => ({
  isComposing: () => false,
  hasPendingText: () => false,
  ...overrides
});

const spliceDescriptor = (
  source: string,
  overrides: Partial<Extract<TypedVariableQuickFixDescriptor["action"], { kind: "splice" }>> = {}
): TypedVariableQuickFixDescriptor => ({
  id: "test-splice",
  label: "Test splice",
  sourceSnapshot: source,
  action: {
    kind: "splice",
    from: 0,
    to: 0,
    insert: "X",
    expectedOldText: "",
    selection: 1,
    ...overrides
  }
});

describe("buildTypedVariableLintActions", () => {
  it("applies a splice as a single dispatched transaction with the expected selection", () => {
    const source = "abc";
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 1, to: 2, insert: "Z", expectedOldText: "b", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps(), [descriptor]);
    action.apply(view, descriptor.action.kind === "splice" ? descriptor.action.from : 0, 0);
    expect(view.state.doc.toString()).toBe("aZc");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("is exactly one Undo away from the original text, and Redo restores the edit", () => {
    const source = "abc";
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 1, to: 2, insert: "Z", expectedOldText: "b", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps(), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("aZc");
    undo(view);
    expect(view.state.doc.toString()).toBe("abc");
    redo(view);
    expect(view.state.doc.toString()).toBe("aZc");
  });

  it("no-ops when the live document no longer matches the descriptor's source snapshot", () => {
    const view = makeView("abc-changed");
    const descriptor = spliceDescriptor("abc", { from: 1, to: 2, insert: "Z", expectedOldText: "b", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps(), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("abc-changed");
  });

  it("no-ops when the specific target range no longer matches expectedOldText, even if full-text length coincidentally matches", () => {
    const source = "abc";
    // Same length, same snapshot text on purpose - only the live doc differs, to
    // isolate the per-range recheck from the full-text recheck.
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 1, to: 2, insert: "Z", expectedOldText: "Q", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps(), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("abc");
  });

  it("no-ops during IME composition", () => {
    const source = "abc";
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 1, to: 2, insert: "Z", expectedOldText: "b", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps({ isComposing: () => true }), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("abc");
  });

  it("no-ops while the buffer has pending (uncommitted) text", () => {
    const source = "abc";
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 1, to: 2, insert: "Z", expectedOldText: "b", selection: 2 });
    const [action] = buildTypedVariableLintActions(baseDeps({ hasPendingText: () => true }), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("abc");
  });

  it("selects the requested cursor position after applying an insertion", () => {
    const source = "let x = 5";
    const view = makeView(source);
    const descriptor = spliceDescriptor(source, { from: 5, to: 5, insert: ": ", expectedOldText: "", selection: 7 });
    const [action] = buildTypedVariableLintActions(baseDeps(), [descriptor]);
    action.apply(view, 0, 0);
    expect(view.state.doc.toString()).toBe("let x:  = 5");
    expect(view.state.selection.main.head).toBe(7);
    expect(view.state.selection.main.anchor).toBe(7);
  });
});
