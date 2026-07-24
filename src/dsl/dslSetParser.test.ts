import { describe, expect, it } from "vitest";
import { parseDslSetStatement } from "./dslSetParser";

const parse = (source: string) => parseDslSetStatement(source);
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

describe("DSL set statement parser", () => {
  it("returns null for a non-set keyword", () => {
    expect(parse("const x: number = 1").statement).toBeNull();
    expect(parse("let x: number = 1").statement).toBeNull();
    expect(parse("point A = coordinate(x: 0 y: 0)").statement).toBeNull();
    expect(parse("var x = 1").statement).toBeNull();
  });

  it("parses a simple set statement with exact target/expression spans", () => {
    const source = "set 表示する = false";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({
      kind: "set",
      name: "表示する",
      expression: "false"
    });
    const statement = result.statement!;
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("表示する");
    expect(source.slice(statement.payloadSpans.expression.start, statement.payloadSpans.expression.end)).toBe("false");
  });

  it("tolerates arbitrary whitespace around the equals sign", () => {
    const result = parse("set   x   =   12  ");
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ name: "x", expression: "12" });
  });

  it("never parses or inspects the RHS expression's own shape", () => {
    const result = parse('set x = "not a number at all" + garbage(');
    expect(result.diagnostics).toEqual([]);
    expect(result.statement!.expression).toBe('"not a number at all" + garbage(');
  });

  it("does not split on `=` inside a quoted RHS string", () => {
    const result = parse('set label = "a = b"');
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ name: "label", expression: '"a = b"' });
  });

  it("reports a missing name with no equals present", () => {
    const result = parse("set");
    expect(result.statement).toMatchObject({ name: "", nameSpan: null, expression: "" });
    expect(messages("set").some((message) => message.includes("変数名"))).toBe(true);
    expect(messages("set").some((message) => message.includes("代入式"))).toBe(true);
  });

  it("still recovers the name when only the RHS is missing", () => {
    const result = parse("set x =");
    expect(result.statement).toMatchObject({ name: "x", expression: "" });
    expect(messages("set x =").some((message) => message.includes("値が必要"))).toBe(true);
  });

  it("reports a missing equals when only a name is present", () => {
    const result = parse("set x");
    expect(result.statement).toMatchObject({ name: "x", expression: "" });
    expect(messages("set x").some((message) => message.includes("代入式"))).toBe(true);
  });
});
