import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import convexNotchSource from "../../docs/module/manual-fixtures/nui3-convex-notch.nui?raw";
import seamAllowanceCopySource from "../../docs/module/manual-fixtures/nui3-seam-allowance-copy.nui?raw";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { elementParameterReferenceOptionsForPosition } from "../geometry/elementParameterReferenceOptions";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import { pickCandidates } from "../model/pickCandidates";
import { activePickCandidates, applyPickReference, finishLinePick } from "../commands/pickCommands";
import { pickRefForOption } from "../model/pickReferences";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT, initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { hitTestCanvasGeometry } from "../components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `fixture:${index}`] as const))
  });
};

const fixtureSource = (name: string) => name === "nui3-convex-notch.nui"
  ? convexNotchSource
  : seamAllowanceCopySource;

const compileFixture = (name: string) => {
  return compileSource(fixtureSource(name));
};

const evaluateFixture = (compiled: ReturnType<typeof compileFixture>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  const elements = compiled.document.elements;
  return evaluateElements(elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
    propertyBindingEntries: compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries({
          propertyBindings: compiled.propertyBindings,
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: compiled.materializedPropertyBindings
        }, elements)
      : undefined,
    numericBindingEntries: compiled.scalarProgram
      ? buildNumericBindingRuntimeEntries({
          numericBindings: compiled.numericBindings ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedNumericBindings: compiled.materializedNumericBindings
        }, elements)
      : undefined,
    conditionalGroupConditionsByElementId: compiled.scalarProgram &&
      (compiled.conditionalGroupConditions || compiled.materializedConditionalGroupConditions)
      ? new Map([
          ...(compiled.conditionalGroupConditions
            ? [...compiled.conditionalGroupConditions].flatMap(([key, expression]) => {
                const statementIndex = Number(key.split(":", 1)[0]);
                const elementId = compiled.statementMap!.elementIdByStatementIndex.get(statementIndex);
                return elementId ? [[elementId, expression] as const] : [];
              })
            : []),
          ...(compiled.materializedConditionalGroupConditions ?? []).map((entry) => [entry.elementId, entry.expression] as const)
        ])
      : undefined,
    conditionalOwnerStatementIdByElementId: compiled.bindingVersions
      ? new Map([
          ...conditionalOwnerIdByElementId(buildConditionalMutationOwners(
            compiled.bindingVersions,
            elements,
            compiled.statementMap.byElementId,
            compiled.statementMap.statementIdByStatementIndex,
            new Set(compiled.moduleConditionalOwnerStatementIdByElementId?.values() ?? [])
          )),
          ...(compiled.moduleConditionalOwnerStatementIdByElementId
            ? [...compiled.moduleConditionalOwnerStatementIdByElementId]
            : [])
        ])
      : undefined,
    forGroupMutationOwnerByElementId: compiled.bindingVersions
      ? new Map([
          ...forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
            compiled.bindingVersions,
            elements,
            compiled.statementMap.byElementId,
            compiled.statementMap.statementIdByStatementIndex,
            new Set(compiled.moduleForGroupMutationOwnerByElementId
              ? [...compiled.moduleForGroupMutationOwnerByElementId].map(([, owner]) => owner.ownerStatementId)
              : [])
          )),
          ...(compiled.moduleForGroupMutationOwnerByElementId
            ? [...compiled.moduleForGroupMutationOwnerByElementId]
            : [])
        ])
      : undefined,
    moduleConditionalOwnerStatementIdByElementId: compiled.moduleConditionalOwnerStatementIdByElementId,
    moduleForGroupMutationOwnerByElementId: compiled.moduleForGroupMutationOwnerByElementId
  });
};

