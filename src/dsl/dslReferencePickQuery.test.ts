import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferencePickTarget } from "./dslReferencePickQuery";

const compileWithIds = (source: string, sourceRevision = 17): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-test:${index}`]))
  });
};

const queryAt = (
  source: string,
  compiled: CompiledDslDocument,
  position: number,
  sourceRevision = 17,
  semanticRevision = sourceRevision
) => queryDslReferencePickTarget({
  source: { normalizedSource: source, sourceRevision },
  position,
  semantic: { sourceRevision: semanticRevision, compiled }
});

const sliceRange = (source: string, result: ReturnType<typeof queryDslReferencePickTarget>) =>
  result ? source.slice(result.range.from, result.range.to) : null;

describe("queryDslReferencePickTarget", () => {
  it("classifies construction point, endpoint, broad path, and reference-list targets", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point Offset = offset(from: @A, dx: 4, dy: 0)",
      "point On = onLine(from: @Base.start, distance: 5)",
      "line Seam = offset(sources: [@Base], distance: 10, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const compiled = compileWithIds(source);

    const pointFrom = source.indexOf("@A", source.indexOf("point Offset"));
    const point = queryAt(source, compiled, pointFrom + 2);
    expect(point).toMatchObject({
      expectedGeometryInterface: "point",
      role: "geometry",
      multiplicity: "single",
      range: { from: pointFrom, to: pointFrom + 2 },
      sourceAnchor: { sourceRevision: 17 }
    });
    expect(point?.sourceAnchor.statementId).toMatch(/^pick-test:/);
    expect(point?.sourceAnchor.scopeId).toBeTruthy();

    const endpointFrom = source.indexOf("@Base.start");
    const endpoint = queryAt(source, compiled, endpointFrom + 3);
    expect(endpoint).toMatchObject({
      expectedGeometryInterface: "point",
      role: "endpoint",
      multiplicity: "single"
    });
    expect(sliceRange(source, endpoint)).toBe("@Base.start");

    const listFrom = source.indexOf("[@Base]");
    const list = queryAt(source, compiled, listFrom + 3);
    expect(list).toMatchObject({
      expectedGeometryInterface: "path",
      role: "geometry",
      multiplicity: "multiple"
    });
    expect(sliceRange(source, list)).toBe("[@Base]");
  });

  it("returns a zero-width insertion range for a known empty geometry value", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: , dx: 0, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const position = source.indexOf("from: ") + "from: ".length;
    const result = queryAt(source, compiled, position);

    expect(result).toMatchObject({
      expectedGeometryInterface: "point",
      role: "geometry",
      multiplicity: "single",
      range: { from: position, to: position }
    });
  });

  it("uses exact Module point, line, and path parameter interfaces", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(anchor: point, straight: line, broad: path) {",
      "}",
      "instance X = M(anchor: @A, straight: @Base, broad: @Curve)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const expectations = [
      ["anchor: @A", "point"],
      ["straight: @Base", "line"],
      ["broad: @Curve", "path"]
    ] as const;

    for (const [fragment, expectedGeometryInterface] of expectations) {
      const at = source.indexOf(fragment) + fragment.indexOf("@") + 2;
      expect(queryAt(source, compiled, at)).toMatchObject({
        expectedGeometryInterface,
        role: "geometry",
        multiplicity: "single"
      });
    }
  });

  it("recognizes final empty labeled Module geometry arguments with or without a trailing comma", () => {
    const source = [
      "nui 1",
      "module M(broad: path) {",
      "}",
      "instance X = M(broad: )"
    ].join("\n");
    const compiled = compileWithIds(source);
    const noCommaPosition = source.lastIndexOf("broad: ") + "broad: ".length;

    expect(queryAt(source, compiled, noCommaPosition)).toMatchObject({
      expectedGeometryInterface: "path",
      role: "geometry",
      multiplicity: "single",
      range: { from: noCommaPosition, to: noCommaPosition }
    });

    const commaSource = source.replace("broad: )", "broad: ,)");
    const commaCompiled = compileWithIds(commaSource);
    const commaPosition = commaSource.lastIndexOf("broad: ") + "broad: ".length;
    expect(queryAt(commaSource, commaCompiled, commaPosition)).toMatchObject({
      expectedGeometryInterface: "path",
      role: "geometry",
      multiplicity: "single",
      range: { from: commaPosition, to: commaPosition }
    });

    const ambiguousSource = source.replace("broad: )", ")");
    const ambiguousCompiled = compileWithIds(ambiguousSource);
    const ambiguousPosition = ambiguousSource.lastIndexOf("M(") + 2;
    expect(queryAt(ambiguousSource, ambiguousCompiled, ambiguousPosition)).toBeNull();
  });

  it("uses geometry builtin registry metadata for active arguments", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const d1: number = distance(@A, @B)",
      "const d2: number = lineDistance(@A, @Base)",
      "const a: number = lineAngle(@Base, @Base)"
    ].join("\n");
    const compiled = compileWithIds(source);

    const distanceA = source.indexOf("@A", source.indexOf("distance("));
    expect(queryAt(source, compiled, distanceA + 2)).toMatchObject({ expectedGeometryInterface: "point" });

    const lineDistanceBase = source.indexOf("@Base", source.indexOf("lineDistance("));
    expect(queryAt(source, compiled, lineDistanceBase + 3)).toMatchObject({ expectedGeometryInterface: "line" });

    const lineAngleBase = source.indexOf("@Base", source.indexOf("lineAngle("));
    expect(queryAt(source, compiled, lineAngleBase + 3)).toMatchObject({ expectedGeometryInterface: "line" });
  });

  it("replaces a numeric operand with a broad geometry base", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const numberFrom = source.indexOf("20", source.indexOf("dx:"));
    const result = queryAt(source, compiled, numberFrom + 1);

    expect(result).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single",
      activationRange: { from: numberFrom, to: numberFrom + 2 },
      numericProperty: { kind: "propertySelectionRequired" }
    });
    expect(sliceRange(source, result)).toBe("20");
  });

  it("targets the complete existing numeric property operand at every reference token", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const baseFrom = source.indexOf("@Base.length");
    const result = queryAt(source, compiled, baseFrom + 3);

    expect(result).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single"
    });
    expect(sliceRange(source, result)).toBe("@Base.length");
    expect(result?.activationRange).toEqual({ from: baseFrom, to: baseFrom + "@Base.length".length });
    expect(result?.numericProperty).toEqual({ kind: "propertySelectionRequired" });

    for (const offset of [baseFrom + 2, baseFrom + "@Base".length, baseFrom + "@Base.".length + 2]) {
      const equivalent = queryAt(source, compiled, offset);
      expect(equivalent?.range).toEqual(result?.range);
      expect(equivalent?.activationRange).toEqual(result?.activationRange);
      expect(equivalent?.numericProperty).toEqual({ kind: "propertySelectionRequired" });
    }
  });

  it("accepts canonical Arc and indexed Bezier numeric properties", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "point C = coordinate(x: 10, y: 10)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5, intermediates: [@C:45:5:5])",
      "point P = offset(from: @A, dx: @Arc.radius, dy: @Arc.sweepAngleDeg)",
      "point Q = offset(from: @A, dx: @Curve.intermediatePoints[1].x, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const cases = ["@Arc.radius", "@Arc.sweepAngleDeg", "@Curve.intermediatePoints[1].x"] as const;

    for (const reference of cases) {
      const from = source.indexOf(reference);
      const result = queryAt(source, compiled, from + reference.indexOf(".") + 2);
      expect(result).toMatchObject({
        role: "numericPropertyBase",
        numericProperty: { kind: "propertySelectionRequired" },
        range: { from, to: from + reference.length }
      });
      expect(result?.activationRange).toEqual({ from, to: from + reference.length });
      if (reference === "@Arc.radius") {
        for (const offset of [from + 2, from + "@Arc".length, from + "@Arc.".length + 2]) {
          const equivalent = queryAt(source, compiled, offset);
          expect(equivalent?.range).toEqual({ from, to: from + reference.length });
          expect(equivalent?.numericProperty).toEqual({ kind: "propertySelectionRequired" });
        }
      }
    }
  });

  it("supports empty numeric operands in calls, typed declarations, and coordinate parameters", () => {
    const emptySource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: @A, dx: , dy: 0)"
    ].join("\n");
    const emptyCompiled = compileWithIds(emptySource);
    const emptyPosition = emptySource.indexOf("dx: ") + "dx: ".length;
    expect(queryAt(emptySource, emptyCompiled, emptyPosition)).toMatchObject({
      role: "numericPropertyBase",
      range: { from: emptyPosition, to: emptyPosition },
      numericProperty: { kind: "propertySelectionRequired" }
    });

    const declarationSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = ",
      "point P = coordinate(x: 0, y: )"
    ].join("\n");
    const declarationCompiled = compileWithIds(declarationSource);
    const declarationPosition = declarationSource.indexOf("const X: number = ") + "const X: number = ".length;
    const declaration = queryAt(declarationSource, declarationCompiled, declarationPosition);
    expect(declaration).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      range: { from: declarationPosition, to: declarationPosition },
      numericProperty: { kind: "propertySelectionRequired" }
    });

    const coordinatePosition = declarationSource.indexOf("y: )") + "y: ".length;
    expect(queryAt(declarationSource, declarationCompiled, coordinatePosition)).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      range: { from: coordinatePosition, to: coordinatePosition },
      numericProperty: { kind: "propertySelectionRequired" }
    });
  });

  it("fails closed for an unsupported numeric property occurrence", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.notNumeric, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const occurrence = source.indexOf("@Base.notNumeric");
    expect(queryAt(source, compiled, occurrence + "@Base.".length + 2)).toBeNull();
  });

  it("fails closed for an unlabeled call slot, non-geometry value, and operator position", () => {
    const ambiguousSource = [
      "nui 1",
      "point P = offset(, dx: 10, dy: 0)"
    ].join("\n");
    const ambiguousCompiled = compileWithIds(ambiguousSource);
    const ambiguousPosition = ambiguousSource.indexOf("offset(") + "offset(".length;
    expect(queryAt(ambiguousSource, ambiguousCompiled, ambiguousPosition)).toBeNull();

    const textSource = "nui 1\ntext Label = label(text: \"hello\", anchor: (0, 0), size: 12)";
    const textCompiled = compileWithIds(textSource);
    expect(queryAt(textSource, textCompiled, textSource.indexOf("hello") + 2)).toBeNull();

    const operatorSource = "nui 1\nconst width: number = 20 + 30";
    const operatorCompiled = compileWithIds(operatorSource);
    expect(queryAt(operatorSource, operatorCompiled, operatorSource.indexOf("+"))).toBeNull();
  });

  it("fails closed when semantic revision or semantic source is stale", () => {
    const source = "nui 1\nconst width: number = 20";
    const compiled = compileWithIds(source, 17);
    const position = source.lastIndexOf("20") + 1;

    expect(queryAt(source, compiled, position, 18, 17)).toBeNull();
    expect(queryDslReferencePickTarget({
      source: { normalizedSource: `${source} `, sourceRevision: 17 },
      position,
      semantic: { sourceRevision: 17, compiled }
    })).toBeNull();
  });
});
