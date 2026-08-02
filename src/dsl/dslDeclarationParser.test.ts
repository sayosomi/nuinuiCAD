import { describe, expect, it } from "vitest";
import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";

const parse = (source: string) => parseDslTypedDeclarationStatement(source);
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

describe("DSL typed declaration parser", () => {
  it("returns null for a non-declaration keyword", () => {
    expect(parse("point A = coordinate(x: 0 y: 0)").statement).toBeNull();
    expect(parse("var x = 1").statement).toBeNull();
  });

  it("parses every declared type with exact name/type/initializer spans", () => {
    const source = "const ラベル: string = \"前身頃\"";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({
      kind: "typedDeclaration",
      bindingKind: "const",
      name: "ラベル",
      declaredType: { kind: "string" },
      initializer: '"前身頃"'
    });
    const statement = result.statement!;
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("ラベル");
    expect(source.slice(statement.payloadSpans.type.start, statement.payloadSpans.type.end)).toBe("string");
    expect(source.slice(statement.payloadSpans.initializer.start, statement.payloadSpans.initializer.end)).toBe('"前身頃"');
  });

  it("parses a choice declaration and records per-option spans in order", () => {
    const source = "const 方向: choice(right, left, center) = left";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ declaredType: { kind: "choice", options: ["right", "left", "center"] } });
    const spans = result.statement!.choiceOptionSpans;
    expect(spans.map((span) => source.slice(span.start, span.end))).toEqual(["right", "left", "center"]);
  });

  it("tolerates arbitrary whitespace around the colon and equals sign", () => {
    const result = parse("const   x   :   number   =   12  ");
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ name: "x", declaredType: { kind: "number" }, initializer: "12" });
  });

  it("parses number step and bounds metadata", () => {
    const source = "let 幅: number(max: 200, step: 5, min: 0) = 120";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({
      declaredType: { kind: "number" },
      numericTypeOptions: { step: 5, min: 0, max: 200 }
    });
  });

  it("reports invalid number step and bounds metadata", () => {
    for (const source of [
      "const x: number() = 1",
      "const x: number(step: 0) = 1",
      "const x: number(min: 10, max: 0) = 1",
      "const x: number(step: 1, step: 2) = 1",
      "const x: number(other: 1) = 1"
    ]) {
      const result = parse(source);
      expect(result.statement?.declaredType).toBeNull();
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-number-type-options")).toBe(true);
    }
  });

  it("reports a missing name with no colon or equals present", () => {
    const result = parse("const");
    expect(result.statement).toMatchObject({ name: "", nameSpan: null, declaredType: null, initializer: "" });
    expect(messages("const").some((message) => message.includes("名前"))).toBe(true);
    expect(messages("const").some((message) => message.includes("型注釈"))).toBe(true);
    expect(messages("const").some((message) => message.includes("初期化式"))).toBe(true);
  });

  it("still recovers the name when only the type annotation is missing", () => {
    const result = parse("const x = 5");
    expect(result.statement).toMatchObject({ name: "x", declaredType: null, initializer: "5" });
    expect(messages("const x = 5")).toEqual([expect.stringContaining("型注釈")]);
  });

  it("still recovers name and type when only the initializer is missing", () => {
    const result = parse("const x: number");
    expect(result.statement).toMatchObject({ name: "x", declaredType: { kind: "number" }, initializer: "" });
    expect(messages("const x: number").some((message) => message.includes("初期化式"))).toBe(true);
  });

  it("never evaluates or inspects the initializer's own shape", () => {
    // A syntactically nonsensical initializer for its declared type is not
    // Task 10's concern - it must be preserved verbatim with no diagnostic.
    const result = parse('const x: number = "not a number at all" + garbage(');
    expect(result.diagnostics).toEqual([]);
    expect(result.statement!.initializer).toBe('"not a number at all" + garbage(');
  });

  it("routes every choice option through scanScalarLiteral, not a separate identifier check", () => {
    expect(messages("const c: choice(true) = true").some((m) => m.includes("true/false"))).toBe(true);
    expect(messages("const c: choice(false) = false").some((m) => m.includes("true/false"))).toBe(true);
    expect(messages('const c: choice("a") = a').some((m) => m.includes("裸の識別子"))).toBe(true);
    expect(messages("const c: choice(1) = a").some((m) => m.includes("裸の識別子"))).toBe(true);
    expect(messages("const c: choice(a, a) = a").some((m) => m.includes("重複"))).toBe(true);
    expect(messages("const c: choice() = a").some((m) => m.includes("少なくとも1つ"))).toBe(true);
    // A valid bare Unicode identifier is accepted, matching scanScalarLiteral's
    // own Unicode-aware IDENTIFIER_PATTERN.
    expect(parse("const c: choice(右, 左) = 右").diagnostics).toEqual([]);
  });
});
