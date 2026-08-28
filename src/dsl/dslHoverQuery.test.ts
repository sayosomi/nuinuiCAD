import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import {
  queryDslGeometryHoverDeclarationRange,
  queryDslGeometryHoverTarget
} from "./dslHoverQuery";
import { parseDslSnapshot } from "./dslParser";

const compileWithIds = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `hover-test:${index}`]))
  });
};

const queryAt = (
  source: string,
  compiled: CompiledDslDocument,
  position: number,
  sourceRevision = 7
) => queryDslGeometryHoverTarget({
  source: { normalizedSource: source, sourceRevision },
  position,
  semantic: { sourceRevision, compiled }
});

const declarationFor = (
  source: string,
  compiled: CompiledDslDocument,
  elementId: string,
  sourceRevision = 7
) => queryDslGeometryHoverDeclarationRange({
  source: { normalizedSource: source, sourceRevision },
  elementId,
  semantic: { sourceRevision, compiled }
});

describe("queryDslGeometryHoverTarget", () => {
  it("returns the same geometry target for a declaration and semantic reference", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 10, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const element = compiled.document?.elements.find((candidate) => candidate.name === "A");
    expect(element).toBeDefined();

    const declarationFrom = source.indexOf("point A") + "point ".length;
    const referenceFrom = source.indexOf("@A") + 1;
    const declaration = queryAt(source, compiled, declarationFrom + 1);
    const reference = queryAt(source, compiled, referenceFrom + 1);

    expect(declaration).toEqual({
      range: { from: declarationFrom, to: declarationFrom + 1 },
      elementId: element!.id
    });
    expect(reference).toEqual({
      range: { from: referenceFrom, to: referenceFrom + 1 },
      elementId: element!.id
    });
    expect(declarationFor(source, compiled, element!.id)).toEqual({
      from: declarationFrom,
      to: declarationFrom + 1
    });
  });

  it("resolves a single materialized runtime geometry back to its authored declaration", () => {
    const source = [
      "nui 4",
      "module Marker() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance Only = Marker()"
    ].join("\n");
    const compiled = compileWithIds(source);
    const point = compiled.document?.elements.find((element) => element.name === "P");
    expect(point).toBeDefined();
    const from = source.indexOf("point P") + "point ".length;

    expect(declarationFor(source, compiled, point!.id)).toEqual({
      from,
      to: from + 1
    });
  });

  it("targets the element segment rather than a numeric property suffix", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Shoulder = segment(start: @A, end: @B)",
      "const width: number = @Shoulder.length"
    ].join("\n");
    const compiled = compileWithIds(source);
    const from = source.indexOf("Shoulder", source.indexOf("@Shoulder"));
    const result = queryAt(source, compiled, from + 2);

    expect(result).not.toBeNull();
    expect(source.slice(result!.range.from, result!.range.to)).toBe("Shoulder");
    expect(compiled.document?.elements.find((element) => element.id === result!.elementId)?.name).toBe("Shoulder");
    expect(queryAt(source, compiled, source.indexOf("length", from) + 2)).toBeNull();
  });

  it("targets a qualified element segment for a choice geometry property", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "  point Start = coordinate(x: 0, y: 0)",
      "  point End = coordinate(x: 10, y: 0)",
      "  line Base = segment(start: @Start, end: @End)",
      "  line A = offset(sources: [@Base], distance: 10, side: right, closed: false, suppressTrimWarnings: false)",
      "}",
      "const side: choice(right, left) = @Outer::A.side"
    ].join("\n");
    const compiled = compileWithIds(source);
    const referenceStart = source.indexOf("@Outer::A.side");
    const elementStart = referenceStart + 1 + "Outer::".length;
    const result = queryAt(source, compiled, elementStart + 1);

    expect(result).not.toBeNull();
    expect(source.slice(result!.range.from, result!.range.to)).toBe("A");
    expect(compiled.document?.elements.find((element) => element.id === result!.elementId)?.name).toBe("A");
    expect(queryAt(source, compiled, referenceStart + "@Outer::A.".length + 1)).toBeNull();
  });

  it("does not target language keywords, construction names, parameter keys, containers, text, or typed bindings", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "group Front {",
      "  point A = coordinate(x: @width, y: 0)",
      "}",
      "text Label = label(text: \"A\", anchor: (0, 0))"
    ].join("\n");
    const compiled = compileWithIds(source);

    for (const position of [
      source.indexOf("point A") + 1,
      source.indexOf("coordinate") + 2,
      source.indexOf("x: @width") + 1,
      source.indexOf("group Front") + "group ".length + 1,
      source.indexOf("text Label") + "text ".length + 1,
      source.indexOf("width") + 1,
      source.indexOf("@width") + 2
    ]) {
      expect(queryAt(source, compiled, position)).toBeNull();
    }
  });

  it("fails closed when a named source geometry becomes unnamed in the exact semantic snapshot", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const compiled = compileWithIds(source);
    const element = compiled.document?.elements.find((candidate) => candidate.name === "A");
    expect(element).toBeDefined();
    const unnamed: CompiledDslDocument = {
      ...compiled,
      document: compiled.document ? {
        ...compiled.document,
        elements: compiled.document.elements.map((candidate) =>
          candidate.id === element!.id ? { ...candidate, name: "" } : candidate
        )
      } : null
    };

    expect(queryAt(source, unnamed, source.indexOf("A") + 1)).toBeNull();
  });

  it("fails closed for repeated Module materialization from one source declaration", () => {
    const source = [
      "nui 4",
      "module Marker() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance First = Marker()",
      "instance Second = Marker()"
    ].join("\n");
    const compiled = compileWithIds(source);
    const pointName = source.indexOf("point P") + "point ".length;
    const runtimePoint = compiled.document?.elements.find((element) => element.name === "P");

    expect(compiled.document?.elements.filter((element) => element.name === "P")).toHaveLength(2);
    expect(queryAt(source, compiled, pointName + 1)).toBeNull();
    expect(runtimePoint).toBeDefined();
    expect(declarationFor(source, compiled, runtimePoint!.id)).toBeNull();
  });

  it("fails closed for geometry authored inside a for-generated source body", () => {
    const source = [
      "nui 4",
      "for i in range(from: 0, count: 2) {",
      "  point P = coordinate(x: i * 10, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const pointName = source.indexOf("point P") + "point ".length;
    const runtimePoint = compiled.document?.elements.find((element) => element.name === "P");

    expect(queryAt(source, compiled, pointName + 1)).toBeNull();
    if (runtimePoint) expect(declarationFor(source, compiled, runtimePoint.id)).toBeNull();
  });

  it("fails closed for stale revisions and same-revision source mismatches", () => {
    const oldSource = "nui 4\npoint A = coordinate(x: 0, y: 0)";
    const compiled = compileWithIds(oldSource, 3);
    const element = compiled.document?.elements.find((candidate) => candidate.name === "A");
    const liveSource = oldSource.replace("A", "Renamed");

    expect(queryDslGeometryHoverTarget({
      source: { normalizedSource: liveSource, sourceRevision: 4 },
      position: liveSource.indexOf("Renamed") + 1,
      semantic: { sourceRevision: 3, compiled }
    })).toBeNull();
    expect(queryDslGeometryHoverTarget({
      source: { normalizedSource: liveSource, sourceRevision: 3 },
      position: liveSource.indexOf("Renamed") + 1,
      semantic: { sourceRevision: 3, compiled }
    })).toBeNull();
    expect(element).toBeDefined();
    expect(queryDslGeometryHoverDeclarationRange({
      source: { normalizedSource: liveSource, sourceRevision: 3 },
      elementId: element!.id,
      semantic: { sourceRevision: 3, compiled }
    })).toBeNull();
  });
});
