import { describe, expect, it } from "vitest";
import { categoriesForConstruction, constructionCandidatesFor, constructionFor } from "./dslConstructions";
import {
  CONSTRUCTION_CATEGORY_MISMATCH_CODE,
  UNCLOSED_CALL_CODE,
  parseDslCallStatement
} from "./dslCallParser";
import { parseDsl } from "./dslParser";

const parse = (source: string, opensBlock = false) => parseDslCallStatement(source, { opensBlock });
const messages = (source: string) => parse(source).diagnostics.map((diagnostic) => diagnostic.message);

const calls = [
  ["point", "coordinate", "point A = coordinate(x: 0, y: 0)"],
  ["point", "offset", "point A = offset(from: B, dx: 0, dy: 0)"],
  ["point", "polar", "point A = polar(from: B, angle: 0, distance: 1)"],
  ["point", "between", "point A = between(start: B, end: C, ratio: 0.5)"],
  ["point", "onLine", "point A = onLine(from: AB.end, distance: 1)"],
  ["point", "intersection", "point A = intersection(line1: AB, line2: CD)"],
  ["point", "tangentOffset", "point A = tangentOffset(line: AB, base: B, angle: 0, distance: 1)"],
  ["line", "segment", "line L = segment(start: A, end: B)"],
  ["line", "polar", "line L = polar(start: A, angle: 0, length: 1)"],
  ["line", "offset", "line L = offset(sources: [AB], distance: 1)"],
  ["line", "split", "line L = split(source: AB, at: A)"],
  ["line", "transformCopy", "line L = transformCopy(startPoint: A, endPoint: B, baseLines: [AB])"],
  ["line", "mirrorCopy", "line L = mirrorCopy(axis1: A, axis2: B, baseLines: [AB])"],
  ["mutation", "edge", "edge(end1: AB.end, end2: CD.start)"],
  ["mutation", "extend", "extend(end: AB.end, to: A)"],
  ["mutation", "move", "move(targets: [AB], from: A, to: B)"],
  ["mutation", "mirrorMove", "mirrorMove(targets: [AB], axis1: A, axis2: B)"],
  ["mutation", "reverse", "reverse(target: AB)"],
  ["curve", "bezier", "curve C = bezier(start: A, end: B)"],
  ["arc", "arc", "arc A = arc(center: O, radius: 1)"],
  ["arc", "through", "arc A = through(point1: A, point2: B, point3: C)"],
  ["arc", "corner", "arc A = corner(end1: AB.end, end2: CD.start, radius: 1)"],
  ["text", "label", "text T = label(text: \"A\", anchor: A)"],
  ["image", "image", "image I = image(source: \"a.png\", origin: A)"],
] as const;

