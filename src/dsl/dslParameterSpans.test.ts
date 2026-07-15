import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import {
  recordField,
  recordSpans,
  resolveParameterKeyForValueSpan,
  resolveParameterTargetAt,
  resolveParameterValueSpan
} from "./dslParameterSpans";
import { documentDslRefs, serializeElementStatement, serializeElementsToDsl } from "./dslSerializer";
import { phase3aCanonicalParameterSpanSource, phase3aFixtureElementNameByType } from "./dslParameterSpanFixtures";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { elementTypeLabels, type CadElement } from "../types/geometry";
import { evaluateElements } from "../geometry/evaluate";

const compiled = (source: string) => {
  const result = compileDslToElements(source, { elements: [] });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result.elements.at(-1)!;
};

const selectedText = (
  source: string,
  element: ReturnType<typeof compiled>,
  key: string,
  committedLineText = source
) => {
  const span = resolveParameterValueSpan(source, element, key, { committedLineText });
  expect(span).not.toBeNull();
  return source.slice(span!.start, span!.end);
};

type ExpectedSpan = string | { nullReason: string };
const nullSpan = (nullReason: string): ExpectedSpan => ({ nullReason });
const common = (name: string, includeColor = true) => ({
  name,
  ...(includeColor ? { colorId: "accent" } : {}),
  visible: "false",
  enabled: "false",
  locked: "true"
});

const expectationsFor = (element: CadElement): Record<string, ExpectedSpan> => {
  switch (element.type) {
    case "group": return { ...common("G"), printEnabled: "true", printAnchor: "(1, 2)", "printAnchor:x": "1", "printAnchor:y": "2" };
    case "conditionalGroup": return { ...common("Cond"), condition: "1" };
    case "forGroup": return { ...common("Loop"), variableName: "i", start: "0", count: "2", step: "1", showGenerated: "true" };
    case "variable": return { name: "V", enabled: "false", locked: "true", scope: "group", expression: "2" };
    case "freePoint": return { ...common("A"), x: "0", y: "0" };
    case "offsetPoint": return { ...common("Off"), fromPoint: "A", dx: "3", dy: "4" };
    case "polarOffsetPoint": return { ...common("Polar"), fromPoint: "A", angleDeg: "30", distance: "5" };
    case "divisionPoint": return { ...common("Div"), startPoint: "A", endPoint: "B", placementMode: nullSpan("mode selector"), distance: nullSpan("inactive ratio mode"), ratio: "0.25" };
    case "lineDivisionPoint": return { ...common("On"), endpoint: "AB.end", placementMode: nullSpan("mode selector"), distance: "10", ratio: nullSpan("inactive distance mode") };
    case "intersectionPoint": return { ...common("Cross"), line1Id: "AB", line2Id: "CD", intersectionIndex: "0", useExtensions: "true" };
    case "lineTangentOffsetPoint": return { ...common("Tangent"), baseLineId: "Arc", basePoint: "A", tangentAngleDeg: "10", distance: "2" };
    case "line": return { ...common("AB"), startPoint: "A", endPoint: "B" };
    case "angleLengthLine": return { ...common("Angle"), startPoint: "A", angleDeg: "45", length: "30" };
    case "arcLine": return { ...common("Arc"), centerPoint: "A", radius: "20", startAngleDeg: "0", endAngleDeg: "90" };
    case "threePointArcLine": return { ...common("Through"), point1: "A", point2: "C", point3: "B", startAngleDeg: "0", endAngleDeg: "180" };
    case "cornerRadiusArcLine": return { ...common("Corner"), endpoint1: "AB.end", endpoint2: "Angle.start", radius: "5", intersectionIndex: "0" };
    case "edge": return { ...common("Edge", false), endpoint1: "AB.end", endpoint2: "Angle.start", intersectionIndex: "0" };
    case "extendTrim": return { ...common("Extend", false), endpoint: "AB.end", point: "C" };
    case "bezierCurve": {
      const variable = element.numericVariables![0];
      const intermediate = element.intermediatePoints[0];
      return {
        ...common("Curve"),
        [`variable:${variable.id}:value`]: "1 + 2",
        startPoint: "A",
        startHandleAngleDeg: "0",
        startHandleLength: "10",
        [`intermediate:${intermediate.id}:point`]: "(4, 5)",
        [`intermediate:${intermediate.id}:point:x`]: "4",
        [`intermediate:${intermediate.id}:point:y`]: "5",
        [`intermediate:${intermediate.id}:handleAngleDeg`]: "45",
        [`intermediate:${intermediate.id}:incomingHandleLength`]: "6",
        [`intermediate:${intermediate.id}:outgoingHandleLength`]: "7",
        endPoint: "B",
        endHandleAngleDeg: "180",
        endHandleLength: "20"
      };
    }
    case "offsetLine": return { ...common("Seam"), baseLineIds: "[AB]", offset: "4", side: "left", closed: "true", suppressTrimWarnings: "true" };
    case "splitLine": return { ...common("Split"), baseLineId: "AB", splitPoint: "C" };
    case "copyLine": return { ...common("Copy"), startPoint: "A", endPoint: "B", scale: "1.5", angleDeg: "5", mirrorX: "true", baseLineIds: "[AB]" };
    case "symmetricCopyLine": return { ...common("SymCopy"), axisPoint1: "A", axisPoint2: "B", baseLineIds: "[AB]" };
    case "move": return { ...common("Move", false), startPoint: "A", endPoint: "B", scale: "2", angleDeg: "10", mirrorX: "false", baseLineIds: "[AB]" };
    case "symmetricMove": return { ...common("SymMove", false), axisPoint1: "A", axisPoint2: "B", baseLineIds: "[AB]" };
    case "image": return { ...common("Img"), originPoint: "(8, 9)", "originPoint:x": "8", "originPoint:y": "9", scale: "1.25", angleDeg: "15", mirrorX: "true" };
    case "text": return { ...common("Label"), text: '"hello"', anchor: "A", fontSize: "4" };
  }
};

