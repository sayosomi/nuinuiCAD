import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const groupModuleSource = [
  "nui 4",
  "module M() {",
  "  group G {",
  "    point P = coordinate(x: 0, y: 0)",
  "  }",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const forModuleSource = [
  "nui 4",
  "module M() {",
  "  # keep this for source comment",
  "  for i in range(from: 0, count: 2) {",
  "    point P = coordinate(x: i, y: 0)",
  "  }",
  "}",
  "instance First = M()",
  "instance Second = M()"
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
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
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
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.sourceText.match(/group G/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "G").map((element) => (element as Extract<CadElement, { type: "group" }>).printEnabled)).toEqual([true, true]);
  });

  it("adds an omitted for step after the positional variable without changing the body", () => {
    seed(forModuleSource);
    const first = elementNamed("First")!;
    const loop = useCadDocumentStore.getState().elements.find((element) => element.type === "forGroup" && element.parentGroupId === first.id)!;

    useCadDocumentStore.getState().updateElement(loop.id, { step: 2 } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("# keep this for source comment");
    expect(state.sourceText).toContain("for i in range(from: 0, count: 2, step: 2) {");
    expect(state.sourceText).toContain("point P = coordinate(x: i, y: 0)");
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.sourceText.match(/for i in range/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.type === "forGroup").map((element) => (element as Extract<CadElement, { type: "forGroup" }>).step)).toEqual([2, 2]);
  });

});
