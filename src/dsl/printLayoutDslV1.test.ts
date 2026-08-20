import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "./dslDocument";
import { parseDsl } from "./dslParser";

const validSource = [
  "nui 4",
  "profile 印刷用",
  "profile SVG用",
  "group 前身頃 {",
  "  point 基準点 = coordinate(x: 0, y: 0)",
  "  point 袖点 = coordinate(x: 20, y: 30)",
  "}",
  "group 後身頃 {",
  "  point 基準点 = coordinate(x: 5, y: 5)",
  "}",
  "layout 型紙(scale: 1) {",
  "  place @前身頃(origin: @前身頃::基準点, at: (0, 0), scale: 2, angle: 360, mirror: true)",
  "  place @後身頃(at: (10, 20))",
  "}",
  "layout 空レイアウト {",
  "}",
  "print 家庭用A4(layout: @型紙, profile: @印刷用, paper: a4, orientation: portrait, margin: 10, overlap: 10)",
  "svg 型紙SVG(layout: @型紙, profile: @SVG用)",
].join("\n");

const errors = (source: string) => compileDslDocument(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("SAY-63 print layout DSL v1", () => {
  it("parses and compiles layouts, placements, print outputs, and SVG outputs", () => {
    const compiled = compileDslDocument(validSource);
    expect(errors(validSource)).toEqual([]);
    expect(compiled.document?.layouts).toHaveLength(2);
    expect(compiled.document?.layouts[0].placements).toHaveLength(2);
    expect(compiled.document?.layouts[0].placements.map((placement) => placement.groupId)).toEqual([
      compiled.document?.elements.find((element) => element.name === "前身頃" && element.type === "group")?.id,
      compiled.document?.elements.find((element) => element.name === "後身頃" && element.type === "group")?.id,
    ]);
    expect(compiled.document?.layouts[0].placements[0]).toMatchObject({
      origin: { kind: "point" },
      at: { x: 0, y: 0 },
      scale: 2,
      angleDeg: 0,
      mirror: true,
    });
    expect(compiled.document?.layouts[0].placements[1]).toMatchObject({
      origin: { kind: "localOrigin" },
      at: { x: 10, y: 20 },
      angleDeg: 0,
      mirror: false,
    });
    expect(compiled.document?.layouts[0].placements[1].scale).toBeUndefined();
    expect(compiled.document?.printOutputs[0]).toMatchObject({
      paper: "a4",
      orientation: "portrait",
      margin: 10,
      overlap: 10,
    });
    expect(compiled.document?.svgOutputs[0]).toMatchObject({ margin: 0 });
    expect(compiled.document?.printOutputs[0].profileId).toBe(
      compiled.document?.drawingProfiles?.find((profile) => profile.name === "印刷用")?.id
    );
  });

  it("accepts omitted layout parentheses and empty layouts", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "layout 空レイアウト {",
      "}",
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts).toHaveLength(1);
    expect(compiled.document?.layouts[0]).toMatchObject({ name: "空レイアウト", scale: 1, placements: [] });
  });

  it("preserves the canonical source model through serialization", () => {
    const compiled = compileDslDocument(validSource);
    expect(compiled.document).not.toBeNull();
    const serialized = serializeDocumentToDsl(compiled.document!, 4);
    expect(serialized).toContain("layout 型紙(");
    expect(serialized).toContain("print 家庭用A4(");
    expect(serialized).toContain("svg 型紙SVG(");
    const reparsed = compileDslDocument(serialized);
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reparsed.document?.layouts).toHaveLength(2);
    expect(reparsed.document?.layouts[0].placements).toHaveLength(2);
    expect(reparsed.document?.printOutputs).toHaveLength(1);
    expect(reparsed.document?.svgOutputs).toHaveLength(1);
  });

  it("uses non-hoisted lexical references and rejects wrong kinds and cross-group origins", () => {
    const forward = compileDslDocument([
      "nui 4",
      "print 出力(layout: @後出し, paper: a4, overlap: 0)",
      "layout 後出し {",
      "}",
    ].join("\n"));
    expect(errors(forward.sourceLines.join("\n")).some((diagnostic) => diagnostic.message.includes("後で宣言"))).toBe(true);

    const invalid = compileDslDocument([
      "nui 4",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "group B {",
      "  point Q = coordinate(x: 0, y: 0)",
      "}",
      "layout L {",
      "  place @A::P(at: (0, 0))",
      "  place @A(origin: @B::Q, at: (0, 0))",
      "}",
    ].join("\n"));
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.message.includes("group ではありません"))).toBe(true);
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.message.includes("内部にありません"))).toBe(true);
  });

  it("enforces required fields and static literal constraints", () => {
    const source = [
      "nui 4",
      "group G {",
      "}",
      "layout L(scale: 0) {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, margin: 200, overlap: 100)",
      "svg S(layout: @L, margin: -1)",
    ].join("\n");
    const diagnostics = errors(source);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("正の値"))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("有効な用紙幅・高さ"))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("overlap"))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("svg margin"))).toBe(true);
    expect(parseDsl("layout L {\n  place @G()\n}").diagnostics.some((diagnostic) => diagnostic.message.includes("必須引数「at」"))).toBe(true);
  });

  it("rejects the removed legacy syntax and nested source outputs", () => {
    expect(parseDsl("printLayout A4(output: pdf)").diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(parseDsl("activePrintLayout A4").diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    const nested = parseDsl([
      "nui 4",
      "group G {",
      "  layout L {",
      "  }",
      "}",
    ].join("\n"));
    expect(nested.diagnostics.some((diagnostic) => diagnostic.message.includes("トップレベル"))).toBe(true);
  });
});
