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
    const parsed = parseDsl("point A = coordinate(x: 10\n  y: 20)");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]).toMatchObject({ line: 1, endLine: 2, kind: "element", type: "freePoint" });
  });

  it("records keyword, name, and attribute spans", () => {
    const source = "point A = coordinate(x: 10 y: 20 color: main)";
    const statement = single(source);
    expect(statement.kind).toBe("element");
    expect(statement.keywordSpan).toEqual({ start: 0, end: 5 });
    expect(statement.nameSpan).toEqual({ start: 6, end: 7 });
    const colorAttr = statement.attrs.find((attr) => attr.key === "color");
    const keyStart = source.indexOf("color:");
    const valueStart = source.indexOf("main");
    expect(colorAttr).toMatchObject({ keyStart, valueStart, valueEnd: valueStart + "main".length });
    expect(source.slice(colorAttr!.valueStart, colorAttr!.valueEnd)).toBe("main");
  });

  it("records coordinate payload spans", () => {
    const source = "point A = coordinate(x: 10 y: -20.5)";
    const statement = single(source);
    const xStart = source.indexOf("10");
    expect(statement.payloadSpans.x).toEqual({ start: xStart, end: xStart + 2 });
    const yStart = source.indexOf("-20.5");
    expect(statement.payloadSpans.y).toEqual({ start: yStart, end: yStart + 5 });
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
    const source = "line AB = segment(start: A end: B)";
    const statement = single(source);
    expect(statement.kind).toBe("element");
    if (statement.kind === "element") expect(statement.type).toBe("line");
    expect(source.slice(statement.payloadSpans.start.start, statement.payloadSpans.start.end)).toBe("A");
    expect(source.slice(statement.payloadSpans.end.start, statement.payloadSpans.end.end)).toBe("B");
  });

  it("records quoted name spans with the quotes included", () => {
    const source = "point \"前 上\" = coordinate(x: 0 y: 0)";
    const statement = single(source);
    expect(statement.name).toBe("前 上");
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("\"前 上\"");
  });
});

describe("DSL parser unnamed statements", () => {
  it("parses unnamed statements when the keyword is followed by =", () => {
    const statement = single("point = coordinate(x: 1 y: 2)");
    expect(statement.name).toBe("");
    expect(statement.nameSpan).toBeNull();
    expect(statement.kind).toBe("element");
    if (statement.kind === "element") expect(statement.type).toBe("freePoint");
  });

  it("parses unnamed group blocks", () => {
    const parsed = parseDsl(["group {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", name: "", opensBlock: true });
    expect(parsed.statements[1].kind).toBe("blockEnd");
  });

  // v1 allowed a bare `group expanded=true` header with no block; v2 containers
  // always require a block, so the closest equivalent is an unnamed group
  // header carrying an argument before its (mandatory) block.
  it("parses unnamed statements when the keyword is followed by attributes", () => {
    const parsed = parseDsl(["group (printEnabled: true) {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", name: "" });
  });

  it("keeps named statements named", () => {
    const parsed = parseDsl(["group 前身頃 (printEnabled: true) {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", name: "前身頃" });
  });
});

