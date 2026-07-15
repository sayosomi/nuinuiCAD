import { describe, expect, it } from "vitest";
import type { CadElement, ComputedGeometry, ComputedLine, ComputedPoint, DependencyError, EvaluationResult } from "../types/geometry";
import {
  elementParameterReferenceOptionsForPosition,
  referenceablePathsForElement
} from "./elementParameterReferenceOptions";

const point = (id: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

const lineGeometry = (elementId: string): ComputedLine => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: null,
  endPointId: null,
  start: point("a", 0, 0),
  end: point("b", 10, 0),
  length: 10,
  startAngleDeg: 0,
  endAngleDeg: 0,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0
});

const lineElement = (id: string, name: string): CadElement => ({
  id,
  name,
  type: "line",
  visible: true,
  enabled: true,
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  endPoint: { mode: "coordinate", x: 10, y: 0 }
});

const forGroupElement = (id: string, name: string): CadElement => ({
  id,
  name,
  type: "forGroup",
  visible: true,
  enabled: true,
  variableName: "i",
  start: 0,
  count: 5,
  step: 1,
  showGenerated: true
});

const variableElement = (id: string, name: string): CadElement => ({
  id,
  name,
  type: "variable",
  visible: true,
  enabled: true,
  scope: "global",
  valueMode: "expression",
  expression: 42,
  point1: { mode: "coordinate", x: 0, y: 0 },
  point2: { mode: "coordinate", x: 0, y: 0 },
  point: { mode: "coordinate", x: 0, y: 0 },
  lineId: ""
});

const baseEvaluation = (overrides: Partial<EvaluationResult> = {}): EvaluationResult => ({
  computedGeometry: new Map<string, ComputedGeometry>(),
  computedVariables: new Map(),
  errors: [],
  warnings: [],
  effectiveEnabledElementIds: new Set(),
  ...overrides
});

describe("referenceablePathsForElement", () => {
  it("lists geometry-derived paths for an enabled, computed line", () => {
    const element = lineElement("line1", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set(["line1"])
    });
    const paths = referenceablePathsForElement(element, [element], evaluation).map((item) => item.path);
    expect(paths).toContain("length");
    expect(paths).toContain("startTangentAngleDeg");
    expect(paths).toContain("endTangentAngleDeg");
  });

  it("excludes a disabled element's saved params, even though the raw value would trivially evaluate", () => {
    // forGroup exposes params.start/count/step as plain number-kind
    // parameters with no geometry entry at all - numericReferenceValueForPath
    // would happily evaluate the literal 0/5/1 values on their own merit.
    // The eligibility gate must still suppress them because the element
    // itself isn't in effectiveEnabledElementIds.
    const element = forGroupElement("fg1", "forブロック1");
    const evaluation = baseEvaluation({ effectiveEnabledElementIds: new Set() });
    expect(referenceablePathsForElement(element, [element], evaluation)).toEqual([]);
  });

  it("includes an enabled forGroup's params.* paths despite it never getting a computedGeometry entry", () => {
    const element = forGroupElement("fg1", "forブロック1");
    const evaluation = baseEvaluation({ effectiveEnabledElementIds: new Set(["fg1"]) });
    const paths = referenceablePathsForElement(element, [element], evaluation).map((item) => item.path);
    expect(paths).toContain("params.start");
    expect(paths).toContain("params.count");
    expect(paths).toContain("params.step");
  });

  it("excludes an enabled-but-erroring element's params, even though the raw value would trivially evaluate", () => {
    const element = forGroupElement("fg1", "forブロック1");
    const errors: DependencyError[] = [
      { elementId: "fg1", elementName: "forブロック1", missingDependencyId: "fg1", message: "評価エラー" }
    ];
    const evaluation = baseEvaluation({ effectiveEnabledElementIds: new Set(["fg1"]), errors });
    expect(referenceablePathsForElement(element, [element], evaluation)).toEqual([]);
  });

  it("includes value for a computed variable element", () => {
    const element = variableElement("v1", "変数A");
    const evaluation = baseEvaluation({
      computedVariables: new Map([["v1", { kind: "variable" as const, elementId: "v1", name: "変数A", value: 42 }]]),
      effectiveEnabledElementIds: new Set(["v1"])
    });
    const paths = referenceablePathsForElement(element, [element], evaluation).map((item) => item.path);
    expect(paths).toContain("value");
  });

  it("treats a missing effectiveEnabledElementIds as unknown eligibility (excludes, never guesses)", () => {
    const element = lineElement("line1", "直線AB");
    const evaluation: EvaluationResult = {
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      computedVariables: new Map(),
      errors: [],
      warnings: []
    };
    expect(referenceablePathsForElement(element, [element], evaluation)).toEqual([]);
  });
});

describe("elementParameterReferenceOptionsForPosition", () => {
  it("resolves a unique element name and lists its referenceable parameters", () => {
    const element = lineElement("line1", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set(["line1"])
    });
    const options = elementParameterReferenceOptionsForPosition({
      referenceElements: [element],
      elementToken: "直線AB",
      evaluation
    });
    expect(options.map((option) => option.path)).toContain("length");
    expect(options.every((option) => option.elementId === "line1")).toBe(true);
  });

  it("returns no candidates for a missing element name (never guesses)", () => {
    const evaluation = baseEvaluation();
    const options = elementParameterReferenceOptionsForPosition({
      referenceElements: [],
      elementToken: "存在しない要素",
      evaluation
    });
    expect(options).toEqual([]);
  });

  it("returns no candidates for an ambiguous (duplicate) element name", () => {
    const first = lineElement("line1", "直線AB");
    const second = lineElement("line2", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([
        ["line1", lineGeometry("line1")],
        ["line2", lineGeometry("line2")]
      ]),
      effectiveEnabledElementIds: new Set(["line1", "line2"])
    });
    const options = elementParameterReferenceOptionsForPosition({
      referenceElements: [first, second],
      elementToken: "直線AB",
      evaluation
    });
    expect(options).toEqual([]);
  });

  it("excludes an element not present in referenceElements (later in document order / out of scope)", () => {
    const laterElement = lineElement("line1", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set(["line1"])
    });
    // Simulates a position before `line1` was declared: it's simply absent
    // from referenceElements, matching evaluatedElements(elements, insertionIndex).
    const options = elementParameterReferenceOptionsForPosition({
      referenceElements: [],
      elementToken: "直線AB",
      evaluation
    });
    expect(options).toEqual([]);
    void laterElement;
  });
});
