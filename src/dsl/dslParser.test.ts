import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import type { DslStatement } from "./dslTypes";

const errors = (source: string) =>
  parseDsl(source).diagnostics.filter((item) => item.severity === "error");

const single = (source: string): DslStatement => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.statements).toHaveLength(1);
  return parsed.statements[0];
};

describe("DSL parser spans", () => {
  it("parses a continued element as one statement while preserving its physical line range", () => {
    const parsed = parseDsl("point A = (10, \\\n  20) color=main");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]).toMatchObject({ line: 1, endLine: 2, kind: "freePoint" });
  });

  it("records keyword, name, and attribute spans", () => {
    const source = "point A = (10, 20) color=main";
    const statement = single(source);
    expect(statement.kind).toBe("freePoint");
    expect(statement.keywordSpan).toEqual({ start: 0, end: 5 });
    expect(statement.nameSpan).toEqual({ start: 6, end: 7 });
    const colorAttr = statement.attrs.find((attr) => attr.key === "color");
    expect(colorAttr).toMatchObject({ keyStart: 19, valueStart: 25, valueEnd: 29 });
    expect(source.slice(colorAttr!.valueStart, colorAttr!.valueEnd)).toBe("main");
  });

  it("records coordinate payload spans", () => {
    const source = "point A = (10, -20.5)";
    const statement = single(source);
    expect(statement.payloadSpans.x).toEqual({ start: 11, end: 13 });
    expect(statement.payloadSpans.y).toEqual({ start: 15, end: 20 });
    expect(source.slice(statement.payloadSpans.y.start, statement.payloadSpans.y.end)).toBe("-20.5");
  });

  it("records expression payload spans for variables", () => {
    const source = "var bust = 840 + 20";
    const statement = single(source);
    expect(statement.kind).toBe("variable");
    if (statement.kind !== "variable") return;
    expect(statement.expression).toBe("840 + 20");
    expect(source.slice(statement.payloadSpans.expression.start, statement.payloadSpans.expression.end)).toBe("840 + 20");
  });

  it("records line payload spans", () => {
    const source = "line AB = A -> B";
    const statement = single(source);
    expect(statement.kind).toBe("line");
    expect(source.slice(statement.payloadSpans.start.start, statement.payloadSpans.start.end)).toBe("A");
    expect(source.slice(statement.payloadSpans.end.start, statement.payloadSpans.end.end)).toBe("B");
  });

  it("records quoted name spans with the quotes included", () => {
    const source = "point \"前 上\" = (0, 0)";
    const statement = single(source);
    expect(statement.name).toBe("前 上");
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("\"前 上\"");
  });
});

describe("DSL parser unnamed statements", () => {
  it("parses unnamed statements when the keyword is followed by =", () => {
    const statement = single("point = (1, 2)");
    expect(statement.name).toBe("");
    expect(statement.nameSpan).toBeNull();
    expect(statement.kind).toBe("freePoint");
  });

  it("parses unnamed group blocks", () => {
    const parsed = parseDsl(["group {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", name: "", opensBlock: true });
    expect(parsed.statements[1].kind).toBe("blockEnd");
  });

  it("parses unnamed statements when the keyword is followed by attributes", () => {
    const statement = single("group expanded=true");
    expect(statement).toMatchObject({ kind: "group", name: "" });
  });

  it("keeps named statements named", () => {
    const statement = single("group 前身頃 expanded=true");
    expect(statement).toMatchObject({ kind: "group", name: "前身頃" });
  });
});

