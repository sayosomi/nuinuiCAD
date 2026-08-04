import { describe, expect, it, vi } from "vitest";
import type { CadElement, ComputedGeometry, ComputedLine, ComputedPoint, DependencyError, EvaluationResult } from "../types/geometry";
import {
  elementParameterCandidateState,
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
  activity: "visible",
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  endPoint: { mode: "coordinate", x: 10, y: 0 }
});

const forGroupElement = (id: string, name: string): CadElement => ({
  id,
  name,
  type: "forGroup",
  activity: "visible",
  variableName: "i",
  start: 0,
  count: 5,
  step: 1,
  showGenerated: true
});

const baseEvaluation = (overrides: Partial<EvaluationResult> = {}): EvaluationResult => ({
  computedGeometry: new Map<string, ComputedGeometry>(),
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

  it("treats a missing effectiveEnabledElementIds as unknown eligibility (excludes, never guesses)", () => {
    const element = lineElement("line1", "直線AB");
    const evaluation: EvaluationResult = {
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
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

describe("elementParameterCandidateState", () => {
  it("reports pending regardless of what evaluation contains, and never calls the TS reference evaluator", async () => {
    const evaluateElementsModule = await import("./evaluate");
    const evaluateElementsSpy = vi.spyOn(evaluateElementsModule, "evaluateElements");
    const element = lineElement("line1", "直線AB");
    // Even a fully-populated, eligible-looking evaluation must not be
    // trusted while the caller says it isn't current - Rust evaluation is
    // asynchronous and a "looks ready" snapshot can still be stale relative
    // to the live document (see useEvaluationEngine.ts).
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set(["line1"])
    });
    const state = elementParameterCandidateState({
      referenceElements: [element],
      elementToken: "直線AB",
      evaluation
    }, false);
    expect(state).toEqual({ status: "pending" });
    expect(evaluateElementsSpy).not.toHaveBeenCalled();
    evaluateElementsSpy.mockRestore();
  });

  it("reports ready with the real candidates once evaluation is current", () => {
    const element = lineElement("line1", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set(["line1"])
    });
    const state = elementParameterCandidateState({
      referenceElements: [element],
      elementToken: "直線AB",
      evaluation
    }, true);
    expect(state.status).toBe("ready");
    expect(state.status === "ready" && state.options.map((option) => option.path)).toContain("length");
  });

  it("reports ready with zero options for a genuinely excluded element when current - never masked as pending", () => {
    // A current evaluation that legitimately excludes the element (disabled,
    // forward reference, dependency error) must read as a confirmed "ready,
    // no candidates" - not "pending". Hiding a real Rust exclusion behind
    // "pending" would be exactly the kind of bug-masking this type exists to
    // prevent.
    const element = lineElement("line1", "直線AB");
    const evaluation = baseEvaluation({
      computedGeometry: new Map([["line1", lineGeometry("line1")]]),
      effectiveEnabledElementIds: new Set() // current evaluation ran and excluded line1
    });
    const state = elementParameterCandidateState({
      referenceElements: [element],
      elementToken: "直線AB",
      evaluation
    }, true);
    expect(state).toEqual({ status: "ready", options: [] });
  });

  it("typed runtime safety: a current Rust result stays authoritative for every exclusion reason, never re-derived via TS evaluation", async () => {
    // effectiveEnabledElementIds/errors already fold together every reason an
    // element can be excluded - disabled, forward reference, an inactive
    // typed conditional-group branch, past @stop, an invalid forGroup scope,
    // or a plain dependency error (see elementIsCurrentlyReferenceable's own
    // doc comment). elementParameterCandidateState must never second-guess a
    // *current* Rust result for any of them, and must never run its own
    // scalarProgram/conditionalGroupConditions-blind TS evaluation as a
    // substitute - doing so could silently disagree with Rust for a typed
    // conditional group or property/numeric binding.
    const evaluateElementsModule = await import("./evaluate");
    const evaluateElementsSpy = vi.spyOn(evaluateElementsModule, "evaluateElements");
    const inactiveConditional = lineElement("cond1", "条件分岐内");
    const forGroupOutOfScope = lineElement("for1", "forGroup要素");
    const erroring = lineElement("err1", "エラー要素");
    const elements = [inactiveConditional, forGroupOutOfScope, erroring];
    // Rust's own bookkeeping: only elements it actually confirms eligible
    // appear in effectiveEnabledElementIds - an inactive conditional branch
    // and an out-of-scope forGroup row are simply absent, exactly like a
    // disabled element; `erroring` is present in computedGeometry (Rust did
    // reach it) but carries a dependency error.
    const evaluation = baseEvaluation({
      computedGeometry: new Map([
        ["cond1", lineGeometry("cond1")],
        ["for1", lineGeometry("for1")],
        ["err1", lineGeometry("err1")]
      ]),
      effectiveEnabledElementIds: new Set(),
      errors: [{ elementId: "err1", elementName: "エラー要素", missingDependencyId: "err1", message: "評価エラー" }]
    });

    for (const [token, element] of [
      ["条件分岐内", inactiveConditional],
      ["forGroup要素", forGroupOutOfScope],
      ["エラー要素", erroring]
    ] as const) {
      const state = elementParameterCandidateState({ referenceElements: elements, elementToken: token, evaluation }, true);
      expect(state).toEqual({ status: "ready", options: [] });
      void element;
    }
    expect(evaluateElementsSpy).not.toHaveBeenCalled();
    evaluateElementsSpy.mockRestore();
  });
});
