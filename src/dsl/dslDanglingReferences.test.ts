import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { CadElement } from "../types/geometry";
import { compileDslDocument, serializeDocumentToDsl } from "./dslDocument";
import { createNameIndex, resolveId } from "./dslReferences";

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

const sourceWithAllDanglingKinds = [
  "nui 4",
  "view Draft (default: true, ghost: false)",
  'activeView "Missing View"',
  "point A = coordinate(x: 0, y: 0)",
  "point AnchorUser = offset(from: @MissingPoint, dx: 1, dy: 2)",
  'point DotAnchorUser = offset(from: @"Missing.Point", dx: 1, dy: 2)',
  'line DerivedAnchorUser = segment(start: @"Outer group"::"Missing shape#1".pivot, end: @A)',
  'extend(end: @"Outer group"::"Missing line#1".end, to: @A, id: EndpointUser)',
  'extend(end: @"Missing.Line".end, to: @A, id: EndpointDotUser)',
  'point NormalRefUser = intersection(line1: @MissingLine, line2: @"Missing line 2", index: 0, extensions: false)',
  'line ListRefUser = copy(startPoint: @A, endPoint: @A, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@MissingLine, @"Missing line 2", @"Outer group"::"Missing#line"])',
  'point ParentUser = coordinate(x: 1, y: 1, parent: @"Outer group"::"Missing parent#1")',
  'printLayout Sheet (output: pdf, view: "Missing View", paper: a4, orientation: portrait, columns: 1, rows: 1, overlap: 0, scale: 1, canvas: (210, 297)) {',
  '  place @"Missing Group" (at: (10, 0), angle: 0, mirrorX: false)',
  "}",
  'activePrintLayout "Missing Layout"'
].join("\n");

describe("dangling reference diagnostics and retention", () => {
  it("keeps every supported dangling reference kind in a compilable document", () => {
    const compiled = compileRecoverable(sourceWithAllDanglingKinds);
    const document = compiled.document!;
    const byName = new Map(document.elements.map((element) => [element.name, element]));
    const byId = new Map(document.elements.map((element) => [element.id, element]));

    expect(compiled.diagnostics.every((item) => item.severity === "warning")).toBe(true);
    expect(compiled.diagnostics.every((item) => item.line > 0 && item.message.length > 0)).toBe(true);
    expect((byName.get("AnchorUser") as Extract<CadElement, { type: "offsetPoint" }>).fromPoint)
      .toEqual({ mode: "reference", pointId: "@MissingPoint" });
    expect((byName.get("DotAnchorUser") as Extract<CadElement, { type: "offsetPoint" }>).fromPoint)
      .toEqual({ mode: "reference", pointId: '@"Missing.Point"' });
    expect((byName.get("DerivedAnchorUser") as Extract<CadElement, { type: "line" }>).startPoint)
      .toEqual({ mode: "derived", elementId: '@"Outer group"::"Missing shape#1"', pointKey: "pivot" });
    expect((byId.get("EndpointUser") as Extract<CadElement, { type: "extendTrim" }>).endpoint)
      .toEqual({ lineId: '@"Outer group"::"Missing line#1"', endpointKey: "end" });
    expect((byId.get("EndpointDotUser") as Extract<CadElement, { type: "extendTrim" }>).endpoint)
      .toEqual({ lineId: '@"Missing.Line"', endpointKey: "end" });
    expect((byName.get("NormalRefUser") as Extract<CadElement, { type: "intersectionPoint" }>).line1Id)
      .toBe("@MissingLine");
    expect((byName.get("ListRefUser") as Extract<CadElement, { type: "copyLine" }>).baseLineIds)
      .toEqual(["@MissingLine", '@"Missing line 2"', '@"Outer group"::"Missing#line"']);
    expect(byName.get("ParentUser")?.parentGroupId).toBe('@"Outer group"::"Missing parent#1"');
    expect(document.visibilityProfiles.find((profile) => profile.name === "Draft")?.roleVisibility)
      .toMatchObject({ ghost: false });
    expect(document.activeVisibilityProfileId).toBe("Missing View");
    expect(document.printLayouts[0]).toMatchObject({ visibilityProfileId: "Missing View" });
    expect(document.printLayouts[0].placements[0].groupId).toBe('@"Missing Group"');
    expect(document.activePrintLayoutId).toBe("Missing Layout");
  });

  it("preserves all dangling semantics across compile -> serialize -> recompile", () => {
    const first = compileRecoverable(sourceWithAllDanglingKinds);
    const serialized = serializeDocumentToDsl(first.document!, 4);
    const second = compileRecoverable(serialized);

    expect(serialized).toContain('@"Outer group"::"Missing shape#1".pivot');
    expect(serialized).toContain('from: @"Missing.Point"');
    expect(serialized).toContain('@"Outer group"::"Missing line#1".end');
    expect(serialized).toContain('@"Missing.Line".end');
    expect(serialized).toContain('baseLines: [@MissingLine, @"Missing line 2", @"Outer group"::"Missing#line"]');
    expect(serialized).not.toContain('"Outer group::Missing');
    expect(serializeDocumentToDsl(second.document!, 4)).toBe(serialized);
    expect(second.document!.activeVisibilityProfileId).toBe("Missing View");
    expect(second.document!.activePrintLayoutId).toBe("Missing Layout");
    expect(second.document!.printLayouts[0].placements[0].groupId).toBe('@"Missing Group"');
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
      expect.objectContaining({ severity: "warning", line: 7, message: expect.stringContaining("曖昧") })
    ]);
  });
});

