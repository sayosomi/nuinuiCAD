import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "./dslDocument";
import { parseDsl } from "./dslParser";

const sourceLines = (...lines: string[]) => lines.join("\n");
const errors = (source: string) => compileDslDocument(source).diagnostics.filter((item) => item.severity === "error");
const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

describe("nui4 drawing modifier source model", () => {
  it("stores Japanese definitions and all supported states", () => {
    const compiled = compileDslDocument(sourceLines(
      "nui 4",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "modifier 元袖ぐり {",
      "  state: hidden,",
      "}",
      "modifier 裁断線 {",
      "  state: disabled,",
      "}"
    ));

    expect(errors(sourceLines(
      "nui 4",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "modifier 元袖ぐり {",
      "  state: hidden,",
      "}",
      "modifier 裁断線 {",
      "  state: disabled,",
      "}"
    ))).toEqual([]);
    expect(compiled.document?.modifiers).toEqual([
      { name: "基本線", state: "visible" },
      { name: "元袖ぐり", state: "hidden" },
      { name: "裁断線", state: "disabled" }
    ]);
  });

  it("preserves ordered geometry and group modifier references", () => {
    const source = sourceLines(
      "nui 4",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "modifier 元袖ぐり {",
      "  state: hidden,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "line 袖ぐりA [基本線, 元袖ぐり] = segment(start: @A, end: @A)",
      "group 前身頃 [元袖ぐり, 基本線] {",
      "}"
    );
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.find((statement) => statement.name === "袖ぐりA")?.modifierNames)
      .toEqual(["基本線", "元袖ぐり"]);
    expect(parsed.statements.find((statement) => statement.name === "前身頃")?.modifierNames)
      .toEqual(["元袖ぐり", "基本線"]);

    const compiled = compileDslDocument(source);
    expect(errors(source)).toEqual([]);
    expect(compiled.document?.elements.map((element) => [element.name, element.modifierNames])).toEqual([
      ["A", undefined],
      ["袖ぐりA", ["基本線", "元袖ぐり"]],
      ["前身頃", ["元袖ぐり", "基本線"]]
    ]);
    expect(compiled.statementMap?.byModifierName.get("基本線")?.range).toEqual({ startLine: 2, endLine: 4 });
    expect(compiled.statementMap?.modifierDefinitionRangeByName.get("元袖ぐり")).toEqual({ startLine: 5, endLine: 7 });
  });

  it("diagnoses duplicate names, nested definitions, and undefined references", () => {
    const duplicate = errors(sourceLines(
      "nui 4",
      "modifier A {",
      "  state: visible,",
      "}",
      "modifier A {",
      "  state: hidden,",
      "}"
    ));
    expect(duplicate.some((item) => item.message.includes("重複"))).toBe(true);

    const nested = errors(sourceLines(
      "nui 4",
      "group G {",
      "  modifier A {",
      "    state: visible,",
      "  }",
      "}"
    ));
    expect(nested.some((item) => item.message.includes("トップレベル"))).toBe(true);

    const nestedModifier = errors(sourceLines(
      "nui 4",
      "modifier Outer {",
      "  modifier Inner {",
      "    state: visible,",
      "  }",
      "  state: visible,",
      "}"
    ));
    expect(nestedModifier.some((item) => item.message.includes("ネスト"))).toBe(true);

    const undefinedReference = errors(sourceLines(
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "line L [未定義] = segment(start: @A, end: @A)"
    ));
    expect(undefinedReference.filter((item) => item.message.includes("未定義の modifier"))).toHaveLength(1);
  });

  it("keeps undefined modifier diagnostics in Module documents", () => {
    const compiled = compileWithIds(sourceLines(
      "nui 4",
      "module M() {",
      "  point Internal = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M()",
      "point Root [未定義] = coordinate(x: 1, y: 1)"
    ));

    expect(compiled.diagnostics.filter((item) => item.message.includes("未定義の modifier"))).toEqual([
      expect.objectContaining({ line: 6, message: "未定義の modifier です: 未定義" })
    ]);
  });

  it("resolves valid modifier references against document-level definitions in Module documents", () => {
    const compiled = compileWithIds(sourceLines(
      "nui 4",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "module M() {",
      "  point Internal = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M()",
      "point Root [基本線] = coordinate(x: 1, y: 1)"
    ));

    expect(compiled.moduleMaterialization).toBeDefined();
    expect(compiled.diagnostics.filter((item) => item.message.includes("未定義の modifier"))).toEqual([]);
  });

  it("validates modifier references on geometry declarations inside Module bodies", () => {
    const compiled = compileWithIds(sourceLines(
      "nui 4",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "module M() {",
      "  point Valid [基本線] = coordinate(x: 0, y: 0)",
      "  group Invalid [未定義] {",
      "  }",
      "}",
      "instance Use = M()"
    ));

    expect(compiled.moduleMaterialization).toBeDefined();
    expect(compiled.diagnostics.filter((item) => item.message.includes("未定義の modifier"))).toEqual([
      expect.objectContaining({ line: 7, message: "未定義の modifier です: 未定義" })
    ]);
  });

  it("rejects duplicate or invalid state, missing commas, and unknown properties", () => {
    const cases = [
      ["duplicate state", ["state: visible,", "state: hidden,"], "state プロパティは1つだけ"],
      ["invalid state", ["state: maybe,"], "visible / hidden / disabled"],
      ["missing comma", ["state: hidden"], "末尾の「,」"],
      ["unknown property", ["color: red,"], "未知のプロパティ"]
    ] as const;
    for (const [, properties, message] of cases) {
      const source = sourceLines("nui 4", "modifier A {", ...properties.map((property) => `  ${property}`), "}");
      expect(errors(source).some((item) => item.message.includes(message))).toBe(true);
    }

    const onePerLine = errors(sourceLines(
      "nui 4",
      "modifier A {",
      "  state: hidden, color: red,",
      "}"
    ));
    expect(onePerLine.some((item) => item.message.includes("1行に1つ"))).toBe(true);

    expect(errors("nui 4\nmodifier A").some((item) => item.message.includes("ブロックが必要"))).toBe(true);
    expect(errors("nui 4\nmodifier A (state: hidden) {").some((item) => item.message.includes("名前が不正"))).toBe(true);
  });

  it("round-trips definitions and ordered references through canonical serialization", () => {
    const source = sourceLines(
      "nui 4",
      "modifier 元袖ぐり {",
      "  state: hidden,",
      "}",
      "modifier 基本線 {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "line L [基本線, 元袖ぐり] = segment(start: @A, end: @A)"
    );
    const first = compileDslDocument(source);
    expect(first.document).not.toBeNull();
    const canonical = serializeDocumentToDsl(first.document!, first.majorVersion!);
    expect(canonical).toContain("modifier 元袖ぐり {\n  state: hidden,\n}");
    expect(canonical).toContain("line L [基本線, 元袖ぐり] = segment(");

    const second = compileDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(second.document?.modifiers).toEqual(first.document?.modifiers);
    expect(second.document?.elements.at(-1)?.modifierNames).toEqual(["基本線", "元袖ぐり"]);
  });

  it("keeps direct state and palette color behavior unchanged", () => {
    const compiled = compileDslDocument(
      "nui 4\npoint P = coordinate(x: 0, y: 0, state: hidden, color: pattern-black)"
    );
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.document?.elements[0]).toMatchObject({ activity: "hidden", colorId: "pattern-black" });
  });

});
