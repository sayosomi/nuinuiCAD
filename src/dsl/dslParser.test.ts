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
    const parsed = parseDsl("point A = coordinate(x: 10\n, y: 20)");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]).toMatchObject({ line: 1, endLine: 2, kind: "element", type: "freePoint" });
  });

  it("records keyword, name, and attribute spans", () => {
    const source = "point A = coordinate(x: 10, y: 20, color: main)";
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
    const source = "point A = coordinate(x: 10, y: -20.5)";
    const statement = single(source);
    const xStart = source.indexOf("10");
    expect(statement.payloadSpans.x).toEqual({ start: xStart, end: xStart + 2 });
    const yStart = source.indexOf("-20.5");
    expect(statement.payloadSpans.y).toEqual({ start: yStart, end: yStart + 5 });
    expect(source.slice(statement.payloadSpans.y.start, statement.payloadSpans.y.end)).toBe("-20.5");
  });

  it("records line payload spans", () => {
    const source = "line AB = segment(start: A, end: B)";
    const statement = single(source);
    expect(statement.kind).toBe("element");
    if (statement.kind === "element") expect(statement.type).toBe("line");
    expect(source.slice(statement.payloadSpans.start.start, statement.payloadSpans.start.end)).toBe("A");
    expect(source.slice(statement.payloadSpans.end.start, statement.payloadSpans.end.end)).toBe("B");
  });

  it("records quoted name spans with the quotes included", () => {
    const source = "point \"前 上\" = coordinate(x: 0, y: 0)";
    const statement = single(source);
    expect(statement.name).toBe("前 上");
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("\"前 上\"");
  });
});

