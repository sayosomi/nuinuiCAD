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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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

  it("uses geometry builtin registry metadata for active arguments", () => {
    const source = [
      "nui 4",
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
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const numberFrom = source.indexOf("20", source.indexOf("dx:"));
    const result = queryAt(source, compiled, numberFrom + 1);

    expect(result).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single"
    });
    expect(sliceRange(source, result)).toBe("20");
  });

  it("preserves an existing numeric property suffix by replacing only its geometry base", () => {
    const source = [
      "nui 4",
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
    expect(sliceRange(source, result)).toBe("@Base");
    expect(source.slice(result!.range.to, result!.range.to + ".length".length)).toBe(".length");
  });

  it("supports empty numeric operands and typed number declarations", () => {
    const emptySource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(from: @A, dx: , dy: 0)"
    ].join("\n");
    const emptyCompiled = compileWithIds(emptySource);
    const emptyPosition = emptySource.indexOf("dx: ") + "dx: ".length;
    expect(queryAt(emptySource, emptyCompiled, emptyPosition)).toMatchObject({
      role: "numericPropertyBase",
      range: { from: emptyPosition, to: emptyPosition }
    });

    const declarationSource = "nui 4\nconst width: number = 20";
    const declarationCompiled = compileWithIds(declarationSource);
    const numberFrom = declarationSource.lastIndexOf("20");
    const declaration = queryAt(declarationSource, declarationCompiled, numberFrom + 1);
    expect(declaration).toMatchObject({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      range: { from: numberFrom, to: numberFrom + 2 }
    });
  });

  it("fails closed for an unlabeled call slot, non-geometry value, and operator position", () => {
    const ambiguousSource = [
      "nui 4",
      "point P = offset(, dx: 10, dy: 0)"
    ].join("\n");
    const ambiguousCompiled = compileWithIds(ambiguousSource);
    const ambiguousPosition = ambiguousSource.indexOf("offset(") + "offset(".length;
    expect(queryAt(ambiguousSource, ambiguousCompiled, ambiguousPosition)).toBeNull();

    const textSource = "nui 4\ntext Label = label(text: \"hello\", anchor: (0, 0), size: 12)";
    const textCompiled = compileWithIds(textSource);
    expect(queryAt(textSource, textCompiled, textSource.indexOf("hello") + 2)).toBeNull();

    const operatorSource = "nui 4\nconst width: number = 20 + 30";
    const operatorCompiled = compileWithIds(operatorSource);
    expect(queryAt(operatorSource, operatorCompiled, operatorSource.indexOf("+"))).toBeNull();
  });

  it("fails closed when semantic revision or semantic source is stale", () => {
    const source = "nui 4\nconst width: number = 20";
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