describe("DSL nui 1 call parser", () => {
  it("parses every registry element construction", () => {
    for (const [category, construction, source] of calls) {
      const result = parse(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.statement).toMatchObject({ category, construction, elementType: constructionFor(category, construction)?.elementType });
    }
  });

  it("parses container headers with inline and following braces", () => {
    expect(parse("group 前身頃 {").statement).toMatchObject({ category: "group", name: "前身頃", opensBlock: true });
    expect(parse("group 前身頃 (roles: [seam]) {").statement).toMatchObject({ category: "group", opensBlock: true });
    expect(parse("if (@見返し > 0)", true).statement).toMatchObject({ category: "if", opensBlock: true, payloadSpans: { condition: { start: 4, end: 12 } } });
    expect(parse("for i in range(from: 0, count: 3, step: 1) {").statement).toMatchObject({ category: "for", opensBlock: true });
    expect(messages("if (@x > 0)").join("\n")).toContain("ブロック");
  });

  it("preserves quoted and unnamed names, projected arguments, and argument spans", () => {
    const quoted = parse('point "前 身" = coordinate(x: 0, y: -1)').statement!;
    expect(quoted.name).toBe("前 身");
    expect(quoted.nameSpan).toEqual({ start: 6, end: 11 });
    expect(parse("point = coordinate(x: 0, y: 0)").statement?.nameSpan).toBeNull();
    const projected = parse("point B = offset( from: A, dx: @幅 * 2, dy: 0 )").statement!;
    expect(projected.args.map((arg) => [arg.key, arg.value])).toEqual([["from", "A"], ["dx", "@幅 * 2"], ["dy", "0"]]);
    expect(projected.payloadSpans.dx).toEqual({ start: 31, end: 37 });
  });

  it("distinguishes category-scoped constructions sharing the same construction name", () => {
    expect(parse("point P = offset(from: A)").statement?.elementType).toBe("offsetPoint");
    expect(parse("line L = offset(sources: [AB])").statement?.elementType).toBe("offsetLine");
  });

  it("reports scoped, recoverable validation diagnostics with spans", () => {
    const unknownCategory = parse("shape A = coordinate(x: 0)");
    expect(unknownCategory.statement).not.toBeNull();
    expect(unknownCategory.diagnostics[0]).toMatchObject({ message: expect.stringContaining("未知の category"), span: { start: 0, end: 5 } });
    const categoryMismatch = parse("point A = segment(start: A, end: B)");
    expect(categoryMismatch.diagnostics).toContainEqual(expect.objectContaining({
      code: CONSTRUCTION_CATEGORY_MISMATCH_CODE,
      span: { start: "point A = ".length, end: "point A = segment".length }
    }));
    expect(messages("point A = segment(start: A, end: B)").join("\n")).toMatch(/point.*segment.*不一致.*line/);
    expect(parse("line L = segmnt(start: A, end: B)").diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-construction",
      span: { start: "line L = ".length, end: "line L = segmnt".length }
    }));
    expect(messages("point A = missing(x: 0)").join("\n")).toContain("候補: coordinate");
    expect(messages("point A = coordinate(z: 0)").join("\n")).toContain("引数「z」");
    expect(messages("point A = coordinate(x: 0, x: 1)").join("\n")).toContain("重複");
    expect(messages("line L = segment(start: A)").join("\n")).toContain("必須引数「end」");
    expect(messages("point A = between(start: A, end: B, distance: 1, ratio: 0.5)").join("\n")).toBe("引数「distance」と「ratio」は同時に指定できません。");
    expect(messages("point A = coordinate(0)").join("\n")).toContain("位置引数");
    expect(messages("if (condition: 1) {").join("\n")).toContain("位置引数");
    expect(messages("point A = coordinate(x: )").join("\n")).toContain("値がありません");
    expect(messages("point A = coordinate(x: 0) extra").join("\n")).toContain("余分なトークン");
    expect(messages("use N = notch(at: A)").join("\n")).toEqual("use は予約済みですが、まだ実装されていません。");
  });

  it("rejects the removed copy construction and recommends only the new spelling", () => {
    const result = parse("line L = copy(startPoint: A, endPoint: B, baseLines: [AB])");
    expect(result.statement).toMatchObject({ category: "line", construction: "copy", elementType: null });
    const diagnostic = result.diagnostics.map((item) => item.message).join("\n");
    expect(diagnostic).toContain("transformCopy");
    expect(diagnostic).not.toContain("候補: copy");
  });

  it("returns a degraded statement (not null) with an UNCLOSED_CALL_CODE diagnostic when a call's `(` never closes", () => {
    // Mid-edit, shape: an unterminated string swallows the rest of the line,
    // so `matchingClose` can never find `)`. Unlike a genuinely unparseable
    // line, the already-typed `text:` argument's span must still be
    // resolvable - dslLineElementStatement (dslValueSpans.ts) depends on this
    // degraded statement surviving so template-hole completion can work.
    const result = parse('text T = label(text: "${@');
    expect(result.statement).not.toBeNull();
    expect(result.statement).toMatchObject({ category: "text", construction: "label" });
    const textArg = result.statement!.args.find((arg) => arg.key === "text");
    expect(textArg?.valueSpan).toEqual({ start: 21, end: 25 });
    expect(textArg?.value).toBe('"${@');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: UNCLOSED_CALL_CODE, message: "呼び出しの「(」が閉じられていません。" })
    );
  });

  it("rejects the removed visible/enabled flags as unknown arguments; state alone never conflicts", () => {
    expect(messages("point A = coordinate(x: 0, y: 0, state: hidden)")).toEqual([]);
    expect(messages("point A = coordinate(x: 0, y: 0, visible: false)").join("\n")).toContain("引数「visible」");
    expect(messages("point A = coordinate(x: 0, y: 0, enabled: false)").join("\n")).toContain("引数「enabled」");
  });

  it("rejects the removed common color argument on mutations and drawable elements", () => {
    for (const source of [
      "reverse(target: AB, color: red)",
      "edge(end1: AB.end, end2: CD.start, color: red)",
      "point A = coordinate(x: 0, y: 0, color: red)"
    ]) {
      expect(messages(source).join("\n")).toContain("引数「color」");
    }
  });

  it("keeps legacy syntax out of the live parser", () => {
    const arrow = parseDsl("nui 1\nline AB = A -> B");
    const genericElement = parseDsl("nui 1\nelement Copy type=copyLine startPoint=A");
    const equalsArguments = parseDsl("nui 1\npoint A = coordinate(x=0 y=0)");

    expect(arrow.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(genericElement.diagnostics.some((diagnostic) => diagnostic.message.includes("未対応のDSLキーワード"))).toBe(true);
    expect(equalsArguments.diagnostics.some((diagnostic) => diagnostic.message.includes("位置引数"))).toBe(true);
  });
});

describe("DSL nui 1 construction registry parser queries", () => {
  it("keeps parser candidates sourced from the registry", () => {
    expect(constructionCandidatesFor("point").map((spec) => spec.construction)).toContain("coordinate");
    expect(constructionCandidatesFor("line").map((spec) => spec.construction)).toContain("offset");
    expect(constructionCandidatesFor("line").map((spec) => spec.construction)).toContain("transformCopy");
    expect(constructionCandidatesFor("line").map((spec) => spec.construction)).not.toContain("copy");
    expect(categoriesForConstruction("offset")).toEqual(["point", "line"]);
  });
});
