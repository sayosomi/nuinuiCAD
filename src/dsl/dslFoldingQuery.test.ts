import { describe, expect, it } from "vitest";
import { parseDslSnapshot } from "./dslParser";
import { queryDslFolding, type DslFoldingRange } from "./dslFoldingQuery";

const foldsFor = (source: string): DslFoldingRange[] => {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const parsed = parseDslSnapshot({ normalizedSource, sourceRevision: 1 });
  return queryDslFolding({
    source: { normalizedSource, sourceRevision: 1 },
    statements: parsed.statements,
    sourceMap: parsed.sourceMap
  });
};

const syntaxFoldsFor = (source: string) =>
  foldsFor(source).filter((range) => range.kind === "syntax");

describe("DSL structural folding query", () => {
  it("folds a simple multiline brace block", () => {
    expect(syntaxFoldsFor([
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 3 }
    ]);
  });

  it("folds nested multiline brace blocks independently", () => {
    expect(syntaxFoldsFor([
      "group Outer {",
      "  group Inner {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 5 },
      { kind: "syntax", startLine: 2, endLine: 4 }
    ]);
  });

  it("anchors a multiline header at its standalone opening brace", () => {
    expect(syntaxFoldsFor([
      "if (true)",
      "{",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 2, endLine: 4 }
    ]);
  });

  it("anchors an inline brace block at the header line", () => {
    expect(syntaxFoldsFor([
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 3 }
    ]);
  });

  it("folds valid if then and else branches independently", () => {
    expect(syntaxFoldsFor([
      "if (true) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 2 },
      { kind: "syntax", startLine: 3, endLine: 5 }
    ]);
  });

  it("folds nested and simple parenthesis pairs inside logical boundaries", () => {
    expect(syntaxFoldsFor([
      "foo(",
      "  bar(",
      "    value",
      "  )",
      ")"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 5 },
      { kind: "syntax", startLine: 2, endLine: 4 }
    ]);
  });

  it("folds nested and mixed array delimiters", () => {
    expect(syntaxFoldsFor([
      "foo([",
      "  bar([",
      "    value",
      "  ])",
      "])"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 5 },
      { kind: "syntax", startLine: 1, endLine: 5 },
      { kind: "syntax", startLine: 2, endLine: 4 },
      { kind: "syntax", startLine: 2, endLine: 4 }
    ]);
  });

  it("ignores quoted and trailing-comment delimiters", () => {
    expect(syntaxFoldsFor([
      "foo(\"( [ ) ]\", # ) ]",
      "  value # ( [",
      ")"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 3 }
    ]);
  });

  it("ignores delimiters in full-line comments within a logical statement", () => {
    expect(syntaxFoldsFor([
      "foo(",
      "  # ) ]",
      "  value",
      ")"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 4 }
    ]);
  });

  it("folds two or more consecutive full-line comments as one comment range", () => {
    expect(foldsFor([
      "# 前身頃",
      "  # 縫い代込み",
      "# 更新済み",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n"))).toEqual([
      { kind: "comment", startLine: 1, endLine: 3 }
    ]);
  });

  it("does not fold a single or trailing comment", () => {
    expect(foldsFor([
      "# single",
      "point A = coordinate(x: 0, y: 0) # trailing"
    ].join("\n"))).toEqual([]);
  });

  it("does not create an EOF-sized fold for an unclosed brace", () => {
    expect(syntaxFoldsFor([
      "group A {",
      "  point P = coordinate(x: 0, y: 0)"
    ].join("\n"))).toEqual([]);
  });

  it("ignores a stray close and an invalid else", () => {
    expect(syntaxFoldsFor([
      "}",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "} else {",
      "  point Q = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 2, endLine: 6 }
    ]);
  });

  it("fails closed for mismatched and unclosed delimiters", () => {
    expect(syntaxFoldsFor([
      "foo([",
      "  value",
      ")",
      "]"
    ].join("\n"))).toEqual([]);
    expect(syntaxFoldsFor([
      "foo(",
      "  bar()",
      "",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 4, endLine: 6 }
    ]);
  });

  it("keeps independent valid structure around a malformed area", () => {
    expect(syntaxFoldsFor([
      "group Before {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "foo([",
      "  value",
      ")",
      "",
      "group After {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"))).toEqual([
      { kind: "syntax", startLine: 1, endLine: 3 },
      { kind: "syntax", startLine: 8, endLine: 10 }
    ]);
  });
});
