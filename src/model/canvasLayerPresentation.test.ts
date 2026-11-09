import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDsl,
  type CadElement
} from "@nuinuicad/nui-language";
import type { EvaluationResult } from "../types/geometry";
import {
  canvasLayerSourceDocumentFor,
  canvasLayerVisibleElementIds,
  projectCanvasLayerPresentation,
  type CanvasLayerMaterialization
} from "./canvasLayerPresentation";

const compile = (source: string, identityPrefix = "test") => {
  const parsed = parseDsl(source);
  const ids = new Map(parsed.statements.map((_, index) => [index, `${identityPrefix}:statement:${index}`] as const));
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: ids,
    assignedElementIds: ids
  });
};

const emptyEvaluation = (patch: Partial<EvaluationResult> = {}): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: [],
  ...patch
});

const pointElement = (id: string): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
});

describe("Canvas layer presentation projection", () => {
  it("projects same-name lexical declarations to one Canvas toggle while preserving their source identities", () => {
    const compiled = compile([
      "nui 1",
      "layer seams",
      "layer empty",
      "point Plain = coordinate(x: 0, y: 0)",
      "point ExplicitDefault in @default = coordinate(x: 0, y: 1)",
      "group Front {",
      "  layer seams",
      "  point FrontPoint in @seams = coordinate(x: 1, y: 0)",
      "}",
      "group Back {",
      "  layer seams",
      "  point BackPoint in @seams = coordinate(x: 2, y: 0)",
      "}"
    ].join("\n"));
    expect(compiled.document).not.toBeNull();
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      elements: compiled.document!.elements,
      evaluation: emptyEvaluation()
    });
    const idForName = (name: string) => compiled.document!.elements.find((element) => element.name === name)!.id;

    const seams = presentation.layers.filter((layer) => layer.name === "seams");
    expect(presentation.layers.map((layer) => layer.name)).toEqual(["default", "seams", "empty"]);
    expect(seams).toHaveLength(1);
    expect(seams[0]?.label).toBe("seams");
    expect((compiled.document!.sourceLayerDeclarations ?? [])
      .filter((declaration) => declaration.name === "seams")
      .map((declaration) => declaration.identity)).toHaveLength(3);
    expect(presentation.layerIdByElementId.get(idForName("Plain"))).toBe("source-layer:builtin:default");
    expect(presentation.layerIdByElementId.get(idForName("ExplicitDefault"))).toBe("source-layer:builtin:default");

    const hiddenFront = new Set([seams[0]!.id]);
    const hiddenPresentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      elements: compiled.document!.elements,
      evaluation: emptyEvaluation(),
      hiddenLayerIds: hiddenFront
    });
    const plainId = idForName("Plain");
    const explicitDefaultId = idForName("ExplicitDefault");
    const frontId = idForName("FrontPoint");
    const backId = idForName("BackPoint");
    expect(canvasLayerVisibleElementIds(new Set([plainId, explicitDefaultId, frontId, backId]), hiddenPresentation)).toEqual(
      new Set([plainId, explicitDefaultId])
    );
  });

  it("shares one declaration toggle across repeated Module bodies while retaining distinct runtime IDs", () => {
    const compiled = compile([
      "nui 1",
      "module Pattern() {",
      "  layer seam",
      "  point Mark in @seam = coordinate(x: 2, y: 3)",
      "}",
      "instance First = Pattern()",
      "instance Second = Pattern()"
    ].join("\n"));
    const markIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Mark");
    const markStatementId = `test:statement:${markIndex}`;
    const materialization = compiled.moduleMaterialization;
    expect(materialization).toBeDefined();
    const runtimeIds = [...materialization!.originByRuntimeElementId.entries()]
      .filter(([, origin]) => origin.kind === "moduleBody" && origin.sourceStatementId === markStatementId)
      .map(([runtimeId]) => runtimeId);
    expect(runtimeIds).toHaveLength(2);
    expect(new Set(runtimeIds).size).toBe(2);

    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      moduleMaterialization: materialization,
      elements: runtimeIds.map(pointElement),
      evaluation: emptyEvaluation()
    });
    const layerIds = runtimeIds.map((runtimeId) => presentation.layerIdByElementId.get(runtimeId));
    expect(layerIds[0]).toBe(layerIds[1]);
    expect(layerIds[0]).toBe(presentation.layers.find((layer) => layer.name === "seam")?.id);
  });

  it("inherits layer membership for evaluator-generated for-group occurrences", () => {
    const compiled = compile([
      "nui 1",
      "layer pattern",
      "point Template in @pattern = coordinate(x: 0, y: 0)"
    ].join("\n"));
    const generatedEvaluation = emptyEvaluation({
      forGroupGeneratedRows: [{
        forGroupId: "loop",
        templateElementId: compiled.document!.elements.find((element) => element.name === "Template")!.id,
        generatedElementId: "runtime-template-occurrence-0",
        iterationIndex: 0,
        occurrencePath: [],
        variableName: "i",
        variableValue: 0,
        elementName: "Template",
        elementType: "freePoint"
      }]
    });
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      elements: compiled.document!.elements,
      evaluation: generatedEvaluation
    });
    const templateId = compiled.document!.elements.find((element) => element.name === "Template")!.id;
    expect(presentation.layerIdByElementId.get("runtime-template-occurrence-0")).toBe(
      presentation.layerIdByElementId.get(templateId)
    );
    const patternLayer = presentation.layers.find((layer) => layer.name === "pattern")!;
    expect(canvasLayerVisibleElementIds(
      new Set([templateId, "runtime-template-occurrence-0"]),
      { ...presentation, hiddenLayerIds: new Set([patternLayer.id]) }
    )).toEqual(new Set());
  });

  it("keeps the visibility key for the same exact layer name across source identity reconciliation", () => {
    const before = compile("nui 1\nlayer seams\npoint A in @seams = coordinate(x: 0, y: 0)", "identity-before");
    const after = compile("nui 1\n// harmless edit\nlayer seams\npoint A in @seams = coordinate(x: 0, y: 0)", "identity-after");
    const beforePresentation = projectCanvasLayerPresentation({
      compiledDocument: before,
      elements: before.document!.elements,
      evaluation: emptyEvaluation()
    });
    const oldLayer = beforePresentation.layers.find((layer) => layer.name === "seams")!;
    expect(before.document!.sourceLayerDeclarations?.find((declaration) => declaration.name === "seams")?.identity)
      .not.toBe(after.document!.sourceLayerDeclarations?.find((declaration) => declaration.name === "seams")?.identity);
    const afterPresentation = projectCanvasLayerPresentation({
      compiledDocument: after,
      elements: after.document!.elements,
      evaluation: emptyEvaluation(),
      hiddenLayerIds: new Set([oldLayer.id])
    });
    const reconciledLayer = afterPresentation.layers.find((layer) => layer.name === "seams")!;

    expect(reconciledLayer.id).toBe(oldLayer.id);
    expect(afterPresentation.hiddenLayerIds.has(reconciledLayer.id)).toBe(true);
    expect(canvasLayerVisibleElementIds(
      new Set([after.document!.elements.find((element) => element.name === "A")!.id]),
      afterPresentation
    )).toEqual(new Set());
  });

  it("uses document-qualified imported provenance and fails closed when that source mapping is absent", () => {
    const root = compile("nui 1");
    const imported = compile([
      "nui 1",
      "layer importedSeam",
      "point ImportedMark in @importedSeam = coordinate(x: 1, y: 2)"
    ].join("\n"));
    const importedStatementIndex = imported.statements.findIndex((statement) =>
      statement.kind === "element" && statement.name === "ImportedMark"
    );
    const importedStatementId = `test:statement:${importedStatementIndex}`;
    const importedDocumentId = "file:///workspace/pattern-library.nui";
    const importedSource = canvasLayerSourceDocumentFor({
      documentId: importedDocumentId,
      sourceLexicalNamespace: imported.sourceLexicalNamespace!,
      statements: imported.statements,
      document: imported.document
    });
    const moduleMaterialization = {
      rootDocumentId: "file:///workspace/root.nui",
      originByRuntimeElementId: new Map([[
        "runtime-imported-mark",
        {
          kind: "moduleBody",
          sourceStatementId: importedStatementId,
          sourceDocumentId: importedDocumentId
        }
      ]])
    } as unknown as CanvasLayerMaterialization;
    const projection = projectCanvasLayerPresentation({
      compiledDocument: root,
      sourceDocuments: [importedSource],
      moduleMaterialization,
      elements: [pointElement("runtime-imported-mark")],
      evaluation: emptyEvaluation()
    });
    const importedLayerId = projection.layerIdByElementId.get("runtime-imported-mark");
    expect(importedLayerId).toBeDefined();
    expect(importedLayerId).toBe("canvas-layer-name:\"importedSeam\"");
    expect(canvasLayerVisibleElementIds(
      new Set(["runtime-imported-mark"]),
      { ...projection, hiddenLayerIds: new Set([importedLayerId!]) }
    )).toEqual(new Set());

    const missingSourceProjection = projectCanvasLayerPresentation({
      compiledDocument: root,
      moduleMaterialization,
      elements: [pointElement("runtime-imported-mark")],
      evaluation: emptyEvaluation()
    });
    expect(missingSourceProjection.unmappedModuleDrawableIds.has("runtime-imported-mark")).toBe(true);
    expect(canvasLayerVisibleElementIds(new Set(["runtime-imported-mark"]), missingSourceProjection)).toEqual(new Set());
  });

  it("aggregates imported and Module occurrences by exact name without merging runtime identities", () => {
    const root = compile([
      "nui 1",
      "layer draft",
      "group Front {",
      "  layer draft",
      "  point FrontPoint in @draft = coordinate(x: 1, y: 0)",
      "}",
      "group Back {",
      "  layer draft",
      "  point BackPoint in @draft = coordinate(x: -1, y: 0)",
      "}",
      "module Pattern() {",
      "  layer draft",
      "  point Mark in @draft = coordinate(x: 2, y: 0)",
      "}",
      "instance First = Pattern()",
      "instance Second = Pattern()",
      "layer Draft",
      "layer empty"
    ].join("\n"));
    const imported = compile("nui 1\nlayer draft\npoint Imported in @draft = coordinate(x: 3, y: 0)");
    const importedDocumentId = "file:///workspace/library.nui";
    const importedSource = canvasLayerSourceDocumentFor({
      documentId: importedDocumentId,
      sourceLexicalNamespace: imported.sourceLexicalNamespace!,
      statements: imported.statements,
      document: imported.document
    });
    const markIndex = root.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Mark");
    const markStatementId = `test:statement:${markIndex}`;
    const instanceRuntimeIds = [...root.moduleMaterialization!.originByRuntimeElementId.entries()]
      .filter(([, origin]) => origin.kind === "moduleBody" && origin.sourceStatementId === markStatementId)
      .map(([runtimeId]) => runtimeId);
    const importedStatementIndex = imported.statements.findIndex((statement) =>
      statement.kind === "element" && statement.name === "Imported"
    );
    const importedStatementId = `test:statement:${importedStatementIndex}`;
    const moduleOrigins: Array<readonly [string, {
      kind: "moduleBody";
      sourceStatementId: string;
      sourceDocumentId?: string;
    }]> = [
      ...instanceRuntimeIds.map((runtimeId) => [runtimeId, {
        kind: "moduleBody",
        sourceStatementId: markStatementId
      }] as const),
      ["runtime-imported", {
        kind: "moduleBody",
        sourceStatementId: importedStatementId,
        sourceDocumentId: importedDocumentId
      }]
    ];
    const materialization = {
      rootDocumentId: "file:///workspace/root.nui",
      originByRuntimeElementId: new Map(moduleOrigins)
    } as unknown as CanvasLayerMaterialization;
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: root,
      sourceDocuments: [importedSource],
      moduleMaterialization: materialization,
      elements: [
        ...root.document!.elements,
        ...instanceRuntimeIds.map(pointElement),
        pointElement("runtime-imported")
      ],
      evaluation: emptyEvaluation()
    });
    const draftRows = presentation.layers.filter((layer) => layer.name === "draft");
    const draftKey = draftRows[0]?.id;
    const draftRuntimeIds = [
      ...root.document!.elements
        .filter((element) => element.name === "FrontPoint" || element.name === "BackPoint")
        .map((element) => element.id),
      ...instanceRuntimeIds,
      "runtime-imported"
    ];
    expect(draftRows).toHaveLength(1);
    expect(instanceRuntimeIds).toHaveLength(2);
    expect(new Set(instanceRuntimeIds).size).toBe(2);
    expect(new Set(draftRuntimeIds.map((id) => presentation.layerIdByElementId.get(id)))).toEqual(new Set([draftKey]));
    expect(presentation.layers.map((layer) => layer.name)).toEqual(["default", "draft", "Draft", "empty"]);
    expect(canvasLayerVisibleElementIds(new Set(draftRuntimeIds), {
      ...presentation,
      hiddenLayerIds: new Set([draftKey!])
    })).toEqual(new Set());
  });
});
