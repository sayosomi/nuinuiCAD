import { CompletionContext, acceptCompletion, autocompletion, currentCompletions, setSelectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { createDslCompletionSource } from "./cmAutocomplete";

const sourceFor = (initial: string) => {
  const lastGood = compileFreshCanonicalText(initial);
  return createDslCompletionSource({
    elements: () => [], statementRanges: () => new Map(), isComposing: () => false,
    computedGeometry: () => undefined, effectiveEnabledElementIds: () => undefined,
    evaluationErrors: () => undefined, bindingAnalysis: () => undefined,
    typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [], statementInfoByElementId: () => undefined,
    moduleSemanticMetadata: () => lastGood.doc, semanticMetadataFresh: () => false,
    currentSourceSemanticMetadata: text => compileCanonicalText(lastGood, text).currentCompiled
  });
};

describe("CodeMirror Layer completion (#1581)", () => {
  it("applies a selected native CodeMirror completion as exactly one resolvable reference", async () => {
    const initial = "nui 1\nlayer seam\nline L in @ = segment(start: (0, 0), end: (10, 0))";
    const completion = sourceFor(initial);
    const view = new EditorView({ parent: document.createElement("div"), state: EditorState.create({
      doc: initial, selection: { anchor: initial.indexOf("in @") + 4 },
      extensions: [autocompletion({ override: [completion], interactionDelay: 0 })]
    }) });
    try {
      startCompletion(view);
      await vi.waitFor(() => expect(currentCompletions(view.state).map(c => c.label)).toEqual(["default", "seam"]));
      view.dispatch({ effects: setSelectedCompletion(1) });
      expect(acceptCompletion(view)).toBe(true);
      const completed = view.state.doc.toString();
      expect(completed).toBe(initial.replace("in @ ", "in @seam "));
      const compiled = compileFreshCanonicalText(completed).currentCompiled;
      expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      expect([...compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.values()][0]?.layerName).toBe("seam");
    } finally {
      view.destroy();
    }
  });
  it.each([
    "line L in @| = segment(start: (0, 0), end: (10, 0))",
    "line L [Ink] in @|",
    "extract E in @|(source: @L, parts: [p: start..end])",
    "extract E(source: @L, parts: [p in @|: start..end])",
    "svg S(\n layers: [\n @outline,\n @|\n ],\n)",
    "print P(layers: [@|"
  ])("uses shared semantic candidates implicitly and explicitly: %s", marked => {
    const text = "nui 1\n// 😀\nlayer outline\nlayer seam\nlayer guide\n" + marked;
    const pos = text.indexOf("|");
    const doc = text.replace("|", "");
    const state = EditorState.create({ doc });
    for (const explicit of [false, true]) {
      const result = sourceFor(doc)(new CompletionContext(state, pos, explicit));
      expect(result).not.toBeInstanceOf(Promise);
      if (!result || result instanceof Promise) throw new Error("Expected synchronous completion");
      expect(result.options.map(o => o.label)).toEqual(["default", "outline", "seam", "guide"]);
      expect(result.from).toBe(pos);
      expect(result.to).toBe(pos);
      expect(result.validFor).toBeUndefined();
      const seam = result.options.find(o => o.label === "seam")!;
      expect(seam.apply).toBe("seam");
      expect(doc.slice(0, result.from) + seam.apply + doc.slice(result.to)).toBe(text.replace("@|", "@seam"));
    }
  });

  it("filters prefixes and replaces quoted names through the shared range", () => {
    const marked = 'nui 1\nlayer outside\nmodule M() {\nlayer "縫い 線"\nline L in @"縫い| 線" = segment(start: (0, 0), end: (10, 0))\n}';
    const doc = marked.replace("|", "");
    const state = EditorState.create({ doc });
    const result = sourceFor(doc)(new CompletionContext(state, marked.indexOf("|"), false));
    if (!result || result instanceof Promise) throw new Error("Expected synchronous completion");
    expect(result.options.map(o => o.label)).toEqual(["縫い 線"]);
    expect(result.options[0]?.apply).toBe('"縫い 線"');
    expect(doc.slice(result.from, result.to)).toBe('"縫い 線"');
  });

  it("invalidates the open list for edits outside the token and handles real Undo/Redo", async () => {
    const initial = "nui 1\nlayer seam\nline L in @";
    const completion = sourceFor(initial);
    const view = new EditorView({ parent: document.createElement("div"), state: EditorState.create({
      doc: initial, selection: { anchor: initial.length }, extensions: [history(), autocompletion({ override: [completion] })]
    }) });
    try {
      startCompletion(view);
      await vi.waitFor(() => expect(currentCompletions(view.state).map(c => c.label)).toEqual(["default", "seam"]));
      view.dispatch({ changes: { from: initial.indexOf("seam"), to: initial.indexOf("seam") + 4, insert: "guide" } });
      expect(currentCompletions(view.state).map(c => c.label)).not.toContain("seam");
      const labels = async () => {
        const result = await completion(new CompletionContext(view.state, view.state.doc.length, true));
        return result?.options.map(o => o.label);
      };
      expect(await labels()).toEqual(["default", "guide"]);
      expect(undo(view)).toBe(true);
      expect(await labels()).toEqual(["default", "seam"]);
      expect(redo(view)).toBe(true);
      expect(await labels()).toEqual(["default", "guide"]);
    } finally {
      view.destroy();
    }
  });
});
