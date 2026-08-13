import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import convexNotchSource from "../../docs/module/manual-fixtures/nui4-convex-notch.nui?raw";
import seamAllowanceCopySource from "../../docs/module/manual-fixtures/nui4-seam-allowance-copy.nui?raw";
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

const fixtureSource = (name: string) => name === "nui4-convex-notch.nui"
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
    const compiled = compileFixture("nui4-convex-notch.nui");
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
    const compiled = compileFixture("nui4-seam-allowance-copy.nui");
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
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: compiled.sourceLexicalNamespace,
        statementInfoByElementId: compiled.statementMap!.byElementId
      }
    });
    expect(lineCandidates.map((candidate) => candidate.elementId)).toEqual(
      exportedChildren.map((element) => element.id)
    );
    expect(lineCandidates.flatMap((candidate) => candidate.options)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReference: { base: "写し::先に縫う" } }),
      expect.objectContaining({ sourceReference: { base: "写し::後で縫う" } })
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
      expect.objectContaining({ sourceReference: { base: "写し::先に縫う" } }),
      expect.objectContaining({ sourceReference: { base: "写し::後で縫う" } })
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
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: compiled.sourceLexicalNamespace,
        statementInfoByElementId: compiled.statementMap!.byElementId
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
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: compiled.sourceLexicalNamespace,
        statementInfoByElementId: compiled.statementMap!.byElementId
      }
    });
    expect(numericCandidates.some((candidate) => candidate.elementId === privateId)).toBe(false);
    expect(numericCandidates.flatMap((candidate) => candidate.options).map((option) =>
      option.kind === "numericReference" ? option.expression : null
    )).toContain("@写し::先に縫う.length");

    const propertyOptions = elementParameterReferenceOptionsForPosition({
      referenceElements: children,
      elementToken: "脇コピー",
      evaluation: result,
      moduleSemanticContext: {
        moduleMaterialization: compiled.moduleMaterialization,
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: compiled.sourceLexicalNamespace,
        statementInfoByElementId: compiled.statementMap!.byElementId
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
        moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
        sourceLexicalNamespace: compiled.sourceLexicalNamespace,
        statementInfoByElementId: compiled.statementMap!.byElementId
      }
    });
    expect(allCandidates.some((candidate) => candidate.elementId === instance!.id)).toBe(false);
  });

  it("keeps module geometry inputs read-only and private exports opaque", () => {
    const mutation = compileSource([
      "nui 4",
      "module M(path: line) {",
      "  move(targets: [@path], from: @path.start, to: @path.end, scale: 1, angleDeg: 0, mirrorX: false)",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance Call = M(path: @Base)"
    ].join("\n"));
    expect(errorsOf(mutation).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);

    const privateReference = compileSource([
      "nui 4",
      "module M() {",
      "  point Private = coordinate(x: 0, y: 0)",
      "}",
      "instance Call = M()",
      "point Root = offset(from: @Call::Private, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(privateReference).some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);
  });

  it("uses source lexical scope for private geometry and nested export candidates", () => {
    const source = [
      "nui 4",
      "module Inner() {",
      "  export line \"Out.dot\" = segment(start: (0, 0), end: (10, 0))",
      "  export point \"Point.dot\" = coordinate(x: 0, y: 0)",
      "  point \"PrivateStart.dot\" = coordinate(x: 0, y: 0)",
      "  point \"PrivateEnd.dot\" = coordinate(x: 5, y: 0)",
      "  line ForwardTarget = segment(start: (0, 0), end: (3, 0))",
      "  line \"Private.dot\" = segment(start: (0, 0), end: (5, 0))",
      "  line PrivateUse = segment(start: (0, 0), end: (3, 0))",
      "  group OuterScope {",
      "    line ScopedPrivate = segment(start: (0, 0), end: (5, 0))",
      "    group InnerScope {",
      "      line ScopedUse = segment(start: (0, 0), end: (3, 0))",
      "    }",
      "  }",
      "  group SiblingScope {",
      "    line SiblingPrivate = segment(start: (0, 0), end: (5, 0))",
      "    line SiblingUse = segment(start: (0, 0), end: (3, 0))",
      "  }",
      "}",
      "module Outer() {",
      "  instance \"First.dot\" = Inner()",
      "  instance \"Second.dot\" = Inner()",
      "  line OuterTarget = segment(start: (0, 0), end: (3, 0))",
      "}",
      "instance OuterCall = Outer()",
      "instance \"RootInst.dot\" = Inner()",
      "line RootTarget = segment(start: (0, 0), end: (3, 0))"
    ].join("\n");
    const compiled = compileSource(source);
    expect(errorsOf(compiled)).toEqual([]);
    const result = evaluateFixture(compiled);
    expect(result.errors).toEqual([]);
    const elements = compiled.document!.elements;
    const context = {
      moduleMaterialization: compiled.moduleMaterialization,
      moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
      sourceLexicalNamespace: compiled.sourceLexicalNamespace,
      statementInfoByElementId: compiled.statementMap!.byElementId
    };
    const byNameAndParent = (name: string, parentName: string) => {
      const parent = elements.find((element) => element.name === parentName && element.type === "moduleInstance");
      return elements.find((element) => element.name === name && element.parentGroupId === parent?.id)!;
    };
    const firstPrivate = byNameAndParent("Private.dot", "First.dot");
    const secondPrivate = byNameAndParent("Private.dot", "Second.dot");
    const firstPrivateUse = byNameAndParent("PrivateUse", "First.dot");
    const ancestry = (element: typeof elements[number]) => {
      const names: string[] = [];
      let parentId = element.parentGroupId;
      while (parentId) {
        const parent = elements.find((candidate) => candidate.id === parentId);
        if (!parent) break;
        names.push(parent.name);
        parentId = parent.parentGroupId;
      }
      return names;
    };
    const firstScopedPrivate = elements.find((element) => element.name === "ScopedPrivate" && ancestry(element).includes("First.dot"))!;
    const firstScopedUse = elements.find((element) => element.name === "ScopedUse" && ancestry(element).includes("First.dot"))!;
    const firstSiblingPrivate = elements.find((element) => element.name === "SiblingPrivate" && ancestry(element).includes("First.dot"))!;
    const firstSiblingUse = elements.find((element) => element.name === "SiblingUse" && ancestry(element).includes("First.dot"))!;
    const outerTarget = elements.find((element) => element.name === "OuterTarget")!;
    const rootTarget = elements.find((element) => element.name === "RootTarget")!;
    const lineCandidatesFor = (targetElementId: string) => pickCandidates(elements, result, {
      activePointPickTarget: null,
      activeLinePickTarget: { elementId: targetElementId, parameterKey: "baseLines" },
      activeNumericReferencePickTarget: null,
      referenceElements: elements,
      moduleSemanticContext: context
    });
    const candidateIdsFor = (targetElementId: string) => new Set(lineCandidatesFor(targetElementId).map((candidate) => candidate.elementId));

    // Same materialized instance is not sufficient: a forward private source
    // is not visible, while the authored private source is visible afterwards.
    const firstCandidates = candidateIdsFor(firstPrivateUse.id);
    expect(firstCandidates.has(firstPrivate.id)).toBe(true);
    const forwardCandidates = candidateIdsFor(byNameAndParent("ForwardTarget", "RootInst.dot").id);
    expect(forwardCandidates.has(byNameAndParent("Private.dot", "RootInst.dot").id)).toBe(false);
    const siblingCandidates = candidateIdsFor(secondPrivate.id);
    expect(siblingCandidates.has(firstPrivate.id)).toBe(false);
    expect(candidateIdsFor(firstScopedUse.id).has(firstScopedPrivate.id)).toBe(true);
    expect(candidateIdsFor(firstSiblingUse.id).has(firstScopedPrivate.id)).toBe(false);
    expect(candidateIdsFor(firstSiblingUse.id).has(firstSiblingPrivate.id)).toBe(true);

    // Nested export is visible in the caller Module body, but neither nested
    // child nor private geometry leaks to the root document.
    const outerCandidates = candidateIdsFor(outerTarget.id);
    const firstExport = byNameAndParent("Out.dot", "First.dot");
    const rootExport = byNameAndParent("Out.dot", "RootInst.dot");
    expect(outerCandidates.has(firstExport.id)).toBe(true);
    expect(outerCandidates.has(firstPrivate.id)).toBe(false);
    expect(outerCandidates.has(rootExport.id)).toBe(false);
    const rootCandidates = candidateIdsFor(rootTarget.id);
    expect(rootCandidates.has(rootExport.id)).toBe(true);
    expect(rootCandidates.has(firstExport.id)).toBe(false);
    expect(rootCandidates.has(firstPrivate.id)).toBe(false);
  });

  it("adopts an exported line from the command pick path as canonical source syntax", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance I = M()",
      "line Base = segment(start: (0, 0), end: (5, 0))",
      "line Use = copy(startPoint: (0, 0), endPoint: (5, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Base])"
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
      .filter(({ option }) => option.kind === "line" && option.sourceReference?.base === "I::Out"))[0];
    expect(exported?.option).toBeDefined();
    if (!exported) return;
    expect(applyPickReference(pickRefForOption(exported.candidate.elementId, exported.option), result)).toBe(true);
    finishLinePick();
    expect(useCadDocumentStore.getState().sourceText).toContain("@I::Out");
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");
    expect(errorsOf(compileSource(useCadDocumentStore.getState().sourceText))).toEqual([]);
  });

  it("adopts quoted Module exports without splitting dots in source references", () => {
    const source = [
      "nui 4",
      "module \"M.dot\"() {",
      "  export line \"Out.dot\" = segment(start: (0, 0), end: (10, 0))",
      "  export point \"Point.dot\" = coordinate(x: 0, y: 0)",
      "}",
      "instance \"I.dot\" = \"M.dot\"()",
      "line Base = segment(start: (0, 0), end: (5, 0))",
      "line LineUse = copy(startPoint: (0, 0), endPoint: (5, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Base])",
      "line PointUse = copy(startPoint: (0, 0), endPoint: (5, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Base])"
    ].join("\n");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    const compiled = useCadDocumentStore.getState().doc as ReturnType<typeof compileFixture>;
    expect(errorsOf(compiled)).toEqual([]);
    const result = evaluateFixture(compiled);
    const lineUse = compiled.document!.elements.find((element) => element.name === "LineUse")!;
    const pointUse = compiled.document!.elements.find((element) => element.name === "PointUse")!;

    useCadUiStore.setState({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: { elementId: lineUse.id, parameterKey: "baseLineIds" }
    });
    const lineCandidates = activePickCandidates(result);
    const quotedExportBase = '"I.dot"::"Out.dot"';
    const quotedLine = lineCandidates.flatMap((candidate) => candidate.options
      .map((option) => ({ candidate, option }))
      .filter(({ option }) => option.kind === "line" && option.sourceReference?.base === quotedExportBase))[0];
    expect(quotedLine?.option).toBeDefined();
    if (!quotedLine) return;
    expect(applyPickReference(pickRefForOption(quotedLine.candidate.elementId, quotedLine.option), result)).toBe(true);
    finishLinePick();
    expect(useCadDocumentStore.getState().sourceText).toContain('@"I.dot"::"Out.dot"');
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");

    const afterLine = useCadDocumentStore.getState().doc as ReturnType<typeof compileFixture>;
    expect(errorsOf(afterLine)).toEqual([]);
    useCadUiStore.setState({
      activePointPickTarget: { elementId: pointUse.id, parameterKey: "startPoint" },
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null
    });
    const pointCandidates = activePickCandidates(evaluateFixture(afterLine));
    const quotedEndpoint = pointCandidates.flatMap((candidate) => candidate.options
      .map((option) => ({ candidate, option }))
      .filter(({ option }) => option.kind === "point" &&
        option.sourceReference?.base === quotedExportBase &&
        option.sourceReference.pointKey === "start"))[0];
    expect(quotedEndpoint?.option).toBeDefined();
    if (!quotedEndpoint) return;
    expect(applyPickReference(
      pickRefForOption(quotedEndpoint.candidate.elementId, quotedEndpoint.option),
      evaluateFixture(afterLine)
    )).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain('startPoint: @"I.dot"::"Out.dot".start');
    expect(useCadDocumentStore.getState().sourceText).not.toContain("module-runtime:");
    expect(errorsOf(compileSource(useCadDocumentStore.getState().sourceText))).toEqual([]);
  });
});
