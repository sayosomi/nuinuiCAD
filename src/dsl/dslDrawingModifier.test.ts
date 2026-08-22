import { describe, expect, it } from "vitest";
import type { LastGoodDslDocument } from "../document/canonicalDocument";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { compileDslDocument, serializeDocumentToDsl } from "./dslDocument";
import { parseDsl } from "./dslParser";

const sourceLines = (...lines: string[]) => lines.join("\n");
const errors = (source: string) => compileDslDocument(source).diagnostics.filter((item) => item.severity === "error");
const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

const asLastGoodDocument = (compiled: ReturnType<typeof compileDslDocument>): LastGoodDslDocument => {
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    throw new Error(`expected valid document: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled as LastGoodDslDocument;
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

  it("preserves resolved Drawing Profile identity through Module compilation and evaluation", () => {
    const compiled = asLastGoodDocument(compileWithIds(sourceLines(
      "nui 4",
      "profile Print",
      "modifier Guide {",
      "  width: 1px,",
      "  for @Print {",
      "    width: 0.5px,",
      "    style: dashed,",
      "    color: warning,",
      "  }",
      "}",
      "module M() {",
      "  point Internal [Guide] = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M()"
    )));
    const profileStatementIndex = compiled.statements.findIndex(
      (statement) => statement.kind === "profileDeclaration" && statement.name === "Print"
    );
    const profile = compiled.document.drawingProfiles?.find((candidate) => candidate.name === "Print");
    const modifier = (compiled.document.modifiers ?? []).find((candidate) => candidate.name === "Guide");
    const delta = modifier?.profileDeltas?.[0];
    const reconciledProfileId = compiled.statementMap.statementIdByStatementIndex?.get(profileStatementIndex);
    const internal = compiled.document.elements.find((element) => element.name === "Internal");

    expect(profile).toBeDefined();
    expect(reconciledProfileId).toBeDefined();
    expect(profile?.id).toBe(reconciledProfileId);
    expect(profile?.id).not.toBe("Print");
    expect(delta?.profileId).toBe(profile?.id);
    expect(delta?.profileName).toBe("Print");
    expect(internal).toBeDefined();

    const evaluation = evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex,
      selectedDrawingProfileId: profile!.id
    }));
    expect(evaluation.errors.filter((error) => error.elementId === internal?.id)).toEqual([]);
    expect(evaluation.computedGeometry.get(internal!.id)).toMatchObject({ kind: "point", x: 0, y: 0 });
    expect(evaluation.effectiveDrawingModifierStrokes?.get(internal!.id)).toEqual({
      widthPx: 0.5,
      style: "dashed",
      color: { kind: "themeRole", role: "warning" }
    });
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
      ["invalid color", ["color: red,"], "color は foreground"]
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

  it("compiles independent modifier properties and profile deltas", () => {
    const source = sourceLines(
      "nui 4",
      "profile 印刷用",
      "modifier Basic {",
      "  width: 1px,",
      "  style: solid,",
      "  color: foreground,",
      "}",
      "modifier Guide {",
      "  state: hidden,",
      "  for @印刷用 {",
      "    width: 0.5px,",
      "    color: info,",
      "  }",
      "}",
      "modifier Custom {",
      "  color: #FF3355,",
      "}"
    );
    const compiled = compileDslDocument(source);
    expect(errors(source)).toEqual([]);
    expect(compiled.document?.modifiers).toEqual([
      {
        name: "Basic",
        widthPx: 1,
        style: "solid",
        color: { kind: "themeRole", role: "foreground" }
      },
      {
        name: "Guide",
        state: "hidden",
        profileDeltas: [{
          profileId: expect.any(String),
          profileName: "印刷用",
          widthPx: 0.5,
          color: { kind: "themeRole", role: "info" }
        }]
      },
      {
        name: "Custom",
        color: { kind: "fixed", hex: "#ff3355" }
      }
    ]);
  });

  it("accepts every theme role and rejects malformed independent values", () => {
    const roles = ["foreground", "muted", "accent", "info", "warning", "error"];
    for (const [index, role] of roles.entries()) {
      const source = sourceLines("nui 4", `modifier M${index} {`, `  color: ${role},`, "}");
      expect(errors(source)).toEqual([]);
    }
    const invalidCases = [
      ["width: 0px,", "正の有限な10進数"],
      ["width: Infinitypx,", "正の有限な10進数"],
      ["width: 1em,", "正の有限な10進数"],
      ["style: zigzag,", "solid / dashed / dotted"],
      ["color: primary,", "foreground / muted / accent"],
      ["color: #fff,", "#RRGGBB"],
      ["color: #gg3355,", "#RRGGBB"]
    ] as const;
    for (const [property, message] of invalidCases) {
      const source = sourceLines("nui 4", "modifier Broken {", `  ${property}`, "}");
      expect(errors(source).some((item) => item.message.includes(message))).toBe(true);
    }
  });

  it("rejects duplicate independent properties, old stroke syntax, and empty modifiers", () => {
    const duplicate = errors(sourceLines(
      "nui 4",
      "modifier A {",
      "  width: 1px,",
      "  width: 2px,",
      "}"
    ));
    expect(duplicate.some((item) => item.message.includes("width プロパティは1つだけ"))).toBe(true);
    expect(errors(sourceLines("nui 4", "modifier Old {", "  stroke: 1px solid foreground,", "}")).some((item) => item.message.includes("未知のプロパティ"))).toBe(true);
    expect(errors(sourceLines("nui 4", "modifier Empty {", "}")).some((item) => item.message.includes("state / width / style / color"))).toBe(true);
  });

  it("resolves profile references by source order and reports profile collisions", () => {
    const forward = errors(sourceLines(
      "nui 4",
      "modifier Guide {",
      "  for @Print {",
      "    width: 0.5px,",
      "  }",
      "}",
      "profile Print"
    ));
    expect(forward.some((item) => item.message.includes("後で宣言"))).toBe(true);

    const undefinedProfile = errors(sourceLines(
      "nui 4",
      "profile Print",
      "modifier Guide {",
      "  for @SVG {",
      "    width: 0.5px,",
      "  }",
      "}"
    ));
    expect(undefinedProfile.some((item) => item.message.includes("未定義の Drawing Profile"))).toBe(true);

    const duplicateOverride = errors(sourceLines(
      "nui 4",
      "profile Print",
      "modifier Guide {",
      "  for @Print {",
      "    width: 0.5px,",
      "  }",
      "  for @Print {",
      "    style: dashed,",
      "  }",
      "}"
    ));
    expect(duplicateOverride.some((item) => item.message.includes("1つだけ指定"))).toBe(true);

    const collision = errors(sourceLines(
      "nui 4",
      "profile Print",
      "point Print = coordinate(x: 0, y: 0)"
    ));
    expect(collision.some((item) => item.message.includes("profile") && item.message.includes("衝突"))).toBe(true);
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

  it("round-trips canonical Drawing Profile declarations and modifier deltas", () => {
    const source = sourceLines(
      "nui 4",
      "profile Print",
      "modifier Guide {",
      "  width: 1px,",
      "  for @Print {",
      "    width: 0.5px,",
      "    style: dashed,",
      "    color: warning,",
      "  }",
      "}"
    );
    const first = compileDslDocument(source);
    expect(first.document).not.toBeNull();
    const canonical = serializeDocumentToDsl(first.document!, first.majorVersion!);
    expect(canonical).toContain("profile Print");
    expect(canonical).toContain("for @Print {");
    expect(canonical).toContain("width: 0.5px,");
    expect(canonical).toContain("style: dashed,");
    expect(canonical).toContain("color: warning,");

    const second = compileDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const secondProfile = second.document?.drawingProfiles?.find((profile) => profile.name === "Print");
    const secondDelta = second.document?.modifiers?.find((modifier) => modifier.name === "Guide")?.profileDeltas?.[0];
    expect(secondProfile).toBeDefined();
    expect(secondDelta).toMatchObject({
      profileName: "Print",
      widthPx: 0.5,
      style: "dashed",
      color: { kind: "themeRole", role: "warning" }
    });
    expect(secondDelta?.profileId).toBe(secondProfile?.id);
  });

  it("serializes modifier properties in canonical order and lowercases fixed colors", () => {
    const compiled = compileDslDocument(sourceLines(
      "nui 4",
      "modifier Combined {",
      "  color: #FF3355,",
      "  state: hidden,",
      "}"
    ));
    const canonical = serializeDocumentToDsl(compiled.document!, compiled.majorVersion!);
    expect(canonical).toContain("modifier Combined {\n  state: hidden,\n  color: #ff3355,\n}");
    expect(compileDslDocument(canonical).diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("serializes a property-only modifier in canonical source form", () => {
    const compiled = compileDslDocument(sourceLines(
      "nui 4",
      "modifier Guide {",
      "  width: 1px,",
      "}"
    ));
    expect(serializeDocumentToDsl(compiled.document!, compiled.majorVersion!)).toContain(
      "modifier Guide {\n  width: 1px,\n}"
    );
  });

  it("keeps property-only modifiers visible while preserving their style metadata", () => {
    const compiled = compileDslDocument(sourceLines(
      "nui 4",
      "modifier StrokeOnly {",
      "  style: dashed,",
      "}",
      "point A [StrokeOnly] = coordinate(x: 0, y: 0)"
    ));
    expect(compiled.document?.elements[0]?.activity).toBe("visible");
    expect(compiled.document?.modifiers).toEqual([
      {
        name: "StrokeOnly",
        style: "dashed"
      }
    ]);
  });

  it("keeps direct state while rejecting the removed element color argument", () => {
    const stateOnly = compileDslDocument(
      "nui 4\npoint P = coordinate(x: 0, y: 0, state: hidden)"
    );
    expect(stateOnly.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(stateOnly.document?.elements[0]).toMatchObject({ activity: "hidden" });

    const withColor = compileDslDocument(
      "nui 4\npoint P = coordinate(x: 0, y: 0, color: pattern-black)"
    );
    expect(withColor.diagnostics.filter((item) => item.severity === "error")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("引数「color」") })
    ]);

    const containerColor = compileDslDocument(
      "nui 4\ngroup G (color: pattern-black) {\n}"
    );
    expect(containerColor.diagnostics.filter((item) => item.severity === "error")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("引数「color」") })
    ]);
  });

});