describe("resolveParameterValueSpan", () => {
  it("covers every current element type against canonical, dependency-valid serializer fixtures", () => {
    const compiledFixture = compileDslToElements(phase3aCanonicalParameterSpanSource, { elements: [] });
    expect(compiledFixture.diagnostics).toEqual([]);
    expect(new Set(compiledFixture.elements.map((element) => element.type))).toEqual(new Set(Object.keys(elementTypeLabels)));
    const evaluation = evaluateElements(compiledFixture.elements);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.warnings).toEqual([]);
    const evaluatedNames = new Set(compiledFixture.elements
      .filter((element) => evaluation.computedGeometry.has(element.id))
      .map((element) => element.name));
    expect(evaluatedNames).toEqual(new Set(["EvalA", "EvalB", "EvalAB"]));

    const serializedFixture = serializeElementsToDsl(compiledFixture.elements, { includeIds: true });
    expect(compileDslToElements(serializedFixture, { elements: [] }).diagnostics).toEqual([]);

    const refs = documentDslRefs(compiledFixture.elements);
    for (const type of Object.keys(elementTypeLabels) as CadElement["type"][]) {
      const element = compiledFixture.elements.find((candidate) => candidate.type === type && candidate.name === phase3aFixtureElementNameByType[type])!;
      expect(element).toBeDefined();
      const line = serializeElementStatement(element, refs);
      const expected = expectationsFor(element);
      const definitions = getParameterDefinitions(element);
      expect(Object.keys(expected).sort()).toEqual(definitions.map((definition) => definition.key).sort());
      for (const definition of definitions) {
        const expectation = expected[definition.key]!;
        const span = resolveParameterValueSpan(line, element, definition.key, { committedLineText: line });
        if (typeof expectation !== "string") {
          expect(expectation.nullReason).not.toBe("");
          expect(span).toBeNull();
          continue;
        }
        expect(span).not.toBeNull();
        expect(line.slice(span!.start, span!.end), `${element.type}.${definition.key}`).toBe(expectation);
        expect(resolveParameterKeyForValueSpan(line, element, span!, { committedLineText: line })).toBe(definition.key);
      }
    }
  });

  it("uses serializer spellings while accepting parser-normalized positional and alias attributes", () => {
    const source = "line lower = split Base at=P";
    const element = compiled(source);
    expect(selectedText(source, element, "baseLineId")).toBe("Base");
    expect(selectedText(source, element, "splitPoint")).toBe("P");
  });

  it("selects name tokens separately from the legacy value spans", () => {
    const source = "point \"named point\" = (0, 0)";
    const element = compiled(source);
    expect(selectedText(source, element, "name")).toBe('"named point"');
  });

  it("resolves the most specific parameter for caret and selection without changing legacy spans", () => {
    const source = "line L = (-(a + 1), 20) -> B";
    const element = compiled(source);
    const parent = resolveParameterValueSpan(source, element, "startPoint")!;
    const x = resolveParameterValueSpan(source, element, "startPoint:x")!;
    const y = resolveParameterValueSpan(source, element, "startPoint:y")!;
    expect(resolveParameterTargetAt(source, element, { start: x.start + 1, end: x.start + 1 })?.parameterKey).toBe("startPoint:x");
    // x.end is a terminal boundary for x, but it is normally contained by
    // the parent coordinate span and must not take precedence over it.
    expect(resolveParameterTargetAt(source, element, { start: x.end, end: x.end })?.parameterKey).toBe("startPoint");
    expect(resolveParameterTargetAt(source, element, x)?.parameterKey).toBe("startPoint:x");
    expect(resolveParameterTargetAt(source, element, parent)?.parameterKey).toBe("startPoint");
    expect(resolveParameterTargetAt(source, element, { start: y.start + 1, end: y.start + 1 })?.parameterKey).toBe("startPoint:y");
    expect(resolveParameterTargetAt(source, element, { start: y.end, end: y.end })?.parameterKey).toBe("startPoint");
  });

  it("resolves dirty reference anchors to live coordinate children", () => {
    const committedReference = compiled("line Dirty = A -> B");
    const dirtyCoordinate = "line Dirty = (1, 2) -> B";
    const dirtyX = dirtyCoordinate.indexOf("1");
    const dirtyY = dirtyCoordinate.indexOf("2");
    expect(resolveParameterTargetAt(dirtyCoordinate, committedReference, { start: dirtyX, end: dirtyX })?.parameterKey).toBe("startPoint:x");
    expect(resolveParameterTargetAt(dirtyCoordinate, committedReference, { start: dirtyY, end: dirtyY })?.parameterKey).toBe("startPoint:y");
  });

  it("uses live division mode and rejects duplicate attributes instead of guessing", () => {
    const committed = "point M = between A B ratio=0.5";
    const element = compiled(committed);
    const liveDistance = "point M = between A B distance=25";
    expect(selectedText(liveDistance, element, "distance", committed)).toBe("25");
    expect(resolveParameterValueSpan(liveDistance, element, "ratio", { committedLineText: committed })).toBeNull();
    const both = "point M = between A B distance=25 ratio=0.5";
    expect(resolveParameterValueSpan(both, element, "distance", { committedLineText: committed })).toBeNull();
    expect(resolveParameterValueSpan(both, element, "ratio", { committedLineText: committed })).toBeNull();
    const arc = compiled("arc C center=A radius=10 start=0 end=90");
    expect(resolveParameterValueSpan("arc C center=A radius=10 radius=20 start=0 end=90", arc, "radius")).toBeNull();
  });

  it("rejects mixed division mode attrs when either spelling is duplicated", () => {
    const committed = "point M = between A B ratio=0.5";
    const element = compiled(committed);
    for (const source of [
      "point M = between A B distance=10 distance=20 ratio=0.5",
      "point M = between A B distance=10 ratio=0.5 ratio=0.75"
    ]) {
      expect(resolveParameterValueSpan(source, element, "distance", { committedLineText: committed })).toBeNull();
      expect(resolveParameterValueSpan(source, element, "ratio", { committedLineText: committed })).toBeNull();
    }
    const lineCommitted = "point N = on AB.end ratio=0.5";
    const lineElement = compiled(lineCommitted);
    for (const source of [
      "point N = on AB.end distance=10 distance=20 ratio=0.5",
      "point N = on AB.end distance=10 ratio=0.5 ratio=0.75"
    ]) {
      expect(resolveParameterValueSpan(source, lineElement, "distance", { committedLineText: lineCommitted })).toBeNull();
      expect(resolveParameterValueSpan(source, lineElement, "ratio", { committedLineText: lineCommitted })).toBeNull();
    }
  });

  it("proves dynamic vars by unique names and never maps a deleted record by index", () => {
    const committed = "point P = (0, 0) vars=[a:1;b:2]";
    const element = compiled(committed);
    const [a, b] = element.numericVariables!;
    const live = "point P = (0, 0) vars=[b:2]";
    expect(resolveParameterValueSpan(live, element, `variable:${a.id}:value`, { committedLineText: committed })).toBeNull();
    expect(selectedText(live, element, `variable:${b.id}:value`, committed)).toBe("2");
    const duplicate = "point P = (0, 0) vars=[b:2;b:3]";
    expect(resolveParameterValueSpan(duplicate, element, `variable:${b.id}:value`, { committedLineText: committed })).toBeNull();
  });

  it("preserves empty dynamic fields and proves intermediates by stable identity or a unique fingerprint", () => {
    const committed = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(1,2):10:11:12;(3,4):20:21:22]";
    const element = compiled(committed) as Extract<CadElement, { type: "bezierCurve" }>;
    const [first, second] = element.intermediatePoints;
    const deleted = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(3,4):20:21:22]";
    expect(resolveParameterValueSpan(deleted, element, `intermediate:${first.id}:outgoingHandleLength`, { committedLineText: committed })).toBeNull();
    expect(selectedText(deleted, element, `intermediate:${second.id}:outgoingHandleLength`, committed)).toBe("22");
    const reordered = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(3,4):20:21:22;(1,2):10:11:12]";
    expect(selectedText(reordered, element, `intermediate:${first.id}:outgoingHandleLength`, committed)).toBe("12");
    const replacement = "curve Replacement = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(1,2):10:11:12;(3,4):20:21:22]";
    expect(resolveParameterValueSpan(replacement, element, `intermediate:${first.id}:outgoingHandleLength`, { committedLineText: committed })).toBeNull();
    const emptyField = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(1,2):10::12]";
    const emptyFieldElement = compiled(emptyField) as Extract<CadElement, { type: "bezierCurve" }>;
    const emptyIntermediate = emptyFieldElement.intermediatePoints[0];
    expect(resolveParameterValueSpan(emptyField, emptyFieldElement, `intermediate:${emptyIntermediate.id}:incomingHandleLength`, { committedLineText: emptyField })).toBeNull();
    expect(selectedText(emptyField, emptyFieldElement, `intermediate:${emptyIntermediate.id}:outgoingHandleLength`, emptyField)).toBe("12");
    expect(emptyIntermediate.outgoingHandleLength).toBe(12);
    const ambiguous = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[A:10:1:2;A:10:1:3]";
    const ambiguousElement = compiled(ambiguous) as Extract<CadElement, { type: "bezierCurve" }>;
    const ambiguousLive = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[A:10:1:3;A:10:1:2]";
    expect(resolveParameterValueSpan(ambiguousLive, ambiguousElement, `intermediate:${ambiguousElement.intermediatePoints[0].id}:outgoingHandleLength`, { committedLineText: ambiguous })).toBeNull();
  });

  it("returns null when the committed intermediate fingerprint collides even if live is unique", () => {
    const siblingCollision = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(1,2):10:11:12;(1,2):10:11:22]";
    const collisionElement = compiled(siblingCollision) as Extract<CadElement, { type: "bezierCurve" }>;
    const collisionLive = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 intermediates=[(1,2):10:11:22]";
    expect(resolveParameterValueSpan(
      collisionLive,
      collisionElement,
      `intermediate:${collisionElement.intermediatePoints[0].id}:outgoingHandleLength`,
      { committedLineText: siblingCollision }
    )).toBeNull();
  });

  it("matches canonical compiler records with quoted delimiters, parenthesized expressions, and empty fields", () => {
    const source = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 vars=[\"a:b\":1 + (2 * (3 + 4));empty:;d:4] intermediates=[(4,5):45::7]";
    const element = compiled(source) as Extract<CadElement, { type: "bezierCurve" }>;
    const [quoted, empty] = element.numericVariables!;
    const intermediate = element.intermediatePoints[0];
    expect(selectedText(source, element, `variable:${quoted.id}:value`)).toBe("1 + (2 * (3 + 4))");
    expect(resolveParameterValueSpan(source, element, `variable:${empty.id}:value`, { committedLineText: source })).toBeNull();
    expect(resolveParameterValueSpan(source, element, `intermediate:${intermediate.id}:incomingHandleLength`, { committedLineText: source })).toBeNull();
    expect(selectedText(source, element, `intermediate:${intermediate.id}:outgoingHandleLength`)).toBe("7");
    expect(intermediate.outgoingHandleLength).toBe(7);
  });

  it("returns null when the live line changed to another element type", () => {
    const element = compiled("arc C center=A radius=10 start=0 end=90");
    expect(resolveParameterValueSpan("line C = A -> B", element, "radius")).toBeNull();
  });
});

