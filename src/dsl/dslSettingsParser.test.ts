import { describe, expect, it } from "vitest";
import { parseDslSettingsStatement } from "./dslSettingsParser";

const parse = (source: string, opensBlock = false) => parseDslSettingsStatement(source, { opensBlock });
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

describe("nui4 settings parser", () => {
  it("parses every short-form settings statement", () => {
    expect(parse("nui 2").statement).toMatchObject({ kind: "version", value: "2", payloadSpans: { value: { start: 4, end: 5 } } });
    expect(parse("activeView 通常").statement).toMatchObject({ kind: "activeView", name: "通常" });
    expect(parse("layout A4 {", true).statement).toMatchObject({ kind: "layout", name: "A4", opensBlock: true });
    expect(parse("stop").statement).toMatchObject({ kind: "atStop" });
  });

  it("parses call settings with positional and named arguments", () => {
    expect(parse('role seam (name: "縫い代")').statement).toMatchObject({ kind: "role", name: "seam" });
    expect(parse("view 通常 (default: true ,seam: false)").statement?.attrs.map((attr) => attr.key)).toEqual(["default", "seam"]);
    expect(parse("place @前身頃(at: (0, margin),angle: 0,mirrorX: false)").statement).toMatchObject({ kind: "place", name: "", payloadSpans: { group: { start: 6, end: 10 } } });
  });

  it("parses one-line print and SVG outputs", () => {
    const print = parse("print A4 (layout: @L,paper: a4,overlap: 10)").statement!;
    expect(print).toMatchObject({ kind: "print", name: "A4", opensBlock: false });
    expect(print.attrs.map((attr) => attr.key)).toEqual(["layout", "paper", "overlap"]);
    expect(parse("svg A4 (layout: @L)").statement).toMatchObject({ kind: "svg", name: "A4" });
  });

  it("requires commas for settings calls", () => {
    const strict = parseDslSettingsStatement("view 印刷 (default: true seam: false)");
    expect(strict.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-argument-comma", span: { start: 23, end: 27 } }));
    expect(parseDslSettingsStatement("view 印刷 (default: true, seam: false,)").diagnostics).toEqual([]);
  });

  it("keeps version values available without deciding supported versions", () => {
    expect(parse("nui 1").diagnostics).toEqual([]);
    expect(parse("nui 4").statement?.value).toBe("4");
  });

  it("reports recoverable argument and statement diagnostics with spans", () => {
    expect(messages("place (at: (0, 0))").join("\n")).toContain("必須の位置引数「group」");
    expect(messages("role seam (name: a ,name: b)").join("\n")).toContain("重複");
    expect(messages("view 通常 (default: )").join("\n")).toContain("値がありません");
    expect(messages("print A4 (paper: a4, overlap: 10)").join("\n")).toContain("必須引数「layout」");
    expect(messages("stop extra").join("\n")).toContain("単独");
  });
});
