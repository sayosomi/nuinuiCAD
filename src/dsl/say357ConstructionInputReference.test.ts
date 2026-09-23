import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDslSnapshot,
  parseDslSourceReference,
  queryDslCompletion,
  queryDslDefinition,
  queryDslReferences,
  serializeDocumentToDsl,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";

const compile = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 7 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `say357:${index}`]))
  });
};

const errorCodes = (compiled: CompiledDslDocument) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);

const elementByName = (compiled: CompiledDslDocument, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const targetFor = (compiled: CompiledDslDocument, elementName: string, parameterKey: string) => {
  const element = elementByName(compiled, elementName);
  return compiled.geometryInputTargetsByElementId?.get(element.id)?.get(parameterKey);
};

const completionLabels = (source: string, token: string) => {
  const compiled = compile(source);
  const position = source.indexOf(token) + token.length;
  const result = queryDslCompletion({
    source: { normalizedSource: source, sourceRevision: 7 },
    position,
    semantic: { sourceRevision: 7, compiled }
  });
  return result?.candidates.map((candidate) => candidate.label) ?? [];
};

describe("SAY-357 construction-input references", () => {
  it("parses input as a member after an optional generated occurrence", () => {
    expect(parseDslSourceReference("@B[0].input.from")).toMatchObject({
      kind: "valid",
      reference: {
        pathText: "B",
        occurrenceIndex: "0",
        property: "input.from"
      }
    });
  });

  it("lowers a direct point alias and preserves the authored source spelling", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "point C = offset(from: @B.input.from, dx: 2, dy: 0)"
    ].join("\n");
    const compiled = compile(source);
    const target = targetFor(compiled, "C", "fromPoint");

    expect(errorCodes(compiled)).toEqual([]);
    expect(target).toMatchObject({
      kind: "drawable",
      elementId: elementByName(compiled, "A").id,
      geometryType: "point",
      stagePath: ["final"],
      sourceText: "@B.input.from"
    });
    expect(serializeDocumentToDsl(compiled.document!, 1)).toContain("from: @B.input.from");
  });

  it("keeps strict line and broad path input interfaces distinct", () => {
    const source = [
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "line B = from(source: @L)",
      "path P = from(source: @L)",
      "line C = from(source: @B.input.source)",
      "path Q = from(source: @P.input.source)"
    ].join("\n");
    const compiled = compile(source);

    expect(errorCodes(compiled)).toEqual([]);
    expect(targetFor(compiled, "C", "source")).toMatchObject({
      kind: "drawable",
      elementId: elementByName(compiled, "L").id,
      geometryType: "line",
      sourceText: "@B.input.source"
    });
    expect(targetFor(compiled, "Q", "source")).toMatchObject({
      kind: "drawable",
      elementId: elementByName(compiled, "L").id,
      geometryType: "path",
      sourceText: "@P.input.source"
    });
  });

  it("rejects incomplete, unknown, scalar, and invalid input dependencies with focused diagnostics", () => {
    const cases = [
      ["@A.input", "module-incomplete-construction-input"],
      ["@A.input.nope", "module-unknown-construction-input"],
      ["@A.input.x", "module-unsupported-construction-input"]
    ] as const;
    for (const [reference, code] of cases) {
      const source = [
        "nui 1",
        "point A = coordinate(x: 0, y: 0)",
        `point C = offset(from: ${reference}, dx: 1, dy: 0)`
      ].join("\n");
      const compiled = compile(source);
      const diagnostic = compiled.diagnostics.find((candidate) => candidate.code === code);
      expect(diagnostic, `${reference} should report ${code}`).toBeDefined();
      const memberName = reference === "@A.input" ? "input" : reference.slice(reference.lastIndexOf(".") + 1);
      expect(diagnostic?.physicalSpan?.segments[0]).toMatchObject({
        from: source.indexOf(memberName, source.indexOf(reference))
      });
    }

    const invalid = compile([
      "nui 1",
      "point B = offset(from: @Missing, dx: 1, dy: 0)",
      "point C = offset(from: @B.input.from, dx: 1, dy: 0)"
    ].join("\n"));
    expect(errorCodes(invalid)).toContain("module-invalid-construction-input");
  });

  it("retains stage, immutable-value, inline-coordinate, gate, and transformation semantics", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "line B = from(source: @A.moved, visible: false, enabled: false)",
      "reverse B ()",
      "line C = from(source: @B.input.source)",
      "const Value: point = coordinate(x: 5, y: 5)",
      "point V = offset(from: @Value, dx: 1, dy: 0)",
      "point W = offset(from: @V.input.from, dx: 1, dy: 0)",
      "line InlineLine = segment(start: (2, 3), end: (4, 3))",
      "point InlineConsumer = offset(from: @InlineLine.input.start, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compile(source);

    expect(errorCodes(compiled)).toEqual([]);
    expect(targetFor(compiled, "C", "source")).toMatchObject({
      kind: "drawable",
      elementId: elementByName(compiled, "A").id,
      geometryType: "line",
      stagePath: ["moved"],
      sourceText: "@B.input.source"
    });
    expect(targetFor(compiled, "W", "fromPoint")).toMatchObject({
      kind: "geometryValue",
      geometryType: "point",
      sourceText: "@V.input.from"
    });
    expect(targetFor(compiled, "InlineConsumer", "fromPoint")).toMatchObject({
      kind: "coordinate",
      geometryType: "point",
      sourceText: "@InlineLine.input.start"
    });
  });

  it("supports generated occurrence owners and schedules input cycles in the canonical graph", () => {
    const generated = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point B = offset(from: @A, dx: 1, dy: 0)",
      "}",
      "point C = offset(from: @B[0].input.from, dx: 2, dy: 0)"
    ].join("\n"));
    expect(errorCodes(generated)).toEqual([]);
    expect(targetFor(generated, "C", "fromPoint")).toMatchObject({
      kind: "drawable",
      elementId: elementByName(generated, "A").id,
      geometryType: "point",
      sourceText: "@B[0].input.from"
    });

    const cycle = compile([
      "nui 1",
      "point A = offset(from: @B.input.from, dx: 1, dy: 0)",
      "point B = offset(from: @C, dx: 1, dy: 0)",
      "point C = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n"));
    expect(errorCodes(cycle)).toContain("dependency-cycle");
  });

  it("reserves input as a transformation stage and keeps Module inputs private", () => {
    const reserved = compile([
      "nui 1",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A as input (from: (0, 0), to: (1, 0))"
    ].join("\n"));
    expect(errorCodes(reserved)).toContain("reserved-transformation-stage-name");

    const privateInput = compile([
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "  export line L = segment(start: @P, end: (10, 0))",
      "}",
      "instance I = M()",
      "point Root = offset(from: @I::L.input.start, dx: 1, dy: 0)"
    ].join("\n"));
    expect(errorCodes(privateInput)).toContain("module-construction-input-inaccessible");
  });

  it("offers only supported input members and keeps semantic occurrences on the owner", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "point C = offset(from: @B.input.from, dx: 2, dy: 0)"
    ].join("\n");
    expect(completionLabels(source.replace("@B.input.from", "@B."), "@B.")).toEqual(["input"]);
    expect(completionLabels(source.replace("@B.input.from", "@B.input."), "@B.input.")).toEqual(["from"]);

    const compiled = compile(source);
    const aliasPosition = source.indexOf("@B.input.from") + "@B".length;
    const references = queryDslReferences({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: aliasPosition,
      semantic: { sourceRevision: 7, sourceText: source, compiled }
    });
    expect(references).not.toBeNull();
    expect(source.slice(references!.declarationRange.from, references!.declarationRange.to)).toBe("B");
    expect(references!.referenceRanges.map((range) => source.slice(range.from, range.to))).toEqual(["B"]);

    const sourceReference = queryDslReferences({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: source.indexOf("@A") + "@A".length,
      semantic: { sourceRevision: 7, sourceText: source, compiled }
    });
    expect(sourceReference).not.toBeNull();
    expect(sourceReference!.referenceRanges.map((range) => source.slice(range.from, range.to))).toEqual(["A"]);

    const definition = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: aliasPosition,
      semantic: { sourceRevision: 7, sourceText: source, compiled }
    });
    expect(definition).not.toBeNull();
    expect(source.slice(definition!.declarationRange.from, definition!.declarationRange.to)).toBe("B");
  });
});
