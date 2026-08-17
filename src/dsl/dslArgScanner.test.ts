import { describe, expect, it } from "vitest";
import type { DslSpan } from "./dslTypes";
import { EMPTY_ARGUMENT_CODE, MISSING_ARGUMENT_COMMA_CODE, scanCallArgs } from "./dslArgScanner";

const spanOf = (source: string, text: string, from = 0): DslSpan => {
  const start = source.indexOf(text, from);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { start, end: start + text.length };
};

const scan = (source: string) => {
  const open = source.indexOf("(");
  return scanCallArgs(source, { start: open + 1, end: source.lastIndexOf(")") });
};

const strictScan = (source: string) => {
  const open = source.indexOf("(");
  return scanCallArgs(source, { start: open + 1, end: source.lastIndexOf(")") });
};

describe("scanCallArgs", () => {
  it("scans named arguments from projected vertical, one-line, and mixed calls", () => {
    const vertical = "offset(from: A, dx: @幅 * 2)";
    const oneLine = "coordinate(x: 50,y: -50)";
    const mixed = "offset( from: A, dx: 100, dy: -20 )";

    expect(scan(vertical).args).toEqual([
      { key: "from", keySpan: spanOf(vertical, "from"), value: "A", valueSpan: spanOf(vertical, "A") },
      { key: "dx", keySpan: spanOf(vertical, "dx"), value: "@幅 * 2", valueSpan: spanOf(vertical, "@幅 * 2") },
    ]);
    expect(scan(oneLine).args.map((arg) => [arg.key, arg.value])).toEqual([["x", "50"], ["y", "-50"]]);
    expect(scan(mixed).args.map((arg) => [arg.key, arg.value])).toEqual([["from", "A"], ["dx", "100"], ["dy", "-20"]]);
  });

  it("returns leading positional arguments only before the first named boundary", () => {
    const positionalOnly = "if(@見返し > 0)";
    const positionalAndNamed = "call(i, from: 0, count: 3, step: 1)";
    const namedOnly = "coordinate(x: 0,y: 0)";

    expect(scan(positionalOnly).args).toEqual([
      { key: null, keySpan: null, value: "@見返し > 0", valueSpan: spanOf(positionalOnly, "@見返し > 0") },
    ]);
    expect(scan(positionalAndNamed).args.map((arg) => [arg.key, arg.value])).toEqual([
      [null, "i"], ["from", "0"], ["count", "3"], ["step", "1"],
    ]);
    expect(scan(namedOnly).args.map((arg) => arg.key)).toEqual(["x", "y"]);
  });

  it("does not split nested values, quoted strings, or reference forms", () => {
    const source = 'call(at: (0, 0), sources: [AB, CD], records: [高さ: 10; 幅: @x * 2], text: "(: #)", ref: @前身頃::交点, endpoint: @AB.end)';

    expect(scan(source).args.map((arg) => [arg.key, arg.value])).toEqual([
      ["at", "(0, 0)"],
      ["sources", "[AB, CD]"],
      ["records", "[高さ: 10; 幅: @x * 2]"],
      ["text", '"(: #)"'],
      ["ref", "@前身頃::交点"],
      ["endpoint", "@AB.end"],
    ]);
    expect(scan(source).errors).toEqual([]);
  });

  it("uses top-level commas while retaining commas inside nested values", () => {
    const source = 'call(at: (0, 0), sources: [AB, CD], value: min(1, 2), text: "a, b",)';
    const result = strictScan(source);

    expect(result.args.map((arg) => [arg.key, arg.value])).toEqual([
      ["at", "(0, 0)"],
      ["sources", "[AB, CD]"],
      ["value", "min(1, 2)"],
      ["text", '"a, b"'],
    ]);
    expect(result.errors).toEqual([]);
  });

  it("recovers whitespace-separated arguments in strict mode and points at each missing comma", () => {
    const source = "call(start: A end: B ratio: 0.5)";
    const result = strictScan(source);

    expect(result.args.map((arg) => [arg.key, arg.value])).toEqual([["start", "A"], ["end", "B"], ["ratio", "0.5"]]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: MISSING_ARGUMENT_COMMA_CODE, span: spanOf(source, "end") }),
      expect.objectContaining({ code: MISSING_ARGUMENT_COMMA_CODE, span: spanOf(source, "ratio") }),
    ]);
  });

  it("rejects empty comma-delimited arguments but permits exactly one trailing comma", () => {
    expect(strictScan("call(, x: 1)").errors).toContainEqual(expect.objectContaining({ code: EMPTY_ARGUMENT_CODE }));
    expect(strictScan("call(x: 1,, y: 2)").errors).toContainEqual(expect.objectContaining({ code: EMPTY_ARGUMENT_CODE }));
    expect(strictScan("call(x: 1,)").errors).toEqual([]);
  });

  it("reports empty values and a missing space after a colon with precise spans", () => {
    const source = "call(x: , y: 2, z:3)";
    const result = scan(source);

    expect(result.args.map((arg) => [arg.key, arg.value])).toEqual([["x", ""], ["y", "2"], ["z", "3"]]);
    // The single mandatory separator space is x's whole raw gap here, so
    // rawValueSpan and the trimmed (collapsed) valueSpan coincide.
    expect(result.args[0]).toEqual({
      key: "x",
      keySpan: spanOf(source, "x"),
      value: "",
      valueSpan: { start: source.indexOf("x:") + 3, end: source.indexOf("x:") + 3 },
      rawValueSpan: { start: source.indexOf("x:") + 2, end: source.indexOf("x:") + 3 },
    });
    expect(result.errors).toEqual([
      {
        message: "引数「x」の値がありません。",
        span: { start: source.indexOf("x:") + 3, end: source.indexOf("x:") + 3 },
        code: "missing-attribute-value",
      },
      {
        message: "引数「z」の「:」の後には空白が必要です。",
        span: { start: source.indexOf("z:") + 1, end: source.indexOf("z:") + 2 },
      },
    ]);
  });

  it("keeps the full untrimmed gap as rawValueSpan when an empty value has more than one separating space", () => {
    // Mirrors deleting a value that had its own leading+trailing space
    // (e.g. "side: @side closed:" -> "side:  closed:"): two whitespace
    // characters remain between the colon and the next key.
    const source = "call(x:  y: 2)";
    const result = scan(source);
    const rawStart = source.indexOf(":", source.indexOf("x")) + 1;
    const rawEnd = source.indexOf("y:");

    expect(rawEnd - rawStart).toBe(2);
    expect(result.args[0]).toEqual({
      key: "x",
      keySpan: spanOf(source, "x"),
      value: "",
      // trimSpan still collapses the trimmed span to the gap's far edge...
      valueSpan: { start: rawEnd, end: rawEnd },
      // ...but rawValueSpan preserves the whole untrimmed gap, including the
      // position right after the colon where a deleted value's cursor sits.
      rawValueSpan: { start: rawStart, end: rawEnd },
    });
  });
});
