import { describe, expect, it } from "vitest";
import { categoriesForConstruction, constructionCandidatesFor, constructionFor } from "./dslConstructions";
import { parseDslCallStatement } from "./dslCallParser";
import { parseDsl } from "./dslParser";

const parse = (source: string, opensBlock = false) => parseDslCallStatement(source, { opensBlock });
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

const calls = [
  ["point", "coordinate", "point A = coordinate(x: 0 y: 0)"],
  ["point", "offset", "point A = offset(from: B dx: 0 dy: 0)"],
  ["point", "polar", "point A = polar(from: B angle: 0 distance: 1)"],
  ["point", "between", "point A = between(start: B end: C ratio: 0.5)"],
  ["point", "onLine", "point A = onLine(from: AB.end distance: 1)"],
  ["point", "intersection", "point A = intersection(line1: AB line2: CD)"],
  ["point", "tangentOffset", "point A = tangentOffset(line: AB base: B angle: 0 distance: 1)"],
  ["line", "segment", "line L = segment(start: A end: B)"],
  ["line", "polar", "line L = polar(start: A angle: 0 length: 1)"],
  ["line", "offset", "line L = offset(sources: [AB] distance: 1)"],
  ["line", "split", "line L = split(source: AB at: A)"],
  ["line", "extend", "line L = extend(end: AB.end to: A)"],
  ["line", "copy", "line L = copy(startPoint: A endPoint: B baseLines: [AB])"],
  ["line", "move", "line L = move(startPoint: A endPoint: B baseLines: [AB])"],
  ["line", "mirrorCopy", "line L = mirrorCopy(axis1: A axis2: B baseLines: [AB])"],
  ["line", "mirrorMove", "line L = mirrorMove(axis1: A axis2: B baseLines: [AB])"],
  ["line", "edge", "line L = edge(end1: AB.end end2: CD.start)"],
  ["curve", "bezier", "curve C = bezier(start: A end: B)"],
  ["arc", "arc", "arc A = arc(center: O radius: 1)"],
  ["arc", "through", "arc A = through(point1: A point2: B point3: C)"],
  ["arc", "corner", "arc A = corner(end1: AB.end end2: CD.start radius: 1)"],
  ["text", "label", "text T = label(text: \"A\" anchor: A)"],
  ["image", "image", "image I = image(source: \"a.png\" origin: A)"],
  ["var", "expression", "var x = expression(value: 1)"],
  ["var", "pointDistance", "var x = pointDistance(point1: A point2: B)"],
  ["var", "pointAngle", "var x = pointAngle(point1: A point2: B)"],
  ["var", "pointLineDistance", "var x = pointLineDistance(point: A line: AB)"],
] as const;

describe("DSL v2 call parser", () => {
  it("parses every registry element construction", () => {
    for (const [category, construction, source] of calls) {
      const result = parse(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.statement).toMatchObject({ category, construction, elementType: constructionFor(category, construction)?.elementType });
    }
  });

  it("parses container headers with inline and following braces", () => {
    expect(parse("group 前身頃 {").statement).toMatchObject({ category: "group", name: "前身頃", opensBlock: true });
    expect(parse("group 前身頃 (printEnabled: true) {").statement).toMatchObject({ category: "group", opensBlock: true });
    expect(parse("if 分岐 (@見返し > 0)", true).statement).toMatchObject({ category: "if", opensBlock: true, payloadSpans: { condition: { start: 7, end: 15 } } });
    expect(parse("for 繰返し (i from: 0 count: 3 step: 1) {").statement).toMatchObject({ category: "for", opensBlock: true });
    expect(messages("if (@x > 0)").join("\n")).toContain("ブロック");
  });

  it("preserves quoted and unnamed names, projected arguments, and argument spans", () => {
    const quoted = parse('point "前 身" = coordinate(x: 0 y: -1)').statement!;
    expect(quoted.name).toBe("前 身");
    expect(quoted.nameSpan).toEqual({ start: 6, end: 11 });
    expect(parse("point = coordinate(x: 0 y: 0)").statement?.nameSpan).toBeNull();
    const projected = parse("point B = offset( from: A dx: @幅 * 2 dy: 0 )").statement!;
    expect(projected.args.map((arg) => [arg.key, arg.value])).toEqual([["from", "A"], ["dx", "@幅 * 2"], ["dy", "0"]]);
    expect(projected.payloadSpans.dx).toEqual({ start: 30, end: 36 });
  });

  it("distinguishes short variables from variable calls and category-scoped constructions", () => {
    expect(parse("var bust = 840").statement).toMatchObject({ construction: "expression", shortVariable: true, payloadSpans: { expression: { start: 11, end: 14 } } });
    expect(parse("var width = pointDistance(point1: A point2: B)").statement).toMatchObject({ construction: "pointDistance", shortVariable: false });
    expect(parse("point P = offset(from: A)").statement?.elementType).toBe("offsetPoint");
    expect(parse("line L = offset(sources: [AB])").statement?.elementType).toBe("offsetLine");
  });

  it("reports scoped, recoverable validation diagnostics with spans", () => {
    const unknownCategory = parse("shape A = coordinate(x: 0)");
    expect(unknownCategory.statement).not.toBeNull();
    expect(unknownCategory.diagnostics[0]).toMatchObject({ message: expect.stringContaining("未知の category"), span: { start: 0, end: 5 } });
    expect(messages("point A = segment(start: A end: B)").join("\n")).toMatch(/point.*segment.*不一致.*line/);
    expect(messages("point A = missing(x: 0)").join("\n")).toContain("候補: coordinate");
    expect(messages("point A = coordinate(z: 0)").join("\n")).toContain("引数「z」");
    expect(messages("point A = coordinate(x: 0 x: 1)").join("\n")).toContain("重複");
    expect(messages("line L = segment(start: A)").join("\n")).toContain("必須引数「end」");
    expect(messages("point A = between(start: A end: B distance: 1 ratio: 0.5)").join("\n")).toContain("同時に指定できません");
    expect(messages("point A = coordinate(0)").join("\n")).toContain("位置引数");
    expect(messages("if (condition: 1) {").join("\n")).toContain("位置引数");
    expect(messages("point A = coordinate(x: )").join("\n")).toContain("値がありません");
    expect(messages("point A = coordinate(x: 0) extra").join("\n")).toContain("余分なトークン");
    expect(messages("use N = notch(at: A)").join("\n")).toEqual("use は予約済みですが、まだ実装されていません。");
  });

  it("keeps legacy syntax out of the live v2 parser", () => {
    const arrow = parseDsl("nui 2\nline AB = A -> B");
    const genericElement = parseDsl("nui 2\nelement Copy type=copyLine startPoint=A");
    const equalsArguments = parseDsl("nui 2\npoint A = coordinate(x=0 y=0)");

    expect(arrow.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(genericElement.diagnostics.some((diagnostic) => diagnostic.message.includes("未対応のDSLキーワード"))).toBe(true);
    expect(equalsArguments.diagnostics.some((diagnostic) => diagnostic.message.includes("位置引数"))).toBe(true);
  });
});

describe("DSL v2 construction registry parser queries", () => {
  it("keeps parser candidates sourced from the registry", () => {
    expect(constructionCandidatesFor("point").map((spec) => spec.construction)).toContain("coordinate");
    expect(constructionCandidatesFor("line").map((spec) => spec.construction)).toContain("offset");
    expect(categoriesForConstruction("offset")).toEqual(["point", "line"]);
  });
});