describe("dangling automatic recovery and evaluation", () => {
  const dangling = [
    "nui 4",
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

    const repaired = dangling.replace("nui 4", "nui 4\npoint Missing = coordinate(x: 0, y: 0)");
    const after = compileRecoverable(repaired);
    const targetId = after.document!.elements.find((element) => element.name === "Missing")!.id;
    const usesMissing = after.document!.elements.find((element) => element.name === "UsesMissing") as Extract<CadElement, { type: "offsetPoint" }>;
    expect(usesMissing.fromPoint).toEqual({ mode: "reference", pointId: targetId });
    expect(after.diagnostics.filter((item) => item.message.includes("参照先"))).toEqual([]);
    expect(evaluateElements(after.document!.elements).errors).toEqual([]);
  });

  it("recovers after renaming an existing target", () => {
    const before = compileRecoverable(`nui 4\npoint Old = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`);
    expect(warningMessages(`nui 4\npoint Old = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`))
      .toEqual(expect.arrayContaining([expect.stringContaining("Missing")]));
    expect(evaluateElements(before.document!.elements).errors).not.toEqual([]);

    const after = compileRecoverable(`nui 4\npoint Missing = coordinate(x: 0, y: 0)\npoint User = offset(from: @Missing, dx: 1, dy: 0)`);
    expect(after.diagnostics).toEqual([]);
    expect(evaluateElements(after.document!.elements).errors).toEqual([]);
  });

  it("resolves a qualified target with quoted special segments after it is added", () => {
    const before = compileRecoverable(
      'nui 4\npoint User = offset(from: @"Outer group"::"Target#point", dx: 1, dy: 0)'
    );
    expect(before.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining('"Outer group"::"Target#point"') })
    ]));

    const after = compileRecoverable([
      "nui 4",
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
    ["paper", "nui 1\nprintLayout L paper=invalid {\n}"],
    ["orientation", "nui 1\nprintLayout L orientation=invalid {\n}"],
    ["output", "nui 1\nprintLayout L output=invalid {\n}"],
    ["canvas", "nui 1\nprintLayout L canvas=invalid {\n}"],
    ["at", "nui 1\nprintLayout L {\n  place G at=invalid\n}\ngroup G"],
    ["resolved non-group place", "nui 1\nprintLayout L {\n  place A at=(0, 0)\n}\npoint A = (0, 0)"]
  ])("keeps invalid non-reference %s values fatal", (_name, source) => {
    const compiled = compileDslDocument(source);
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });
});
