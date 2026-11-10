import { describe, expect, it } from "vitest";
import { compileDslDocument, planSourceOutputSection, serializeDocumentToDsl } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";

const validSource = [
  "nui 1",
  "layer 完成",
  "layer 标记",
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
  "print 家庭用A4(layout: @型紙, layers: [@完成, @标记], paper: a4, orientation: portrait, overlap: 10)",
  "svg 型紙SVG(layout: @型紙, layers: [@完成])",
].join("\n");

const errors = (source: string) => compileDslDocument(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const compileWithStatementIds = (source: string) => {
  const statements = parseDsl(source).statements;
  return compileDslDocument(source, {
    assignedStatementIds: new Map(statements.map((_, index) => [index, `test:${index}`]))
  });
};

describe("SAY-63 output layers DSL v1", () => {
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
    expect(compiled.document?.printOutputs[0].layers.map(({ name, reference }) => ({ name, reference }))).toEqual([
      { name: "完成", reference: "完成" },
      { name: "标记", reference: "标记" }
    ]);
  });

  it("accepts omitted layout parentheses and empty layouts", () => {
    const compiled = compileDslDocument([
      "nui 1",
      "layout 空レイアウト {",
      "}",
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts).toHaveLength(1);
    expect(compiled.document?.layouts[0]).toMatchObject({ name: "空レイアウト", scale: 1, placements: [] });
  });

  it("accepts the canonical pi constant in layout, placement, print, and SVG numeric fields", () => {
    const source = [
      "nui 1",
      "group G {",
      "}",
      "layout L(scale: pi) {",
      "  place @G(at: (0, 0), scale: pi, angle: pi)",
      "}",
      "print P(layout: @L, layers: [@default], paper: a4, overlap: pi)",
      "svg S(layout: @L, layers: [@default], margin: pi)"
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
      "nui 1",
      "layout L {",
      "}",
      "print P(layout: @L, layers: [@default], paper: a4, margin: 10, overlap: 10)"
    ].join("\n"));
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("引数「margin」"))).toBe(true);
  });

  it("preserves the canonical source model through serialization", () => {
    const compiled = compileDslDocument(validSource);
    expect(compiled.document).not.toBeNull();
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("layout 型紙 {");
    expect(serialized).toContain("print 家庭用A4(");
    expect(serialized).toContain("svg 型紙SVG(");
    const reparsed = compileDslDocument(serialized);
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reparsed.document?.layouts).toHaveLength(2);
    expect(reparsed.document?.layouts[0].placements).toHaveLength(2);
    expect(reparsed.document?.printOutputs).toHaveLength(1);
    expect(reparsed.document?.svgOutputs).toHaveLength(1);
    expect(reparsed.document?.printOutputs[0]?.layers.map((layer) => layer.reference)).toEqual(["完成", "标记"]);
    expect(reparsed.document?.svgOutputs[0]?.layers.map((layer) => layer.reference)).toEqual(["完成"]);
    expect(planSourceOutputSection(compiled.document!).blocks[0].lines[0]).toBe("layout 型紙 {");
  });

  it("serializes a default layout without an empty settings block", () => {
    const source = [
      "nui 1",
      "layout 型紙 {",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source);
    expect(errors(source)).toEqual([]);
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("layout 型紙 {");
    expect(serialized).not.toContain("layout 型紙(");
    expect(serialized).not.toContain("scale: 1");
    expect(compileDslDocument(serialized).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("uses non-hoisted lexical references and rejects wrong kinds and cross-group origins", () => {
    const forward = compileDslDocument([
      "nui 1",
      "print 出力(layout: @後出し, layers: [@default], paper: a4, overlap: 0)",
      "layout 後出し {",
      "}",
    ].join("\n"));
    expect(errors(forward.sourceLines.join("\n")).some((diagnostic) => diagnostic.message.includes("後で宣言"))).toBe(false);

    const invalid = compileDslDocument([
      "nui 1",
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
      "nui 1",
      "group G {",
      "}",
      "layout L(scale: 0) {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, layers: [@default], paper: a4, overlap: 200)",
      "svg S(layout: @L, layers: [@default], margin: -1)",
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
      "nui 1",
      "const finite: number = 2",
      "group G {",
      "}",
      line.startsWith("layout") ? line : "layout L {",
      line.startsWith("layout") ? "}" : line,
      line.startsWith("layout") ? "" : "}",
      "print P(layout: @L, layers: [@default], paper: a4, overlap: @finite)",
      "svg S(layout: @L, layers: [@default], margin: @finite)"
    ].filter((item) => item !== "").join("\n");
    const diagnostics = errors(source);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("有限"))).toBe(true);

    const expressionSource = [
      "nui 1",
      "const finite: number = 2",
      "group G {",
      "}",
      "layout L(scale: @finite) {",
      "  place @G(at: (0, 0), scale: @finite, angle: @finite)",
      "}",
      "print P(layout: @L, layers: [@default], paper: a4, overlap: @finite)",
      "svg S(layout: @L, layers: [@default], margin: @finite)"
    ].join("\n");
    const expressionCompiled = compileDslDocument(expressionSource, {
      assignedStatementIds: new Map(parseDsl(expressionSource).statements.map((_, index) => [index, `test:${index}`]))
    });
    expect(expressionCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("rejects Drawing Profile syntax and nested source outputs", () => {
    expect(parseDsl("printLayout A4(output: pdf)").diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(parseDsl("activePrintLayout A4").diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(parseDsl("profile Print").diagnostics.some((diagnostic) => diagnostic.code === "unknown-dsl-keyword")).toBe(true);
    expect(parseDsl("style Seam {\n  for @Print {\n    visible: false,\n  }\n}")
      .diagnostics.some((diagnostic) => diagnostic.code === "drawing-profile-syntax-removed")).toBe(true);
    const legacyOutput = compileDslDocument([
      "nui 1", "layout L {", "}", "print P(layout: @L, profile: @Print, paper: a4, overlap: 0)"
    ].join("\n"));
    expect(legacyOutput.diagnostics.some((diagnostic) => diagnostic.code === "settings-unknown-argument" && diagnostic.message.includes("profile"))).toBe(true);
    const nested = parseDsl([
      "nui 1",
      "group G {",
      "  layout L {",
      "  }",
      "}",
    ].join("\n"));
    expect(nested.diagnostics.some((diagnostic) => diagnostic.message.includes("トップレベル"))).toBe(true);
    for (const field of ["printEnabled", "printAnchor"]) {
      const legacyGroup = parseDsl(["nui 1", `group G (${field}: true) {`, "}"].join("\n"));
      expect(legacyGroup.diagnostics.some((diagnostic) => diagnostic.message.includes(field))).toBe(true);
    }
  });

  it.each([
    ["missing", "", "settings-missing-named-argument"],
    ["empty", "layers: []", "output-layers-empty"],
    ["empty entry", "layers: [, @default]", "output-layers-entry-empty"],
    ["malformed entry", "layers: [finished]", "output-layers-entry-malformed"],
    ["unresolved entry", "layers: [@missing]", "output-layer-reference-undefined"],
    ["wrong-kind entry", "layers: [@L]", "output-layer-reference-not-layer"]
  ] as const)("rejects %s layer selection for both output kinds", (_label, selector, code) => {
    const selectorSuffix = selector ? `, ${selector}` : "";
    const compiled = compileDslDocument([
      "nui 1",
      "group G {",
      "}",
      "layout L {",
      "}",
      `print P(layout: @L${selectorSuffix}, paper: a4, overlap: 0)`,
      `svg S(layout: @L${selectorSuffix}, margin: 0)`
    ].join("\n"));
    const diagnostics = compiled.diagnostics.filter((diagnostic) => diagnostic.code === code);
    expect(diagnostics).toHaveLength(2);
  });

  it("retains source spans and declaration identity for output layer references", () => {
    const source = [
      "nui 1",
      "layer finished",
      "group G {",
      "}",
      "layout L {",
      "}",
      "print P(layout: @L, layers: [@finished, @default], paper: a4, overlap: 0)",
      "svg S(layout: @L, layers: [@finished], margin: 0)"
    ].join("\n");
    const compiled = compileWithStatementIds(source);
    const selected = compiled.document!.printOutputs[0].layers;
    const finished = compiled.document!.sourceLayerDeclarations!.find((layer) => layer.name === "finished")!;

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(selected[0]).toMatchObject({ identity: finished.identity, name: "finished", reference: "finished" });
    expect(source.slice(selected[0].sourceSpan.start, selected[0].sourceSpan.end)).toBe("@finished");
    expect(selected[1]).toMatchObject({ identity: "source-layer:builtin:default", name: "default", scopeId: "builtin" });
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("layers: [@finished, @default]");
    const reopened = compileDslDocument(serialized);
    expect(reopened.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reopened.document?.printOutputs[0].layers.map(({ name }) => name)).toEqual(["finished", "default"]);
  });

  it("resolves qualified nested placement targets and origins for both output kinds", () => {
    const compiled = compileWithStatementIds([
      "nui 1",
      "group Outer {",
      "  group Inner {",
      "    point Origin = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "layout L {",
      "  place @Outer::Inner(origin: @Outer::Inner::Origin, at: (1, 2))",
      "}",
      "print Paper(layout: @L, layers: [@default], paper: a4, overlap: 0)",
      "svg Vector(layout: @L, layers: [@default], margin: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.layouts[0].placements[0].origin).toMatchObject({ kind: "point" });
    expect(compiled.document?.printOutputs[0].layoutId).toBe(compiled.document?.layouts[0].id);
    expect(compiled.document?.svgOutputs[0].layoutId).toBe(compiled.document?.layouts[0].id);
  });

  it("reports undefined, forward, and wrong-kind layout references", () => {
    const undefinedReferences = compileWithStatementIds([
      "nui 1",
      "group G {",
      "  point Origin = coordinate(x: 0, y: 0)",
      "}",
      "layout L {",
      "  place @missingGroup(origin: @missingOrigin, at: (0, 0))",
      "}",
      "print Paper(layout: @missingLayout, layers: [@default], paper: a4, overlap: 0)",
      "svg Vector(layout: @missingLayout, layers: [@default], margin: 0)"
    ].join("\n"));
    expect(undefinedReferences.diagnostics.filter((diagnostic) => diagnostic.message.includes("未定義の参照"))).not.toHaveLength(0);

    const forward = compileWithStatementIds([
      "nui 1",
      "print Paper(layout: @Later, layers: [@default], paper: a4, overlap: 0)",
      "layout Later {",
      "}"
    ].join("\n"));
    expect(forward.diagnostics.some((diagnostic) => diagnostic.message.includes("後で宣言"))).toBe(false);

    const wrongKind = compileWithStatementIds([
      "nui 1",
      "group G {",
      "}",
      "group H {",
      "}",
      "layout L {",
      "  place @G(origin: @H, at: (0, 0))",
      "}",
      "print Paper(layout: @G, layers: [@L], paper: a4, overlap: 0)"
    ].join("\n"));
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.message.includes("layout ではありません"))).toBe(true);
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.code === "output-layer-reference-not-layer")).toBe(true);
    expect(wrongKind.diagnostics.some((diagnostic) => diagnostic.message.includes("点ではありません"))).toBe(true);
  });

  it("accepts typed numeric references in layout, place, print, and SVG fields", () => {
    const compiled = compileWithStatementIds([
      "nui 1",
      "const n: number = 2",
      "group G {",
      "}",
      "layout L(scale: @n) {",
      "  place @G(at: (0, 0), scale: @n, angle: @n)",
      "}",
      "print Paper(layout: @L, layers: [@default], paper: a4, overlap: @n)",
      "svg Vector(layout: @L, layers: [@default], margin: @n)"
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
      "nui 1",
      ...(reference === "@later" ? [] : declarations),
      "group G {",
      "}",
      ...layoutBeforeDeclaration,
      `print Paper(layout: @L, layers: [@default], paper: a4, overlap: ${reference})`,
      `svg Vector(layout: @L, layers: [@default], margin: ${reference})`,
      ...(reference === "@later" ? declarations : [])
    ];
    const compiled = compileWithStatementIds(lines.join("\n"));
    const matchingDiagnostics = compiled.diagnostics.filter((diagnostic) => diagnostic.code === code);
    if (reference === "@later") {
      expect(matchingDiagnostics).toEqual([]);
    } else {
      expect(matchingDiagnostics.length).toBeGreaterThan(0);
    }
  });

  it("keeps default and inherited placement values in the source model while preserving explicit overrides and identities", () => {
    const source = [
      "nui 1",
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
