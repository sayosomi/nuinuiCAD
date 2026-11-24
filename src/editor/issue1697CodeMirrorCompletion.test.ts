import {
  acceptCompletion,
  autocompletion,
  currentCompletions,
  setSelectedCompletion,
  startCompletion
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { compileDslDocument, parseDslSnapshot, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { createDslCompletionSource } from "./cmAutocomplete";

const compileWithIds = (source: string, sourceRevision = 1697): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue-1697-cm:${index}`]))
  });
};

const sourceFor = (source: string) => {
  const compiled = compileWithIds(source);
  return createDslCompletionSource({
    elements: () => compiled.document?.elements ?? [],
    statementRanges: () => new Map(),
    isComposing: () => false,
    computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined,
    evaluationErrors: () => undefined,
    bindingAnalysis: () => compiled.bindingAnalysis,
    typedDeclarationRanges: () => new Map(),
    scopeBodyRanges: () => [],
    statementInfoByElementId: () => undefined,
    moduleSemanticMetadata: () => compiled,
    semanticSourceRevision: () => compiled.spans.sourceMap.sourceRevision,
    semanticMetadataFresh: () => true
  });
};

const applyNativeCompletion = async (
  source: string,
  cursor: number,
  label: string,
  visibleLabels?: readonly string[]
) => {
  const completion = sourceFor(source);
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      selection: { anchor: cursor },
      extensions: [autocompletion({ override: [completion], interactionDelay: 0 })]
    })
  });
  try {
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).map((item) => item.label)).toContain(label));
    if (visibleLabels) {
      expect(currentCompletions(view.state).map((item) => item.label).sort()).toEqual([...visibleLabels].sort());
    }
    const selectedIndex = currentCompletions(view.state).findIndex((item) => item.label === label);
    view.dispatch({ effects: setSelectedCompletion(selectedIndex) });
    expect(acceptCompletion(view)).toBe(true);
    return view.state.doc.toString();
  } finally {
    view.destroy();
    parent.remove();
  }
};

describe("Issue #1697 CodeMirror completion cutover", () => {
  it("applies a bare numeric binding through CodeMirror and preserves its binding identity", async () => {
    const source = [
      "nui 1",
      "const width: number = 40",
      "const copied: number = wi"
    ].join("\n");
    const cursor = source.length;
    const completed = await applyNativeCompletion(source, cursor, "width");
    expect(completed).toBe(source.slice(0, cursor - 2) + "width");

    const compiled = compileWithIds(completed);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const width = compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "width");
    const copied = compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "copied");
    const initializer = compiled.scalarProgram?.statements.find((statement) => statement.bindingId === copied?.id)?.declaration.initializer;
    expect(initializer).toMatchObject({ kind: "reference", name: "width", bindingId: width?.id });
    expect(completed.includes("@width")).toBe(false);
  });

  it("applies a schema-typed @choice while keeping the marker outside the editable range", async () => {
    const source = "nui 1\nconst selected: choice(left, right) = @le";
    const completed = await applyNativeCompletion(source, source.length, "left", ["left"]);
    expect(completed).toBe("nui 1\nconst selected: choice(left, right) = @left");

    const compiled = compileWithIds(completed);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const selected = compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "selected");
    const initializer = compiled.scalarProgram?.statements.find((statement) => statement.bindingId === selected?.id)?.declaration.initializer;
    expect(initializer).toMatchObject({ kind: "choiceLiteral", value: "left", type: { kind: "choice", options: ["left", "right"] } });
  });

  it("filters and applies a Module @choice value without treating it as a reference", async () => {
    const source = [
      "nui 1",
      "module Choose(side: choice(left, right)) {",
      "}",
      "instance Use = Choose(side: @le)"
    ].join("\n");
    const completed = await applyNativeCompletion(source, source.length - 1, "left", ["left"]);
    expect(completed).toBe(source.replace("@le)", "@left)"));

    const compiled = compileWithIds(completed);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === "Use");
    expect(instance?.parameterBindings.some((binding) => binding.parameterName === "side")).toBe(true);
  });
});
