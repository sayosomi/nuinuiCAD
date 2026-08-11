import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { effectiveElementActivityById } from "../model/elementActivity";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const moduleSource = [
  "nui 3",
  "module M() {",
  "  point P = coordinate(x: 1, y: 2)",
  "}",
  "module First = M()",
  "module Second = M()"
].join("\n");

const geometryParameterModuleSource = [
  "nui 3",
  "line Base = segment(start: (0, 0), end: (10, 0))",
  "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
  "module M(path: line, side: choice(right, left) = left) {",
  "  point P = onLine(from: path.end, ratio: 0.5)",
  "  line Copy = offset(",
  "    sources: [path],",
  "    distance: 1,",
  "    side: @side,",
  "    closed: false,",
  "    suppressTrimWarnings: false",
  "  )",
  "}",
  "module BaseInstance = M(path: Base)",
  "module ArcInstance = M(path: A)"
].join("\n");

const pointParameterModuleSource = [
  "nui 3",
  "point BasePoint = coordinate(x: 0, y: 0)",
  "point OtherPoint = coordinate(x: 10, y: 0)",
  "module PointModule(p: point) {",
  "  point P = offset(from: p, dx: 1, dy: 2)",
  "}",
  "module FirstPoint = PointModule(p: BasePoint)",
  "module SecondPoint = PointModule(p: OtherPoint)"
].join("\n");

const seed = (source: string) => {
  useCadDocumentStore.getState().commitText(source, "test");
  useCadDocumentStore.setState({ past: [], future: [] });
};

const elementNamed = (name: string, parentGroupId?: string) =>
  useCadDocumentStore.getState().elements.find((element) =>
    element.name === name && (parentGroupId === undefined || element.parentGroupId === parentGroupId)
  );

