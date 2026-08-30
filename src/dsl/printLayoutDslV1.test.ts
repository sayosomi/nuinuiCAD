import { describe, expect, it } from "vitest";
import { compileDslDocument, planSourceOutputSection, serializeDocumentToDsl } from "./dslDocument";
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
  "layout 型紙 {",
  "  place @前身頃(origin: @前身頃::基準点, at: (0, 0), scale: 2, angle: 360, mirror: true)",
  "  place @後身頃(at: (10, 20))",
  "}",
  "layout 空レイアウト {",
  "}",
  "print 家庭用A4(layout: @型紙, profile: @印刷用, paper: a4, orientation: portrait, overlap: 10)",
  "svg 型紙SVG(layout: @型紙, profile: @SVG用)",
].join("\n");

const errors = (source: string) => compileDslDocument(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const compileWithStatementIds = (source: string) => {
  const statements = parseDsl(source).statements;
  return compileDslDocument(source, {
    assignedStatementIds: new Map(statements.map((_, index) => [index, `test:${index}`]))
  });
};

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
      overlap: 10,
    });
    expect(compiled.document?.printOutputs[0]).not.toHaveProperty("margin");
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

  it("accepts the canonical pi constant in layout, placement, print, and SVG numeric fields", () => {
    const source = [
      "nui 4",
      "group G {",
      "}",
      "layout L(scale: pi) {",
      "  place @G(at: (0, 0), scale: pi, angle: pi)",
      "}",
      "print P(layout: @L, paper: a4, overlap: pi)",
      "svg S(layout: @L, margin: pi)"
    ].join("\n");
    const compiled = compileWithStatementIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts[0]).toMatchObject({ scale: { kind: "expression", expression: "pi" } });
    expect(compiled.document?.layouts[0].placements[0]).toMatchObject({
      scale: { kind: "expression", expression: "pi" },
      angleDeg: { kind: "expression", expression: "pi" }
    });
    expect(compiled.document?.printOutputs[0].overlap).toMatchObject({ kind: "expression", expression: "pi" });
    expect(compiled.document?.svgOutputs[0].margin).toMatchObject({ kind: "expression", expression: "pi" });
  });

  it("rejects the removed print margin attribute through normal DSL validation", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "layout L {",
      "}",
      "print P(layout: @L, paper: a4, margin: 10, overlap: 10)"
    ].join("\n"));
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("引数「margin」"))).toBe(true);
  });

  it("preserves the canonical source model through serialization", () => {
    const compiled = compileDslDocument(validSource);
    expect(compiled.document).not.toBeNull();
    const serialized = serializeDocumentToDsl(compiled.document!, 4);
    expect(serialized).toContain("layout 型紙 {");
    expect(serialized).toContain("print 家庭用A4(");
    expect(serialized).toContain("svg 型紙SVG(");
    const reparsed = compileDslDocument(serialized);
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reparsed.document?.layouts).toHaveLength(2);
    expect(reparsed.document?.layouts[0].placements).toHaveLength(2);
    expect(reparsed.document?.printOutputs).toHaveLength(1);
    expect(reparsed.document?.svgOutputs).toHaveLength(1);
    expect(planSourceOutputSection(compiled.document!).blocks[0].lines[0]).toBe("layout 型紙 {");
  });

  it("serializes a default layout without an empty settings block", () => {
    const source = [
      "nui 4",
      "layout 型紙 {",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source);
    expect(errors(source)).toEqual([]);
    const serialized = serializeDocumentToDsl(compiled.document!, 4);
    expect(serialized).toContain("layout 型紙 {");
    expect(serialized).not.toContain("layout 型紙(");
    expect(serialized).not.toContain("scale: 1");
    expect(compileDslDocument(serialized).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
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
      "print P(layout: @L, paper: a4, overlap: 200)",
      "svg S(layout: @L, margin: -1)",
    ].join("\n");
    const compiled = compileDslDocument(source);
    const diagnostics = errors(source);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("正の値"))).toBe(true);
    const overlapDiagnostic = diagnostics.find((diagnostic) => diagnostic.message.includes("overlap が大きすぎます"));
    expect(overlapDiagnostic?.message).toContain("A4 portrait では overlap を 105mm 未満にしてください。");
    const overlapFrom = source.indexOf("200");
    expect(overlapDiagnostic?.physicalSpan).toEqual({
      segments: [{ from: overlapFrom, to: overlapFrom + "200".length }],
      sourceRevision: compiled.spans.sourceMap.sourceRevision
    });
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("svg margin"))).toBe(true);
    expect(parseDsl("layout L {\n  place @G()\n}").diagnostics.some((diagnostic) => diagnostic.message.includes("必須引数「at」"))).toBe(true);
  });

  it.each([
    ["layout scale", "layout L(scale: 1e999) {"],
    ["place scale", "  place @G(at: (0, 0), scale: 1e999)"],
    ["place angle", "  place @G(at: (0, 0), angle: 1e999)"],
  ])("rejects non-finite literal %s while keeping expressions compile-time-valid", (_label, line) => {
    const source = [
      "nui 4",
      "const finite: number = 2",
      "group G {",
      "}",
      line.startsWith("layout") ? line : "layout L {",
      line.startsWith("layout") ? "}" : line,
      line.startsWith("layout") ? "" : "}",
      "print P(layout: @L, paper: a4, overlap: @finite)",
      "svg S(layout: @L, margin: @finite)"
    ].filter((item) => item !== "").join("\n");
    const diagnostics = errors(source);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("有限"))).toBe(true);

    const expressionSource = [
      "nui 4",
      "const finite: number = 2",
      "group G {",
      "}",
      "layout L(scale: @finite) {",
      "  place @G(at: (0, 0), scale: @finite, angle: @finite)",
      "}",
      "print P(layout: @L, paper: a4, overlap: @finite)",
      "svg S(layout: @L, margin: @finite)"
    ].join("\n");
    const expressionCompiled = compileDslDocument(expressionSource, {
      assignedStatementIds: new Map(parseDsl(expressionSource).statements.map((_, index) => [index, `test:${index}`]))
    });
    expect(expressionCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
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
    for (const field of ["printEnabled", "printAnchor"]) {
      const legacyGroup = parseDsl(["nui 4", `group G (${field}: true) {`, "}"].join("\n"));
      expect(legacyGroup.diagnostics.some((diagnostic) => diagnostic.message.includes(field))).toBe(true);
    }
  });

  it("resolves qualified nested placement targets and origins for both output kinds", () => {
    const compiled = compileWithStatementIds([
      "nui 4",
      "profile P",
      "group Outer {",
      "  group Inner {",
      "    point Origin = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "layout L {",
      "  place @Outer::Inner(origin: @Outer::Inner::Origin, at: (1, 2))",
      "}",
      "print Paper(layout: @L, profile: @P, paper: a4, overlap: 0)",
      "svg Vector(layout: @L, profile: @P, margin: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts[0].placements[0].origin).toMatchObject({ kind: "point" });
    expect(compiled.document?.printOutputs[0].layoutId).toBe(compiled.document?.layouts[0].id);
    expect(compiled.document?.svgOutputs[0].layoutId).toBe(compiled.document?.layouts[0].id);
    expect(compiled.document?.printOutputs[0].profileId).toBe(compiled.document?.drawingProfiles?.[0].id);
    expect(compiled.document?.svgOutputs[0].profileId).toBe(compiled.document?.drawingProfiles?.[0].id);
  });

  it("reports undefined, forward, and wrong-kind layout references", () => {
    const undefinedReferences = compileWithStatementIds([
      "nui 4",
      "profile P",
      "group G {",
      "  point Origin = coordinate(x: 0, y: 0)",
      "}",
      "layout L {",
      "  place @missingGroup(origin: @missingOrigin, at: (0, 0))",
      "}",
      "print Paper(layout: @missingLayout, profile: @missingProfile, paper: a4, overlap: 0)",
      "svg Vector(layout: @missingLayout, profile: @missingProfile, margin: 0)"
    ].join("\n"));
    expect(undefinedReferences.diagnostics.filter((diagnostic) => diagnostic.message.includes("未定義の参照"))).not.toHaveLength(0);

    const forward = compileWithStatementIds([
      "nui 4",
      "print Paper(layout: @Later, paper: a4, overlap: 0)",
      "layout Later {",
      "}"
    ].join("\n"));
    expect(forward.diagnostics.some((diagnostic) => diagnostic.message.includes("後で宣言"))).toBe(true);

    const wrongKind = compileWithStatementIds([
      "nui 4",
      "profile P",
      "group G {",
      "}",
      "group H {",
      "}",
      "layout L {",
      "  place @G(origin: @H, at: (0, 0))",
      "}",
      "print Paper(layout: @G, profile: @L, paper: a4, overlap: 0)"
    ].join("\n"));
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.message.includes("layout ではありません"))).toBe(true);
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.message.includes("profile ではありません"))).toBe(true);
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.message.includes("点ではありません"))).toBe(true);
  });

  it("accepts typed numeric references in layout, place, print, and SVG fields", () => {
    const compiled = compileWithStatementIds([
      "nui 4",
      "profile P",
      "const n: number = 2",
      "group G {",
      "}",
      "layout L(scale: @n) {",
      "  place @G(at: (0, 0), scale: @n, angle: @n)",
      "}",
      "print Paper(layout: @L, profile: @P, paper: a4, overlap: @n)",
      "svg Vector(layout: @L, profile: @P, margin: @n)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts[0].scale).toMatchObject({ kind: "expression" });
    expect(compiled.document?.layouts[0].placements[0].scale).toMatchObject({ kind: "expression" });
    expect(compiled.document?.svgOutputs[0].margin).toMatchObject({ kind: "expression" });
  });

  it.each([
    ["undefined", "@missing", "numeric-binding-unresolved"],
    ["forward", "@later", "numeric-binding-unresolved"],
    ["wrong type", "@text", "numeric-binding-type-mismatch"]
  ] as const)("rejects %s typed numeric references", (_label, reference, code) => {
    const declarations = reference === "@later"
      ? ["const later: number = 2"]
      : reference === "@text"
        ? ["const text: string = \"not a number\""]
        : [];
    const layoutBeforeDeclaration = reference === "@later" ? [
      `layout L(scale: ${reference}) {`,
      `  place @G(at: (0, 0), scale: ${reference}, angle: ${reference})`,
      "}"
    ] : [
      `layout L(scale: ${reference}) {`,
      `  place @G(at: (0, 0), scale: ${reference}, angle: ${reference})`,
      "}"
    ];
    const lines = [
      "nui 4",
      "profile P",
      ...(reference === "@later" ? [] : declarations),
      "group G {",
      "}",
      ...layoutBeforeDeclaration,
      `print Paper(layout: @L, profile: @P, paper: a4, overlap: ${reference})`,
      `svg Vector(layout: @L, profile: @P, margin: ${reference})`,
      ...(reference === "@later" ? declarations : [])
    ];
    const compiled = compileWithStatementIds(lines.join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === code).length).toBeGreaterThan(0);
  });

  it("keeps default and inherited placement values in the source model while preserving explicit overrides and identities", () => {
    const source = [
      "nui 4",
      "group G {",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "  place @G(at: (10, 0), scale: 2)",
      "}"
    ].join("\n");
    const parsed = parseDsl(source);
    const compiled = compileWithStatementIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const layout = compiled.document!.layouts[0];
    const placeIndexes = parsed.statements.flatMap((statement, index) => statement.kind === "place" ? [index] : []);
    expect(layout.scale).toBe(1);
    expect(layout.placements.map((placement) => placement.scale)).toEqual([undefined, 2]);
    expect(layout.placements.map((placement) => placement.id)).toEqual(placeIndexes.map((index) => `test:${index}`));
    expect(layout.placements.map((placement) => placement.at.x)).toEqual([0, 10]);
  });
});
