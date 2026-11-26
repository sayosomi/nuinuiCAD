import { createHash } from "node:crypto";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createModuleRuntimeContext,
  parseDsl,
  queryDslDefinition,
  queryDslReferences,
  queryDslRenameTarget,
  planDslRenameEditsResult,
  queryDslFormatting,
  type DslLayerMembershipForSerialization,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import {
  canvasLayerSourceDocumentFor,
  canvasLayerVisibleElementIds,
  projectCanvasLayerPresentation
} from "../src/model/canvasLayerPresentation";
import { projectEffectiveDrawableLayers } from "../src/model/effectiveDrawableLayer";
import { referencePickCandidates } from "../src/model/referencePickCandidates";
import { buildOutputPlan } from "../src/output/outputCore";
import { evaluateElementsReference } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import type { EvaluationResult } from "../src/types/geometry";

const compile = (source: string) => {
  const preparsed = parseDsl(source);
  const ids = new Map(preparsed.statements.map((_, index) => [index, `issue1619-instance:statement:${index}`] as const));
  const compiled = compileDslDocument(source, { preparsed, assignedStatementIds: ids, assignedElementIds: ids });
  return { preparsed, ids, compiled };
};

const errors = (compiled: CompiledDslDocument) => compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error");
const emptyEvaluation = (): EvaluationResult => ({ computedGeometry: new Map(), errors: [], warnings: [] });

