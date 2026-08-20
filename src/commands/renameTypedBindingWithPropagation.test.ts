import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import type { BindingId } from "../scalars/bindingCatalog";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { renameTypedBindingWithPropagation } from "./renameTypedBindingWithPropagation";

const seed = (sourceText: string) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
};

const typedBindingId = (name: string): BindingId =>
  useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindings.find(
    (binding) => binding.kind === "typed" && binding.name === name
  )!.id;

const changedLines = (before: string, after: string) => before.split("\n").flatMap((line, index) =>
  line === after.split("\n")[index] ? [] : [index + 1]
);

describe("renameTypedBindingWithPropagation", () => {
  let unregister = () => {};

  beforeEach(() => {
    unregister = () => {};
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => unregister());

  it("patches declaration, initializer, set-rhs, and set-target occurrences, leaving comments/blank lines/unrelated statements untouched, tagged model-patch, in one Undo step", () => {
    const source = [
      "nui 4",
      "// keep this comment",
      "let base: number = 1",
      "let derived: number = @base",
      "",
      "let mirror: number = 0",
      "set mirror = @base + 1",
      "set base = 2",
      "// leave this alone"
    ].join("\n");
    seed(source);
    const before = useCadDocumentStore.getState().sourceText;
    const id = typedBindingId("base");

    expect(renameTypedBindingWithPropagation(id, "renamed")).toBe(true);

    const state = useCadDocumentStore.getState();
    expect(changedLines(before, state.sourceText)).toEqual([3, 4, 7, 8]);
    expect(state.sourceText).toContain("// keep this comment");
    expect(state.sourceText).toContain("// leave this alone");
    expect(state.sourceText).toContain("let renamed: number = 1");
    expect(state.sourceText).toContain("let derived: number = @renamed");
    expect(state.sourceText).toContain("set mirror = @renamed + 1");
    expect(state.sourceText).toContain("set renamed = 2");
    expect(state.sourceUpdate).toMatchObject({ revision: state.sourceRevision, kind: "model-patch" });
    expect(state.past).toHaveLength(1);
    expect(state.doc.bindingAnalysis!.catalog.bindingsById.get(id)?.name).toBe("renamed");
  });

  it("patches a typed text-template-hole reference", () => {
    const source = ["nui 4", "let amount: number = 5", 'text T = label(text: "${@amount}", anchor: none, size: 3)'].join("\n");
    seed(source);
    const id = typedBindingId("amount");

    expect(renameTypedBindingWithPropagation(id, "qty")).toBe(true);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("let qty: number = 5");
    expect(state.sourceText).toContain('text: "${@qty}"');
  });

  it("patches a typed property-binding reference", () => {
    const source = ["nui 4", "let flag: boolean = true", "for i in range(from: 0, count: 1, showGenerated: @flag) {", "}"].join("\n");
    seed(source);
    const id = typedBindingId("flag");

    expect(renameTypedBindingWithPropagation(id, "enabled")).toBe(true);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("let enabled: boolean = true");
    expect(state.sourceText).toContain("showGenerated: @enabled");
  });

  it("treats an already canonical same-name rename as a successful no-op", () => {
    const source = ["nui 4", "const base: number = 1"].join("\n");
    seed(source);
    const id = typedBindingId("base");
    useCadUiStore.getState().setCommandErrorMessage("previous error");
    const before = useCadDocumentStore.getState();

    expect(renameTypedBindingWithPropagation(id, "base")).toBe(true);

    const after = useCadDocumentStore.getState();
    expect(after.sourceText).toBe(before.sourceText);
    expect(after.past).toBe(before.past);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.sourceUpdate).toBe(before.sourceUpdate);
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
  });

  it("flushes pending text, then analyzes and patches the flushed document as its own, second Undo step", () => {
    seed(["nui 4", "let base: number = 1", "let derived: number = @base"].join("\n"));
    const id = typedBindingId("base");
    let pending = true;
    unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush: () => {
        pending = false;
        useCadDocumentStore.getState().commitText(
          ["nui 4", "let base: number = 9", "let derived: number = @base"].join("\n"),
          "editor"
        );
        return "flushed";
      }
    });

    expect(renameTypedBindingWithPropagation(id, "renamed")).toBe(true);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("let renamed: number = 9");
    expect(state.sourceText).toContain("let derived: number = @renamed");
    expect(state.past).toHaveLength(2);
  });

  it("rejects composition and error-source requests without any mutation", () => {
    seed(["nui 4", "const base: number = 1"].join("\n"));
    const id = typedBindingId("base");
    const compositionBefore = useCadDocumentStore.getState();
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush: () => "blocked-composition"
    });

    expect(renameTypedBindingWithPropagation(id, "blocked")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(compositionBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(compositionBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("日本語入力");

    unregister();
    seed("nui 4\nconst base: number = 1\nlet broken: number = (");
    const errorBefore = useCadDocumentStore.getState();
    expect(renameTypedBindingWithPropagation(id, "broken2")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(errorBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(errorBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("DSLテキストにエラー");
  });

  it("rejects a same-scope collision without changing source or history, then permits a retry", () => {
    seed(["nui 4", "const a: number = 1", "const b: number = 2"].join("\n"));
    const id = typedBindingId("a");
    const documentBefore = useCadDocumentStore.getState();

    expect(renameTypedBindingWithPropagation(id, "b")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(documentBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(documentBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("b");

    expect(renameTypedBindingWithPropagation(id, "renamed")).toBe(true);
    expect(useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindingsById.get(id)?.name).toBe("renamed");
  });

  it("rejects an outer rename captured by an inner shadow, without changing source or history", () => {
    const source = [
      "nui 4",
      "const outer: number = 1",
      "group G {",
      "const inner: number = 2",
      "let usesOuter: number = @outer",
      "}"
    ].join("\n");
    seed(source);
    const id = typedBindingId("outer");
    const documentBefore = useCadDocumentStore.getState();

    expect(renameTypedBindingWithPropagation(id, "inner")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(documentBefore.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(documentBefore.past);
    expect(useCadUiStore.getState().commandErrorMessage).not.toBeNull();
  });

  it("uses one rename snapshot; undo/redo restore exact text and the binding's identity", () => {
    const source = ["nui 4", "let base: number = 1", "let derived: number = @base"].join("\n");
    seed(source);
    const id = typedBindingId("base");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(renameTypedBindingWithPropagation(id, "renamed")).toBe(true);
    const renamedText = useCadDocumentStore.getState().sourceText;
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    expect(useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindingsById.get(id)?.name).toBe("renamed");

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindingsById.get(id)?.name).toBe("base");

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(renamedText);
    expect(useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindingsById.get(id)?.name).toBe("renamed");
  });
});
