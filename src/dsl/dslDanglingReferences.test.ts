import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { CadElement } from "../types/geometry";
import { buildSourceLexicalNamespaceIndex, compileDslDocument, parseDsl, serializeDocumentToDsl } from "@nuinuicad/nui-language";
import { createNameIndex, resolveId } from "@nuinuicad/nui-language";

const compileRecoverable = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return compiled;
};

const warningMessages = (source: string) =>
  compileRecoverable(source).diagnostics
    .filter((item) => item.severity === "warning")
    .map((item) => item.message);

const resolveLexicalReference = (source: string, token: string) => {
  const parsed = parseDsl(source);
  const stableIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`] as const));
  const sourceNamespace = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);
  const statementIndex = parsed.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Use");
  if (statementIndex < 0) throw new Error("missing Use source statement");
  const currentElement: CadElement = {
    id: "runtime-use",
    name: "Use",
    type: "offsetPoint",
    activity: "visible",
    fromPoint: { mode: "coordinate", x: 0, y: 0 },
    dx: 1,
    dy: 0
  };
  const index = createNameIndex([currentElement], {
    sourceNamespace,
    elementIdByStatementIndex: new Map([[statementIndex, currentElement.id]])
  });
  const diagnostics: Parameters<typeof resolveId>[3] = [];
  const result = resolveId(token, index, 7, diagnostics, currentElement, { start: 0, end: token.length });
  return { result, diagnostics };
};

const sourceWithAllDanglingKinds = [
  "nui 1",
  "view Draft (default: true, ghost: false)",
  'activeView "Missing View"',
  "point A = coordinate(x: 0, y: 0)",
  "point AnchorUser = offset(from: @MissingPoint, dx: 1, dy: 2)",
  'point DotAnchorUser = offset(from: @"Missing.Point", dx: 1, dy: 2)',
  'line DerivedAnchorUser = segment(start: @"Outer group"::"Missing shape#1".pivot, end: @A)',
  'point NormalRefUser = intersection(line1: @MissingLine, line2: @"Missing line 2", index: 0, extensions: false)',
  'line ListRefUser = transformCopy(startPoint: @A, endPoint: @A, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@MissingLine, @"Missing line 2", @"Outer group"::"Missing#line"])',
  'point ParentUser = coordinate(x: 1, y: 1, parent: @"Outer group"::"Missing parent#1")',
].join("\n");

describe("dangling reference diagnostics and retention", () => {
  it("keeps every supported dangling reference kind in a compilable document", () => {
    const compiled = compileRecoverable(sourceWithAllDanglingKinds);
    const document = compiled.document!;
    const byName = new Map(document.elements.map((element) => [element.name, element]));
    expect(compiled.diagnostics.every((item) => item.severity === "warning")).toBe(true);
    expect(compiled.diagnostics.every((item) => item.line > 0 && item.message.length > 0)).toBe(true);
    expect((byName.get("AnchorUser") as Extract<CadElement, { type: "offsetPoint" }>).fromPoint)
      .toEqual({ mode: "reference", pointId: "@MissingPoint" });
    expect((byName.get("DotAnchorUser") as Extract<CadElement, { type: "offsetPoint" }>).fromPoint)
      .toEqual({ mode: "reference", pointId: '@"Missing.Point"' });
    expect((byName.get("DerivedAnchorUser") as Extract<CadElement, { type: "line" }>).startPoint)
      .toEqual({ mode: "derived", elementId: '@"Outer group"::"Missing shape#1"', pointKey: "pivot", stagePath: ["final"] });
    expect((byName.get("NormalRefUser") as Extract<CadElement, { type: "intersectionPoint" }>).line1Id)
      .toBe("@MissingLine");
    expect((byName.get("ListRefUser") as Extract<CadElement, { type: "copyLine" }>).baseLineIds)
      .toEqual(["@MissingLine", '@"Missing line 2"', '@"Outer group"::"Missing#line"']);
    expect(byName.get("ParentUser")?.parentGroupId).toBe('@"Outer group"::"Missing parent#1"');
    expect(document.visibilityProfiles.find((profile) => profile.name === "Draft")?.roleVisibility)
      .toMatchObject({ ghost: false });
    expect(document.activeVisibilityProfileId).toBe("Missing View");
  });

  it("preserves all dangling semantics across compile -> serialize -> recompile", () => {
    const first = compileRecoverable(sourceWithAllDanglingKinds);
    const serialized = serializeDocumentToDsl(first.document!, 1);
    const second = compileRecoverable(serialized);

    expect(serialized).toContain('@"Outer group"::"Missing shape#1".pivot');
    expect(serialized).toContain('from: @"Missing.Point"');
    expect(serialized).toContain('baseLines: [@MissingLine, @"Missing line 2", @"Outer group"::"Missing#line"]');
    expect(serialized).not.toContain('"Outer group::Missing');
    expect(serializeDocumentToDsl(second.document!, 1)).toBe(serialized);
    expect(second.document!.activeVisibilityProfileId).toBe("Missing View");
  });

  it("reports ambiguous resolveId references as recoverable warnings", () => {
    const duplicate = (id: string): CadElement => ({
      id,
      name: "Same",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    });
    const diagnostics: Parameters<typeof resolveId>[3] = [];
    expect(resolveId("@Same", createNameIndex([duplicate("a"), duplicate("b")]), 7, diagnostics))
      .toBe("@Same");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        line: 7,
        code: "source-reference-ambiguous",
        presentation: { key: "diagnostic.source-reference-ambiguous", parameters: { reference: "@Same" } },
        message: "参照名が曖昧です: @Same"
      })
    ]);
  });

  it.each([
    {
      kind: "ambiguous",
      source: [
        "nui 1",
        "group A {",
        "}",
        "group A {",
        "}",
        "point Use = coordinate(x: 0, y: 0)"
      ].join("\n"),
      token: "@A",
      code: "source-reference-ambiguous",
      message: "参照名が曖昧です: @A",
      parameters: { reference: "@A" }
    },
    {
      kind: "invalid traversal",
      source: [
        "nui 1",
        "const Scalar: number = 1",
        "point Use = coordinate(x: 0, y: 0)"
      ].join("\n"),
      token: "@Scalar::member",
      code: "source-reference-invalid-traversal",
      message: "参照先「Scalar」はnamespace/containerではありません: @Scalar::member",
      parameters: { reference: "@Scalar::member", declaration: "Scalar" }
    },
    {
      kind: "undefined",
      source: [
        "nui 1",
        "point Use = coordinate(x: 0, y: 0)"
      ].join("\n"),
      token: "@Missing::Child",
      code: "source-reference-undefined",
      message: "参照先が見つかりません: @Missing::Child",
      parameters: { reference: "@Missing::Child" }
    }
  ] as const)("maps source lexical $kind outcomes onto structured warnings", ({ source, token, code, message, parameters }) => {
    const { result, diagnostics } = resolveLexicalReference(source, token);

    expect(result).toBe(token);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        line: 7,
        code,
        presentation: { key: `diagnostic.${code}`, parameters },
        message
      })
    ]);
  });

  it("keeps the geometry-only undefined warning when source lexical resolution is unavailable", () => {
    const diagnostics: Parameters<typeof resolveId>[3] = [];

    expect(resolveId("@Missing", createNameIndex([]), 4, diagnostics)).toBe("@Missing");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "undefined-geometry-reference",
        presentation: { key: "diagnostic.undefined-geometry-reference", parameters: { reference: "@Missing" } },
        message: "参照先が見つかりません: @Missing"
      })
    ]);
  });

  it("classifies canonical dotted geometry properties in ID-only roles", () => {
    const line: CadElement = {
      id: "line-a",
      name: "A",
      type: "line",
      activity: "visible",
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };
    const diagnostics: Parameters<typeof resolveId>[3] = [];
    expect(resolveId("@A.startPoint.x", createNameIndex([line]), 3, diagnostics)).toBe("@A.startPoint.x");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-source-reference",
        message: expect.stringContaining("property")
      })
    ]);
  });
});

describe("dangling automatic recovery and evaluation", () => {
  const dangling = [
    "nui 1",
    "point UsesMissing = offset(from: @Missing, dx: 1, dy: 0)",
    "point Downstream = offset(from: @UsesMissing, dx: 1, dy: 0)"
  ].join("\n");

  it("recovers after adding the target and clears direct and downstream dependency errors", () => {
    const before = compileRecoverable(dangling);
    const beforeEvaluation = evaluateElements(before.document!.elements);
    const usesMissingId = before.document!.elements.find((element) => element.name === "UsesMissing")!.id;
    expect(beforeEvaluation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ missingDependencyId: "@Missing" }),
      expect.objectContaining({ missingDependencyId: usesMissingId })
    ]));

    const repaired = dangling.replace("nui 1", "nui 1\npoint Missing = coordinate(x: 0, y: 0)");
    const after = compileRecoverable(repaired);
    const targetId = after.document!.elements.find((element) => element.name === "Missing")!.id;
    const usesMissing = after.document!.elements.find((element) => element.name === "UsesMissing") as Extract<CadElement, { type: "offsetPoint" }>;
    expect(usesMissing.fromPoint).toEqual({ mode: "reference", pointId: targetId });
    expect(after.diagnostics.filter((item) => item.message.includes("参照先"))).toEqual([]);
    expect(evaluateElements(after.document!.elements).errors).toEqual([]);
  });

  it("recovers after renaming an existing target", () => {
    const before = compileRecoverable(`nui 1\npoint Old = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`);
    expect(warningMessages(`nui 1\npoint Old = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`))
      .toEqual(expect.arrayContaining([expect.stringContaining("Missing")]));
    expect(evaluateElements(before.document!.elements).errors).not.toEqual([]);

    const after = compileRecoverable(`nui 1\npoint Missing = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`);
    expect(after.diagnostics).toEqual([]);
    expect(evaluateElements(after.document!.elements).errors).toEqual([]);
  });

  it("resolves a qualified target with quoted special segments after it is added", () => {
    const before = compileRecoverable(
      'nui 1\npoint User = offset(from: @"Outer group"::"Target#point", dx: 1, dy: 0)'
    );
    expect(before.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining('"Outer group"::"Target#point"') })
    ]));

    const after = compileRecoverable([
      "nui 1",
      'group "Outer group" {',
      '  point "Target#point" = coordinate(x: 0, y: 0)',
      "}",
      'point User = offset(from: @"Outer group"::"Target#point", dx: 1, dy: 0)'
    ].join("\n"));
    const target = after.document!.elements.find((element) => element.name === "Target#point")!;
    const user = after.document!.elements.find((element) => element.name === "User") as Extract<CadElement, { type: "offsetPoint" }>;
    expect(user.fromPoint).toEqual({ mode: "reference", pointId: target.id });
    expect(after.diagnostics.filter((item) => item.message.includes("参照先"))).toEqual([]);
    expect(evaluateElements(after.document!.elements).errors).toEqual([]);
  });
});

describe("fatal diagnostic boundary", () => {
  it.each([
    ["mode", "nui 1\nvar V = 0 mode=invalid"],
    ["boolean", "nui 1\npoint A = (0, 0) visible=invalid"],
  ])("keeps invalid non-reference %s values fatal", (_name, source) => {
    const compiled = compileDslDocument(source);
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });
});