describe("#1619 Slice B Module instance layer inheritance", () => {
  it("parses, resolves, serializes, and services a call-site Layer reference", () => {
    const source = [
      "nui 1",
      "// Preserve this authored note.",
      "module Pattern() {",
      "  line Center = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance One in caller = Pattern()",
      "layer caller"
    ].join("\n");
    const { compiled, ids } = compile(source);
    expect(errors(compiled)).toEqual([]);
    const instanceIndex = compiled.statements.findIndex(statement => statement.kind === "moduleInstance");
    const instance = compiled.statements[instanceIndex]!;
    expect(instance).toMatchObject({ kind: "moduleInstance", name: "One", layerReference: "caller" });
    if (instance.kind !== "moduleInstance" || !instance.layerReferencePhysicalSpan) throw new Error("instance Layer source span missing");
    const physical = instance.layerReferencePhysicalSpan.segments[0]!;
    expect(source.slice(physical.from, physical.to)).toBe("caller");
    const layerId = ids.get(compiled.statements.findIndex(statement => statement.kind === "layerDeclaration" && statement.name === "caller"));
    expect(compiled.sourceLexicalNamespace?.layerMembershipsByStatementIndex.get(instanceIndex)).toMatchObject({
      layerIdentity: layerId, layerName: "caller", explicit: true
    });
    expect(compiled.document!.sourceLayerMembershipsBySourceStatementId?.get(
      `issue1619-instance:statement:${instanceIndex}`
    )).toMatchObject({ layerIdentity: layerId, layerName: "caller", explicit: true });
    const formatted = [...queryDslFormatting({ normalizedSource: source, options: { tabSize: 2, insertSpaces: true } })]
      .sort((left, right) => right.range.from - left.range.from)
      .reduce((current, edit) => current.slice(0, edit.range.from) + edit.newText + current.slice(edit.range.to), source);
    expect(formatted).toContain("instance One in caller = Pattern()");
    expect(formatted).toContain("// Preserve this authored note.");
    expect(errors(compile(formatted).compiled)).toEqual([]);

    const referenceStart = source.indexOf("in caller") + "in ".length;
    const layerStart = source.indexOf("layer caller") + "layer ".length;
    const semantic = { sourceRevision: 0, sourceText: source, compiled };
    const snapshot = { normalizedSource: source, sourceRevision: 0 };
    expect(queryDslDefinition({ source: snapshot, position: referenceStart + 1, semantic })).toEqual({
      declarationRange: { from: layerStart, to: layerStart + "caller".length },
      referenceRange: { from: referenceStart, to: referenceStart + "caller".length }
    });
    expect(queryDslReferences({ source: snapshot, position: layerStart + 1, semantic })?.referenceRanges.map(
      range => source.slice(range.from, range.to)
    )).toContain("caller");
    expect(queryDslRenameTarget({ source: snapshot, semantic }, referenceStart)).toMatchObject({ oldName: "caller" });
    const rename = planDslRenameEditsResult({ source: snapshot, semantic }, referenceStart, "cutline");
    expect(rename.status).toBe("ok");
    if (rename.status === "ok") {
      const renamed = [...rename.plan.edits].sort((left, right) => right.from - left.from)
        .reduce((current, edit) => current.slice(0, edit.from) + edit.newText + current.slice(edit.to), source);
      expect(renamed).toContain("instance One in cutline = Pattern()");
      expect(renamed).toContain("// Preserve this authored note.");
      expect(errors(compile(renamed).compiled)).toEqual([]);
    }
  });

  it("applies drawable > nearest instance > nearest Group > default precedence without duplicating occurrences", () => {
    const source = [
      "nui 1",
      "layer outer",
      "layer instance_layer",
      "layer inner",
      "layer other_instance",
      "module Pattern() {",
      "  layer own",
      "  line Inherited = segment(start: (0, 0), end: (10, 0))",
      "  line Own in own = segment(start: (0, 1), end: (10, 1))",
      "  line OwnDefault in default = segment(start: (0, 2), end: (10, 2))",
      "  for i in range(min: 0, max: 1, step: 1) {",
      "    line Generated = segment(start: (0, i), end: (10, i))",
      "  }",
      "}",
      "group Outer in outer {",
      "  layer instance_layer",
      "  instance One in instance_layer = Pattern()",
      "  group Inner in inner {",
      "    instance Two in other_instance = Pattern()",
      "    instance Three = Pattern()",
      "  }",
      "}",
      "instance Four = Pattern()"
    ].join("\n");
    const { compiled } = compile(source);
    expect(errors(compiled)).toEqual([]);
    const document = compiled.document!;
    const evaluation = evaluateElementsReference(document.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: document.evaluationLimitIndex
    }));
    expect(evaluation.errors).toEqual([]);
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      moduleMaterialization: compiled.moduleMaterialization,
      elements: document.elements,
      evaluation
    });
    const origins = compiled.moduleMaterialization!.originByRuntimeElementId;
    const sourceIndex = compiled.statements.findIndex(statement => statement.kind === "element" && statement.name === "Inherited");
    const sourceId = `issue1619-instance:statement:${sourceIndex}`;
    const inheritedIds = [...origins].filter(([, origin]) => origin.kind === "moduleBody" && origin.sourceStatementId === sourceId)
      .map(([id]) => id);
    expect(inheritedIds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(inheritedIds).size).toBe(inheritedIds.length);
    expect(inheritedIds.every(id => evaluation.computedGeometry.has(id))).toBe(true);
    const layerId = (name: string) => presentation.layers.find(layer => layer.name === name)!.id;
    const instanceOrigins = [...origins].filter(([, origin]) => origin.kind === "moduleInstance");
    const assignmentForSourceName = (name: string) => {
      const index = compiled.statements.findIndex(statement => statement.kind === "moduleInstance" && statement.name === name);
      return compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(index);
    };
    expect(assignmentForSourceName("One")).toMatchObject({ layerName: "instance_layer", explicit: true });
    const localLayerDeclaration = compiled.sourceLexicalNamespace!.layerDeclarations.find(declaration =>
      declaration.name === "instance_layer" && compiled.sourceLexicalNamespace!.scopeIndex.scopes.get(declaration.scopeId)?.kind === "group"
    );
    expect(assignmentForSourceName("One")?.layerIdentity).toBe(localLayerDeclaration?.statementId);
    expect(instanceOrigins.length).toBe(4);
    const bodies = (instanceName: string) => {
      const instanceIndex = compiled.statements.findIndex(statement => statement.kind === "moduleInstance" && statement.name === instanceName);
      const instanceStatementId = `issue1619-instance:statement:${instanceIndex}`;
      const runtimeInstanceId = instanceOrigins.find(([, origin]) => origin.sourceStatementId === instanceStatementId)?.[0];
      return inheritedIds.filter(id => document.elements.find(element => element.id === id)?.parentGroupId === runtimeInstanceId);
    };
    const oneBody = bodies("One")[0]!;
    const twoBody = bodies("Two")[0]!;
    const threeBody = bodies("Three")[0]!;
    const fourBody = bodies("Four")[0]!;
    expect(presentation.layerIdByElementId.get(oneBody)).toBe(layerId("instance_layer"));
    expect(presentation.layerIdByElementId.get(twoBody)).toBe(layerId("other_instance"));
    expect(presentation.layerIdByElementId.get(threeBody)).toBe(layerId("inner"));
    expect(presentation.layerIdByElementId.get(fourBody)).toBe(layerId("default"));
    const ownIds = [...origins].filter(([, origin]) => origin.kind === "moduleBody" &&
      origin.sourceStatementId === `issue1619-instance:statement:${compiled.statements.findIndex(statement => statement.name === "Own")}`)
      .map(([id]) => id);
    const defaultIds = [...origins].filter(([, origin]) => origin.kind === "moduleBody" &&
      origin.sourceStatementId === `issue1619-instance:statement:${compiled.statements.findIndex(statement => statement.name === "OwnDefault")}`)
      .map(([id]) => id);
    expect(presentation.layerIdByElementId.get(ownIds[0]!)).toBe(layerId("own"));
    expect(presentation.layerIdByElementId.get(defaultIds[0]!)).toBe(layerId("default"));
    expect(document.elements.filter(element => element.name === "Inherited").map(element => element.id)).toEqual(inheritedIds);
    expect(instanceOrigins.map(([id]) => id).length).toBe(new Set(instanceOrigins.map(([id]) => id)).size);
    const generatedSourceIndex = compiled.statements.findIndex(statement => statement.kind === "element" && statement.name === "Generated");
    const generatedSourceId = `issue1619-instance:statement:${generatedSourceIndex}`;
    const generatedTemplates = new Set([...origins].filter(([, origin]) => origin.kind === "moduleBody" &&
      origin.sourceStatementId === generatedSourceId).map(([id]) => id));
    const generatedRows = (evaluation.forGroupGeneratedRows ?? []).filter(row => generatedTemplates.has(row.templateElementId));
    expect(generatedRows.length).toBeGreaterThan(0);
    const instanceNameByRuntimeId = new Map(instanceOrigins.map(([id, origin]) => [
      id,
      compiled.statements[origin.sourceStatementIndex]!.name
    ]));
    const expectedByInstanceName: Record<string, string> = {
      One: "instance_layer",
      Two: "other_instance",
      Three: "inner",
      Four: "default"
    };
    const elementsById = new Map(document.elements.map(element => [element.id, element] as const));
    for (const row of generatedRows) {
      const template = elementsById.get(row.templateElementId)!;
      const forGroup = elementsById.get(template.parentGroupId!)!;
      const instanceId = forGroup.parentGroupId!;
      const instanceName = instanceNameByRuntimeId.get(instanceId)!;
      expect(presentation.layerIdByElementId.get(row.generatedElementId)).toBe(layerId(expectedByInstanceName[instanceName]!));
    }
  });

  it("keeps Module-body Layer identity definition-local and reports invalid call-site references exactly", () => {
    const source = [
      "nui 1",
      "layer seam",
      "module Pattern() {",
      "  layer seam",
      "  line Body in seam = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance Use in seam = Pattern()"
    ].join("\n");
    const { compiled } = compile(source);
    expect(errors(compiled)).toEqual([]);
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      moduleMaterialization: compiled.moduleMaterialization,
      elements: compiled.document!.elements,
      evaluation: emptyEvaluation()
    });
    const origin = [...compiled.moduleMaterialization!.originByRuntimeElementId].find(([, value]) => value.kind === "moduleBody");
    const bodyIndex = compiled.statements.findIndex(statement => statement.kind === "element" && statement.name === "Body");
    const localLayerId = compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(bodyIndex)?.layerIdentity;
    const instanceIndex = compiled.statements.findIndex(statement => statement.kind === "moduleInstance");
    const instanceOrigin = [...compiled.moduleMaterialization!.originByRuntimeElementId].find(([, value]) =>
      value.kind === "moduleInstance" && value.sourceStatementIndex === instanceIndex
    )!;
    const instanceMembership = compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(instanceIndex)!;
    const bodyMembership = compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(bodyIndex)!;
    const effective = projectEffectiveDrawableLayers({
      elements: compiled.document!.elements,
      assignmentByElementId: new Map([
        [instanceOrigin[0], { layerIdentity: instanceMembership.layerIdentity, layerName: instanceMembership.layerName, explicit: true }],
        [origin![0], { layerIdentity: bodyMembership.layerIdentity, layerName: bodyMembership.layerName, explicit: true }]
      ])
    });
    expect(effective.get(origin![0])?.layerIdentity).toBe(localLayerId);
    expect(effective.get(origin![0])?.layerIdentity).not.toBe(instanceMembership.layerIdentity);
    expect(presentation.layerIdByElementId.get(origin![0])).toBe(presentation.layers.find(layer => layer.name === "seam")?.id);

    const invalid = "nui 1\ninstance Use in Missing = Pattern()";
    const failed = compile(invalid).compiled;
    const diagnostic = errors(failed).find(item => item.code === "layer-membership-undefined");
    expect(diagnostic).toBeDefined();
    const span = diagnostic!.physicalSpan!.segments[0]!;
    expect(invalid.slice(span.from, span.to)).toBe("Missing");
  });

  it("uses the nearest annotated instance in nested calls and preserves instance gates", () => {
    const source = [
      "nui 1",
      "layer caller",
      "layer inner_group",
      "module Leaf() {",
      "  line Body = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module Wrapper() {",
      "  layer inner_group",
      "  layer nested_instance",
      "  group InnerGroup in inner_group {",
      "    instance Inner in nested_instance = Leaf()",
      "  }",
      "}",
      "instance Outer(enabled: true, visible: true) in caller = Wrapper()",
      "instance Disabled(enabled: false, visible: false) in caller = Leaf()"
    ].join("\n");
    const { compiled } = compile(source);
    expect(errors(compiled)).toEqual([]);
    const disabled = compiled.statements.find(statement => statement.kind === "moduleInstance" && statement.name === "Disabled");
    expect(disabled).toMatchObject({
      kind: "moduleInstance",
      layerReference: "caller",
      options: [
        expect.objectContaining({ name: "enabled", value: "false" }),
        expect.objectContaining({ name: "visible", value: "false" })
      ]
    });
    const evaluation = evaluateElementsReference(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document!.evaluationLimitIndex
    }));
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      moduleMaterialization: compiled.moduleMaterialization,
      elements: compiled.document!.elements,
      evaluation
    });
    const innerIndex = compiled.statements.findIndex(statement => statement.kind === "moduleInstance" && statement.name === "Inner");
    const innerOrigin = [...compiled.moduleMaterialization!.originByRuntimeElementId].find(([, origin]) =>
      origin.kind === "moduleInstance" && origin.sourceStatementIndex === innerIndex
    )!;
    const bodyIndex = compiled.statements.findIndex(statement => statement.kind === "element" && statement.name === "Body");
    const bodySourceId = `issue1619-instance:statement:${bodyIndex}`;
    const bodyOrigin = [...compiled.moduleMaterialization!.originByRuntimeElementId].find(([, origin]) =>
      origin.kind === "moduleBody" && origin.sourceStatementId === bodySourceId
    )!;
    const bodyElement = compiled.document!.elements.find(element => element.id === bodyOrigin[0])!;
    expect(bodyElement.parentGroupId).toBe(innerOrigin[0]);
    expect(presentation.layerIdByElementId.get(bodyOrigin[0])).toBe(
      presentation.layers.find(layer => layer.name === "nested_instance")?.id
    );
  });

  it("diagnoses invalid call-site Layer references with exact spans", () => {
    const cases: readonly [string, string, string][] = [
      ["nui 1\ninstance Use in missing = Pattern()", "layer-membership-undefined", "missing"],
      ["nui 1\npoint P = coordinate(x: 0, y: 0)\ninstance Use in P = Pattern()", "layer-membership-not-layer", "P"],
      ["nui 1\nmodule Hidden() {\n  layer private\n}\ninstance Use in private = Pattern()", "layer-membership-inaccessible", "private"],
      ["nui 1\nlayer seam\nlayer seam\ninstance Use in seam = Pattern()", "layer-membership-ambiguous", "seam"],
      ["nui 1\nlayer seam\ninstance Use in @seam = Pattern()", "layer-membership-invalid-reference", "@seam"]
    ];
    for (const [source, code, token] of cases) {
      const diagnostic = errors(compile(source).compiled).find(item => item.code === code);
      expect(diagnostic, `${code}: ${source}`).toBeDefined();
      const span = diagnostic!.physicalSpan!.segments[0]!;
      expect(source.slice(span.from, span.to)).toBe(token);
    }
  });

  it("leaves geometry results and dependency failures unchanged by instance Layer metadata", () => {
    const sourceFor = (annotation: string) => [
      "nui 1",
      "layer seam",
      "module Pattern() {",
      "  line Body = segment(start: (0, 0), end: (10, 0))",
      "}",
      `instance Use${annotation} = Pattern()`
    ].join("\n");
    const plain = compile(sourceFor("")).compiled;
    const assigned = compile(sourceFor(" in seam")).compiled;
    const evaluationFor = (compiled: CompiledDslDocument) => evaluateElementsReference(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document!.evaluationLimitIndex
    }));
    const plainEvaluation = evaluationFor(plain);
    const assignedEvaluation = evaluationFor(assigned);
    expect(plainEvaluation.errors).toEqual([]);
    expect(assignedEvaluation.errors).toEqual([]);
    expect([...assignedEvaluation.computedGeometry]).toEqual([...plainEvaluation.computedGeometry]);

    const broken = (annotation: string) => compile([
      "nui 1",
      "layer seam",
      "module Pattern() {",
      "  line Body = segment(start: UnknownPoint, end: (10, 0))",
      "}",
      `instance Use${annotation} = Pattern()`
    ].join("\n")).compiled;
    const plainErrors = errors(broken("")).map(diagnostic => diagnostic.code).sort();
    const assignedErrors = errors(broken(" in seam")).map(diagnostic => diagnostic.code).sort();
    expect(plainErrors.length).toBeGreaterThan(0);
    expect(assignedErrors).toEqual(plainErrors);
  });

  it("keeps exported const values non-drawable and filters output by effective instance membership", () => {
    const source = [
      "nui 1",
      "layer cut",
      "module Pattern() {",
      "  export line Center = segment(start: (0, 0), end: (10, 0))",
      "  export const CenterValue: line = Center",
      "  export line Side = segment(start: (0, 5), end: (10, 5))",
      "}",
      "group Placement {",
      "  instance Use in cut = Pattern()",
      "  const ExternalValue: line = Use::CenterValue",
      "  const ExternalLength: number = Use::Center.length",
      "}",
      "layout L {",
      "  place Placement(at: (0, 0))",
      "}",
      "svg Cut(layout: L, layers: [cut], margin: 0)",
      "print PrintCut(layout: L, layers: [cut], paper: a4, overlap: 10)",
      "svg Default(layout: L, layers: [default], margin: 0)"
    ].join("\n");
    const compiled = compileFreshCanonicalText(source);
    expect(compiled.status, JSON.stringify(compiled.diagnostics)).not.toBe("fatal");
    const doc = compiled.doc;
    const evaluation = evaluateElementsReference(doc.document.elements, buildEvaluationOptions({
      compiledDocument: doc,
      evaluationLimitIndex: doc.document.evaluationLimitIndex
    }));
    const plans = doc.document.svgOutputs.map(output => buildOutputPlan({ compiledDocument: doc, output, evaluation }));
    expect(plans[0]!.drawables.map(drawable => drawable.name)).toEqual(expect.arrayContaining(["Center", "Side"]));
    expect(plans[1]!.drawables).toEqual([]);
    expect(doc.document.elements.some(element => ["CenterValue", "ExternalValue", "ExternalLength"].includes(element.name))).toBe(false);
    const canvas = projectCanvasLayerPresentation({
      compiledDocument: doc,
      moduleMaterialization: doc.moduleMaterialization,
      elements: doc.document.elements,
      evaluation,
      hiddenLayerIds: new Set(["canvas-layer-name:\"cut\""])
    });
    const visibleIds = canvasLayerVisibleElementIds(new Set(doc.document.elements.map(element => element.id)), canvas);
    const bodyIds = [...(doc.moduleMaterialization?.originByRuntimeElementId ?? [])]
      .filter(([, origin]) => origin.kind === "moduleBody" && ["Center", "Side"].includes(
        doc.statements[origin.sourceStatementIndex]?.name ?? ""
      )).map(([id]) => id);
    expect(bodyIds.length).toBe(2);
    const picks = referencePickCandidates({ compiled: doc, evaluation, target: null });
    for (const id of bodyIds) expect(picks.filter(candidate => candidate.elementId === id)).toHaveLength(1);
    expect(bodyIds.some(id => visibleIds.has(id))).toBe(false);
    const afterCanvasHide = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    expect(afterCanvasHide.drawables).toEqual(plans[0]!.drawables);
    expect(afterCanvasHide.bounds).toEqual(plans[0]!.bounds);
    expect(afterCanvasHide.pages).toEqual(plans[0]!.pages);
    const printPlan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0]!, evaluation });
    const afterCanvasHidePrint = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0]!, evaluation });
    expect(afterCanvasHidePrint.drawables).toEqual(printPlan.drawables);
    expect(afterCanvasHidePrint.bounds).toEqual(printPlan.bounds);
    expect(afterCanvasHidePrint.pages).toEqual(printPlan.pages);
  });

  it("resolves imported Module call-site assignments in the importing document", async () => {
    const source = [
      "nui 1",
      "import \"./pattern.nui\" as p",
      "layer caller",
      "group Placement {",
      "  instance Use in caller = p::Pattern()",
      "}",
      "layout L {",
      "  place Placement(at: (0, 0))",
      "}",
      "svg Caller(layout: L, layers: [caller], margin: 0)"
    ].join("\n");
    const dependency = "nui 1\nexport module Pattern() {\n  export line Body = segment(start: (0, 0), end: (10, 0))\n}";
    const rootId = documentIdFromHost("/issue1619/root.nui");
    const graph = await buildMultiDocumentImportGraph({
      root: { kind: "root-current", documentId: rootId, normalizedSource: source, sourceRevision: 1 },
      loader: { async loadSavedDependency(importer, relative) {
        const path = posix.normalize(posix.join(posix.dirname(importer), relative));
        if (posix.basename(path) !== "pattern.nui") return { status: "failed", reason: "missing" };
        return { status: "loaded", snapshot: {
          kind: "dependency-saved", documentId: documentIdFromHost(path), normalizedSource: dependency,
          savedSourceFingerprint: savedSourceFingerprintFromHost(createHash("sha256").update(dependency).digest("hex"))
        } };
      } },
      declarationContributors: [moduleDeclarationContributor]
    });
    const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
    const node = graph.nodes.get(rootId)!;
    const compiled = compileDslDocument(source, {
      preparsed: node.artifact.parsed,
      sourceRevision: 1,
      assignedStatementIds: node.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(errors(compiled)).toEqual([]);
    const runtime = [...(compiled.moduleMaterialization?.originByRuntimeElementId ?? [])]
      .find(([, origin]) => origin.kind === "moduleBody");
    expect(runtime).toBeDefined();
    expect(runtime?.[1]).toMatchObject({ sourceDocumentId: expect.not.stringContaining(rootId) });
    const sourceDocuments = [...context.documentsById.values()].map(sourceDocument => canvasLayerSourceDocumentFor({
      documentId: String(sourceDocument.documentId),
      sourceLexicalNamespace: sourceDocument.sourceLexicalNamespace,
      statements: sourceDocument.statements,
      document: sourceDocument.documentId === context.rootDocumentId ? compiled.document : undefined
    }));
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: compiled,
      sourceDocuments,
      moduleMaterialization: compiled.moduleMaterialization,
      elements: compiled.document!.elements,
      evaluation: emptyEvaluation()
    });
    expect(presentation.layerIdByElementId.get(runtime![0])).toBe(
      presentation.layers.find(layer => layer.name === "caller")?.id
    );
    const evaluation = evaluateElementsReference(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document!.evaluationLimitIndex
    }));
    expect(evaluation.errors).toEqual([]);
    const output = buildOutputPlan({ compiledDocument: compiled, output: compiled.document!.svgOutputs[0]!, evaluation });
    expect(output.drawables.map(drawable => drawable.name)).toEqual(["Body"]);
  });

  it("filters an imported definition-local same-name Layer without rejecting valid ownership", async () => {
    const source = [
      "nui 1",
      "import \"./pattern.nui\" as p",
      "layer seam",
      "group Placement {",
      "  instance Use in seam = p::Pattern()",
      "  line CallerLocal in seam = segment(start: (20, 0), end: (30, 0))",
      "}",
      "layout L {",
      "  place Placement(at: (0, 0))",
      "}",
      "svg CallerSeam(layout: L, layers: [seam], margin: 0)"
    ].join("\n");
    const dependency = [
      "nui 1",
      "export module Pattern() {",
      "  layer seam",
      "  export line Body in seam = segment(start: (0, 10), end: (10, 10))",
      "}"
    ].join("\n");
    const rootId = documentIdFromHost("/issue1619/root.nui");
    const graph = await buildMultiDocumentImportGraph({
      root: { kind: "root-current", documentId: rootId, normalizedSource: source, sourceRevision: 1 },
      loader: { async loadSavedDependency(importer, relative) {
        const path = posix.normalize(posix.join(posix.dirname(importer), relative));
        if (posix.basename(path) !== "pattern.nui") return { status: "failed", reason: "missing" };
        return { status: "loaded", snapshot: {
          kind: "dependency-saved", documentId: documentIdFromHost(path), normalizedSource: dependency,
          savedSourceFingerprint: savedSourceFingerprintFromHost(createHash("sha256").update(dependency).digest("hex"))
        } };
      } },
      declarationContributors: [moduleDeclarationContributor]
    });
    const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
    const root = graph.nodes.get(rootId)!;
    const compiled = compileDslDocument(source, {
      preparsed: root.artifact.parsed,
      sourceRevision: 1,
      assignedStatementIds: root.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(errors(compiled)).toEqual([]);
    expect(compiled.moduleRuntimeContext).toBe(context);
    const evaluation = evaluateElementsReference(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled,
      evaluationLimitIndex: compiled.document!.evaluationLimitIndex
    }));
    expect(evaluation.errors).toEqual([]);

    const importedBody = [...compiled.moduleMaterialization!.originByRuntimeElementId].find(([, origin]) => {
      if (origin.kind !== "moduleBody" || !origin.sourceDocumentId) return false;
      const imported = context.documentFor(origin.sourceDocumentId);
      return imported?.statements[origin.sourceStatementIndex]?.name === "Body";
    });
    expect(importedBody).toBeDefined();
    expect(evaluation.computedGeometry.has(importedBody![0])).toBe(true);
    const bodyOrigin = importedBody![1];
    if (bodyOrigin.kind !== "moduleBody" || !bodyOrigin.sourceDocumentId) throw new Error("Imported Body provenance missing");
    const imported = context.documentFor(bodyOrigin.sourceDocumentId)!;
    const bodySourceIndex = imported.statements.findIndex(statement => statement.kind === "element" && statement.name === "Body");
    const definitionLayer = imported.sourceLexicalNamespace.layerDeclarations.find(layer => layer.name === "seam");
    const bodyMembership = imported.sourceLexicalNamespace.layerMembershipsByStatementIndex.get(bodySourceIndex);
    const rootLayer = compiled.sourceLexicalNamespace!.layerDeclarations.find(layer => layer.name === "seam");
    const callerInstanceIndex = compiled.statements.findIndex(statement => statement.kind === "moduleInstance" && statement.name === "Use");
    const callerMembership = compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(callerInstanceIndex);
    expect(definitionLayer).toBeDefined();
    expect(bodyMembership).toMatchObject({
      layerIdentity: definitionLayer?.statementId,
      layerName: "seam",
      explicit: true
    });
    expect(callerMembership).toMatchObject({
      layerIdentity: rootLayer?.statementId,
      layerName: "seam",
      explicit: true
    });
    expect(bodyMembership!.layerIdentity).not.toBe(callerMembership!.layerIdentity);

    const output = buildOutputPlan({ compiledDocument: compiled, output: compiled.document!.svgOutputs[0]!, evaluation });
    expect(output.drawables.map(drawable => drawable.name)).toEqual(["CallerLocal"]);
    expect(output.drawables.some(drawable => drawable.name === "Body")).toBe(false);
  });

  it("continues to fail closed when a drawable has an unknown source Layer identity", () => {
    const source = [
      "nui 1",
      "layer seam",
      "group Placement {",
      "  line Body in seam = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place Placement(at: (0, 0))",
      "}",
      "svg Seam(layout: L, layers: [seam], margin: 0)"
    ];
    const compiled = compileFreshCanonicalText(source.join("\n"));
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
    const doc = compiled.doc;
    const body = doc.document.elements.find(element => element.name === "Body");
    if (!body) throw new Error("fixture did not produce Body");
    const memberships = doc.document.sourceLayerMembershipsByElementId;
    const membership = memberships?.get(body.id);
    if (!memberships || !membership) throw new Error("fixture did not resolve Body's source Layer");
    (memberships as Map<string, DslLayerMembershipForSerialization>).set(body.id, {
      ...membership,
      layerIdentity: "unresolvable:layer:identity"
    });
    const evaluation = evaluateElementsReference(doc.document.elements, buildEvaluationOptions({
      compiledDocument: doc,
      evaluationLimitIndex: doc.document.evaluationLimitIndex
    }));

    expect(() => buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.svgOutputs[0]!,
      evaluation
    })).toThrow(/unresolved source layer ownership/);
  });
});