describe("module source-owned model mutation", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("patches a definition statement once and rematerializes every instance", () => {
    seed(moduleSource);
    const first = elementNamed("First")!;
    const firstPoint = elementNamed("P", first.id)!;
    useCadDocumentStore.getState().updateElement(firstPoint.id, { x: 7 } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("module M() {");
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
    expect(state.sourceText).toContain("x: 7");
    expect(state.sourceText).not.toContain("x: 1");
    const points = state.elements.filter(
      (element): element is Extract<CadElement, { type: "freePoint" }> => element.name === "P" && element.type === "freePoint"
    );
    expect(points.map((element) => element.x)).toEqual([7, 7]);
  });

  it("patches only a literal line parameter while preserving a lowered geometry parameter reference", () => {
    seed(geometryParameterModuleSource);
    const baseInstance = elementNamed("BaseInstance")!;
    const arcInstance = elementNamed("ArcInstance")!;
    const baseCopy = elementNamed("Copy", baseInstance.id) as Extract<CadElement, { type: "offsetLine" }>;
    const arcCopy = elementNamed("Copy", arcInstance.id) as Extract<CadElement, { type: "offsetLine" }>;

    useCadDocumentStore.getState().updateElement(baseCopy.id, { offset: 7 });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("module M(path: line, side: choice(right, left) = left) {");
    expect(state.sourceText).toContain("sources: [path]");
    expect(state.sourceText).toContain("side: @side");
    expect(state.sourceText).not.toContain("sources: [Base]");
    expect(state.sourceText).not.toContain("sources: [A]");
    expect(state.sourceText).toContain("distance: 7");
    expect(state.sourceText).toContain("module BaseInstance = M(path: Base)");
    expect(state.sourceText).toContain("module ArcInstance = M(path: A)");
    expect(state.sourceText.match(/line Copy/g)).toHaveLength(1);
    expect((state.elements.find((element) => element.id === baseCopy.id) as Extract<CadElement, { type: "offsetLine" }>).baseLineIds).toEqual([
      state.elements.find((element) => element.name === "Base")!.id
    ]);
    expect((state.elements.find((element) => element.id === arcCopy.id) as Extract<CadElement, { type: "offsetLine" }>).baseLineIds).toEqual([
      state.elements.find((element) => element.name === "A")!.id
    ]);
    expect((state.elements.find((element) => element.id === baseCopy.id) as Extract<CadElement, { type: "offsetLine" }>).offset).toBe(7);
    expect((state.elements.find((element) => element.id === arcCopy.id) as Extract<CadElement, { type: "offsetLine" }>).offset).toBe(7);
  });

  it("patches a literal point parameter while preserving the authored geometry parameter token", () => {
    seed(pointParameterModuleSource);
    const firstInstance = elementNamed("FirstPoint")!;
    const firstPoint = elementNamed("P", firstInstance.id) as Extract<CadElement, { type: "offsetPoint" }>;

    useCadDocumentStore.getState().updateElement(firstPoint.id, { dy: 9 });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point P = offset(from: p, dx: 1, dy: 9)");
    expect(state.sourceText).not.toContain("from: BasePoint");
    expect(state.sourceText).not.toContain("from: OtherPoint");
    expect(state.sourceText).toContain("module FirstPoint = PointModule(p: BasePoint)");
    expect(state.sourceText).toContain("module SecondPoint = PointModule(p: OtherPoint)");
    const points = state.elements.filter(
      (element): element is Extract<CadElement, { type: "offsetPoint" }> => element.name === "P" && element.type === "offsetPoint"
    );
    expect(points.map((element) => element.dy)).toEqual([9, 9]);
    expect(points.map((element) => element.fromPoint)).toEqual([
      { mode: "reference", pointId: state.elements.find((element) => element.name === "BasePoint")!.id },
      { mode: "reference", pointId: state.elements.find((element) => element.name === "OtherPoint")!.id }
    ]);
  });

  it("keeps module syntax while editing an ordinary geometry outside the module", () => {
    seed([
      "nui 3",
      "point Outside = coordinate(x: 0, y: 0)",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module First = M()",
      "module Second = M()"
    ].join("\n"));
    const outside = elementNamed("Outside")!;
    useCadDocumentStore.getState().updateElement(outside.id, { x: 9 } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point Outside = coordinate(");
    expect(state.sourceText).toContain("x: 9");
    expect(state.sourceText).toContain("module M() {");
    expect(state.sourceText.match(/module (First|Second) = M\(\)/g)).toHaveLength(2);
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
  });

  it("maps module instance activity to the call statement without changing definition source", () => {
    seed(moduleSource);
    const first = elementNamed("First")!;
    useCadDocumentStore.getState().updateElement(first.id, { activity: "hidden" } as Partial<CadElement>);

    let state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("module First(state: hidden) = M()");
    expect(state.sourceText).toContain("module Second = M()");
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
    const activities = effectiveElementActivityById(state.elements);
    expect(activities.get(state.elements.find((element) => element.name === "P" && element.parentGroupId === first.id)!.id)?.activity).toBe("hidden");

    useCadDocumentStore.getState().updateElement(first.id, { activity: "visible" } as Partial<CadElement>);
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("module First = M()");
    expect(state.sourceText).not.toContain("module First(state:");
  });

  it("fails closed for a structural runtime mutation instead of flattening the module", () => {
    seed(moduleSource);
    const before = useCadDocumentStore.getState();
    const result = useCadDocumentStore.getState().commitDocumentChange({
      elements: [...before.elements, { ...before.elements[0], id: "unsafe-extra" } as CadElement]
    });

    expect(result).toEqual({ status: "rejected", reason: "invalid-change" });
    expect(useCadDocumentStore.getState().sourceText).toBe(moduleSource);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("unsafe-extra");
  });

  it("fails closed for an unsupported evaluation boundary change instead of rewriting module source", () => {
    seed(moduleSource);
    const before = useCadDocumentStore.getState().sourceText;
    const result = useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    expect(result).toEqual({ status: "rejected", reason: "invalid-change" });
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadDocumentStore.getState().sourceText).toContain("module M() {");
    expect(useCadDocumentStore.getState().sourceText).toContain("module First = M()");
    expect(useCadDocumentStore.getState().sourceText).toContain("module Second = M()");
  });

  it("refuses a stale module runtime compatibility rebase instead of serializing its runtime view", () => {
    seed(moduleSource);
    const before = useCadDocumentStore.getState().sourceText;
    const staleElements = useCadDocumentStore.getState().elements.slice(1);
    useCadDocumentStore.setState({ elements: staleElements });

    const result = useCadDocumentStore.getState().commitDocumentChange({});

    expect(result).toEqual({ status: "rejected", reason: "invalid-change" });
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");
  });
});
