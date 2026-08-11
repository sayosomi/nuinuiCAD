import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const groupModuleSource = [
  "nui 3",
  "module M() {",
  "  group G {",
  "    point P = coordinate(x: 0, y: 0)",
  "  }",
  "}",
  "module First = M()",
  "module Second = M()"
].join("\n");

const forModuleSource = [
  "nui 3",
  "module M() {",
  "  # keep this for source comment",
  "  for Loop (i, from: 0, count: 2) {",
  "    point P = coordinate(x: i, y: 0)",
  "  }",
  "}",
  "module First = M()",
  "module Second = M()"
].join("\n");

const conditionalModuleSource = [
  "nui 3",
  "module M() {",
  "  if C (true) {",
  "    point P = coordinate(x: 0, y: 0)",
  "  }",
  "}",
  "module First = M()",
  "module Second = M()"
].join("\n");

const seed = (source: string) => {
  useCadDocumentStore.getState().commitText(source, "test");
  useCadDocumentStore.setState({ past: [], future: [] });
};

const elementNamed = (name: string, parentGroupId?: string) =>
  useCadDocumentStore.getState().elements.find((element) =>
    element.name === name && (parentGroupId === undefined || element.parentGroupId === parentGroupId)
  );

describe("module source-owned container argument insertion", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("inserts omitted group state into the definition and rematerializes both calls", () => {
    seed(groupModuleSource);
    const first = elementNamed("First")!;
    const group = elementNamed("G", first.id)!;

    useCadDocumentStore.getState().updateElement(group.id, { activity: "hidden" });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("group G (state: hidden) {");
    expect(state.sourceText).toContain("point P = coordinate(x: 0, y: 0)");
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/group G/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "G").map((element) => element.activity)).toEqual(["hidden", "hidden"]);

    const hiddenGroup = elementNamed("G", first.id)!;
    useCadDocumentStore.getState().updateElement(hiddenGroup.id, { activity: "disabled" });
    let next = useCadDocumentStore.getState();
    expect(next.sourceText).toContain("group G (state: disabled) {");
    expect(next.elements.filter((element) => element.name === "G").map((element) => element.activity)).toEqual(["disabled", "disabled"]);

    const disabledGroup = elementNamed("G", first.id)!;
    useCadDocumentStore.getState().updateElement(disabledGroup.id, { activity: "visible" });
    next = useCadDocumentStore.getState();
    expect(next.sourceText).toContain("group G (state: visible) {");
    expect(next.elements.filter((element) => element.name === "G").map((element) => element.activity)).toEqual(["visible", "visible"]);
  });

  it("inserts an omitted group literal while preserving the body and both calls", () => {
    seed(groupModuleSource);
    const first = elementNamed("First")!;
    const group = elementNamed("G", first.id)!;

    useCadDocumentStore.getState().updateElement(group.id, { printEnabled: true } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("group G (printEnabled: true) {");
    expect(state.sourceText).toContain("point P = coordinate(x: 0, y: 0)");
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/group G/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "G").map((element) => (element as Extract<CadElement, { type: "group" }>).printEnabled)).toEqual([true, true]);
  });

  it("adds an omitted for step after the positional variable without changing the body", () => {
    seed(forModuleSource);
    const first = elementNamed("First")!;
    const loop = elementNamed("Loop", first.id)!;

    useCadDocumentStore.getState().updateElement(loop.id, { step: 2 } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("# keep this for source comment");
    expect(state.sourceText).toContain("for Loop (i, from: 0, count: 2, step: 2) {");
    expect(state.sourceText).toContain("point P = coordinate(x: i, y: 0)");
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/for Loop/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "Loop").map((element) => (element as Extract<CadElement, { type: "forGroup" }>).step)).toEqual([2, 2]);
  });

  it("adds omitted conditional state while preserving the positional condition", () => {
    seed(conditionalModuleSource);
    const first = elementNamed("First")!;
    const conditional = elementNamed("C", first.id)!;

    useCadDocumentStore.getState().updateElement(conditional.id, { activity: "hidden" });

    let state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("if C (true, state: hidden) {");
    expect(state.sourceText).toContain("point P = coordinate(x: 0, y: 0)");
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/if C/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "C").map((element) => element.activity)).toEqual(["hidden", "hidden"]);

    const hiddenConditional = elementNamed("C", first.id)!;
    useCadDocumentStore.getState().updateElement(hiddenConditional.id, { activity: "disabled" });
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("if C (true, state: disabled) {");
    expect(state.elements.filter((element) => element.name === "C").map((element) => element.activity)).toEqual(["disabled", "disabled"]);

    const disabledConditional = elementNamed("C", first.id)!;
    useCadDocumentStore.getState().updateElement(disabledConditional.id, { activity: "visible" });
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("if C (true, state: visible) {");
    expect(state.elements.filter((element) => element.name === "C").map((element) => element.activity)).toEqual(["visible", "visible"]);
  });
});
