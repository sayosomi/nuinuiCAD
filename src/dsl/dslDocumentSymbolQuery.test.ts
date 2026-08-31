import { describe, expect, it } from "vitest";
import { parseDslSnapshot } from "./dslParser";
import { queryDslDocumentSymbols, type DslDocumentSymbol } from "./dslDocumentSymbolQuery";

const symbolsFor = (source: string, sourceRevision = 1): DslDocumentSymbol[] => {
  const snapshot = {
    normalizedSource: source.replace(/\r\n/g, "\n"),
    sourceRevision
  };
  const parsed = parseDslSnapshot(snapshot);
  return queryDslDocumentSymbols({
    source: snapshot,
    statements: parsed.statements,
    sourceMap: parsed.sourceMap
  });
};

const symbolNamed = (symbols: readonly DslDocumentSymbol[], name: string): DslDocumentSymbol => {
  const symbol = symbols.flatMap((candidate) => [candidate, ...candidate.children.flatMap((child) => [child, ...child.children])])
    .find((candidate) => candidate.name === name);
  if (!symbol) throw new Error(`Missing symbol ${name}`);
  return symbol;
};

describe("DSL document symbol query", () => {
  it("maps flat declarations to host-neutral kinds, details, and exact name ranges", () => {
    const source = [
      "nui 1",
      "const fixed: number = 1",
      "let changing: number = 2",
      "profile Print",
      "modifier Seam {",
      "  state: visible,",
      "}",
      "point A [Seam, Cutting] = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB [Seam] = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "text Label = label(text: \"label\", anchor: none, size: 3)",
      "image Guide = image(source: \"guide.png\", origin: (0, 0), scale: 1, angleDeg: 0, mirrorX: false)"
    ].join("\n");

    const symbols = symbolsFor(source);

    expect(symbolNamed(symbols, "fixed")).toMatchObject({ kind: "constant", detail: "" });
    expect(symbolNamed(symbols, "changing")).toMatchObject({ kind: "variable", detail: "" });
    expect(symbolNamed(symbols, "Print")).toMatchObject({ kind: "enum", detail: "profile" });
    expect(symbolNamed(symbols, "Seam")).toMatchObject({ kind: "struct", detail: "" });
    expect(symbolNamed(symbols, "A")).toMatchObject({ kind: "property", detail: "point [Seam, Cutting]" });
    expect(symbolNamed(symbols, "AB")).toMatchObject({ kind: "field", detail: "line [Seam]" });
    expect(symbolNamed(symbols, "Curve")).toMatchObject({ kind: "field", detail: "curve" });
    expect(symbolNamed(symbols, "Arc")).toMatchObject({ kind: "field", detail: "arc" });
    expect(symbolNamed(symbols, "Label")).toMatchObject({ kind: "string", detail: "text" });
    expect(symbolNamed(symbols, "Guide")).toMatchObject({ kind: "file", detail: "image" });

    const nameStart = source.indexOf("A [");
    expect(symbolNamed(symbols, "A").selectionRange).toEqual({ from: nameStart, to: nameStart + 1 });
  });

  it("excludes modifier profile blocks, modifier properties, anonymous geometry, mutations, and settings", () => {
    const source = [
      "nui 1",
      "profile Print",
      "modifier Seam {",
      "  state: visible,",
      "  for @Print {",
      "    color: accent,",
      "  }",
      "}",
      "point = coordinate(x: 0, y: 0)",
      "edge(end1: @A, end2: @A)",
      "move(target: @A, dx: 1, dy: 1)",
      "role Draft",
      "view Main",
      "activeView Main",
      "layout Paper {",
      "  place @Draft(at: (0, 0))",
      "}",
      "point Named = coordinate(x: 0, y: 0)"
    ].join("\n");

    const symbols = symbolsFor(source);
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Print", "Seam", "Named"]);
    expect(symbols.some((symbol) => symbol.name === "color")).toBe(false);
    expect(symbols.some((symbol) => symbol.name === "Draft")).toBe(false);
  });

  it("uses the matching closing brace for modifier ranges and excludes override rows", () => {
    const source = [
      "nui 1",
      "modifier Seam {",
      "  state: visible,",
      "  for @Print {",
      "    width: 1px,",
      "  }",
      "}",
    ].join("\n");

    const symbols = symbolsFor(source);
    const modifier = symbolNamed(symbols, "Seam");
    const closeStart = source.lastIndexOf("}");

    expect(modifier.range).toEqual({ from: source.indexOf("modifier Seam"), to: closeStart + 1 });
    expect(modifier.children).toEqual([]);
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Seam"]);
  });

  it("extends an unclosed modifier range to the current EOF", () => {
    const source = [
      "nui 1",
      "modifier Seam {",
      "  state: visible,",
    ].join("\n");

    const modifier = symbolNamed(symbolsFor(source), "Seam");

    expect(modifier.range).toEqual({ from: source.indexOf("modifier Seam"), to: source.length });
  });

  it("never treats modifier profile `for @Profile` as an iteration namespace", () => {
    const source = [
      "nui 1",
      "profile Print",
      "modifier Seam {",
      "  for @Print {",
      "    width: 1px,",
      "  }",
      "}",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point P = coordinate(x: @i, y: 0)",
      "}"
    ].join("\n");

    const symbols = symbolsFor(source);
    expect(symbols.some((symbol) => symbol.name === "for Print")).toBe(false);
    expect(symbolNamed(symbols, "for i")).toMatchObject({ kind: "namespace", detail: "" });
  });

  it("builds module, group, for, and conditional branch hierarchy from enclosing metadata", () => {
    const source = [
      "nui 1",
      "module Panel() {",
      "  group Outer {",
      "    if (@condition) {",
      "      group Inner {",
      "        point ThenPoint = coordinate(x: 0, y: 0)",
      "      }",
      "    } else {",
      "      line ElseLine = segment(start: @ThenPoint, end: @ThenPoint)",
      "    }",
      "    for i in range(from: 0, count: 2, step: 1) {",
      "      text LoopLabel = label(text: \"loop\", anchor: none, size: 3)",
      "    }",
      "  }",
      "}",
      "instance panel = Panel()"
    ].join("\n");

    const symbols = symbolsFor(source);
    const module = symbolNamed(symbols, "Panel");
    const outer = module.children.find((symbol) => symbol.name === "Outer")!;
    const conditional = outer.children.find((symbol) => symbol.name === "if (@condition)")!;
    const thenBranch = conditional.children.find((symbol) => symbol.name === "THEN")!;
    const elseBranch = conditional.children.find((symbol) => symbol.name === "ELSE")!;
    const forGroup = outer.children.find((symbol) => symbol.name === "for i")!;

    expect(module.kind).toBe("module");
    expect(outer.kind).toBe("namespace");
    expect(thenBranch.children.map((symbol) => symbol.name)).toEqual(["Inner"]);
    expect(symbolNamed(thenBranch.children, "Inner").children.map((symbol) => symbol.name)).toEqual(["ThenPoint"]);
    expect(elseBranch.children.map((symbol) => symbol.name)).toEqual(["ElseLine"]);
    expect(forGroup.children.map((symbol) => symbol.name)).toEqual(["LoopLabel"]);
    expect(symbolNamed(symbols, "panel")).toMatchObject({ kind: "object", children: [] });
  });

  it("keeps both source branches, omits absent ELSE, and uses branch range rules", () => {
    const withElse = [
      "if (@condition) {",
      "  point ThenPoint = coordinate(x: 0, y: 0)",
      "} else {",
      "  point ElsePoint = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const withoutElse = [
      "if (@false) {",
      "  point OnlyPoint = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");

    const conditional = symbolsFor(withElse)[0]!;
    const thenBranch = conditional.children.find((symbol) => symbol.name === "THEN")!;
    const elseBranch = conditional.children.find((symbol) => symbol.name === "ELSE")!;
    const elseLineStart = withElse.indexOf("} else {");
    const closeStart = withElse.lastIndexOf("}");
    expect(conditional.children.map((symbol) => symbol.name)).toEqual(["THEN", "ELSE"]);
    expect(thenBranch.children.map((symbol) => symbol.name)).toEqual(["ThenPoint"]);
    expect(elseBranch.children.map((symbol) => symbol.name)).toEqual(["ElsePoint"]);
    expect(conditional.selectionRange).toEqual({ from: 0, to: 2 });
    expect(thenBranch.selectionRange).toEqual(conditional.selectionRange);
    expect(elseBranch.selectionRange).toEqual({ from: elseLineStart, to: elseLineStart + "} else {".length });
    expect(thenBranch.range.to).toBe(elseLineStart);
    expect(elseBranch.range.from).toBe(elseLineStart);
    expect(elseBranch.range.to).toBe(closeStart + 1);
    expect(symbolsFor(withoutElse)[0]!.children.map((symbol) => symbol.name)).toEqual(["THEN"]);
  });

  it("extends unclosed structural ranges to the current EOF", () => {
    const source = [
      "group Open {",
      "  point P = coordinate(x: 0, y: 0)"
    ].join("\n");
    const group = symbolsFor(source)[0]!;

    expect(group.range).toEqual({ from: 0, to: source.length });
  });

  it("omits a malformed nameless group while retaining its safely projectable descendant", () => {
    const source = [
      "group {",
      "  point P = coordinate(x: 0, y: 0)"
    ].join("\n");

    const symbols = symbolsFor(source);

    expect(symbols.map((symbol) => symbol.name)).toEqual(["P"]);
    expect(symbols[0]).toMatchObject({ kind: "property", children: [] });
  });

  it("fails closed for every stale source/map/revision combination", () => {
    const source = "point A = coordinate(x: 0, y: 0)";
    const snapshot = { normalizedSource: source, sourceRevision: 1 };
    const parsed = parseDslSnapshot(snapshot);

    expect(queryDslDocumentSymbols({ source: { normalizedSource: "point B = coordinate(x: 0, y: 0)", sourceRevision: 1 }, statements: parsed.statements, sourceMap: parsed.sourceMap })).toEqual([]);
    expect(queryDslDocumentSymbols({ source: { normalizedSource: source, sourceRevision: 2 }, statements: parsed.statements, sourceMap: parsed.sourceMap })).toEqual([]);
    expect(queryDslDocumentSymbols({ source: snapshot, statements: parsed.statements, sourceMap: { ...parsed.sourceMap, source: "stale" } })).toEqual([]);
    expect(queryDslDocumentSymbols({ source: snapshot, statements: parsed.statements, sourceMap: { ...parsed.sourceMap, sourceRevision: 2 } })).toEqual([]);
  });
});