const errorsOf = (compiled: ReturnType<typeof compileFixture>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("Module v1 manual fixtures", () => {
  it("compiles and evaluates the convex notch fixture with two independent instances", () => {
    const compiled = compileFixture("nui3-convex-notch.nui");
    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const instances = compiled.document!.elements.filter((element) => element.type === "moduleInstance");
    expect(instances.map((element) => element.name)).toEqual(["ノッチ通常", "ノッチ反転"]);
    expect(new Set(instances.map((element) => element.id)).size).toBe(2);

    const result = evaluateFixture(compiled);
    expect(result.errors).toEqual([]);
    const firstSides = compiled.document!.elements
      .filter((element) => element.name === "サイド1")
      .map((element) => result.computedGeometry.get(element.id));
    expect(firstSides).toHaveLength(2);
    expect(firstSides[0]).toBeDefined();
    expect(firstSides[1]).toBeDefined();
    expect(firstSides[0]?.elementId).not.toBe(firstSides[1]?.elementId);

    const heads = compiled.document!.elements
      .filter((element) => element.name === "頭")
      .map((element) => result.computedGeometry.get(element.id));
    expect(heads).toHaveLength(2);
    expect(heads[0]).toMatchObject({ kind: "point" });
    expect(heads[1]).toMatchObject({ kind: "point" });
    if (heads[0]?.kind === "point" && heads[1]?.kind === "point") {
      expect({ x: heads[0].x, y: heads[0].y }).not.toEqual({ x: heads[1].x, y: heads[1].y });
    }
  });

  it("materializes private and exported geometry for the nested seam-allowance fixture", () => {
    const compiled = compileFixture("nui3-seam-allowance-copy.nui");
    expect(errorsOf(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const instance = compiled.document!.elements.find((element) => element.name === "写し");
    expect(instance?.type).toBe("moduleInstance");
    expect(instance?.parentGroupId).toBeDefined();
    const children = compiled.document!.elements.filter((element) =>
      element.parentGroupId === instance?.id && element.name
    );
    expect(children.map((element) => element.name)).toEqual(["脇コピー", "先に縫う", "後で縫う"]);

    const result = evaluateFixture(compiled);
    expect(result.errors).toEqual([]);
    expect(children.map((element) => result.computedGeometry.get(element.id))).toEqual([
      expect.objectContaining({ kind: "offsetLine" }),
      expect.objectContaining({ kind: "offsetLine" }),
      expect.objectContaining({ kind: "offsetLine" })
    ]);

    const exportedChildren = children.filter((element) => element.name !== "脇コピー");
    expect(exportedChildren.every((element) => element.id.startsWith("module-runtime:"))).toBe(true);
    const origins = compiled.moduleMaterialization!.originByRuntimeElementId;
    expect(origins.get(children[0].id)).toMatchObject({ kind: "moduleBody" });
    expect(origins.get(children[1].id)).toMatchObject({ kind: "moduleBody" });
    expect(origins.get(children[2].id)).toMatchObject({ kind: "moduleBody" });
    const definition = [...compiled.moduleSemanticAnalysis!.definitionsByStatementId.values()]
      .find((candidate) => candidate.name === "縫い代写し");
    expect(definition?.exports.map((entry) => entry.name)).toEqual(["先に縫う", "後で縫う"]);

    const lineCandidates = pickCandidates(compiled.document!.elements, result, {
      activePointPickTarget: null,
      activeLinePickTarget: { elementId: "virtual-after-fixture", parameterKey: "baseLineIds" },
      activeNumericReferencePickTarget: null,
      referenceElements: children,
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
      }
    });
    expect(lineCandidates.map((candidate) => candidate.elementId)).toEqual(
      exportedChildren.map((element) => element.id)
    );
    expect(lineCandidates.flatMap((candidate) => candidate.options)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReference: "写し::先に縫う" }),
      expect.objectContaining({ sourceReference: "写し::後で縫う" })
    ]));

    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(seamAllowanceCopySource, "test");
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: {
        elementId: "virtual-command-target",
        parameterKey: "baseLineIds",
        insertionIndex: useCadDocumentStore.getState().elements.length
      }
    });
    const storeCompiled = useCadDocumentStore.getState().doc as ReturnType<typeof compileFixture>;
    const storeResult = evaluateFixture(storeCompiled);
    const commandCandidates = activePickCandidates(storeResult);
    const storePrivateId = storeCompiled.document!.elements.find((element) => element.name === "脇コピー")!.id;
    expect(commandCandidates.some((candidate) => candidate.elementId === storePrivateId)).toBe(false);
    expect(commandCandidates.flatMap((candidate) => candidate.options)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReference: "写し::先に縫う" }),
      expect.objectContaining({ sourceReference: "写し::後で縫う" })
    ]));

    const privateId = children.find((element) => element.name === "脇コピー")!.id;
    expect(result.computedGeometry.get(privateId)).toMatchObject({ kind: "offsetLine", elementId: privateId });
    expect(origins.get(privateId)).toMatchObject({ kind: "moduleBody", instancePath: expect.any(Array) });
    const { result: canvas } = renderHook(() => useCanvasOverlayData({
      evaluation: result,
      elements: compiled.document!.elements,
      selectedElementId: null,
      pointPickCandidates: [],
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));
    expect(canvas.current.offsetLines.some((line) => line.elementId === privateId)).toBe(true);
    expect(hitTestCanvasGeometry({
      screen: canvas.current.overlayOffsetLines.find((line) => line.line.elementId === privateId)!.points[0],
      lines: [],
      offsetLines: canvas.current.overlayOffsetLines,
      points: []
    })).toBe(privateId);

    const pointCandidates = pickCandidates(compiled.document!.elements, result, {
      activePointPickTarget: {
        elementId: "virtual-point-target",
        parameterKey: "point",
        insertionIndex: compiled.document!.elements.length
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      referenceElements: children,
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
      }
    });
    expect(pointCandidates.map((candidate) => candidate.elementId)).toEqual(
      exportedChildren.map((element) => element.id)
    );

    const numericCandidates = pickCandidates(compiled.document!.elements, result, {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: {
        elementId: "virtual-numeric-target",
        parameterKey: "distance",
        property: "length",
        mode: "replace",
        insertionIndex: compiled.document!.elements.length
      },
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
      }
    });
    expect(numericCandidates.some((candidate) => candidate.elementId === privateId)).toBe(false);
    expect(numericCandidates.flatMap((candidate) => candidate.options).map((option) =>
      option.kind === "numericReference" ? option.expression : null
    )).toContain("写し::先に縫う.length");

    const propertyOptions = elementParameterReferenceOptionsForPosition({
      referenceElements: children,
      elementToken: "脇コピー",
      evaluation: result,
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
      }
    });
    expect(propertyOptions).toEqual([]);

    const allCandidates = pickCandidates(compiled.document!.elements, result, {
      activePointPickTarget: null,
      activeLinePickTarget: {
        elementId: "virtual-all-target",
        parameterKey: "baseLineIds",
        insertionIndex: compiled.document!.elements.length
      },
      activeNumericReferencePickTarget: null,
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
      }
    });
    expect(allCandidates.some((candidate) => candidate.elementId === instance!.id)).toBe(false);
  });

  it("keeps module geometry inputs read-only and private exports opaque", () => {
    const mutation = compileSource([
      "nui 3",
      "module M(path: line) {",
      "  move(targets: [path], from: path.start, to: path.end, scale: 1, angleDeg: 0, mirrorX: false)",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "module Call = M(path: Base)"
    ].join("\n"));
    expect(errorsOf(mutation).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);

    const privateReference = compileSource([
      "nui 3",
      "module M() {",
      "  point Private = coordinate(x: 0, y: 0)",
      "}",
      "module Call = M()",
      "point Root = offset(from: Call::Private, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(privateReference).some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);
  });

  it("adopts an exported line from the command pick path as canonical source syntax", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module I = M()",
      "line Base = segment(start: (0, 0), end: (5, 0))",
      "line Use = copy(startPoint: (0, 0), endPoint: (5, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [Base])"
    ].join("\n");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    const compiled = useCadDocumentStore.getState().doc as ReturnType<typeof compileFixture>;
    const result = evaluateFixture(compiled);
    const use = compiled.document!.elements.find((element) => element.name === "Use")!;
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: {
        elementId: use.id,
        parameterKey: "baseLineIds"
      }
    });
    const candidates = activePickCandidates(result);
    const exported = candidates.flatMap((candidate) => candidate.options
      .map((option) => ({ candidate, option }))
      .filter(({ option }) => option.kind === "line" && option.sourceReference === "I::Out"))[0];
    expect(exported?.option).toBeDefined();
    if (!exported) return;
    expect(applyPickReference(pickRefForOption(exported.candidate.elementId, exported.option), result)).toBe(true);
    finishLinePick();
    expect(useCadDocumentStore.getState().sourceText).toContain("I::Out");
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");
    expect(errorsOf(compileSource(useCadDocumentStore.getState().sourceText))).toEqual([]);
  });
});
