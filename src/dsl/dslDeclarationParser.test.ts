import { describe, expect, it } from "vitest";
import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";
import { parseDslSnapshot } from "./dslParser";
import { geometryArrayTypeOfTypedDeclaration } from "./geometryArraySourceAnnotations";
import { dslValueTypeName, isDslValueTypeAssignable } from "../../packages/nui-language/src/dsl/dslValueTypes";

const parse = (source: string) => parseDslTypedDeclarationStatement(source);
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

describe("DSL typed declaration parser", () => {
  it("returns null for a non-declaration keyword", () => {
    expect(parse("point A = coordinate(x: 0,y: 0)").statement).toBeNull();
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
      valueType: { kind: "string" },
      initializer: '"前身頃"'
    });
    const statement = result.statement!;
    expect(source.slice(statement.nameSpan!.start, statement.nameSpan!.end)).toBe("ラベル");
    expect(source.slice(statement.payloadSpans.type.start, statement.payloadSpans.type.end)).toBe("string");
    expect(source.slice(statement.payloadSpans.initializer.start, statement.payloadSpans.initializer.end)).toBe('"前身頃"');
  });

  it("parses the three immutable geometry-array type spellings", () => {
    for (const [sourceType, elementType] of [
      ["point[]", "point"],
      ["line[]", "line"],
      ["path[]", "path"]
    ] as const) {
      const result = parse(`const items: ${sourceType} = []`);
      expect(result.diagnostics).toEqual([]);
      expect(result.statement).toMatchObject({
        bindingKind: "const",
        valueType: { kind: "array", elementType: { kind: elementType } },
        initializer: "[]"
      });
    }
  });

  it("requires const for every immutable array and rejects nested/invalid spellings", () => {
    const mutable = parse("let items: path[] = []");
    expect(mutable.statement?.valueType).toEqual({ kind: "array", elementType: { kind: "path" } });
    expect(mutable.diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-const-only", span: { start: 0, end: 3 } })
    );

    const numberArray = parse("const items: number[] = []");
    expect(numberArray.diagnostics).toEqual([]);
    expect(numberArray.statement?.valueType).toEqual({ kind: "array", elementType: { kind: "number" } });

    for (const source of ["const items: point[][] = []", "const items: path [ ] = []"]) {
      const result = parse(source);
      expect(result.statement?.valueType).toBeNull();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: source.includes("[][]") ? "nested-array-type" : "unknown-type" }));
    }
  });

  it("parses scalar, choice, and nominal-record arrays", () => {
    expect(parse("const numbers: number[] = [1, 2]").diagnostics).toEqual([]);
    expect(parse("const labels: string[] = [\"a\", \"b\"]").diagnostics).toEqual([]);
    expect(parse("const flags: boolean[] = [true, false]").diagnostics).toEqual([]);
    expect(parse("const choices: choice(left, right)[] = [left, right]").diagnostics).toEqual([]);
    expect(parse("const records: Measurements[] = []").statement?.valueType).toEqual({
      kind: "array",
      elementType: { kind: "record", name: "Measurements" }
    });
  });

  it("parses optional values and preserves array suffix precedence", () => {
    expect(parse("const note: string? = none").statement?.valueType).toEqual({
      kind: "optional",
      valueType: { kind: "string" }
    });
    expect(parse("const members: number?[] = []").statement?.valueType).toEqual({
      kind: "array",
      elementType: { kind: "optional", valueType: { kind: "number" } }
    });
    expect(parse("const maybe: number[]? = []").statement?.valueType).toEqual({
      kind: "optional",
      valueType: { kind: "array", elementType: { kind: "number" } }
    });
    expect(dslValueTypeName(parse("const members: number?[] = []").statement!.valueType!)).toBe("number?[]");
    expect(dslValueTypeName(parse("const maybe: number[]? = []").statement!.valueType!)).toBe("number[]?");
  });

  it("rejects repeated optional suffixes at the extra question mark", () => {
    const result = parse("const x: number?? = none");
    expect(result.statement?.valueType).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "repeated-optional-type",
      span: { start: "const x: number??".indexOf("??"), end: "const x: number??".indexOf("??") + 1 }
    }));
    expect(parse("const x: number?[]? = []").diagnostics).toContainEqual(
      expect.objectContaining({ code: "repeated-optional-type" })
    );
  });

  it("uses one assignability rule for optional scalars, geometry, records, and arrays", () => {
    const number = { kind: "number" } as const;
    const optionalNumber = { kind: "optional", valueType: number } as const;
    const point = { kind: "point" } as const;
    const optionalPoint = { kind: "optional", valueType: point } as const;
    const record = { kind: "record", name: "Measurement" } as const;
    const optionalRecord = { kind: "optional", valueType: record } as const;
    const numbers = { kind: "array", elementType: number } as const;
    const optionalNumbers = { kind: "optional", valueType: numbers } as const;
    const optionalMembers = { kind: "array", elementType: optionalNumber } as const;

    expect(isDslValueTypeAssignable(number, optionalNumber)).toBe(true);
    expect(isDslValueTypeAssignable(optionalNumber, number)).toBe(false);
    expect(isDslValueTypeAssignable(point, optionalPoint)).toBe(true);
    expect(isDslValueTypeAssignable(record, optionalRecord)).toBe(true);
    expect(isDslValueTypeAssignable(numbers, optionalNumbers)).toBe(true);
    expect(isDslValueTypeAssignable(optionalMembers, optionalMembers)).toBe(true);
    expect(isDslValueTypeAssignable(optionalMembers, numbers)).toBe(false);
  });

  it("parses a choice declaration and records per-option spans in order", () => {
    const source = "const 方向: choice(right, left, center) = left";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ valueType: { kind: "choice", options: ["right", "left", "center"] } });
    const spans = result.statement!.choiceOptionSpans;
    expect(spans.map((span) => source.slice(span.start, span.end))).toEqual(["right", "left", "center"]);
  });

  it("tolerates arbitrary whitespace around the colon and equals sign", () => {
    const result = parse("const   x   :   number   =   12  ");
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({ name: "x", valueType: { kind: "number" }, initializer: "12" });
  });

  it("parses number step and bounds metadata", () => {
    const source = "let 幅: number(max: 200, step: 5, min: 0) = 120";
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toMatchObject({
      valueType: { kind: "number" },
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
      expect(result.statement?.valueType).toBeNull();
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-number-type-options")).toBe(true);
    }
  });

  it("reports a missing name with no colon or equals present", () => {
    const result = parse("const");
    expect(result.statement).toMatchObject({ name: "", nameSpan: null, valueType: null, initializer: "" });
    expect(messages("const").some((message) => message.includes("名前"))).toBe(true);
    expect(messages("const").some((message) => message.includes("型注釈"))).toBe(true);
    expect(messages("const").some((message) => message.includes("初期化式"))).toBe(true);
  });

  it("still recovers the name when only the type annotation is missing", () => {
    const result = parse("const x = 5");
    expect(result.statement).toMatchObject({ name: "x", valueType: null, initializer: "5" });
    expect(messages("const x = 5")).toEqual([expect.stringContaining("型注釈")]);
  });

  it("still recovers name and type when only the initializer is missing", () => {
    const result = parse("const x: number");
    expect(result.statement).toMatchObject({ name: "x", valueType: { kind: "number" }, initializer: "" });
    expect(messages("const x: number").some((message) => message.includes("初期化式"))).toBe(true);
  });

  it("never evaluates or inspects the initializer's own shape", () => {
    // A syntactically nonsensical initializer for its declared type is not
    // Task 10's concern - it must be preserved verbatim with no diagnostic.
    const result = parse('const x: number = "not a number at all" + garbage(');
    expect(result.diagnostics).toEqual([]);
    expect(result.statement!.initializer).toBe('"not a number at all" + garbage(');
  });

  it("parses single geometry declarations as canonical immutable value types", () => {
    const result = parse("const p: point = @p");
    expect(result.diagnostics).toEqual([]);
    expect(result.statement?.valueType).toEqual({ kind: "point" });
    expect(parse("const l: line = @l").statement?.valueType).toEqual({ kind: "line" });
    expect(parse("const p: path = @p").statement?.valueType).toEqual({ kind: "path" });
  });

  it("requires const for single geometry declarations", () => {
    const result = parse("let p: point = @p");
    expect(result.statement?.valueType).toEqual({ kind: "point" });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-value-const-only", span: { start: 0, end: 3 } })
    );
  });

  it("carries the canonical type through the final snapshot and projects geometry arrays compatibly", () => {
    const parsed = parseDslSnapshot({ normalizedSource: "nui 1\nconst paths: path[] = []", sourceRevision: 3 });
    const statement = parsed.statements[1];
    expect(statement).toMatchObject({
      kind: "typedDeclaration",
      valueType: { kind: "array", elementType: { kind: "path" } }
    });
    if (statement?.kind !== "typedDeclaration") throw new Error("typed declaration not parsed");
    expect(geometryArrayTypeOfTypedDeclaration(statement)).toEqual({ kind: "geometryArray", elementType: "path" });
  });

  it("routes every choice option through scanScalarLiteral, not a separate identifier check", () => {
    expect(messages("const c: choice(true) = true").some((m) => m.includes("true/false"))).toBe(true);
    expect(messages("const c: choice(false) = false").some((m) => m.includes("true/false"))).toBe(true);
    expect(messages('const c: choice("a") = a').some((m) => m.includes("裸の識別子"))).toBe(true);
    expect(messages("const c: choice(1) = a").some((m) => m.includes("裸の識別子"))).toBe(true);
    expect(messages("const c: choice(a, a) = a").some((m) => m.includes("重複"))).toBe(true);
    expect(messages("const c: choice(pi, left) = left").some((m) => m.includes("裸の識別子"))).toBe(true);
    expect(parse("const c: choice(none, left) = left").diagnostics).toContainEqual(
      expect.objectContaining({ code: "reserved-none-choice-option" })
    );
    expect(messages("const c: choice() = a").some((m) => m.includes("少なくとも1つ"))).toBe(true);
    // A valid bare Unicode identifier is accepted, matching scanScalarLiteral's
    // own Unicode-aware IDENTIFIER_PATTERN.
    expect(parse("const c: choice(右, 左) = 右").diagnostics).toEqual([]);
  });
});
