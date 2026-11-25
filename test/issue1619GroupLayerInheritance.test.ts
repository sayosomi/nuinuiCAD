import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDsl,
  queryDslDefinition,
  queryDslReferences,
  queryDslRenameTarget,
  planDslRenameEditsResult,
  queryDslFormatting,
  serializeDocumentToDsl,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import {
  canvasLayerVisibleElementIds,
  projectCanvasLayerPresentation
} from "../src/model/canvasLayerPresentation";
import { projectEffectiveDrawableLayers } from "../src/model/effectiveDrawableLayer";
import type { EvaluationResult } from "../src/types/geometry";

const compile = (source: string) => {
  const preparsed = parseDsl(source);
  const ids = new Map(preparsed.statements.map((_, index) => [index, `issue1619:statement:${index}`] as const));
  const compiled = compileDslDocument(source, {
    preparsed,
    assignedStatementIds: ids,
    assignedElementIds: ids
  });
  return { preparsed, ids, compiled };
};

const errors = (compiled: CompiledDslDocument) => compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error");
const emptyEvaluation = (): EvaluationResult => ({ computedGeometry: new Map(), errors: [], warnings: [] });

describe("#1619 Slice A Group layer inheritance", () => {
  const source = [
    "nui 1",
    "layer outline",
    "layer seam",
    "group Outer in seam {",
    "  group Middle {",
    "    line Inherited = segment(start: (0, 0), end: (10, 0))",
    "    line Explicit in outline = segment(start: (0, 1), end: (10, 1))",
    "    line ExplicitDefault in default = segment(start: (0, 2), end: (10, 2))",
    "    group Inner in outline {",
    "      line NestedOverride = segment(start: (0, 3), end: (10, 3))",
    "    }",
    "    extract Parts(source: Inherited, parts: [plain: start..end, part in outline: start..end])",
    "    extract HeadOnly in outline(source: Inherited, parts: [headOnly: start..end])",
    "    extract HeadAndPart in outline(source: Inherited, parts: [partWins in seam: start..end])",
    "  }",
    "}",
    "line Root = segment(start: (0, 4), end: (10, 4))"
  ].join("\n");

  it("keeps Group assignments source-owned, scoped, span-accurate, and serializable", () => {
    const { preparsed, ids, compiled } = compile(source);
    expect(preparsed.diagnostics).toEqual([]);
    expect(errors(compiled)).toEqual([]);

    const outerIndex = compiled.statements.findIndex(statement => statement.kind === "group" && statement.name === "Outer");
    const innerIndex = compiled.statements.findIndex(statement => statement.kind === "group" && statement.name === "Inner");
    const outer = compiled.statements[outerIndex]!;
    const inner = compiled.statements[innerIndex]!;
    expect(outer).toMatchObject({ kind: "group", layerReference: "seam" });
    expect(inner).toMatchObject({ kind: "group", layerReference: "outline" });
    if (outer.kind !== "group" || !outer.layerReferencePhysicalSpan) throw new Error("Group source span missing");
    if (inner.kind !== "group" || !inner.layerReferencePhysicalSpan) throw new Error("Nested Group source span missing");
    expect(source.slice(outer.layerReferencePhysicalSpan.segments[0]!.from, outer.layerReferencePhysicalSpan.segments[0]!.to)).toBe("seam");
    expect(source.slice(inner.layerReferencePhysicalSpan.segments[0]!.from, inner.layerReferencePhysicalSpan.segments[0]!.to)).toBe("outline");

    const namespace = compiled.sourceLexicalNamespace!;
    const outerAssignment = namespace.layerMembershipsByStatementIndex.get(outerIndex);
    const innerAssignment = namespace.layerMembershipsByStatementIndex.get(innerIndex);
    const layerId = (name: string) => ids.get(compiled.statements.findIndex(statement => statement.kind === "layerDeclaration" && statement.name === name));
    expect(outerAssignment).toMatchObject({ layerIdentity: layerId("seam"), layerName: "seam", explicit: true });
    expect(innerAssignment).toMatchObject({ layerIdentity: layerId("outline"), layerName: "outline", explicit: true });
    expect(outerAssignment?.referencePhysicalSpan?.segments[0] && source.slice(
      outerAssignment.referencePhysicalSpan.segments[0]!.from,
      outerAssignment.referencePhysicalSpan.segments[0]!.to
    )).toBe("seam");

    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("group Outer in seam {");
    expect(serialized).toContain("group Inner in outline {");
    expect(errors(compile(serialized).compiled)).toEqual([]);
  });

  it("resolves Group Layer references through Definition, References, and Rename", () => {
    const text = "nui 1\nlayer seam\ngroup G in seam {\n  line L = segment(start: (0, 0), end: (1, 0))\n}";
    const { compiled } = compile(text);
    expect(errors(compiled)).toEqual([]);
    const source = { normalizedSource: text, sourceRevision: 0 };
    const semantic = { sourceRevision: 0, sourceText: text, compiled };
    const referenceStart = text.indexOf("in seam") + "in ".length;
    const layerStart = text.indexOf("layer seam") + "layer ".length;
    const definition = queryDslDefinition({ source, position: referenceStart + 1, semantic });
    expect(definition).toEqual({
      declarationRange: { from: layerStart, to: layerStart + "seam".length },
      referenceRange: { from: referenceStart, to: referenceStart + "seam".length }
    });
    const references = queryDslReferences({ source, position: layerStart + 1, semantic });
    expect(references?.referenceRanges.map(range => text.slice(range.from, range.to))).toEqual(["seam"]);
    const renameSnapshot = { source, semantic };
    expect(queryDslRenameTarget(renameSnapshot, referenceStart)).toMatchObject({ oldName: "seam" });
    const rename = planDslRenameEditsResult(renameSnapshot, referenceStart, "stitch");
    expect(rename.status).toBe("ok");
    if (rename.status === "ok") {
      const renamed = [...rename.plan.edits].sort((a, b) => b.from - a.from).reduce(
        (current, edit) => current.slice(0, edit.from) + edit.newText + current.slice(edit.to), text
      );
      expect(renamed).toContain("layer stitch");
      expect(renamed).toContain("group G in stitch {");
      expect(errors(compile(renamed).compiled)).toEqual([]);
    }
  });

  it("formats Group Layer references without rewriting their syntax", () => {
    const source = "nui 1\nlayer seam\ngroup G in seam {\nline L = segment(start: (0, 0), end: (1, 0))\n}";
    const edits = queryDslFormatting({
      normalizedSource: source,
      options: { tabSize: 2, insertSpaces: true }
    });
    const formatted = [...edits].sort((left, right) => right.range.from - left.range.from).reduce(
      (current, edit) => current.slice(0, edit.range.from) + edit.newText + current.slice(edit.range.to),
      source
    );

    expect(formatted).toBe([
      "nui 1",
      "layer seam",
      "group G in seam {",
      "  line L = segment(",
      "    start: (0, 0),",
      "    end: (1, 0),",
      "  )",
      "}"
    ].join("\n"));
    expect(errors(compile(formatted).compiled)).toEqual([]);
  });

  it("applies nearest Group inheritance while preserving drawable overrides and default", () => {
    const { compiled } = compile(source);
    expect(errors(compiled)).toEqual([]);
    const document = compiled.document!;
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      elements: document.elements,
      evaluation: emptyEvaluation()
    });
    const element = (name: string) => document.elements.find(candidate => candidate.name === name)!;
    const layer = (name: string) => presentation.layers.find(candidate => candidate.name === name)!.id;
    const inheritedNames = ["Inherited", "plain"];
    for (const name of inheritedNames) {
      const value = element(name);
      expect(presentation.layerIdByElementId.get(value.id)).toBe(layer("seam"));
    }
    for (const name of ["Explicit", "NestedOverride", "part", "headOnly"]) {
      expect(presentation.layerIdByElementId.get(element(name).id)).toBe(layer("outline"));
    }
    expect(presentation.layerIdByElementId.get(element("partWins").id)).toBe(layer("seam"));
    expect(presentation.layerIdByElementId.get(element("ExplicitDefault").id)).toBe(layer("default"));
    expect(presentation.layerIdByElementId.get(element("Root").id)).toBe(layer("default"));

    const hidden = { ...presentation, hiddenLayerIds: new Set([layer("seam")]) };
    expect(canvasLayerVisibleElementIds(new Set(document.elements.map(item => item.id)), hidden).has(element("Inherited").id)).toBe(false);
    expect(canvasLayerVisibleElementIds(new Set(document.elements.map(item => item.id)), hidden).has(element("Explicit").id)).toBe(true);

    const changed = compile(source.replace("Outer in seam", "Outer in outline"));
    const changedDocument = changed.compiled.document!;
    const changedPresentation = projectCanvasLayerPresentation({
      compiledDocument: changed.compiled,
      elements: changedDocument.elements,
      evaluation: emptyEvaluation()
    });
    const changedInherited = changedDocument.elements.find(candidate => candidate.name === "Inherited")!;
    expect(changedPresentation.layerIdByElementId.get(changedInherited.id)).toBe(
      changedPresentation.layers.find(candidate => candidate.name === "outline")!.id
    );
  });

  it("preserves gates and Style syntax alongside the Group layer clause", () => {
    const { preparsed, compiled } = compile([
      "nui 1",
      "layer seam",
      "style Hidden {",
      "  visible: false,",
      "}",
      "group G [Hidden] in seam (roles: [], visible: true, enabled: false) {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "}"
    ].join("\n"));
    expect(preparsed.diagnostics).toEqual([]);
    expect(errors(compiled)).toEqual([]);
    const group = compiled.statements.find(statement => statement.kind === "group");
    expect(group).toMatchObject({ kind: "group", layerReference: "seam", modifierNames: ["Hidden"] });
    expect(compiled.document!.elements.find(element => element.type === "group")).toMatchObject({
      modifierNames: ["Hidden"], enabled: false
    });
  });

  it("reports undefined, non-Layer, inaccessible, ambiguous, and `@` Group references", () => {
    const cases: readonly [string, string][] = [
      ["nui 1\ngroup G in missing {\n}", "layer-membership-undefined"],
      ["nui 1\npoint P = coordinate(x: 0, y: 0)\ngroup G in P {\n}", "layer-membership-not-layer"],
      ["nui 1\ngroup G {\n layer local\n}\ngroup H in local {\n}", "layer-membership-inaccessible"],
      ["nui 1\nlayer seam\nlayer seam\ngroup G in seam {\n}", "layer-membership-ambiguous"],
      ["nui 1\nlayer seam\ngroup G in @seam {\n}", "layer-membership-invalid-reference"]
    ];
    for (const [text, code] of cases) {
      const { compiled } = compile(text);
      expect(errors(compiled).some(diagnostic => diagnostic.code === code), `${code}: ${text}`).toBe(true);
      const diagnostic = errors(compiled).find(item => item.code === code)!;
      if (diagnostic.physicalSpan?.segments[0]) {
        const physical = diagnostic.physicalSpan.segments[0];
        expect(text.slice(physical.from, physical.to).length).toBeGreaterThan(0);
      }
    }
  });

  it("inherits caller Group membership through existing Module instances without capturing Module scopes", () => {
    const moduleSource = [
      "nui 1",
      "layer seam",
      "module M() {",
      "  line Body = segment(start: (0, 0), end: (10, 0))",
      "  layer local",
      "  group Local in local {",
      "    line LocalBody = segment(start: (0, 1), end: (10, 1))",
      "  }",
      "}",
      "group Caller in seam {",
      "  instance One = M()",
      "}"
    ].join("\n");
    const { compiled } = compile(moduleSource);
    expect(errors(compiled)).toEqual([]);
    const document = compiled.document!;
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      moduleMaterialization: compiled.moduleMaterialization,
      elements: document.elements,
      evaluation: emptyEvaluation()
    });
    const origins = compiled.moduleMaterialization!.originByRuntimeElementId;
    const runtimeIdForSourceName = (name: string) => {
      const sourceIndex = compiled.statements.findIndex(statement => statement.name === name);
      const sourceId = `issue1619:statement:${sourceIndex}`;
      return [...origins].find(([, origin]) => origin.kind === "moduleBody" && origin.sourceStatementId === sourceId)?.[0];
    };
    const bodyId = runtimeIdForSourceName("Body");
    const localBodyId = runtimeIdForSourceName("LocalBody");
    expect(bodyId).toBeDefined();
    expect(localBodyId).toBeDefined();
    expect(presentation.layerIdByElementId.get(bodyId!)).toBe(presentation.layers.find(layer => layer.name === "seam")?.id);
    expect(presentation.layerIdByElementId.get(localBodyId!)).toBe(presentation.layers.find(layer => layer.name === "local")?.id);
  });

  it("feeds runtime ancestry into the shared effective membership projection", () => {
    const { compiled } = compile(source);
    const document = compiled.document!;
    const assignmentByElementId = document.sourceLayerMembershipsByElementId!;
    const effective = projectEffectiveDrawableLayers({
      elements: document.elements,
      assignmentByElementId
    });
    const inherited = document.elements.find(element => element.name === "Inherited")!;
    const group = document.elements.find(element => element.name === "Outer")!;
    expect(effective.get(inherited.id)).toEqual(expect.objectContaining({
      layerIdentity: assignmentByElementId.get(group.id)?.layerIdentity,
      layerName: "seam"
    }));
  });
});