describe("DSL parser blocks", () => {
  it("accepts a multi-line block header followed by its own opening-brace line", () => {
    const parsed = parseDsl([
      "group A (printEnabled: true",
      ")",
      "{",
      "  point P = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", line: 1, endLine: 2, opensBlock: true });
    expect(parsed.statements[1]).toMatchObject({ kind: "element" });
  });

  it("assigns enclosing block info to nested statements", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = coordinate(x: 0 y: 0)",
      "  group 襟 {",
      "    point B = coordinate(x: 1 y: 1)",
      "  }",
      "  point C = coordinate(x: 2 y: 2)",
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
      "if 分岐 (1) {",
      "  point A = coordinate(x: 0 y: 0)",
      "} else {",
      "  point B = coordinate(x: 1 y: 1)",
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
      "for 繰返し (i from: 0 count: 5 step: 1) {",
      "  point P = coordinate(x: i y: 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[0];
    expect(statement).toMatchObject({ kind: "element", type: "forGroup", name: "繰返し" });
    // The synthetic positional attr is keyed by the DSL spelling ("variable"),
    // not the CadElement parameter key ("variableName"); applyArgs resolves
    // the parameter key from the construction registry separately.
    expect(statement.attrs.find((attr) => attr.key === "variable")?.value).toBe("i");
  });

  it("parses unnamed for blocks", () => {
    const parsed = parseDsl(["for (i from: 0 count: 3) {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "element", type: "forGroup", name: "" });
    expect(parsed.statements[0].attrs.find((attr) => attr.key === "variable")?.value).toBe("i");
  });

  it("allows comments and blank lines inside blocks", () => {
    const parsed = parseDsl([
      "group A {",
      "",
      "  # コメント",
      "  point P = coordinate(x: 0 y: 0) # 行末コメント",
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
    expect(errors("point A = coordinate(x: 0 y: 0) {")[0].message).toContain("ブロックを開けません");
  });

  it("reports if without a block", () => {
    expect(errors("if 分岐 (1)")[0].message).toContain("ブロックが必要");
  });

  it("reports mid-line braces", () => {
    expect(errors("group A { point B = coordinate(x: 0 y: 0)").length).toBeGreaterThan(0);
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
    const statement = single('color main ("#ff0000" name: "本体" default: true)');
    expect(statement).toMatchObject({ kind: "color", name: "main", hex: "#ff0000", isDefault: true });
    expect(statement.attrs.find((attr) => attr.key === "name")?.value).toBe('"本体"');
  });

  it("rejects invalid color hex values", () => {
    expect(errors('color main ("#ff00")')[0].message).toContain("#rrggbb");
    expect(errors("color main (red)")[0].message).toContain("#rrggbb");
  });

  it("parses @stop as a standalone statement", () => {
    const statement = single("@stop");
    expect(statement.kind).toBe("atStop");
    expect(errors("@stop extra")[0].message).toContain("単独の行");
  });

  it("rejects more than one @stop", () => {
    const result = errors(["point A = coordinate(x: 0 y: 0)", "@stop", "point B = coordinate(x: 1 y: 1)", "@stop"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("1つだけ");
  });

  it("parses activePrintLayout", () => {
    const statement = single("activePrintLayout 型紙A");
    expect(statement).toMatchObject({ kind: "activePrintLayout", name: "型紙A" });
  });

  it("parses printLayout blocks with place and layoutVar members", () => {
    const parsed = parseDsl([
      "printLayout 型紙A (output: pdf paper: a4 orientation: portrait columns: 2 rows: 3 overlap: 10 scale: 1) {",
      "  layoutVar 余白 = 20",
      "  place 前身頃 (at: (0, 余白) angle: 0 mirrorX: false)",
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
    expect(errors("place 前身頃 (at: (0,0))")[0].message).toContain("printLayout");
    expect(errors("layoutVar n = 1")[0].message).toContain("printLayout");
  });

  it("rejects element statements inside printLayout blocks", () => {
    const parsed = errors([
      "printLayout 型紙A () {",
      "  point A = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n"));
    expect(parsed[0].message).toContain("place と layoutVar のみ");
  });
});

describe("DSL parser duplicate names", () => {
  it("reports duplicate names in the same scope", () => {
    const result = errors(["point A = coordinate(x: 0 y: 0)", "point A = coordinate(x: 1 y: 1)"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("同名の要素");
  });

  it("allows the same name in different blocks", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = coordinate(x: 0 y: 0)",
      "}",
      "group 後身頃 {",
      "  point A = coordinate(x: 1 y: 1)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows the same name under different parent: attributes (legacy flat export)", () => {
    const parsed = parseDsl([
      "group 前身頃 (id: g1) {",
      "}",
      "group 後身頃 (id: g2) {",
      "}",
      "point A = coordinate(x: 0 y: 0 id: p1 parent: g1)",
      "point A = coordinate(x: 1 y: 1 id: p2 parent: g2)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows duplicate names when both statements carry distinct ids", () => {
    const parsed = parseDsl([
      "point A = coordinate(x: 0 y: 0 id: p1)",
      "point A = coordinate(x: 1 y: 1 id: p2)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("ignores unnamed statements for duplicate detection", () => {
    const parsed = parseDsl(["point = coordinate(x: 0 y: 0)", "point = coordinate(x: 1 y: 1)"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  // 重複名検出のscope/name結合キーはスペースではなくNUL(\0)で連結する
  // (W5の凍結パーサ src/document/legacyDsl/dslParser.ts と同型の回帰)。
  // `parent:` の値は末尾位置では quote なしで複数語(例: `Base X`)をそのまま
  // 属性値として読み取れる。このため
  //   scope="parent:Base"   + name=`X Y`
  //   scope="parent:Base X" + name=`Y`
  // の2つは、scope と name をスペースで連結すると両方とも
  // `"parent:Base X Y"` に潰れてしまい、無関係な要素同士が偽の重複と
  // 判定される。NUL区切りならこの2つは `"parent:Base\0X Y"` /
  // `"parent:Base X\0Y"` として区別され、衝突しない。
  it("does not report a false collision when an unquoted multi-word parent value and a quoted name land on the same space-joined key", () => {
    const parsed = parseDsl([
      "group Base {",
      "}",
      'group "Base X" {',
      "}",
      'point "X Y" = coordinate(x: 0 y: 0 parent: Base)',
      'point Y = coordinate(x: 1 y: 1 parent: Base X)'
    ].join("\n"));
    const duplicateNameDiagnostics = parsed.diagnostics.filter((item) => item.message.includes("同名の要素"));
    expect(duplicateNameDiagnostics).toEqual([]);
  });
});

describe("DSL parser compatibility", () => {
  it("still parses the vertical call drafting syntax", () => {
    const parsed = parseDsl([
      "var bust = 840",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(from: A dx: 0 dy: -(bust / 4))",
      "line AB = segment(start: A end: B)",
      "arc armhole = arc(center: A radius: 120 start: 0 end: -90)",
      "text label = label(text: \"前中心\" anchor: A size: 4)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "variable",
      "element",
      "element",
      "element",
      "element",
      "element"
    ]);
    expect(parsed.statements.slice(1).map((statement) => (statement.kind === "element" ? statement.type : null))).toEqual([
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
  });

  it("parses CRLF sources", () => {
    const parsed = parseDsl("group A {\r\n  point P = coordinate(x: 0 y: 0)\r\n}\r\n");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(3);
  });

  it("accepts parent: and branch: attributes", () => {
    const parsed = parseDsl("point A = coordinate(x: 0 y: 0 parent: g1 branch: else)");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0].attrs.map((attr) => attr.key)).toEqual(
      expect.arrayContaining(["parent", "branch"])
    );
  });

  it("keeps an exact conflicting-arg span on the state/visible conflict diagnostic, not a whole-statement span", () => {
    const source = "point A = coordinate(x: 0 y: 0 state: hidden visible: false)";
    const parsed = parseDsl(source);
    const conflict = parsed.diagnostics.find((item) => item.code === "element-state-conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.physicalSpan?.segments).toHaveLength(1);
    const [segment] = conflict!.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("visible");
    // Not the whole statement, which starts at offset 0 ("point").
    expect(segment.from).toBeGreaterThan(0);
  });
});