describe("recordField", () => {
  it("returns each field of a 5-field intermediates=-style record independently, unlike recordRemainder", () => {
    const source = "curve C = A -> B intermediates=[X: 10: 5: 5: pt1]";
    const outer = { start: source.indexOf("["), end: source.indexOf("]") + 1 };
    const records = recordSpans(source, outer)!;
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(source.slice(recordField(source, record, 0)!.start, recordField(source, record, 0)!.end)).toBe("X");
    expect(source.slice(recordField(source, record, 1)!.start, recordField(source, record, 1)!.end)).toBe("10");
    expect(source.slice(recordField(source, record, 2)!.start, recordField(source, record, 2)!.end)).toBe("5");
    expect(source.slice(recordField(source, record, 3)!.start, recordField(source, record, 3)!.end)).toBe("5");
    expect(source.slice(recordField(source, record, 4)!.start, recordField(source, record, 4)!.end)).toBe("pt1");
  });

  it("returns null for an out-of-range field index", () => {
    const source = "curve C = A -> B intermediates=[X: 10: 5: 5: pt1]";
    const outer = { start: source.indexOf("["), end: source.indexOf("]") + 1 };
    const record = recordSpans(source, outer)![0];
    expect(recordField(source, record, 5)).toBeNull();
  });

  it("returns null for an empty field", () => {
    const source = "curve C = A -> B intermediates=[X::5:5:pt1]";
    const outer = { start: source.indexOf("["), end: source.indexOf("]") + 1 };
    const record = recordSpans(source, outer)![0];
    expect(recordField(source, record, 1)).toBeNull();
  });
});
