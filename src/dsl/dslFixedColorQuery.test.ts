import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslFixedColors } from "./dslFixedColorQuery";
import { parseDslSnapshot } from "./dslParser";

const compile = (source: string, revision = 1) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: revision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `fixed-color:${index}`]))
  });
};

const query = (source: string, revision = 1) => queryDslFixedColors({
  source: { normalizedSource: source, sourceRevision: revision },
  semantic: { sourceRevision: revision, compiled: compile(source, revision) }
});

describe("DSL fixed-color query", () => {
  it("returns exact modifier fixed-color ranges and normalized RGB values", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  width: 1.5px,",
      "  style: dotted,",
      "  color: #Ab10fF,",
      "}",
      "// #abcdef must not be a color token",
      'modifier "#112233" {',
      "  color: #Ab10fF",
      "}",
      "modifier Theme {",
      "  color: accent",
      "}"
    ].join("\n");

    expect(query(source)).toEqual([{
      range: { from: source.indexOf("#Ab10fF"), to: source.indexOf("#Ab10fF") + "#Ab10fF".length },
      hex: "#Ab10fF",
      color: { red: 171 / 255, green: 16 / 255, blue: 1, alpha: 1 }
    }, {
      range: { from: source.lastIndexOf("#Ab10fF"), to: source.lastIndexOf("#Ab10fF") + "#Ab10fF".length },
      hex: "#Ab10fF",
      color: { red: 171 / 255, green: 16 / 255, blue: 1, alpha: 1 }
    }]);
  });

  it("fails closed for stale source semantics and incomplete fixed-color authoring", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  color: #123456",
      "}"
    ].join("\n");
    const stale = queryDslFixedColors({
      source: { normalizedSource: source, sourceRevision: 2 },
      semantic: { sourceRevision: 1, compiled: compile(source, 1) }
    });
    expect(stale).toEqual([]);
    expect(query(source.replace("#123456", "#12"))).toEqual([]);
  });

  it("keeps exact fixed colors available from the current partial source", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  color: #123456",
      "}",
      "point Broken = coordinate(x: nope, y: 0)"
    ].join("\n");

    expect(query(source)).toEqual([expect.objectContaining({
      hex: "#123456",
      range: { from: source.indexOf("#123456"), to: source.indexOf("#123456") + "#123456".length }
    })]);
  });
});
