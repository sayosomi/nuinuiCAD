import { describe, expect, it } from "vitest";
import { parseDslSnapshot } from "../index";
import { queryDslDocumentSymbols } from "./dslDocumentSymbolQuery";

const snapshotFor = (normalizedSource: string, sourceRevision = 7) => ({
  normalizedSource,
  sourceRevision
});

const queryFor = (normalizedSource: string) => {
  const source = snapshotFor(normalizedSource);
  const parsed = parseDslSnapshot(source);
  return {
    parsed,
    symbols: queryDslDocumentSymbols({ source, statements: parsed.statements, sourceMap: parsed.sourceMap })
  };
};

const fingerprint = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Expected a JSON-serializable symbol oracle");
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

const longNestedSource = (moduleCount: number): string => {
  const lines = ["nui 1"];
  for (let index = 0; index < moduleCount; index += 1) {
    lines.push(
      `module M${index}() {`,
      `  group G${index} {`,
      "    if (true) {",
      `      for i in range(min: 0, max: 1, step: 1) {`,
      `        point P${index} = coordinate(x: 0, y: 0)`,
      "      }",
      "    } else {",
      `      line L${index} = segment(start: (0, 0), end: (1, 1))`,
      "    }",
      "  }",
      "}",
      `instance I${index} = M${index}()`
    );
  }
  lines.push("# edit:");
  return lines.join("\n");
};

describe("DSL document symbol query", () => {
  it("matches the independent Base oracle for nested Module, group, THEN/ELSE, for, and leaf ranges", () => {
    const source = [
      "nui 1",
      "# é😀",
      "module Sleeve() {",
      "  group Panel {",
      "    if (true) {",
      "      for i in range(min: 0, max: 1, step: 1) {",
      "        point Top = coordinate(x: 0, y: 0)",
      "      }",
      "    } else {",
      "      line Seam = segment(start: (0, 0), end: (1, 1))",
      "    }",
      "  }",
      "}",
      "instance Cut = Sleeve()"
    ].join("\n");

    expect(queryFor(source).symbols).toEqual([
      {
        name: "Sleeve", detail: "", kind: "module",
        range: { from: 12, to: 239 }, selectionRange: { from: 19, to: 25 },
        children: [{
          name: "Panel", detail: "group", kind: "namespace",
          range: { from: 30, to: 237 }, selectionRange: { from: 38, to: 43 },
          children: [{
            name: "if (true)", detail: "", kind: "namespace",
            range: { from: 46, to: 233 }, selectionRange: { from: 50, to: 52 },
            children: [
              {
                name: "THEN", detail: "", kind: "namespace",
                range: { from: 46, to: 161 }, selectionRange: { from: 50, to: 52 },
                children: [{
                  name: "for i", detail: "", kind: "namespace",
                  range: { from: 62, to: 160 }, selectionRange: { from: 68, to: 71 },
                  children: [{
                    name: "Top", detail: "point", kind: "property",
                    range: { from: 110, to: 152 }, selectionRange: { from: 124, to: 127 },
                    children: []
                  }]
                }]
              },
              {
                name: "ELSE", detail: "", kind: "namespace",
                range: { from: 161, to: 233 }, selectionRange: { from: 161, to: 173 },
                children: [{
                  name: "Seam", detail: "line", kind: "field",
                  range: { from: 174, to: 227 }, selectionRange: { from: 185, to: 189 },
                  children: []
                }]
              }
            ]
          }]
        }]
      },
      {
        name: "Cut", detail: "", kind: "object",
        range: { from: 240, to: 263 }, selectionRange: { from: 249, to: 252 }, children: []
      }
    ]);
  });

  it("preserves the complete independent Base symbol tree for a 1,502-line nested source", () => {
    const source = longNestedSource(125);
    const { parsed, symbols } = queryFor(source);
    const nodeCount = (nodes: typeof symbols): number =>
      nodes.reduce((count, node) => count + 1 + nodeCount(node.children), 0);

    expect(source.split("\n")).toHaveLength(1502);
    expect(parsed.statements).toHaveLength(1501);
    expect(symbols).toHaveLength(250);
    expect(nodeCount(symbols)).toBe(1125);
    expect(fingerprint(symbols)).toBe("1aa914991657f1ee");
  });

  it("matches independent Base oracles for empty and partially invalid input", () => {
    const empty = queryFor("nui 1\n");
    const partial = queryFor("nui 1\ngroup Draft {\n  if (true) {\n    point Broken =");

    expect(empty.symbols).toEqual([]);
    expect(fingerprint(empty.symbols)).toBe("09612b07b5ecb5a5");
    expect(partial.parsed.statements).toHaveLength(3);
    expect(partial.symbols).toHaveLength(1);
    expect(fingerprint(partial.symbols)).toBe("5571227e1ca56ef0");
  });

  it("rejects a source map or statement set from a different revision", () => {
    const source = snapshotFor("nui 1\ngroup G {\n  point P = coordinate(x: 0, y: 0)\n}");
    const parsed = parseDslSnapshot(source);

    expect(queryDslDocumentSymbols({
      source: { ...source, sourceRevision: source.sourceRevision + 1 },
      statements: parsed.statements,
      sourceMap: parsed.sourceMap
    })).toEqual([]);
  });
});
