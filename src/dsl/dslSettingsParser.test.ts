import { describe, expect, it } from "vitest";
import { parseDslSettingsStatement } from "./dslSettingsParser";

const parse = (source: string, opensBlock = false) => parseDslSettingsStatement(source, { opensBlock });
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

describe("DSL v2 settings parser", () => {
  it("parses every short-form settings statement", () => {
    expect(parse("nui 2").statement).toMatchObject({ kind: "version", value: "2", payloadSpans: { value: { start: 4, end: 5 } } });
    expect(parse("activeView 通常").statement).toMatchObject({ kind: "activeView", name: "通常" });
    expect(parse("activePrintLayout A4").statement).toMatchObject({ kind: "activePrintLayout", name: "A4" });
    expect(parse("@stop").statement).toMatchObject({ kind: "atStop" });
  });

  it("parses call settings with positional and named arguments", () => {
    const color = parse('color pattern-black ("#31322f" name: "基本線" default: true)').statement!;
    expect(color).toMatchObject({ kind: "color", name: "pattern-black", payloadSpans: { hex: { start: 21, end: 30 }, name: { start: 37, end: 42 }, default: { start: 52, end: 56 } } });
    expect(color.args.map((arg) => [arg.key, arg.value])).toEqual([[null, '"#31322f"'], ["name", '"基本線"'], ["default", "true"]]);
    expect(parse('role seam (name: "縫い代")').statement).toMatchObject({ kind: "role", name: "seam" });
    expect(parse("view 通常 (default: true seam: false)").statement?.attrs.map((attr) => attr.key)).toEqual(["default", "seam"]);
    expect(parse("place 前身頃 (at: (0, margin) angle: 0 mirrorX: false)").statement).toMatchObject({ kind: "place", name: "", payloadSpans: { group: { start: 6, end: 9 } } });
  });

  it("parses one-line and projected multiline printLayout headers", () => {
    const inline = parse("printLayout A4 (output: pdf view: 印刷 paper: a4 columns: 2) {").statement!;
    expect(inline).toMatchObject({ kind: "printLayout", name: "A4", opensBlock: true });
    expect(inline.attrs.map((attr) => attr.key)).toEqual(["output", "view", "paper", "columns"]);
    expect(parse("printLayout A4 ( output: pdf view: 印刷 paper: a4 )", true).statement).toMatchObject({ opensBlock: true });
  });

  it("requires commas for nui 3 settings callers when requested", () => {
    const strict = parseDslSettingsStatement("view 印刷 (default: true seam: false)", { requireArgumentCommas: true });
    expect(strict.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-argument-comma", span: { start: 23, end: 27 } }));
    expect(parseDslSettingsStatement("view 印刷 (default: true, seam: false,)", { requireArgumentCommas: true }).diagnostics).toEqual([]);
  });

  it("keeps version values available without deciding supported versions", () => {
    expect(parse("nui 1").diagnostics).toEqual([]);
    expect(parse("nui 3").statement?.value).toBe("3");
  });

  it("reports recoverable argument and statement diagnostics with spans", () => {
    expect(messages("color c (name: \"missing hex\")").join("\n")).toContain("必須の位置引数「hex」");
    expect(messages("place (at: (0, 0))").join("\n")).toContain("必須の位置引数「group」");
    expect(messages("color c (#fff unknown: true)").join("\n")).toContain("引数「unknown」");
    expect(messages("role seam (name: a name: b)").join("\n")).toContain("重複");
    expect(messages("view 通常 (default: )").join("\n")).toContain("値がありません");
    expect(messages("printLayout A4 (output: pdf)").join("\n")).toContain("ブロック");
    expect(messages("@stop extra").join("\n")).toContain("単独");
  });
});
