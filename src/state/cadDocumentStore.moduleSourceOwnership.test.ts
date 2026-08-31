import { beforeEach, describe, expect, it } from "vitest";
import { moveBezierHandleByDelta } from "../commands/geometryEditCommands";
import type { CadElement } from "../types/geometry";
import { effectiveElementActivityById } from "../model/elementActivity";
import { setParameterValue } from "../parameters/parameterAccess";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const moduleSource = [
  "nui 1",
  "module M() {",
  "  point P = coordinate(x: 1, y: 2)",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const geometryParameterModuleSource = [
  "nui 1",
  "line Base = segment(start: (0, 0), end: (10, 0))",
  "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
  "module M(path: path, side: choice(right, left) = left) {",
  "  point P = onLine(from: @path.end, ratio: 0.5)",
  "  line Copy = offset(",
  "    sources: [@path],",
  "    distance: 1,",
  "    side: @side,",
  "    closed: false,",
  "    suppressTrimWarnings: false",
  "  )",
  "}",
  "instance BaseInstance = M(path: @Base)",
  "instance ArcInstance = M(path: @A)"
].join("\n");

const pointParameterModuleSource = [
  "nui 1",
  "point BasePoint = coordinate(x: 0, y: 0)",
  "point OtherPoint = coordinate(x: 10, y: 0)",
  "module PointModule(p: point) {",
  "  point P = offset(from: @p, dx: 1, dy: 2)",
  "}",
  "instance FirstPoint = PointModule(p: @BasePoint)",
  "instance SecondPoint = PointModule(p: @OtherPoint)"
].join("\n");

const omittedLiteralModuleSource = [
  "nui 1",
  "module M() {",
  "  point P = coordinate()",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const multilineOmittedLiteralModuleSource = [
  "nui 1",
  "module M() {",
  "  point P = coordinate(",
  "    // keep this source comment",
  "  )",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const coordinateAnchorModuleSource = [
  "nui 1",
  "module M() {",
  "  line L = segment(start: (0, 0), end: (10, 0))",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const placementModuleSource = [
  "nui 1",
  "module M() {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 10, y: 0)",
  "  point D = between(start: @A, end: @B, ratio: 0.5)",
  "}",
  "instance First = M()",
  "instance Second = M()"
].join("\n");

const bezierModuleSource = [
  "nui 1",
  "module M(origin: point) {",
  "  curve Curve = bezier(start: @origin, end: (100, 0), startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)",
  "}",
  "instance First = M(origin: (0, 0))",
  "instance Second = M(origin: (40, 20))"
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
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
    expect(state.sourceText).toContain("x: 7");
    expect(state.sourceText).not.toContain("x: 1");
    const points = state.elements.filter(
      (element): element is Extract<CadElement, { type: "freePoint" }> => element.name === "P" && element.type === "freePoint"
    );
    expect(points.map((element) => element.x)).toEqual([7, 7]);
  });

  it("routes a materialized Bezier handle drag through the authored Module body", () => {
    seed(bezierModuleSource);
    const first = elementNamed("First")!;
    const firstCurve = elementNamed("Curve", first.id)!;
    const second = elementNamed("Second")!;
    const secondCurve = elementNamed("Curve", second.id)!;
    expect(firstCurve.id).not.toBe(secondCurve.id);

    const result = moveBezierHandleByDelta({
      elementId: firstCurve.id,
      dx: 0,
      dy: 20,
      bezierHandleRole: "start"
    });

    expect(result).toEqual({ status: "applied" });
    const state = useCadDocumentStore.getState();
    expect(state.sourceText.match(/curve Curve/g)).toHaveLength(1);
    expect(state.sourceText).not.toContain(firstCurve.id);
    expect(state.sourceText).not.toContain(secondCurve.id);
    const firstAfter = elementNamed("Curve", elementNamed("First")!.id)!;
    const secondAfter = elementNamed("Curve", elementNamed("Second")!.id)!;
    expect(firstAfter).toMatchObject({ startHandleAngleDeg: 45 });
    expect(secondAfter).toMatchObject({ startHandleAngleDeg: 45 });
    expect((firstAfter as Extract<CadElement, { type: "bezierCurve" }>).startHandleLength).toBeCloseTo(Math.sqrt(800));
    expect((secondAfter as Extract<CadElement, { type: "bezierCurve" }>).startHandleLength).toBeCloseTo(Math.sqrt(800));
  });

  it("patches only a literal line parameter while preserving a lowered geometry parameter reference", () => {
    seed(geometryParameterModuleSource);
    const baseInstance = elementNamed("BaseInstance")!;
    const arcInstance = elementNamed("ArcInstance")!;
    const baseCopy = elementNamed("Copy", baseInstance.id) as Extract<CadElement, { type: "offsetLine" }>;
    const arcCopy = elementNamed("Copy", arcInstance.id) as Extract<CadElement, { type: "offsetLine" }>;

    useCadDocumentStore.getState().updateElement(baseCopy.id, { offset: 7 });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("module M(path: path, side: choice(right, left) = left) {");
    expect(state.sourceText).toContain("sources: [@path]");
    expect(state.sourceText).toContain("side: @side");
    expect(state.sourceText).not.toContain("sources: [Base]");
    expect(state.sourceText).not.toContain("sources: [A]");
    expect(state.sourceText).toContain("distance: 7");
    expect(state.sourceText).toContain("instance BaseInstance = M(path: @Base)");
    expect(state.sourceText).toContain("instance ArcInstance = M(path: @A)");
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
    expect(state.sourceText).toContain("point P = offset(from: @p, dx: 1, dy: 9)");
    expect(state.sourceText).not.toContain("from: BasePoint");
    expect(state.sourceText).not.toContain("from: OtherPoint");
    expect(state.sourceText).toContain("instance FirstPoint = PointModule(p: @BasePoint)");
    expect(state.sourceText).toContain("instance SecondPoint = PointModule(p: @OtherPoint)");
    const points = state.elements.filter(
      (element): element is Extract<CadElement, { type: "offsetPoint" }> => element.name === "P" && element.type === "offsetPoint"
    );
    expect(points.map((element) => element.dy)).toEqual([9, 9]);
    expect(points.map((element) => element.fromPoint)).toEqual([
      { mode: "reference", pointId: state.elements.find((element) => element.name === "BasePoint")!.id },
      { mode: "reference", pointId: state.elements.find((element) => element.name === "OtherPoint")!.id }
    ]);
  });

  it("inserts an omitted safe literal argument without flattening the module", () => {
    seed(omittedLiteralModuleSource);
    const first = elementNamed("First")!;
    const firstPoint = elementNamed("P", first.id)! as Extract<CadElement, { type: "freePoint" }>;

    useCadDocumentStore.getState().updateElement(firstPoint.id, { x: 7 });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point P = coordinate(x: 7)");
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
    expect(state.elements.filter((element) => element.name === "P").map((element) => (element as Extract<CadElement, { type: "freePoint" }>).x)).toEqual([7, 7]);
  });

  it("inserts an omitted argument in a multiline call while preserving comments", () => {
    seed(multilineOmittedLiteralModuleSource);
    const first = elementNamed("First")!;
    const firstPoint = elementNamed("P", first.id)!;

    useCadDocumentStore.getState().updateElement(firstPoint.id, { x: 7 });

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("// keep this source comment");
    expect(state.sourceText).toContain("x: 7");
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.elements.filter((element) => element.name === "P").map((element) => (element as Extract<CadElement, { type: "freePoint" }>).x)).toEqual([7, 7]);
  });

  it("patches module-body activity in the definition and rematerializes every call", () => {
    seed(moduleSource);
    const first = elementNamed("First")!;
    const firstPoint = elementNamed("P", first.id)!;

    useCadDocumentStore.getState().updateElement(firstPoint.id, { activity: "hidden" });
    let state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point P = coordinate(x: 1, y: 2, state: hidden)");
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.elements.filter((element) => element.name === "P").map((element) => element.activity)).toEqual(["hidden", "hidden"]);

    const hiddenPoint = elementNamed("P", first.id)!;
    useCadDocumentStore.getState().updateElement(hiddenPoint.id, { activity: "disabled" });
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("state: disabled");
    expect(state.elements.filter((element) => element.name === "P").map((element) => element.activity)).toEqual(["disabled", "disabled"]);

    const disabledPoint = elementNamed("P", first.id)!;
    useCadDocumentStore.getState().updateElement(disabledPoint.id, { activity: "visible" });
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("state: visible");
    expect(state.elements.filter((element) => element.name === "P").map((element) => element.activity)).toEqual(["visible", "visible"]);
  });

  it("patches only a coordinate component when the anchor parent is synthetic", () => {
    seed(coordinateAnchorModuleSource);
    const first = elementNamed("First")!;
    const firstLine = elementNamed("L", first.id)!;
    const edited = setParameterValue(firstLine, "startPoint:x", 5);
    const result = useCadDocumentStore.getState().commitDocumentChange({
      elements: useCadDocumentStore.getState().elements.map((element) => element.id === firstLine.id ? edited : element)
    });

    expect(result).toEqual({ status: "applied" });
    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("start: (5, 0)");
    expect(state.sourceText).toContain("end: (10, 0)");
    expect(state.sourceText.match(/line L/g)).toHaveLength(1);
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.elements.filter((element) => element.name === "L").map((element) => (element as Extract<CadElement, { type: "line" }>).startPoint)).toEqual([
      { mode: "coordinate", x: 5, y: 0 },
      { mode: "coordinate", x: 5, y: 0 }
    ]);
  });

  it("keeps safe synthetic placement edits source-owned", () => {
    seed(placementModuleSource);
    const first = elementNamed("First")!;
    const firstDivision = elementNamed("D", first.id)!;
    useCadDocumentStore.getState().updateElement(firstDivision.id, { placement: { kind: "ratio", value: 0.75 } } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point D = between(start: @A, end: @B, ratio: 0.75)");
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.elements.filter((element) => element.name === "D").map((element) => (element as Extract<CadElement, { type: "divisionPoint" }>).placement)).toEqual([
      { kind: "ratio", value: 0.75 },
      { kind: "ratio", value: 0.75 }
    ]);
  });

  it("rejects a module geometry reference change without flattening source", () => {
    seed(geometryParameterModuleSource);
    const before = useCadDocumentStore.getState().sourceText;
    const first = elementNamed("BaseInstance")!;
    const copy = elementNamed("Copy", first.id)!;
    const replacement = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    const edited = setParameterValue(copy, "baseLineIds", [replacement.id]);
    const result = useCadDocumentStore.getState().commitDocumentChange({
      elements: useCadDocumentStore.getState().elements.map((element) => element.id === copy.id ? edited : element)
    });

    expect(result).toEqual({ status: "rejected", reason: "invalid-change" });
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("sources: [Base]");
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");
  });

  it("keeps module syntax while editing an ordinary geometry outside the module", () => {
    seed([
      "nui 1",
      "point Outside = coordinate(x: 0, y: 0)",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance First = M()",
      "instance Second = M()"
    ].join("\n"));
    const outside = elementNamed("Outside")!;
    useCadDocumentStore.getState().updateElement(outside.id, { x: 9 } as Partial<CadElement>);

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("point Outside = coordinate(");
    expect(state.sourceText).toContain("x: 9");
    expect(state.sourceText).toContain("module M() {");
    expect(state.sourceText.match(/instance (First|Second) = M\(\)/g)).toHaveLength(2);
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
  });

  it("maps module instance activity to the call statement without changing definition source", () => {
    seed(moduleSource);
    const first = elementNamed("First")!;
    useCadDocumentStore.getState().updateElement(first.id, { activity: "hidden" } as Partial<CadElement>);

    let state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("instance First(state: hidden) = M()");
    expect(state.sourceText).toContain("instance Second = M()");
    expect(state.sourceText.match(/point P/g)).toHaveLength(1);
    const activities = effectiveElementActivityById(state.elements);
    expect(activities.get(state.elements.find((element) => element.name === "P" && element.parentGroupId === first.id)!.id)?.activity).toBe("hidden");

    useCadDocumentStore.getState().updateElement(first.id, { activity: "visible" } as Partial<CadElement>);
    state = useCadDocumentStore.getState();
    expect(state.sourceText).toContain("instance First = M()");
    expect(state.sourceText).not.toContain("instance First(state:");
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
    expect(useCadDocumentStore.getState().sourceText).toContain("instance First = M()");
    expect(useCadDocumentStore.getState().sourceText).toContain("instance Second = M()");
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