describe("DSL parser blocks", () => {
  it("accepts a multi-line block header followed by its own opening-brace line", () => {
    const parsed = parseDsl([
      "group A \\",
      "  expanded=true",
      "{",
      "  point P = (0, 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", line: 1, endLine: 2, opensBlock: true });
    expect(parsed.statements[1]).toMatchObject({ kind: "freePoint" });
  });

  it("assigns enclosing block info to nested statements", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = (0, 0)",
      "  group 襟 {",
      "    point B = (1, 1)",
      "  }",
      "  point C = (2, 2)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const [outer, pointA, inner, pointB, , pointC] = parsed.statements;
    expect(outer.enclosing).toBeNull();
    expect(pointA.enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(inner.enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(pointB.enclosing).toEqual({ statementIndex: 2, branch: "then" });
    expect(pointC.enclosing).toEqual({ statementIndex: 0, branch: "then" });
  });

  it("parses if/else blocks with branch tracking", () => {
    const parsed = parseDsl([
      "if 分岐 condition=1 {",
      "  point A = (0, 0)",
      "} else {",
      "  point B = (1, 1)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const [ifStatement, pointA, blockElse, pointB] = parsed.statements;
    expect(ifStatement).toMatchObject({ kind: "element", type: "conditionalGroup", name: "分岐", opensBlock: true });
    expect(pointA.enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(blockElse.kind).toBe("blockElse");
    expect(pointB.enclosing).toEqual({ statementIndex: 0, branch: "else" });
  });

  it("desugars for blocks to forGroup statements", () => {
    const parsed = parseDsl([
      "for 繰返し i start=0 count=5 step=1 {",
      "  point P = (i, 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[0];
    expect(statement).toMatchObject({ kind: "element", type: "forGroup", name: "繰返し" });
    expect(statement.attrs.find((attr) => attr.key === "variableName")?.value).toBe("i");
  });

  it("parses unnamed for blocks", () => {
    const parsed = parseDsl(["for i start=0 count=3 {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "element", type: "forGroup", name: "" });
    expect(parsed.statements[0].attrs.find((attr) => attr.key === "variableName")?.value).toBe("i");
  });

  it("allows comments and blank lines inside blocks", () => {
    const parsed = parseDsl([
      "group A {",
      "",
      "  # コメント",
      "  point P = (0, 0) # 行末コメント",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(3);
  });

  it("reports unclosed blocks", () => {
    expect(errors("group A {")).toHaveLength(1);
    expect(errors("group A {")[0].message).toContain("閉じられていません");
  });

  it("reports stray closing braces", () => {
    expect(errors("}")[0].message).toContain("対応するブロックの開きがない");
  });

  it("reports else outside if blocks", () => {
    expect(errors(["group A {", "} else {", "}"].join("\n"))[0].message).toContain("} else {");
  });

  it("reports statements that cannot open blocks", () => {
    expect(errors("point A = (0, 0) {")[0].message).toContain("ブロックを開けません");
  });

  it("reports if without a block", () => {
    expect(errors("if 分岐 condition=1")[0].message).toContain("ブロックが必要");
  });

  it("reports mid-line braces", () => {
    expect(errors("group A { point B = (0,0)").length).toBeGreaterThan(0);
  });
});

describe("DSL parser new document statements", () => {
  it("parses the nui version statement without diagnostics", () => {
    const statement = single("nui 1");
    expect(statement).toMatchObject({ kind: "version", value: "1" });
  });

  it("parses malformed nui values without diagnostics (validated by dslDocument)", () => {
    const parsed = parseDsl("nui abc");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "version", value: "abc" });
  });

  it("parses color statements", () => {
    const statement = single("color main \"#ff0000\" name=\"本体\" default");
    expect(statement).toMatchObject({ kind: "color", name: "main", hex: "#ff0000", isDefault: true });
    expect(statement.attrs.find((attr) => attr.key === "name")?.value).toBe("本体");
  });

  it("rejects invalid color hex values", () => {
    expect(errors("color main \"#ff00\"")[0].message).toContain("#rrggbb");
    expect(errors("color main red")[0].message).toContain("#rrggbb");
  });

  it("parses @stop as a standalone statement", () => {
    const statement = single("@stop");
    expect(statement.kind).toBe("atStop");
    expect(errors("@stop extra")[0].message).toContain("単独の行");
  });

  it("rejects more than one @stop", () => {
    const result = errors(["point A = (0, 0)", "@stop", "point B = (1, 1)", "@stop"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("1つだけ");
  });

  it("parses activePrintLayout", () => {
    const statement = single("activePrintLayout 型紙A");
    expect(statement).toMatchObject({ kind: "activePrintLayout", name: "型紙A" });
  });

  it("parses printLayout blocks with place and layoutVar members", () => {
    const parsed = parseDsl([
      "printLayout 型紙A output=pdf paper=a4 orientation=portrait columns=2 rows=3 overlap=10 scale=1 {",
      "  layoutVar 余白 = 20",
      "  place 前身頃 at=(0, 余白) angle=0 mirrorX=false",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const [layout, layoutVar, place] = parsed.statements;
    expect(layout).toMatchObject({ kind: "printLayout", name: "型紙A", opensBlock: true });
    expect(layoutVar).toMatchObject({ kind: "layoutVar", name: "余白", expression: "20" });
    expect(place).toMatchObject({ kind: "place", group: "前身頃" });
    expect(layoutVar.enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(place.enclosing).toEqual({ statementIndex: 0, branch: "then" });
  });

  it("rejects place and layoutVar outside printLayout blocks", () => {
    expect(errors("place 前身頃 at=(0,0)")[0].message).toContain("printLayout");
    expect(errors("layoutVar n = 1")[0].message).toContain("printLayout");
  });

  it("rejects element statements inside printLayout blocks", () => {
    const parsed = errors([
      "printLayout 型紙A {",
      "  point A = (0, 0)",
      "}"
    ].join("\n"));
    expect(parsed[0].message).toContain("place と layoutVar のみ");
  });
});

describe("DSL parser duplicate names", () => {
  it("reports duplicate names in the same scope", () => {
    const result = errors(["point A = (0, 0)", "point A = (1, 1)"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("同名の要素");
  });

  it("allows the same name in different blocks", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = (0, 0)",
      "}",
      "group 後身頃 {",
      "  point A = (1, 1)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows the same name under different parent= attributes (legacy flat export)", () => {
    const parsed = parseDsl([
      "group 前身頃 id=g1",
      "group 後身頃 id=g2",
      "point A = (0, 0) id=p1 parent=g1",
      "point A = (1, 1) id=p2 parent=g2"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows duplicate names when both statements carry distinct ids", () => {
    const parsed = parseDsl([
      "point A = (0, 0) id=p1",
      "point A = (1, 1) id=p2"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("ignores unnamed statements for duplicate detection", () => {
    const parsed = parseDsl(["point = (0, 0)", "point = (1, 1)"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("DSL parser compatibility", () => {
  it("still parses the classic flat drafting syntax", () => {
    const parsed = parseDsl([
      "var bust = 840",
      "point A = (0, 0)",
      "point B = offset A dx=0 dy=-(bust / 4)",
      "line AB = A -> B",
      "arc armhole center=A radius=120 start=0 end=-90",
      "text label = \"前中心\" at=A size=4"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "variable",
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
  });

  it("parses CRLF sources", () => {
    const parsed = parseDsl("group A {\r\n  point P = (0, 0)\r\n}\r\n");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(3);
  });

  it("accepts parent= and branch= attributes", () => {
    const parsed = parseDsl("point A = (0, 0) parent=g1 branch=else");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0].attrs.map((attr) => attr.key)).toEqual(
      expect.arrayContaining(["parent", "branch"])
    );
  });
});