describe("DSL parser unnamed statements", () => {
  it("parses unnamed statements when the keyword is followed by =", () => {
    const statement = single("point = coordinate(x: 1, y: 2)");
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
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "group", line: 1, endLine: 2, opensBlock: true });
    expect(parsed.statements[1]).toMatchObject({ kind: "element" });
  });

  it("assigns enclosing block info to nested statements", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = coordinate(x: 0, y: 0)",
      "  group 襟 {",
      "    point B = coordinate(x: 1, y: 1)",
      "  }",
      "  point C = coordinate(x: 2, y: 2)",
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
      "if (@condition) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const [ifStatement, pointA, blockElse, pointB] = parsed.statements;
    expect(ifStatement).toMatchObject({ kind: "element", type: "conditionalGroup", name: "", opensBlock: true });
    expect(pointA.enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(blockElse.kind).toBe("blockElse");
    expect(pointB.enclosing).toEqual({ statementIndex: 0, branch: "else" });
  });

  it("desugars for blocks to forGroup statements", () => {
    const parsed = parseDsl([
      "for i in range(from: 0, count: 5, step: 1) {",
      "  point P = coordinate(x: i, y: 0)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[0];
    expect(statement).toMatchObject({ kind: "element", type: "forGroup", name: "" });
    // The synthetic positional attr is keyed by the DSL spelling ("variable"),
    // not the CadElement parameter key ("variableName"); applyArgs resolves
    // the parameter key from the construction registry separately.
    expect(statement.attrs.find((attr) => attr.key === "variable")?.value).toBe("i");
  });

  it("parses unnamed for blocks", () => {
    const parsed = parseDsl(["for i in range(from: 0, count: 3) {", "}"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({ kind: "element", type: "forGroup", name: "" });
    expect(parsed.statements[0].attrs.find((attr) => attr.key === "variable")?.value).toBe("i");
  });

  it("allows comments and blank lines inside blocks", () => {
    const parsed = parseDsl([
      "group A {",
      "",
      "  # コメント",
      "  point P = coordinate(x: 0, y: 0) # 行末コメント",
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
    expect(errors("point A = coordinate(x: 0, y: 0) {")[0].message).toContain("ブロックを開けません");
  });

  it("reports if without a block", () => {
    expect(errors("if (@condition)")[0].message).toContain("ブロックが必要");
  });

  it("reports mid-line braces", () => {
    expect(errors("group A { point B = coordinate(x: 0, y: 0)").length).toBeGreaterThan(0);
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
    const statement = single('color main ("#ff0000", name: "本体", default: true)');
    expect(statement).toMatchObject({ kind: "color", name: "main", hex: "#ff0000", isDefault: true });
    expect(statement.attrs.find((attr) => attr.key === "name")?.value).toBe('"本体"');
  });

  it("rejects invalid color hex values", () => {
    expect(errors('color main ("#ff00")')[0].message).toContain("#rrggbb");
    expect(errors("color main (red)")[0].message).toContain("#rrggbb");
  });

  it("parses stop as a standalone statement", () => {
    const statement = single("stop");
    expect(statement.kind).toBe("atStop");
    expect(errors("stop extra")[0].message).toContain("単独の行");
  });

  it("rejects more than one stop", () => {
    const result = errors(["point A = coordinate(x: 0, y: 0)", "stop", "point B = coordinate(x: 1, y: 1)", "stop"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("1つだけ");
  });

  it("parses activePrintLayout", () => {
    const statement = single("activePrintLayout 型紙A");
    expect(statement).toMatchObject({ kind: "activePrintLayout", name: "型紙A" });
  });

  it("parses printLayout blocks with place members", () => {
    const parsed = parseDsl([
      "printLayout 型紙A (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 3, overlap: 10, scale: 1) {",
      "  place @前身頃(at: (0, 20), angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const [layout, place] = parsed.statements;
    expect(layout).toMatchObject({ kind: "printLayout", name: "型紙A", opensBlock: true });
    expect(place).toMatchObject({ kind: "place", group: "@前身頃" });
    expect(place.enclosing).toEqual({ statementIndex: 0, branch: "then" });
  });

  it("rejects place outside printLayout blocks", () => {
    expect(errors("place @前身頃(at: (0,0))")[0].message).toContain("printLayout");
  });

  it("rejects element statements inside printLayout blocks", () => {
    const parsed = errors([
      "printLayout 型紙A () {",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    expect(parsed[0].message).toContain("place のみ");
  });
});

describe("DSL typed declarations", () => {
  it("parses a const number declaration with exact name/type/initializer spans", () => {
    const source = "const ゆとり: number = 12";
    const statement = single(source);
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      bindingKind: "const",
      name: "ゆとり",
      declaredType: { kind: "number" },
      initializer: "12"
    });
    if (statement.kind !== "typedDeclaration") return;
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("ゆとり");
    expect(source.slice(statement.payloadSpans.type.start, statement.payloadSpans.type.end)).toBe("number");
    expect(source.slice(statement.payloadSpans.initializer.start, statement.payloadSpans.initializer.end)).toBe("12");
  });

  it("parses a let string declaration", () => {
    const statement = single('let ラベル: string = "前身頃"');
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      bindingKind: "let",
      name: "ラベル",
      declaredType: { kind: "string" },
      initializer: '"前身頃"'
    });
  });

  it("parses a boolean declaration", () => {
    const statement = single("let 表示する: boolean = true");
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      bindingKind: "let",
      declaredType: { kind: "boolean" },
      initializer: "true"
    });
  });

  it("parses a choice declaration with ordered options and per-option spans", () => {
    const source = "const 方向: choice(right, left) = right";
    const statement = single(source);
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      declaredType: { kind: "choice", options: ["right", "left"] },
      initializer: "right"
    });
    if (statement.kind !== "typedDeclaration") return;
    expect(statement.choiceOptionSpans).toHaveLength(2);
    expect(source.slice(statement.choiceOptionSpans[0].start, statement.choiceOptionSpans[0].end)).toBe("right");
    expect(source.slice(statement.choiceOptionSpans[1].start, statement.choiceOptionSpans[1].end)).toBe("left");
  });

  it("keeps a complex numeric expression initializer completely unparsed", () => {
    const statement = single("const x: number = distance(A, B) + 1");
    expect(statement).toMatchObject({ kind: "typedDeclaration", initializer: "distance(A, B) + 1" });
  });

  it("reports a missing type annotation", () => {
    const result = errors("const x = 5");
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("型注釈");
  });

  it("reports a missing initializer", () => {
    const result = errors("const x: number");
    expect(result.some((item) => item.message.includes("初期化式"))).toBe(true);
  });

  it("reports an empty initializer after =", () => {
    const result = errors("const x: number =");
    expect(result.some((item) => item.message.includes("初期化式"))).toBe(true);
  });

  it("reports a missing name", () => {
    const result = errors("const : number = 5");
    expect(result.some((item) => item.message.includes("名前"))).toBe(true);
  });

  it("reports an unrecognized type annotation", () => {
    const result = errors("const x: Vector3 = 5");
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("不明な型注釈");
    const statement = parseDsl("const x: Vector3 = 5").statements[0];
    expect(statement).toMatchObject({ kind: "typedDeclaration", declaredType: null });
  });

  it("rejects an empty choice option list", () => {
    const result = errors("const c: choice() = a");
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("少なくとも1つ"))).toBe(true);
  });

  it("rejects a duplicate choice option", () => {
    const result = errors("const c: choice(right, right) = right");
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("重複"))).toBe(true);
  });

  it("rejects true/false as a choice option", () => {
    const result = errors("const c: choice(true, left) = left");
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("true/false"))).toBe(true);
  });

  it("rejects a quoted string as a choice option", () => {
    const result = errors('const c: choice("right", left) = left');
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("裸の識別子"))).toBe(true);
  });

  it("rejects a number literal as a choice option", () => {
    const result = errors("const c: choice(1, left) = left");
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("裸の識別子"))).toBe(true);
  });

  it("rejects an empty option in the middle of a choice list", () => {
    const result = errors("const c: choice(a,,b) = a");
    expect(result.some((item) => item.code === "invalid-choice-type" && item.message.includes("空"))).toBe(true);
  });

  it("rejects an unterminated choice paren", () => {
    const result = errors("const c: choice(a, b = a");
    expect(result.length).toBeGreaterThan(0);
  });

  it("rejects trailing tokens after a closed choice paren", () => {
    const result = errors("const c: choice(a, b) extra = a");
    expect(result.some((item) => item.message.includes("余分"))).toBe(true);
  });

  it("does not enforce name uniqueness (deferred to later binding-resolution tasks)", () => {
    const parsed = parseDsl(["const x: number = 1", "const x: number = 2"].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("does not open a block and produces no CadElement dependency effects", () => {
    const statement = single("const x: number = 1");
    expect(statement.opensBlock).toBe(false);
  });

  it("is legal inside group and if/else blocks and records enclosing scope", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  const 幅: number = 10",
      "}",
      "if (@condition) {",
      "  let x: boolean = true",
      "} else {",
      "  let x: boolean = false",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const decls = parsed.statements.filter((item) => item.kind === "typedDeclaration");
    expect(decls).toHaveLength(3);
    expect(decls[0].enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(decls[1].enclosing).toMatchObject({ branch: "then" });
    expect(decls[2].enclosing).toMatchObject({ branch: "else" });
  });

  it("allows ordinary typed declarations inside printLayout blocks", () => {
    const result = errors(["printLayout 型紙A () {", "  const x: number = 1", "}"].join("\n"));
    expect(result).toEqual([]);
  });

  it("parses correctly when sandwiched between multi-line vertical element statements", () => {
    const parsed = parseDsl([
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0",
      ")",
      "const ラベル: string = \"A\"",
      "point B = coordinate(",
      "  x: 1,",
      "  y: 1",
      ")"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(3);
    expect(parsed.statements[0]).toMatchObject({ kind: "element", line: 1, endLine: 4 });
    expect(parsed.statements[1]).toMatchObject({ kind: "typedDeclaration", line: 5, endLine: 5 });
    expect(parsed.statements[2]).toMatchObject({ kind: "element", line: 6, endLine: 9 });
  });

  it("tolerates a trailing comment on the same line", () => {
    const statement = single("const x: number = 1 # ゆとり分");
    expect(statement).toMatchObject({ kind: "typedDeclaration", initializer: "1" });
  });

});

describe("DSL set statements", () => {
  it("parses a set statement with exact target/expression spans", () => {
    const source = "set x = 1";
    const statement = single(source);
    expect(statement).toMatchObject({ kind: "set", name: "x", expression: "1" });
    if (statement.kind !== "set") return;
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("x");
    expect(source.slice(statement.payloadSpans.expression.start, statement.payloadSpans.expression.end)).toBe("1");
  });

  it("does not open a block and is excluded from element/duplicate-name processing", () => {
    const statement = single("set x = 1");
    expect(statement.opensBlock).toBe(false);
  });

  it("is legal inside group and if/else blocks and records enclosing scope", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  set 幅 = 10",
      "}",
      "if (@condition) {",
      "  set x = true",
      "} else {",
      "  set x = false",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    const sets = parsed.statements.filter((item) => item.kind === "set");
    expect(sets).toHaveLength(3);
    expect(sets[0].enclosing).toEqual({ statementIndex: 0, branch: "then" });
    expect(sets[1].enclosing).toMatchObject({ branch: "then" });
    expect(sets[2].enclosing).toMatchObject({ branch: "else" });
  });

  it("allows set inside printLayout blocks", () => {
    const result = errors(["printLayout 型紙A () {", "  set x = 1", "}"].join("\n"));
    expect(result).toEqual([]);
  });

  it("reports a missing target name", () => {
    const result = errors("set = 1");
    expect(result.some((item) => item.message.includes("変数名"))).toBe(true);
  });

  it("reports a missing assignment", () => {
    const result = errors("set x");
    expect(result.some((item) => item.message.includes("代入式"))).toBe(true);
  });

  it("tolerates a trailing comment on the same line", () => {
    const statement = single("set x = 1 # 上書き");
    expect(statement).toMatchObject({ kind: "set", expression: "1" });
  });
});

describe("DSL parser duplicate names", () => {
  it("reports duplicate names in the same scope", () => {
    const result = errors(["point A = coordinate(x: 0, y: 0)", "point A = coordinate(x: 1, y: 1)"].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("同名の要素");
  });

  it("allows the same name in different blocks", () => {
    const parsed = parseDsl([
      "group 前身頃 {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "group 後身頃 {",
      "  point A = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows the same name under different, parent: attributes (legacy flat export)", () => {
    const parsed = parseDsl([
      "group 前身頃 (id: g1) {",
      "}",
      "group 後身頃 (id: g2) {",
      "}",
      "point A = coordinate(x: 0, y: 0, id: p1, parent: g1)",
      "point A = coordinate(x: 1, y: 1, id: p2, parent: g2)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows duplicate names when both statements carry distinct ids", () => {
    const parsed = parseDsl([
      "point A = coordinate(x: 0, y: 0, id: p1)",
      "point A = coordinate(x: 1, y: 1, id: p2)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("ignores unnamed statements for duplicate detection", () => {
    const parsed = parseDsl(["point = coordinate(x: 0, y: 0)", "point = coordinate(x: 1, y: 1)"].join("\n"));
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
      'point "X Y" = coordinate(x: 0, y: 0, parent: Base)',
      'point Y = coordinate(x: 1, y: 1, parent: Base X)'
    ].join("\n"));
    const duplicateNameDiagnostics = parsed.diagnostics.filter((item) => item.message.includes("同名の要素"));
    expect(duplicateNameDiagnostics).toEqual([]);
  });
});

describe("DSL parser compatibility", () => {
  it("requires top-level commas for nui 4 calls while preserving nui 2 input", () => {
    const strict = parseDsl(["nui 4", "point C = between(start: @A end: @B ratio: 0.5)"].join("\n"));
    expect(strict.diagnostics.filter((item) => item.code === "missing-argument-comma")).toHaveLength(2);
    const end = strict.diagnostics.find((item) => item.message.includes("end"));
    expect(end?.physicalSpan?.segments).toEqual([{ from: 34, to: 37 }]);

    const commaDelimited = parseDsl("nui 4\nfor i in range(from: 0, count: 3) {\n}");
    expect(commaDelimited.diagnostics).toEqual([]);
    const legacy = parseDsl("nui 4\nfor Loop (i, from: 0, count: 3) {\n}");
    expect(legacy.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("still parses the vertical call drafting syntax", () => {
    const parsed = parseDsl([
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: A, dx: 0, dy: -(210 / 4))",
      "line AB = segment(start: A, end: B)",
      "arc armhole = arc(center: A, radius: 120, start: 0, end: -90)",
      "text label = label(text: \"前中心\", anchor: A, size: 4)"
    ].join("\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "element",
      "element",
      "element",
      "element",
      "element"
    ]);
    expect(parsed.statements.map((statement) => (statement.kind === "element" ? statement.type : null))).toEqual([
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
  });

  it("parses CRLF sources", () => {
    const parsed = parseDsl("group A {\r\n  point P = coordinate(x: 0, y: 0)\r\n}\r\n");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(3);
  });

  it("accepts, parent: and, branch: attributes", () => {
    const parsed = parseDsl("point A = coordinate(x: 0, y: 0, parent: g1, branch: else)");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements[0].attrs.map((attr) => attr.key)).toEqual(
      expect.arrayContaining(["parent", "branch"])
    );
  });

});
