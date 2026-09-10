import type {
  CadElement,
  ComputedGeometry,
  DependencyError,
  DrawingModifierDefinition,
  ElementId,
  EvaluationResult,
  EvaluationWarning,
  ForGroupGeneratedOccurrenceStep,
  ForGroupGeneratedRow,
  GeometryMutationExecution,
  GeometryInputTarget,
  PointAnchor
} from "../types/geometry";
import type { ArcDirection } from "../types/geometry";
import {
  isConditionalGroupElement,
  isForGroupElement,
  isContainerElement
} from "../model/groups";
import {
  activityAllowsEvaluation,
  activityAllowsDrawing,
  effectiveElementActivity,
  effectiveElementActivityByRuntime,
  effectiveDrawingModifierResolutionsByRuntime,
  effectiveDrawingModifierRuntimeById,
  effectiveDrawingModifierStrokeByRuntime
} from "../model/elementActivity";
import type { EvaluationResultWithDrawingModifierInspection } from "../model/drawingModifierInspection";
import { geometryError, numericError } from "./evaluationContext";
import { evaluateElement } from "./elementEvaluators";
import {
  expandForGroupIteration,
  forGroupRangeValues,
  forGroupOwnedTemplateElements,
  forGroupTemplateDescendantIds,
  type ForGroupIterationBinding
} from "./forGroupExpansion";
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { BindingVersionGraph } from "../scalars/bindingVersions";
import { hasSetVersions } from "../scalars/linearMutationEvaluator";
import {
  createDocumentLinearScalarBindingResolver,
  createDocumentScalarBindingResolver,
  resolveDocumentGeometryProperty,
  resolveDocumentGeometryTarget
} from "./scalarProgramEvaluation";
import {
  groupPropertyBindingRuntimeEntriesByElement,
  materializePropertyBoundElement,
  type PropertyBindingRuntimeEntry
} from "./propertyBindingRuntime";
import {
  groupNumericBindingRuntimeEntriesByElement,
  materializeNumericBindingElement,
  type NumericBindingRuntimeEntry
} from "./numericBindingRuntime";
import {
  resolveConditionalGroupCondition,
  resolveForGroupEffectiveShowGenerated
} from "./controlBooleanRuntime";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { ConditionEvaluationTrace } from "../scalars/conditionEvaluationTrace";
import type { ScalarEvaluation } from "../scalars/types";
import type { TextTemplateAst } from "../scalars/textTemplate";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ForGroupMutationOwner } from "../scalars/forGroupMutationControl";
import type { ForGroupMutationStatement } from "../scalars/linearMutationEvaluator";
import { degreesToRadians, normalizeDegrees360 } from "../scalars/angleMath";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { GeometryValueProgram } from "../dsl/moduleGeometryValueProgram";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import type {
  ComputedGeometryValue,
  ComputedGeometryValueEntry,
  GeometryValueEvaluationError
} from "./evaluationTypes";
import { arcGeometryKernel, bezierBulgePointGeometryKernel, bezierExtremePointGeometryKernel, bezierGeometryKernel, commonTangentGeometryKernel, coordinateGeometryKernel, divisionPointGeometryKernel, offsetLineGeometryValueKernel, offsetPointGeometryKernel, polarLineGeometryKernel, polarPointGeometryKernel, polylineGeometryKernel, segmentGeometryKernel, tangentOffsetPointGeometryKernel, throughArcGeometryKernel, type StructuralPoint } from "./geometryValueKernels";
import { buildOffsetLineGeometry } from "./offsetPaths";
import { isLineLikeGeometryInput, pointAtDistanceFromEndpoint } from "./linePaths";
import { copyPathGeometry } from "./copyPathGeometry";
import { connectSourceSegmentGroups, sourceSegmentsForGeometry } from "./offsetSourceSegments";
import { lineLength } from "./offsetPathMath";
import { findLineIntersections } from "./lineIntersections";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import { setParameterValue } from "../parameters/parameterAccess";

export type EvaluateElementsOptions = {
  evaluationLimitIndex?: number;
  /** Bake-only evaluation escape hatch; normal evaluation leaves disabled elements unevaluated. */
  allowDisabledElementIds?: ReadonlySet<ElementId>;
  /** Compiled document-level drawing modifier definitions. */
  drawingModifiers?: readonly DrawingModifierDefinition[];
  /** Optional selected Drawing Profile; omitted means common modifier properties only. */
  selectedDrawingProfileId?: string;
  /**
   * Task 19's compiled declaration program. Task 20 evaluates it (via
   * createDocumentScalarBindingResolver) on this TS reference path only -
   * evaluateElementsWithRust calls the Rust `evaluate_document` command
   * directly && never runs this function, so Rust has no equivalent output
   * until Task 21 gives it one.
   */
  scalarProgram?: ScalarProgram;
  /** Task 30 graph; Task 31 consumes it only when it contains a linear set. */
  bindingVersions?: BindingVersionGraph;
  /** Existing compiled element ID -> source statement mapping; never inferred from element order. */
  statementInfoByElementId?: ReadonlyMap<ElementId, { statementIndex: number }>;
  /** Task 5 runtime-only source execution positions for materialized module elements. */
  sourceExecutionPositionByElementId?: ReadonlyMap<ElementId, number>;
  /** Inner scalar execution order for materialized module occurrences. */
  scalarExecutionPositionByElementId?: ReadonlyMap<ElementId, number>;
  statementIdByStatementIndex?: ReadonlyMap<number, string>;
  /** Task 33's completed static join from conditional element id to owner statement id. */
  conditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  /** Task 35's compiled stable join; never inferred from element array order. */
  forGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, ForGroupMutationOwner>;
  /** Explicit joins for materialized module control owners. */
  moduleConditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  moduleForGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, ForGroupMutationOwner>;
  moduleMaterialization?: ModuleMaterialization;
  /** Compiler-resolved read-only line/path consumer targets. */
  geometryInputTargetsByElementId?: ReadonlyMap<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>;
  /** Compiled immutable geometry values; never converted into elements. */
  geometryValueProgram?: GeometryValueProgram;
  /**
   * Schema-driven elementId-keyed property sources (already re-keyed from
   * CompiledDslDocument.propertyBindings by
   * propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries - never
   * built here). Requires `scalarProgram` to also be present; see the throw
   * below for why that combination is a caller-contract violation rather
   * than a silent no-op.
   */
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  /** General numeric parameter occurrences compiled to BindingId slots. */
  numericBindingEntries?: readonly NumericBindingRuntimeEntry[];
  /**
   * Task 25's elementId-keyed typed boolean conditions for `conditionalGroup`
   * (already re-keyed from CompiledDslDocument.conditionalGroupConditions by
   * controlBooleanRuntime.ts's buildConditionalGroupConditionsByElementId -
   * never built here). An element with no entry here uses its literal
   * `NumericValue` condition.
   */
  conditionalGroupConditionsByElementId?: ReadonlyMap<ElementId, TypedScalarExpression>;
  /**
   * Task 25's elementId-keyed `forGroup.showGenerated` bindings (already
   * re-keyed by controlBooleanRuntime.ts's buildControlBooleanRuntimeEntries).
   * Never affects iteration count/rows - presentation-only.
   */
  controlBooleanEntries?: readonly PropertyBindingRuntimeEntry[];
  /**
   * Task 27's elementId-keyed compiled TextTemplateAst (already re-keyed by
   * textTemplateRuntime.ts's buildTextTemplateEntriesByElementId - never
   * built here). Unlike every entry above, this does NOT require
   * `scalarProgram`: Task 26's compileTextTemplates runs for every nui 1
   * document regardless of typed declarations, so an all-numeric-hole
   * template can be present with no scalarProgram at all.
   */
  textTemplateEntriesByElementId?: ReadonlyMap<ElementId, TextTemplateAst>;
  /**
   * Task 27's elementId-keyed bare `@binding` `text.text` property source
   * (already re-keyed from textTemplateRuntime.ts's
   * buildTextPropertyBindingRuntimeEntries). Requires `scalarProgram`, like
   * propertyBindingEntries/controlBooleanEntries above - a bound reference
   * always implies a typed declaration exists.
   */
  textPropertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
};

const geometryMutationTargetIds = (element: CadElement): ElementId[] => {
  const targetIds = (() => {
    switch (element.type) {
      case "edge":
        return [element.endpoint1.lineId, element.endpoint2.lineId];
      case "extendTrim":
        return [element.endpoint.lineId];
      case "pathReverse":
        return [element.targetLineId];
      case "move":
      case "symmetricMove":
        return element.baseLineIds;
      default:
        return [];
    }
  })();
  return Array.from(new Set(targetIds));
};

export const evaluateElements = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationResultWithDrawingModifierInspection => {
  if (options.propertyBindingEntries?.length && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: propertyBindingEntries was given without a scalarProgram - " +
        "a caller must always derive both from the same compiled document (see " +
        "propertyBindingRuntime.ts's buildPropertyBindingRuntimeEntries), never one without the other"
    );
  }
  if (options.numericBindingEntries?.length && !options.scalarProgram) {
    throw new Error("evaluateElements: numericBindingEntries was given without a scalarProgram");
  }
  if ((options.controlBooleanEntries?.length || options.conditionalGroupConditionsByElementId?.size) && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: controlBooleanEntries/conditionalGroupConditionsByElementId was given without a " +
        "scalarProgram - a caller must always derive these from the same compiled document (see " +
        "controlBooleanRuntime.ts), never one without the other"
    );
  }
  if (options.textPropertyBindingEntries?.length && !options.scalarProgram) {
    throw new Error(
      "evaluateElements: textPropertyBindingEntries was given without a scalarProgram - " +
        "a caller must always derive both from the same compiled document (see " +
        "textTemplateRuntime.ts's buildTextPropertyBindingRuntimeEntries), never one without the other"
    );
  }
  // textTemplateEntriesByElementId deliberately has no such guard: Task 26's
  // compileTextTemplates runs for every nui 1 document regardless of typed
  // declarations, so it can be non-empty with an all-numeric-hole template
  // && no scalarProgram at all - see EvaluateElementsOptions's doc comment.

  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  const evaluatedElements = elements.slice(0, evaluationLimitIndex);
  const evaluatedElementIds = new Set(evaluatedElements.map((element) => element.id));
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const computedGeometryValues = new Map<import("../model/geometryValueOccurrence").GeometryValueOccurrenceKey, ComputedGeometryValueEntry>();
  const geometryValueErrors: GeometryValueEvaluationError[] = [];
  const preMutationGeometry = new Map<ElementId, ComputedGeometry>();
  const geometryMutationExecutions: GeometryMutationExecution[] = [];
  const instanceBaseGeometry = new Map<ElementId, ComputedGeometry[]>();
  const instanceSnapshotsByEnd = new Map<number, ModuleMaterialization["instanceBaseGeometrySnapshots"]>();
  for (const snapshot of options.moduleMaterialization?.instanceBaseGeometrySnapshots ?? []) {
    instanceSnapshotsByEnd.set(snapshot.endRuntimeIndex, [
      ...(instanceSnapshotsByEnd.get(snapshot.endRuntimeIndex) ?? []),
      snapshot
    ]);
    if (snapshot.endRuntimeIndex < evaluationLimitIndex) {
      instanceBaseGeometry.set(snapshot.instanceId, []);
    }
  }
  const errors: DependencyError[] = [];
  const warnings: EvaluationWarning[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const runtimeElementsById = new Map(elementsById);
  const runtimeElements = [...evaluatedElements];
  const drawingModifierRuntime = effectiveDrawingModifierRuntimeById(
    elements,
    options.drawingModifiers,
    options.selectedDrawingProfileId
  );
  const activities = effectiveElementActivityByRuntime(drawingModifierRuntime);
  const effectiveDrawingModifierResolutions = new Map(
    effectiveDrawingModifierResolutionsByRuntime(drawingModifierRuntime)
  );
  const effectiveDrawingModifierStrokes = new Map(
    effectiveDrawingModifierStrokeByRuntime(drawingModifierRuntime)
  );
  const effectiveVisibleIds = new Set(elements
    .filter((element) => evaluatedElementIds.has(element.id) &&
      activityAllowsDrawing(effectiveElementActivity(element, activities).activity))
    .map((element) => element.id));
  const baseEffectiveEnabledIds = new Set(elements
    .filter((element) => evaluatedElementIds.has(element.id) &&
      activityAllowsEvaluation(effectiveElementActivity(element, activities).activity))
    .map((element) => element.id));
  for (const elementId of options.allowDisabledElementIds ?? []) {
    if (evaluatedElementIds.has(elementId)) baseEffectiveEnabledIds.add(elementId);
  }
  const disabledByGroupId = new Map<ElementId, ElementId>(
    elements.flatMap((element) => {
      const disabledBy = effectiveElementActivity(element, activities).disabledByElementId;
      const disabledByElement = disabledBy ? elementsById.get(disabledBy) : undefined;
      return disabledBy && disabledByElement && isContainerElement(disabledByElement)
        ? [[element.id, disabledBy] as const]
        : [];
    })
  );
  const conditionalGroupStates = new Map<ElementId, "then" | "else" | null>();
  const conditionInactiveElementIds = new Set<ElementId>();
  const conditionEvaluationTraces = new Map<ElementId, ConditionEvaluationTrace>();
  const effectiveEnabledIds = new Set<ElementId>();
  const forGroupEffectiveShowGeneratedIds = new Set<ElementId>();
  const templateDescendantIds = forGroupTemplateDescendantIds(elements);
  const forGroupGeneratedRows: EvaluationResult["forGroupGeneratedRows"] = [];

  // Built whenever a scalarProgram is present, independent of whether any
  // property bindings exist - computedScalarBindings is Task 21's own
  // contract && must not depend on Task 23's property wiring.
  const linearMutationEnabled = options.bindingVersions !== undefined &&
    (hasSetVersions(options.bindingVersions) || options.bindingVersions.requiresExecutionOrdering === true);
  if (linearMutationEnabled && !options.statementInfoByElementId &&
    !options.sourceExecutionPositionByElementId && !options.scalarExecutionPositionByElementId) {
    throw new Error("evaluateElements: binding mutation requires compiled source execution positions");
  }
  const linearMutationResolver = linearMutationEnabled
    ? createDocumentLinearScalarBindingResolver(options.bindingVersions!, { computedGeometry, computedGeometryValues, elementsById: runtimeElementsById, activities }, options.scalarProgram?.collectionValues)
    : undefined;
  const knownConditionalMutationOwnerIds = new Set(
    options.bindingVersions?.versions.flatMap((version) => version.control.ownerChain
      .filter((owner) => owner.kind === "conditionalBranch")
      .map((owner) => owner.ownerStatementId)) ?? []
  );
  const declarationResolver = !linearMutationResolver && options.scalarProgram
    ? createDocumentScalarBindingResolver(options.scalarProgram, { computedGeometry, computedGeometryValues, elementsById: runtimeElementsById, activities })
    : undefined;
  const scalarBindingResolver = linearMutationResolver ?? declarationResolver;
  const geometryRuntime = { computedGeometry, computedGeometryValues, elementsById: runtimeElementsById, activities };
  const propertyBindingEntriesByElementId = options.propertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.propertyBindingEntries)
    : undefined;
  const numericBindingEntriesByElementId = options.numericBindingEntries
    ? groupNumericBindingRuntimeEntriesByElement(options.numericBindingEntries)
    : undefined;
  const controlBooleanEntriesByElementId = options.controlBooleanEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.controlBooleanEntries)
    : undefined;
  const conditionalGroupConditionsByElementId = options.conditionalGroupConditionsByElementId;
  const textPropertyBindingEntriesByElementId = options.textPropertyBindingEntries
    ? groupPropertyBindingRuntimeEntriesByElement(options.textPropertyBindingEntries)
    : undefined;
  const textTemplateEntriesByElementId = options.textTemplateEntriesByElementId;
  /**
   * A typed text hole can only exist when a typed declaration exists, which
   * implies `scalarProgram` exists (see EvaluateElementsOptions's doc
   * comment on textTemplateEntriesByElementId) - so this is only ever
   * called when scalarBindingResolver is defined. Throws instead of
   * silently mis-evaluating if that invariant is ever violated.
   */
  const resolveScalarBindingForText = scalarBindingResolver
    ? scalarBindingResolver.resolveBinding
    : (bindingId: BindingId) => {
        throw new Error(
          `evaluateElements: a typed text template hole referenced binding "${bindingId}" but no scalarProgram ` +
            "was provided - a typed hole implies a typed declaration, which implies a scalarProgram"
      );
      };

  const pointAnchorForGeometryInputTarget = (target: GeometryInputTarget): PointAnchor | undefined => {
    if (target.kind === "coordinate") return target.anchor;
    if (target.kind === "drawable" && target.geometryType === "point") {
      return target.pointKey
        ? { mode: "derived", elementId: target.elementId, pointKey: target.pointKey }
        : { mode: "reference", pointId: target.elementId };
    }
    if (target.kind === "geometryValue" && target.geometryType === "point") {
      return {
        mode: "geometryValue",
        occurrence: target.occurrence,
        ...(target.pointKey ? { pointKey: target.pointKey } : {})
      };
    }
    return undefined;
  };

  let activeGeometryMapBinder: Exclude<GeometryInputTarget, { kind: "collectionIndex" | "geometryValueMap" }> | null = null;
  const resolveGeometryTargetForEvaluation = (
    target: Parameters<typeof resolveDocumentGeometryTarget>[1],
    sourceOrder: number
  ): ReturnType<typeof resolveDocumentGeometryTarget> => {
    if (target.kind === "geometryValueForBinder" && activeGeometryMapBinder) {
      const source = activeGeometryMapBinder;
      if (source.kind === "drawable") {
        return resolveDocumentGeometryTarget(geometryRuntime, {
          kind: "drawable",
          statementId: source.elementId,
          statementIndex: -1,
          geometryType: source.geometryType,
          ...(source.pointKey ? { pointKey: source.pointKey } : {})
        }, sourceOrder);
      }
      if (source.kind === "geometryValue") {
        return resolveDocumentGeometryTarget(geometryRuntime, {
          kind: "geometryValue",
          occurrence: source.occurrence,
          statementId: source.occurrence.sourceStatementId,
          statementIndex: -1,
          geometryType: source.geometryType,
          ...(source.pointKey ? { pointKey: source.pointKey } : {})
        }, sourceOrder);
      }
      if (source.kind === "coordinate" && typeof source.anchor.x === "number" && typeof source.anchor.y === "number") {
        return { kind: "point" as const, x: source.anchor.x, y: source.anchor.y };
      }
      return undefined;
    }
    return resolveDocumentGeometryTarget(geometryRuntime, target, sourceOrder);
  };
  const resolveGeometryPropertyForEvaluation = (reference: Parameters<typeof resolveDocumentGeometryProperty>[1], sourceOrder: number): ScalarEvaluation => {
    if (reference.geometryValueBinderId && activeGeometryMapBinder) {
      const source = activeGeometryMapBinder;
      const rest = { ...reference, geometryValueBinderId: undefined };
      if (source.kind === "drawable") {
        return resolveDocumentGeometryProperty(geometryRuntime, { ...rest, elementId: source.elementId, geometryValueOccurrence: undefined }, sourceOrder);
      }
      if (source.kind === "geometryValue") {
        return resolveDocumentGeometryProperty(geometryRuntime, { ...rest, elementId: null, geometryValueOccurrence: source.occurrence }, sourceOrder);
      }
      const referenceType = reference.type;
      if (source.kind === "coordinate" && referenceType?.kind === "number" && (reference.property === "x" || reference.property === "y")) {
        const value = source.anchor[reference.property];
        return typeof value === "number"
          ? { status: "ok" as const, type: referenceType, value: { kind: "number" as const, value } }
          : { status: "error" as const, type: referenceType, issueCode: "evaluation-geometry-property-unavailable" };
      }
    }
    return resolveDocumentGeometryProperty(geometryRuntime, reference, sourceOrder);
  };

  const materializeGeometryInputTargets = (
    element: CadElement,
    targets: ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>,
    sourceOrder: number
  ): { element: CadElement; targets: ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]> } | null => {
    const materialized = new Map<string, GeometryInputTarget | readonly GeometryInputTarget[]>();
    let materializedElement = element;
    const isTargetList = (value: GeometryInputTarget | readonly GeometryInputTarget[]): value is readonly GeometryInputTarget[] => Array.isArray(value);
    const invalid = (target: Extract<GeometryInputTarget, { kind: "collectionIndex" }>, issueCode: string) => {
      errors.push(geometryError(
        element,
        `${element.name} の geometry collection index を評価できません。(${issueCode})`
      ));
      void target;
    };
    const materialize = (target: GeometryInputTarget): GeometryInputTarget | null => {
      if (target.kind === "geometryValueMap") {
        const previousBinder = activeGeometryMapBinder;
        activeGeometryMapBinder = target.source;
        const entry: import("../dsl/moduleGeometryValueProgram").GeometryValueProgramEntry = {
          sourceStatementId: target.occurrence.sourceStatementId,
          sourceStatementIndex: target.executionPosition,
          declaredInterfaceType: target.declaredInterfaceType,
          occurrence: target.occurrence,
          executionPosition: target.executionPosition,
          construction: target.program
        };
        evaluateGeometryValueEntry(entry);
        activeGeometryMapBinder = previousBinder;
        return {
          kind: "geometryValue",
          occurrence: target.occurrence,
          geometryType: target.geometryType,
          ...(target.pointKey ? { pointKey: target.pointKey } : {})
        };
      }
      if (target.kind !== "collectionIndex") return target;
      if (target.targetSourceOrder >= sourceOrder) {
        invalid(target, "evaluation-collection-index-unavailable");
        return null;
      }
      const evaluation = evaluateTypedExpression(target.index, {
        lookupBinding: scalarBindingResolver
          ? scalarBindingResolver.resolveBinding
          : () => ({ status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-unavailable" }),
        lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
        lookupGeometryTarget: (resolvedTarget) => resolveGeometryTargetForEvaluation(resolvedTarget, sourceOrder)
      });
      if (evaluation.status === "error") {
        invalid(target, evaluation.issueCode);
        return null;
      }
      const index = evaluation.value.kind === "number" ? evaluation.value.value : Number.NaN;
      if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0 ||
        (target.collectionLength !== null && index >= target.collectionLength)) {
        invalid(target, "evaluation-collection-index-invalid");
        return null;
      }
      const selected = target.members[index];
      if (!selected || selected.kind === "collectionIndex") {
        invalid(target, "evaluation-collection-index-invalid");
        return null;
      }
      return selected;
    };

    for (const [parameterKey, target] of targets) {
      if (isTargetList(target)) {
        const selected = target.map(materialize);
        if (selected.some((candidate) => candidate === null)) return null;
        materialized.set(parameterKey, selected as GeometryInputTarget[]);
        continue;
      }
      const selected = materialize(target);
      if (!selected) return null;
      materialized.set(parameterKey, selected);
      if (target.kind === "collectionIndex" || target.kind === "geometryValueMap") {
        const anchor = pointAnchorForGeometryInputTarget(selected);
        if (anchor) materializedElement = setParameterValue(materializedElement, parameterKey, anchor);
      }
    }
    return { element: materializedElement, targets: materialized };
  };

  const evaluateGeometryValueScalar = (expression: TypedScalarExpression, sourceOrder: number): number | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    return evaluation.status === "ok" && evaluation.value.kind === "number" ? evaluation.value.value : undefined;
  };

  const evaluateGeometryValueDirection = (expression: TypedScalarExpression, sourceOrder: number): ArcDirection | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "choice", options: [] }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    if (evaluation.status !== "ok" || evaluation.value.kind !== "choice") return undefined;
    return evaluation.value.value === "clockwise" || evaluation.value.value === "counterclockwise"
      ? evaluation.value.value
      : undefined;
  };

  const evaluateGeometryValueSide = (expression: TypedScalarExpression, sourceOrder: number): "left" | "right" | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "choice", options: [] }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    if (evaluation.status !== "ok" || evaluation.value.kind !== "choice") return undefined;
    return evaluation.value.value === "left" || evaluation.value.value === "right"
      ? evaluation.value.value
      : undefined;
  };

  const evaluateGeometryValueTangentKind = (expression: TypedScalarExpression, sourceOrder: number): "external" | "internal" | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "choice", options: [] }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    if (evaluation.status !== "ok" || evaluation.value.kind !== "choice") return undefined;
    return evaluation.value.value === "external" || evaluation.value.value === "internal"
      ? evaluation.value.value
      : undefined;
  };

  const evaluateGeometryValueCurveSide = (expression: TypedScalarExpression, sourceOrder: number): "convex" | "concave" | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "choice", options: [] }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    if (evaluation.status !== "ok" || evaluation.value.kind !== "choice") return undefined;
    return evaluation.value.value === "convex" || evaluation.value.value === "concave"
      ? evaluation.value.value
      : undefined;
  };

  const evaluateGeometryValueBoolean = (expression: TypedScalarExpression, sourceOrder: number): boolean | undefined => {
    const evaluation = evaluateTypedExpression(expression, {
      lookupBinding: scalarBindingResolver
        ? scalarBindingResolver.resolveBinding
        : () => ({ status: "error", type: { kind: "boolean" }, issueCode: "evaluation-binding-unavailable" }),
      lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
      lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
    });
    return evaluation.status === "ok" && evaluation.value.kind === "boolean" ? evaluation.value.value : undefined;
  };

  const appendGeometryValueError = (
    entry: import("../dsl/moduleGeometryValueProgram").GeometryValueProgramEntry,
    message: string
  ) => {
    geometryValueErrors.push({
      occurrence: entry.occurrence,
      message
    });
  };

  const identityFreeGeometryValue = (
    geometry: ComputedGeometry | ComputedGeometryValue
  ): ComputedGeometryValue | undefined => {
    switch (geometry.kind) {
      case "point":
        return { kind: "point", x: geometry.x, y: geometry.y };
      case "line":
        return {
          kind: "line",
          start: { x: geometry.start.x, y: geometry.start.y },
          end: { x: geometry.end.x, y: geometry.end.y },
          length: geometry.length,
          startAngleDeg: geometry.startAngleDeg,
          endAngleDeg: geometry.endAngleDeg,
          startTangentAngleDeg: geometry.startTangentAngleDeg,
          endTangentAngleDeg: geometry.endTangentAngleDeg
        };
      case "arcLine":
        return {
          kind: "arcLine",
          center: { x: geometry.center.x, y: geometry.center.y },
          start: { x: geometry.start.x, y: geometry.start.y },
          end: { x: geometry.end.x, y: geometry.end.y },
          radius: geometry.radius,
          startAngleDeg: geometry.startAngleDeg,
          endAngleDeg: geometry.endAngleDeg,
          startTangentAngleDeg: geometry.startTangentAngleDeg,
          endTangentAngleDeg: geometry.endTangentAngleDeg,
          sweepAngleDeg: geometry.sweepAngleDeg,
          length: geometry.length
        };
      case "bezierCurve":
        return {
          kind: "bezierCurve",
          segments: geometry.segments.map((segment) => ({
            start: { x: segment.start.x, y: segment.start.y },
            control1: { x: segment.control1.x, y: segment.control1.y },
            control2: { x: segment.control2.x, y: segment.control2.y },
            end: { x: segment.end.x, y: segment.end.y }
          })),
          length: geometry.length
        };
      case "polyline":
        return {
          kind: "polyline",
          segments: geometry.segments.map((segment) => ({
            start: { x: segment.start.x, y: segment.start.y },
            end: { x: segment.end.x, y: segment.end.y },
            length: segment.length
          })),
          closed: geometry.closed,
          start: { x: geometry.start.x, y: geometry.start.y },
          end: { x: geometry.end.x, y: geometry.end.y },
          length: geometry.length,
          startTangentAngleDeg: geometry.startTangentAngleDeg,
          endTangentAngleDeg: geometry.endTangentAngleDeg
        };
      case "offsetLine":
        return {
          kind: "offsetLine",
          start: geometry.start ? { x: geometry.start.x, y: geometry.start.y } : null,
          end: geometry.end ? { x: geometry.end.x, y: geometry.end.y } : null,
          segments: geometry.segments.map((segment) => {
            if (segment.kind === "line") {
              return {
                kind: "line" as const,
                start: { x: segment.start.x, y: segment.start.y },
                end: { x: segment.end.x, y: segment.end.y },
                length: segment.length
              };
            }
            if (segment.kind === "bezier") {
              return {
                kind: "bezier" as const,
                start: { x: segment.start.x, y: segment.start.y },
                control1: { x: segment.control1.x, y: segment.control1.y },
                control2: { x: segment.control2.x, y: segment.control2.y },
                end: { x: segment.end.x, y: segment.end.y },
                length: segment.length
              };
            }
            return {
              kind: "arc" as const,
              center: { x: segment.center.x, y: segment.center.y },
              start: { x: segment.start.x, y: segment.start.y },
              end: { x: segment.end.x, y: segment.end.y },
              radius: segment.radius,
              startAngleDeg: segment.startAngleDeg,
              sweepAngleDeg: segment.sweepAngleDeg,
              length: segment.length
            };
          }),
          closed: geometry.closed,
          length: geometry.length,
          startTangentAngleDeg: geometry.startTangentAngleDeg,
          endTangentAngleDeg: geometry.endTangentAngleDeg
        };
      default:
        return undefined;
    }
  };

  const structuralPointForValueTarget = (target: Parameters<typeof resolveDocumentGeometryTarget>[1], sourceOrder: number): StructuralPoint | undefined => {
    const geometry = resolveGeometryTargetForEvaluation(target, sourceOrder);
    if (!geometry || geometry.kind === "unavailable") return undefined;
    if (geometry.kind === "point") return { x: geometry.x, y: geometry.y };
    return undefined;
  };

  const structuralPointForProgramPoint = (
    point: import("../dsl/moduleGeometryValueProgram").GeometryValueProgramPoint,
    sourceOrder: number
  ): StructuralPoint | undefined => {
    if (point.kind === "coordinate") {
      const x = evaluateGeometryValueScalar(point.x, sourceOrder);
      const y = evaluateGeometryValueScalar(point.y, sourceOrder);
      return x === undefined || y === undefined ? undefined : coordinateGeometryKernel(x, y);
    }
    return structuralPointForValueTarget(point.target, sourceOrder);
  };

  const evaluateGeometryValueEntry = (entry: import("../dsl/moduleGeometryValueProgram").GeometryValueProgramEntry) => {
    const sourceOrder = entry.executionPosition;
    if (linearMutationResolver) {
      linearMutationResolver.advanceTo({ kind: "beforeStatement", sourceOrder });
    }
    if (entry.construction.kind === "reference") {
      const geometry = resolveGeometryTargetForEvaluation(entry.construction.target, sourceOrder);
      const value = geometry && geometry.kind !== "unavailable" ? identityFreeGeometryValue(geometry) : undefined;
      if (!value) {
        appendGeometryValueError(entry, "Geometry value reference is unavailable at runtime.");
        return;
      }
      computedGeometryValues.set(geometryValueOccurrenceKey(entry.occurrence), { occurrence: entry.occurrence, value });
      return;
    }
    if (entry.construction.kind === "if") {
      const condition = evaluateGeometryValueBoolean(entry.construction.condition, sourceOrder);
      if (condition === undefined) {
        appendGeometryValueError(entry, "Geometry value if condition is unavailable or not boolean.");
        return;
      }
      evaluateGeometryValueEntry({
        ...entry,
        construction: condition ? entry.construction.thenBranch : entry.construction.elseBranch
      });
      return;
    }
    if (entry.construction.kind === "match") {
      const evaluation = evaluateTypedExpression(entry.construction.scrutinee, {
        lookupBinding: scalarBindingResolver
          ? scalarBindingResolver.resolveBinding
          : () => ({ status: "error", type: { kind: "choice", options: [] }, issueCode: "evaluation-binding-unavailable" }),
        lookupGeometryProperty: (reference) => resolveGeometryPropertyForEvaluation(reference, sourceOrder),
        lookupGeometryTarget: (target) => resolveGeometryTargetForEvaluation(target, sourceOrder)
      });
      const label = evaluation.status === "ok" && evaluation.value.kind === "choice" ? evaluation.value.value : undefined;
      const arm = label === undefined ? undefined : entry.construction.arms.find((candidate) => candidate.label === label);
      if (!arm) {
        appendGeometryValueError(entry, "Geometry value match scrutinee is unavailable or has no matching case.");
        return;
      }
      evaluateGeometryValueEntry({ ...entry, construction: arm.expression });
      return;
    }
    let value: ComputedGeometryValue | undefined;
    if (entry.construction.kind === "coordinate") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const x = evaluateGeometryValueScalar(entry.construction.x, sourceOrder);
      const y = evaluateGeometryValueScalar(entry.construction.y, sourceOrder);
      if (x !== undefined && y !== undefined) {
        value = { kind: "point", ...coordinateGeometryKernel(x, y) };
      }
    } else if (entry.construction.kind === "offsetPoint") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const from = structuralPointForProgramPoint(entry.construction.from, sourceOrder);
      const dx = evaluateGeometryValueScalar(entry.construction.dx, sourceOrder);
      const dy = evaluateGeometryValueScalar(entry.construction.dy, sourceOrder);
      if (from && dx !== undefined && dy !== undefined) {
        value = { kind: "point", ...offsetPointGeometryKernel(from, dx, dy) };
      }
    } else if (entry.construction.kind === "polarPoint") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const from = structuralPointForProgramPoint(entry.construction.from, sourceOrder);
      const angleDeg = evaluateGeometryValueScalar(entry.construction.angleDeg, sourceOrder);
      const distance = evaluateGeometryValueScalar(entry.construction.distance, sourceOrder);
      if (from && angleDeg !== undefined && distance !== undefined) {
        value = { kind: "point", ...polarPointGeometryKernel(from, angleDeg, distance) };
      }
    } else if (entry.construction.kind === "between") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const start = structuralPointForProgramPoint(entry.construction.start, sourceOrder);
      const end = structuralPointForProgramPoint(entry.construction.end, sourceOrder);
      const placementValue = evaluateGeometryValueScalar(entry.construction.placement.value, sourceOrder);
      if (start && end && placementValue !== undefined) {
        const point = divisionPointGeometryKernel(start, end, {
          kind: entry.construction.placement.kind,
          value: placementValue
        });
        if (!point) {
          appendGeometryValueError(entry, "between construction cannot determine a distance direction because its endpoints coincide.");
          return;
        }
        value = { kind: "point", ...point };
      }
    } else if (entry.construction.kind === "onLine") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const geometry = resolveGeometryTargetForEvaluation(entry.construction.line.target, sourceOrder);
      const line = geometry && geometry.kind !== "unavailable" && isLineLikeGeometryInput(geometry) ? geometry : undefined;
      const placementValue = evaluateGeometryValueScalar(entry.construction.placement.value, sourceOrder);
      if (!line || placementValue === undefined) {
        appendGeometryValueError(entry, "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.");
        return;
      }
      const distanceFromEndpoint = entry.construction.placement.kind === "distance"
        ? placementValue
        : line.length * placementValue;
      const point = pointAtDistanceFromEndpoint(line, entry.construction.endpointKey, distanceFromEndpoint);
      if (!point) {
        appendGeometryValueError(entry, "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry.");
        return;
      }
      value = { kind: "point", ...point };
    } else if (entry.construction.kind === "intersection") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const line1Target = entry.construction.line1.target;
      const line2Target = entry.construction.line2.target;
      const sameSource = line1Target.kind === "geometryValue" || line2Target.kind === "geometryValue"
        ? line1Target.kind === "geometryValue" && line2Target.kind === "geometryValue" &&
          line1Target.occurrence.sourceStatementId === line2Target.occurrence.sourceStatementId &&
          line1Target.occurrence.instancePath.length === line2Target.occurrence.instancePath.length &&
          line1Target.occurrence.instancePath.every((part, index) => part === line2Target.occurrence.instancePath[index])
        : line1Target.statementId === line2Target.statementId;
      if (sameSource) {
        appendGeometryValueError(entry, "intersection geometry value cannot intersect the same source geometry twice.");
        return;
      }
      const geometry1 = resolveGeometryTargetForEvaluation(line1Target, sourceOrder);
      const geometry2 = resolveGeometryTargetForEvaluation(line2Target, sourceOrder);
      const line1 = geometry1 && geometry1.kind !== "unavailable" && isLineLikeGeometryInput(geometry1) ? geometry1 : undefined;
      const line2 = geometry2 && geometry2.kind !== "unavailable" && isLineLikeGeometryInput(geometry2) ? geometry2 : undefined;
      if (!line1 || !line2) {
        appendGeometryValueError(entry, "intersection geometry value inputs are unavailable or invalid.");
        return;
      }
      const intersectionIndex = evaluateGeometryValueScalar(entry.construction.index, sourceOrder);
      if (intersectionIndex === undefined || !Number.isFinite(intersectionIndex) || !Number.isInteger(intersectionIndex) || intersectionIndex < 0) {
        appendGeometryValueError(entry, "intersection geometry value index must be a finite non-negative integer.");
        return;
      }
      const useExtensions = evaluateGeometryValueBoolean(entry.construction.extensions, sourceOrder);
      if (useExtensions === undefined) {
        appendGeometryValueError(entry, "intersection geometry value extensions must be boolean.");
        return;
      }
      const result = findLineIntersections(line1, line2, { useExtensions });
      if (result.error) {
        appendGeometryValueError(entry, result.error);
        return;
      }
      const intersection = result.intersections[intersectionIndex];
      if (!intersection) {
        appendGeometryValueError(
          entry,
          result.intersections.length === 0
            ? "intersection geometry value could not find an intersection between the referenced geometry inputs. Check line1, line2, or extensions."
            : `intersection geometry value index ${intersectionIndex} is unavailable. There are ${result.intersections.length} intersections.`
        );
        return;
      }
      value = { kind: "point", x: intersection.x, y: intersection.y };
    } else if (entry.construction.kind === "commonTangent") {
      if (entry.declaredInterfaceType !== "line" && entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const firstGeometry = resolveGeometryTargetForEvaluation(entry.construction.first.target, sourceOrder);
      const secondGeometry = resolveGeometryTargetForEvaluation(entry.construction.second.target, sourceOrder);
      const firstArc = firstGeometry && firstGeometry.kind !== "unavailable" && firstGeometry.kind === "arcLine"
        ? firstGeometry
        : undefined;
      const secondArc = secondGeometry && secondGeometry.kind !== "unavailable" && secondGeometry.kind === "arcLine"
        ? secondGeometry
        : undefined;
      if (!firstArc) appendGeometryValueError(entry, "first に円弧が指定されていません。共通接線には円弧を指定してください。");
      if (!secondArc) appendGeometryValueError(entry, "second に円弧が指定されていません。共通接線には円弧を指定してください。");
      if (!firstArc || !secondArc) return;
      const tangentKind = evaluateGeometryValueTangentKind(entry.construction.tangentKind, sourceOrder);
      if (!tangentKind) {
        appendGeometryValueError(entry, "commonTangent geometry value kind must be external or internal.");
        return;
      }
      const side = evaluateGeometryValueSide(entry.construction.side, sourceOrder);
      if (!side) {
        appendGeometryValueError(entry, "commonTangent geometry value side must be left or right.");
        return;
      }
      const result = commonTangentGeometryKernel(firstArc, secondArc, tangentKind, side);
      if ("errors" in result) {
        for (const message of result.errors) appendGeometryValueError(entry, message);
        return;
      }
      value = result.line;
    } else if (entry.construction.kind === "tangentOffset") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const geometry = resolveGeometryTargetForEvaluation(entry.construction.line.target, sourceOrder);
      const line = geometry && geometry.kind !== "unavailable" && isLineLikeGeometryInput(geometry) ? geometry : undefined;
      const base = structuralPointForProgramPoint(entry.construction.base, sourceOrder);
      const distance = evaluateGeometryValueScalar(entry.construction.distance, sourceOrder);
      if (!line || !base || distance === undefined) {
        appendGeometryValueError(entry, "tangentOffset geometry value inputs are unavailable or invalid.");
        return;
      }
      const curveSide = entry.construction.curveSide
        ? evaluateGeometryValueCurveSide(entry.construction.curveSide, sourceOrder)
        : undefined;
      if (entry.construction.curveSide && curveSide === undefined) {
        appendGeometryValueError(entry, "tangentOffset geometry value curveSide must be convex or concave.");
        return;
      }
      const angleDeg = entry.construction.angleDeg
        ? evaluateGeometryValueScalar(entry.construction.angleDeg, sourceOrder)
        : undefined;
      if (!entry.construction.curveSide && angleDeg === undefined) {
        appendGeometryValueError(entry, "tangentOffset geometry value angle must be a finite number.");
        return;
      }
      const result = tangentOffsetPointGeometryKernel(
        line,
        base,
        curveSide !== undefined
          ? { kind: "curveSide", curveSide }
          : { kind: "angle", angleDeg: angleDeg ?? 0 },
        distance
      );
      if ("error" in result) {
        appendGeometryValueError(entry, `tangentOffset geometry value ${result.error}`);
        return;
      }
      value = { kind: "point", ...result.point };
    } else if (entry.construction.kind === "bezierExtremePoint") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const geometry = resolveGeometryTargetForEvaluation(entry.construction.source.target, sourceOrder);
      if (!geometry || geometry.kind === "unavailable" || geometry.kind !== "bezierCurve") {
        appendGeometryValueError(entry, "Bezier feature-point construction requires a computed Bezier curve source.");
        return;
      }
      const segmentIndex = evaluateGeometryValueScalar(entry.construction.segmentIndex, sourceOrder);
      if (segmentIndex === undefined || !Number.isFinite(segmentIndex)) {
        appendGeometryValueError(entry, "bezierExtremePoint segmentIndex must be a finite number.");
        return;
      }
      if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
        appendGeometryValueError(entry, "bezierExtremePoint segmentIndex must be a non-negative integer.");
        return;
      }
      if (segmentIndex >= geometry.segments.length) {
        appendGeometryValueError(entry, `bezierExtremePoint segmentIndex ${segmentIndex} is outside the source Bezier segment range (${geometry.segments.length} segments).`);
        return;
      }
      const directionDeg = evaluateGeometryValueScalar(entry.construction.direction, sourceOrder);
      if (directionDeg === undefined || !Number.isFinite(directionDeg)) {
        appendGeometryValueError(entry, "bezierExtremePoint direction must be a finite number.");
        return;
      }
      const directionRad = degreesToRadians(normalizeDegrees360(directionDeg));
      const point = bezierExtremePointGeometryKernel(geometry.segments[segmentIndex], {
        x: Math.cos(directionRad),
        y: Math.sin(directionRad)
      });
      value = { kind: "point", ...point };
    } else if (entry.construction.kind === "bezierBulgePoint") {
      if (entry.declaredInterfaceType !== "point") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const geometry = resolveGeometryTargetForEvaluation(entry.construction.source.target, sourceOrder);
      if (!geometry || geometry.kind === "unavailable" || geometry.kind !== "bezierCurve") {
        appendGeometryValueError(entry, "Bezier feature-point construction requires a computed Bezier curve source.");
        return;
      }
      const segmentIndex = evaluateGeometryValueScalar(entry.construction.segmentIndex, sourceOrder);
      if (segmentIndex === undefined || !Number.isFinite(segmentIndex)) {
        appendGeometryValueError(entry, "bezierBulgePoint segmentIndex must be a finite number.");
        return;
      }
      if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
        appendGeometryValueError(entry, "bezierBulgePoint segmentIndex must be a non-negative integer.");
        return;
      }
      if (segmentIndex >= geometry.segments.length) {
        appendGeometryValueError(entry, `bezierBulgePoint segmentIndex ${segmentIndex} is outside the source Bezier segment range (${geometry.segments.length} segments).`);
        return;
      }
      const point = bezierBulgePointGeometryKernel(geometry.segments[segmentIndex]);
      if (!point) {
        appendGeometryValueError(entry, "bezierBulgePoint selected segment has coincident endpoints, so its bulge chord is undefined.");
        return;
      }
      value = { kind: "point", ...point };
    } else if (entry.construction.kind === "segment") {
      if (entry.declaredInterfaceType !== "line" && entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const start = structuralPointForProgramPoint(entry.construction.start, sourceOrder);
      const end = structuralPointForProgramPoint(entry.construction.end, sourceOrder);
      if (start && end) {
        value = segmentGeometryKernel(start, end);
      }
    } else if (entry.construction.kind === "polarLine") {
      if (entry.declaredInterfaceType !== "line" && entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const start = structuralPointForProgramPoint(entry.construction.start, sourceOrder);
      const angleDeg = evaluateGeometryValueScalar(entry.construction.angleDeg, sourceOrder);
      const length = evaluateGeometryValueScalar(entry.construction.length, sourceOrder);
      if (start && angleDeg !== undefined && length !== undefined) {
        value = polarLineGeometryKernel(start, angleDeg, length);
      }
    } else if (entry.construction.kind === "arc") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const center = structuralPointForProgramPoint(entry.construction.center, sourceOrder);
      const radius = evaluateGeometryValueScalar(entry.construction.radius, sourceOrder);
      const startAngleDeg = evaluateGeometryValueScalar(entry.construction.startAngleDeg, sourceOrder);
      const endAngleDeg = evaluateGeometryValueScalar(entry.construction.endAngleDeg, sourceOrder);
      const direction = evaluateGeometryValueDirection(entry.construction.direction, sourceOrder);
      if (center && radius !== undefined && startAngleDeg !== undefined && endAngleDeg !== undefined && direction) {
        if (!(radius > 0)) {
          appendGeometryValueError(entry, "円弧の半径は0より大きい値で指定してください。");
          return;
        }
        value = arcGeometryKernel(center, radius, startAngleDeg, endAngleDeg, direction);
      }
    } else if (entry.construction.kind === "through") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const point1 = structuralPointForProgramPoint(entry.construction.point1, sourceOrder);
      const point2 = structuralPointForProgramPoint(entry.construction.point2, sourceOrder);
      const point3 = structuralPointForProgramPoint(entry.construction.point3, sourceOrder);
      const startAngleDeg = evaluateGeometryValueScalar(entry.construction.startAngleDeg, sourceOrder);
      const endAngleDeg = evaluateGeometryValueScalar(entry.construction.endAngleDeg, sourceOrder);
      if (point1 && point2 && point3 && startAngleDeg !== undefined && endAngleDeg !== undefined) {
        const throughValue = throughArcGeometryKernel(point1, point2, point3, startAngleDeg, endAngleDeg);
        if (!throughValue) {
          appendGeometryValueError(entry, "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。");
          return;
        }
        value = throughValue;
      }
    } else if (entry.construction.kind === "bezier") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const start = structuralPointForProgramPoint(entry.construction.start, sourceOrder);
      const end = structuralPointForProgramPoint(entry.construction.end, sourceOrder);
      const startAngleDeg = evaluateGeometryValueScalar(entry.construction.startAngleDeg, sourceOrder);
      const startLength = evaluateGeometryValueScalar(entry.construction.startLength, sourceOrder);
      const endAngleDeg = evaluateGeometryValueScalar(entry.construction.endAngleDeg, sourceOrder);
      const endLength = evaluateGeometryValueScalar(entry.construction.endLength, sourceOrder);
      const intermediates = entry.construction.intermediates.map((intermediate) => ({
        point: structuralPointForProgramPoint(intermediate.point, sourceOrder),
        angleDeg: evaluateGeometryValueScalar(intermediate.angleDeg, sourceOrder),
        incomingLength: evaluateGeometryValueScalar(intermediate.incomingLength, sourceOrder),
        outgoingLength: evaluateGeometryValueScalar(intermediate.outgoingLength, sourceOrder)
      }));
      if (
        !start || !end ||
        startAngleDeg === undefined || startLength === undefined ||
        endAngleDeg === undefined || endLength === undefined ||
        intermediates.some((intermediate) =>
          !intermediate.point ||
          intermediate.angleDeg === undefined ||
          intermediate.incomingLength === undefined ||
          intermediate.outgoingLength === undefined
        )
      ) {
        appendGeometryValueError(entry, "Bezier geometry value construction inputs are unavailable or invalid.");
        return;
      }
      const bezierValue = bezierGeometryKernel(
        start,
        end,
        startAngleDeg,
        startLength,
        endAngleDeg,
        endLength,
        intermediates.map((intermediate) => ({
          point: intermediate.point!,
          angleDeg: intermediate.angleDeg!,
          incomingLength: intermediate.incomingLength!,
          outgoingLength: intermediate.outgoingLength!
        }))
      );
      if (!bezierValue) {
        appendGeometryValueError(entry, "Bezier geometry value construction inputs are unavailable or invalid.");
        return;
      }
      value = bezierValue;
    } else if (entry.construction.kind === "polyline") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const closed = evaluateGeometryValueBoolean(entry.construction.closed, sourceOrder);
      const points = entry.construction.points.map((point) => structuralPointForProgramPoint(point, sourceOrder));
      if (closed === undefined || points.some((point) => !point)) {
        appendGeometryValueError(entry, "Polyline geometry value construction inputs are unavailable or invalid.");
        return;
      }
      const polylineValue = polylineGeometryKernel(points as StructuralPoint[], closed);
      if (!polylineValue) {
        appendGeometryValueError(entry, `Polyline geometry value construction requires at least ${closed ? 3 : 2} finite points.`);
        return;
      }
      value = polylineValue;
    } else if (entry.construction.kind === "transformCopy") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const startPoint = structuralPointForProgramPoint(entry.construction.startPoint, sourceOrder);
      const endPoint = structuralPointForProgramPoint(entry.construction.endPoint, sourceOrder);
      const scale = evaluateGeometryValueScalar(entry.construction.scale, sourceOrder);
      const angleDeg = evaluateGeometryValueScalar(entry.construction.angleDeg, sourceOrder);
      const mirrorX = evaluateGeometryValueBoolean(entry.construction.mirrorX, sourceOrder);
      if (!startPoint || !endPoint || scale === undefined || angleDeg === undefined || mirrorX === undefined) {
        appendGeometryValueError(entry, "transformCopy geometry value construction inputs are unavailable or invalid.");
        return;
      }
      if (scale <= 0) {
        appendGeometryValueError(entry, "transformCopy geometry value construction scale must be a finite positive number.");
        return;
      }
      const sourceGroups = entry.construction.baseLines.map((source) => {
        const geometry = resolveGeometryTargetForEvaluation(source.target, sourceOrder);
        if (!geometry || geometry.kind === "unavailable" || !isLineLikeGeometryInput(geometry)) return undefined;
        const segments = sourceSegmentsForGeometry(geometry);
        return segments.length > 0 ? segments : undefined;
      });
      if (sourceGroups.length === 0 || sourceGroups.some((group) => !group)) {
        appendGeometryValueError(entry, "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments.");
        return;
      }
      const sourceSegments = connectSourceSegmentGroups(sourceGroups as Array<import("./offsetPathTypes").SourceSegment[]>, false);
      if (!sourceSegments) {
        appendGeometryValueError(entry, "transformCopy geometry value construction baseLines are not continuous in the specified order.");
        return;
      }
      value = copyPathGeometry(sourceSegments, {
        kind: "transform",
        startPoint,
        endPoint,
        scale,
        angleDeg,
        mirrorX
      }) ?? undefined;
      if (!value) appendGeometryValueError(entry, "transformCopy geometry value construction produced no transformed segments.");
    } else if (entry.construction.kind === "mirrorCopy") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const axis1 = structuralPointForProgramPoint(entry.construction.axis1, sourceOrder);
      const axis2 = structuralPointForProgramPoint(entry.construction.axis2, sourceOrder);
      if (!axis1 || !axis2) {
        appendGeometryValueError(entry, "mirrorCopy geometry value construction axis points are unavailable or invalid.");
        return;
      }
      if (lineLength(axis1, axis2) <= 1e-9) {
        appendGeometryValueError(entry, "mirrorCopy geometry value construction requires two distinct axis points.");
        return;
      }
      const sourceGroups = entry.construction.baseLines.map((source) => {
        const geometry = resolveGeometryTargetForEvaluation(source.target, sourceOrder);
        if (!geometry || geometry.kind === "unavailable" || !isLineLikeGeometryInput(geometry)) return undefined;
        const segments = sourceSegmentsForGeometry(geometry);
        return segments.length > 0 ? segments : undefined;
      });
      if (sourceGroups.length === 0 || sourceGroups.some((group) => !group)) {
        appendGeometryValueError(entry, "mirrorCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments.");
        return;
      }
      const sourceSegments = connectSourceSegmentGroups(sourceGroups as Array<import("./offsetPathTypes").SourceSegment[]>, false);
      if (!sourceSegments) {
        appendGeometryValueError(entry, "mirrorCopy geometry value construction baseLines are not continuous in the specified order.");
        return;
      }
      value = copyPathGeometry(sourceSegments, { kind: "mirror", axis1, axis2 }) ?? undefined;
      if (!value) appendGeometryValueError(entry, "mirrorCopy geometry value construction produced no transformed segments.");
    } else if (entry.construction.kind === "offsetPath") {
      if (entry.declaredInterfaceType !== "path") {
        appendGeometryValueError(entry, "Geometry value construction is incompatible with its declared interface type.");
        return;
      }
      const distance = evaluateGeometryValueScalar(entry.construction.distance, sourceOrder);
      const side = evaluateGeometryValueSide(entry.construction.side, sourceOrder);
      const closed = evaluateGeometryValueBoolean(entry.construction.closed, sourceOrder);
      const suppressTrimWarnings = evaluateGeometryValueBoolean(entry.construction.suppressTrimWarnings, sourceOrder);
      const sources = entry.construction.sources.map((source) => {
        const geometry = resolveGeometryTargetForEvaluation(source.target, sourceOrder);
        return geometry && geometry.kind !== "unavailable" && isLineLikeGeometryInput(geometry) ? geometry : undefined;
      });
      if (
        distance === undefined || side === undefined || closed === undefined || suppressTrimWarnings === undefined ||
        sources.some((source) => !source)
      ) {
        appendGeometryValueError(entry, "Offset geometry value construction inputs are unavailable or invalid.");
        return;
      }
      const result = buildOffsetLineGeometry({
        elementId: "",
        name: "geometry value",
        baseLineIds: [],
        baseGeometries: sources as Array<ComputedGeometry | ComputedGeometryValue>,
        offset: side === "right" ? distance : -distance,
        closed,
        suppressTrimWarnings
      });
      if (result.error) {
        appendGeometryValueError(entry, result.error);
        return;
      }
      if (result.geometry) value = offsetLineGeometryValueKernel(result.geometry);
    }
    if (value) {
      computedGeometryValues.set(geometryValueOccurrenceKey(entry.occurrence), { occurrence: entry.occurrence, value });
    }
  };

  const geometryValueProgram = options.geometryValueProgram ?? [];
  let nextGeometryValueIndex = 0;
  const evaluateGeometryValuesThrough = (sourceOrder: number) => {
    while (nextGeometryValueIndex < geometryValueProgram.length &&
      geometryValueProgram[nextGeometryValueIndex]!.executionPosition <= sourceOrder) {
      const entry = geometryValueProgram[nextGeometryValueIndex]!;
      if (!entry.lazy) evaluateGeometryValueEntry(entry);
      nextGeometryValueIndex += 1;
    }
  };

  const advanceLinearBindingsBefore = (element: CadElement, sourceElement?: CadElement) => {
    if (!linearMutationEnabled) return;
    const sourceId = (sourceElement ?? element).id;
    const statement = options.statementInfoByElementId?.get(sourceId);
    const sourceOrder = options.scalarExecutionPositionByElementId?.get(sourceId) ??
      options.scalarExecutionPositionByElementId?.get(element.id) ??
      statement?.statementIndex ?? options.sourceExecutionPositionByElementId?.get(element.id);
    if (sourceOrder === undefined) {
      throw new Error(
        `evaluateElements: no compiled source execution position for ${sourceId}`
      );
    }
    // `beforeStatement` deliberately excludes a set on this same source line.
    linearMutationResolver!.advanceTo({ kind: "beforeStatement", sourceOrder });
  };

  const pushGeneratedVisibilityState = (
    generatedElement: CadElement,
    templateElement: CadElement,
    showGenerated: boolean,
    forGroupElement: CadElement
  ) => {
    if (
      showGenerated &&
      effectiveVisibleIds.has(forGroupElement.id) &&
      effectiveVisibleIds.has(templateElement.id)
    ) {
      effectiveVisibleIds.add(generatedElement.id);
    }
    if (baseEffectiveEnabledIds.has(templateElement.id)) {
      effectiveEnabledIds.add(generatedElement.id);
    }
  };

  const forGroupRangeError = (
    element: CadElement,
    error: Exclude<ReturnType<typeof forGroupRangeValues>, { values: number[] }>["error"]
  ) => {
    const message = (() => {
      switch (error) {
        case "non-finite-min": return `${element.name} の min は有限の値にしてください。`;
        case "non-finite-max": return `${element.name} の max は有限の値にしてください。`;
        case "non-finite-step": return `${element.name} の step は有限の値にしてください。`;
        case "min-greater-than-max": return `${element.name} の min は max 以下にしてください。`;
        case "non-positive-step": return `${element.name} の step は0より大きい値にしてください。`;
        case "iteration-limit": return `${element.name} の範囲は1000回以下にしてください。`;
      }
    })();
    errors.push({
      elementId: element.id,
      elementName: element.name,
      missingDependencyId: element.id,
      missingDependencyName: element.name,
      message
    });
  };

  const inactiveConditionalGroupId = (element: CadElement) => {
    let child = element;
    let parentId = child.parentGroupId;
    const visited = new Set<ElementId>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = runtimeElementsById.get(parentId);
      if (!parent) return null;
      if (isConditionalGroupElement(parent)) {
        const activeBranch = conditionalGroupStates.get(parent.id);
        const branch = child.conditionalBranch ?? "then";
        if (activeBranch !== branch) return parent.id;
      }
      child = parent;
      parentId = parent.parentGroupId;
    }
    return null;
  };

  const iterationLocalVariables = (bindings: readonly ForGroupIterationBinding[]) => {
    const localVariableValues = new Map<string, number>();
    const localVariableNames = new Map<string, string>();
    for (const binding of bindings) {
      localVariableNames.set(binding.id, binding.name);
      localVariableNames.set(binding.name, binding.name);
      localVariableValues.set(binding.id, binding.value);
      localVariableValues.set(binding.name, binding.value);
    }
    return { localVariableValues, localVariableNames };
  };

  const evaluateRuntimeElement = (
    element: CadElement,
    sourceElement?: CadElement,
    ancestorIterationVariables: ForGroupIterationBinding[] = [],
    ancestorElementIdMap: ReadonlyMap<ElementId, ElementId> = new Map(),
    ancestorOccurrencePath: readonly ForGroupGeneratedOccurrenceStep[] = []
  ) => {
    advanceLinearBindingsBefore(element, sourceElement);
    const inactiveGroupId = inactiveConditionalGroupId(element);
    if (inactiveGroupId) {
      conditionInactiveElementIds.add(element.id);
      disabledByGroupId.set(element.id, inactiveGroupId);
      return;
    }

    const enabled = sourceElement
      ? baseEffectiveEnabledIds.has(sourceElement.id)
      : baseEffectiveEnabledIds.has(element.id);
    if (!enabled) {
      return;
    }
    effectiveEnabledIds.add(element.id);

    const sourceElementId = (sourceElement ?? element).id;
    const sourceOrder = options.statementInfoByElementId?.get(sourceElementId)?.statementIndex ??
      options.scalarExecutionPositionByElementId?.get(sourceElementId) ??
      options.scalarExecutionPositionByElementId?.get(element.id) ??
      options.sourceExecutionPositionByElementId?.get(sourceElementId) ??
      options.sourceExecutionPositionByElementId?.get(element.id) ??
      Number.POSITIVE_INFINITY;
    const resolveScalarGeometryProperty = (
      reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>
    ): ScalarEvaluation => resolveGeometryPropertyForEvaluation(reference, sourceOrder);

    const numericEntriesForElement = numericBindingEntriesByElementId?.get((sourceElement ?? element).id);
    if (numericEntriesForElement?.length) {
      const numericSourceId = (sourceElement ?? element).id;
      const numericSourceOrder = options.scalarExecutionPositionByElementId?.get(numericSourceId) ??
        options.scalarExecutionPositionByElementId?.get(element.id) ??
        options.statementInfoByElementId?.get(numericSourceId)?.statementIndex ??
        options.sourceExecutionPositionByElementId?.get(element.id);
      const materialized = materializeNumericBindingElement(
        element,
        numericEntriesForElement,
        scalarBindingResolver!.resolveBinding,
        resolveScalarGeometryProperty,
        numericSourceOrder === undefined
          ? undefined
          : (target) => resolveDocumentGeometryTarget(
              geometryRuntime,
              target,
              numericSourceOrder
            )
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      element = materialized.element;
      runtimeElementsById.set(element.id, element);
    }

    const localVariables = iterationLocalVariables(ancestorIterationVariables);

    if (isConditionalGroupElement(element)) {
      // Bound typed conditions live on the template statement/element, not
      // on a forGroup-generated clone's own synthetic id - look up by the
      // template id (sourceElement) exactly like bound properties below, so
      // a conditionalGroup written inside a forGroup template resolves the
      // same active branch on every generated iteration.
      const typedCondition = conditionalGroupConditionsByElementId?.get((sourceElement ?? element).id);
      const resolvedTypedCondition = typedCondition
        ? resolveConditionalGroupCondition(
            typedCondition,
            scalarBindingResolver!.resolveBinding,
            resolveScalarGeometryProperty
          )
        : undefined;
      if (resolvedTypedCondition) conditionEvaluationTraces.set(element.id, resolvedTypedCondition.trace);
      const activeBranch = resolvedTypedCondition
        ? resolvedTypedCondition.activeBranch
        : (() => {
            const conditionValue = numericError(
              element,
              element.condition,
              computedGeometry,
              runtimeElementsById,
              errors,
              localVariables.localVariableValues,
              localVariables.localVariableNames,
              disabledByGroupId,
              runtimeElements
            );
            return conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then";
          })();
      conditionalGroupStates.set(element.id, activeBranch);
      const ownerStatementId = options.conditionalOwnerStatementIdByElementId?.get((sourceElement ?? element).id);
      // A module conditional may guard geometry-only output and therefore have
      // no scalar version in the linear mutation graph. Its branch state still
      // controls descendant evaluation, but it has no mutation frame to
      // register.
      if (ownerStatementId && knownConditionalMutationOwnerIds.has(ownerStatementId)) {
        linearMutationResolver!.registerConditionalResult(ownerStatementId, activeBranch);
      }
      return;
    }

    if (isForGroupElement(element)) {
      const min = numericError(
        element,
        element.min,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        runtimeElements
      );
      const max = numericError(
        element,
        element.max,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        runtimeElements
      );
      const step = numericError(
        element,
        element.step,
        computedGeometry,
        runtimeElementsById,
        errors,
        localVariables.localVariableValues,
        localVariables.localVariableNames,
        disabledByGroupId,
        runtimeElements
      );
      if (min === undefined || max === undefined || step === undefined) return;
      const range = forGroupRangeValues(min, max, step);
      if ("error" in range) {
        forGroupRangeError(element, range.error);
        return;
      }
      const iterationValues = range.values;

      // Evaluated once per forGroup entry, alongside min/max/step -
      // never re-evaluated per iteration. Presentation-only: never gates ||
      // alters the iteration loop below.
      const showGeneratedEntry = controlBooleanEntriesByElementId?.get((sourceElement ?? element).id)?.[0];
      const effectiveShowGenerated = showGeneratedEntry
        ? resolveForGroupEffectiveShowGenerated(
            showGeneratedEntry,
            element.showGenerated,
            scalarBindingResolver!.resolveBinding,
            resolveScalarGeometryProperty
          )
        : element.showGenerated;
      if (effectiveShowGenerated) forGroupEffectiveShowGeneratedIds.add(element.id);

      const mutationOwner = options.forGroupMutationOwnerByElementId?.get((sourceElement ?? element).id);
      if (linearMutationResolver && mutationOwner) {
        if (!options.statementInfoByElementId) {
          throw new Error("evaluateElements: forGroup mutation requires compiled generated statement mapping");
        }
        const templates = forGroupOwnedTemplateElements(elements, (sourceElement ?? element).id);
        const ownedTemplateIds = new Set(templates.map((templateElement) => templateElement.id));
        const statements: ForGroupMutationStatement[] = templates.map((templateElement) => {
          const statement = options.statementInfoByElementId!.get(templateElement.id);
          const sourceOrder = options.scalarExecutionPositionByElementId?.get(templateElement.id) ?? statement?.statementIndex;
          if (sourceOrder === undefined) throw new Error(`evaluateElements: no compiled execution mapping for forGroup template ${templateElement.id}`);
          return { kind: "element" as const, sourceOrder, templateElementId: templateElement.id };
        });
        statements.push({ kind: "exit", sourceOrder: mutationOwner.exitSourceOrder });
        let expandedIteration = -1;
        let generatedByTemplateId = new Map<ElementId, CadElement>();
        let rowByTemplateId = new Map<ElementId, ForGroupGeneratedRow>();
        let childAncestorIterationVariables: ForGroupIterationBinding[] = ancestorIterationVariables;
        let childAncestorElementIdMap: Map<ElementId, ElementId> = new Map(ancestorElementIdMap);
        let childAncestorOccurrencePath: readonly ForGroupGeneratedOccurrenceStep[] = ancestorOccurrencePath;
        const outcome = linearMutationResolver.runForGroup({
          ownerStatementId: mutationOwner.ownerStatementId,
          loopScopeId: mutationOwner.scopeId,
          // This is the compiler's established iteration binding identity.
          iterationBindingId: mutationOwner.iterationBindingId ?? `binding:iteration:${mutationOwner.ownerStatementId}`,
          iterationValues,
          statements
        }, (statement, context) => {
          if (options.bindingVersions!.evaluationLimitSourceOrder !== undefined &&
            statement.sourceOrder >= options.bindingVersions!.evaluationLimitSourceOrder) return "stopped";
          if (statement.kind === "exit") return "completed";
          if (expandedIteration !== context.iterationIndex) {
            expandedIteration = context.iterationIndex;
            generatedByTemplateId = new Map();
            rowByTemplateId = new Map();
            const expanded = expandForGroupIteration({
              elements,
              forGroup: element,
              templateForGroupId: sourceElement?.id,
              iterationIndex: context.iterationIndex,
              variableValue: context.iterationValue,
              ancestorElementIdMap,
              ancestorOccurrencePath
            });
            childAncestorIterationVariables = [...ancestorIterationVariables, expanded.iterationVariable];
            childAncestorElementIdMap = new Map(ancestorElementIdMap);
            childAncestorOccurrencePath = expanded.occurrencePath;
            for (const generatedElement of expanded.generatedElements) {
              const templateElementId = expanded.templateElementIdByGeneratedId.get(generatedElement.id);
              if (templateElementId && ownedTemplateIds.has(templateElementId)) {
                generatedByTemplateId.set(templateElementId, generatedElement);
                childAncestorElementIdMap.set(templateElementId, generatedElement.id);
              }
            }
            for (const row of expanded.rows) {
              if (ownedTemplateIds.has(row.templateElementId)) rowByTemplateId.set(row.templateElementId, row);
            }
          }
          const generatedElement = generatedByTemplateId.get(statement.templateElementId!);
          const templateElement = elementsById.get(statement.templateElementId!);
          if (!generatedElement || !templateElement) return "completed";
          const row = rowByTemplateId.get(templateElement.id);
          if (row) forGroupGeneratedRows.push(row);
          runtimeElements.push(generatedElement);
          runtimeElementsById.set(generatedElement.id, generatedElement);
          pushGeneratedVisibilityState(generatedElement, templateElement, effectiveShowGenerated, element);
          evaluateRuntimeElement(
            generatedElement,
            templateElement,
            childAncestorIterationVariables,
            childAncestorElementIdMap,
            childAncestorOccurrencePath
          );
          return "completed";
        });
        if (outcome === "stopped") return;
        return;
      }

      const ownedTemplateIds = new Set(
        forGroupOwnedTemplateElements(elements, (sourceElement ?? element).id).map((templateElement) => templateElement.id)
      );

      for (const [iterationIndex, variableValue] of iterationValues.entries()) {
        const { generatedElements, rows, templateElementIdByGeneratedId, iterationVariable, occurrencePath } = expandForGroupIteration({
          elements,
          forGroup: element,
          templateForGroupId: sourceElement?.id,
          iterationIndex,
          variableValue,
          ancestorElementIdMap,
          ancestorOccurrencePath
        });
        const childAncestorIterationVariables = [...ancestorIterationVariables, iterationVariable];
        const childAncestorElementIdMap = new Map(ancestorElementIdMap);
        for (const [generatedId, templateElementId] of templateElementIdByGeneratedId) {
          if (ownedTemplateIds.has(templateElementId)) childAncestorElementIdMap.set(templateElementId, generatedId);
        }
        for (const row of rows) {
          if (ownedTemplateIds.has(row.templateElementId)) forGroupGeneratedRows.push(row);
        }
        for (const generatedElement of generatedElements) {
          const templateElementId = templateElementIdByGeneratedId.get(generatedElement.id);
          if (!templateElementId || !ownedTemplateIds.has(templateElementId)) continue;
          const templateElement = elementsById.get(templateElementId);
          runtimeElements.push(generatedElement);
          runtimeElementsById.set(generatedElement.id, generatedElement);
          if (templateElement) {
            pushGeneratedVisibilityState(generatedElement, templateElement, effectiveShowGenerated, element);
          }
          evaluateRuntimeElement(
            generatedElement,
            templateElement,
            childAncestorIterationVariables,
            childAncestorElementIdMap,
            occurrencePath
          );
        }
      }
      return;
    }

    if (isContainerElement(element)) {
      return;
    }


    // Bound properties live on the template statement/element, not on a
    // forGroup-generated clone's own synthetic id - look up by the template
    // id (sourceElement) when this is a generated instance, so every
    // iteration sees the same resolved value uniformly (boolean/choice
    // bindings never vary per iteration; that is loop-mutation territory,
    // out of scope here).
    const propertyBindingEntriesForElement = propertyBindingEntriesByElementId?.get((sourceElement ?? element).id);
    let elementToEvaluate: CadElement = element;
    if (propertyBindingEntriesForElement?.length) {
      const materialized = materializePropertyBoundElement(
        element,
        propertyBindingEntriesForElement,
        scalarBindingResolver!.resolveBinding,
        resolveScalarGeometryProperty
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      elementToEvaluate = materialized.element;
      runtimeElementsById.set(elementToEvaluate.id, elementToEvaluate);
    }

    // Task 27: the bare/compound `text.text` property case is materialized
    // through its remaining dedicated physical route, chained onto whatever
    // common property materialization already happened.
    const textPropertyBindingEntriesForElement = textPropertyBindingEntriesByElementId?.get((sourceElement ?? element).id);
    if (textPropertyBindingEntriesForElement?.length) {
      const materialized = materializePropertyBoundElement(
        elementToEvaluate,
        textPropertyBindingEntriesForElement,
        scalarBindingResolver!.resolveBinding,
        resolveScalarGeometryProperty
      );
      if (!materialized.ok) {
        errors.push(materialized.error);
        return;
      }
      elementToEvaluate = materialized.element;
      runtimeElementsById.set(elementToEvaluate.id, elementToEvaluate);
    }

    // Task 27: a compiled TextTemplateAst for a quoted text value
    // (`"...{...}..."`) - looked up by the template id, same as bound
    // properties above, so every forGroup iteration resolves the same
    // template.
    const textTemplateForElement = textTemplateEntriesByElementId?.get((sourceElement ?? element).id);

    const geometryInputTargetsForElement = options.geometryInputTargetsByElementId?.get((sourceElement ?? element).id);
    let materializedGeometryInputTargets: ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]> | undefined;
    if (geometryInputTargetsForElement) {
      const geometrySourceOrder = options.scalarExecutionPositionByElementId?.get(element.id) ??
        options.sourceExecutionPositionByElementId?.get(element.id) ??
        sourceOrder;
      const materialized = materializeGeometryInputTargets(elementToEvaluate, geometryInputTargetsForElement, geometrySourceOrder);
      if (!materialized) return;
      elementToEvaluate = materialized.element;
      materializedGeometryInputTargets = materialized.targets;
      runtimeElementsById.set(elementToEvaluate.id, elementToEvaluate);
    }

    const mutationTargetIds = geometryMutationTargetIds(elementToEvaluate);
    const errorCountBeforeElementEvaluation = errors.length;
    evaluateElement(elementToEvaluate, {
      computedGeometry,
      computedGeometryValues,
      elementsById: runtimeElementsById,
      errors,
      warnings,
      disabledByGroupId,
      localVariables,
      elements: runtimeElements,
      ...(materializedGeometryInputTargets
        ? { geometryInputTargets: materializedGeometryInputTargets }
        : {}),
      ...(textTemplateForElement
        ? { textTemplate: textTemplateForElement, resolveScalarBinding: resolveScalarBindingForText }
        : {})
    });
    if (mutationTargetIds.length > 0 && errors.length === errorCountBeforeElementEvaluation) {
      geometryMutationExecutions.push({
        mutationElementId: elementToEvaluate.id,
        targetElementIds: mutationTargetIds
      });
    }
    if (!preMutationGeometry.has(elementToEvaluate.id)) {
      const geometry = computedGeometry.get(elementToEvaluate.id);
      if (geometry) preMutationGeometry.set(elementToEvaluate.id, structuredClone(geometry));
    }
  };

  for (const [elementIndex, element] of evaluatedElements.entries()) {
    if (templateDescendantIds.has(element.id)) continue;
    const sourceOrder = options.scalarExecutionPositionByElementId?.get(element.id) ??
      options.sourceExecutionPositionByElementId?.get(element.id) ??
      options.statementInfoByElementId?.get(element.id)?.statementIndex ?? elementIndex;
    evaluateGeometryValuesThrough(sourceOrder);
    evaluateRuntimeElement(element);
    for (const snapshot of instanceSnapshotsByEnd.get(elementIndex) ?? []) {
      const geometry = snapshot.descendantIds
        .map((id) => computedGeometry.get(id))
        .filter((value): value is ComputedGeometry => Boolean(value))
        .map((value) => structuredClone(value));
      instanceBaseGeometry.set(snapshot.instanceId, geometry);
    }
  }

  evaluateGeometryValuesThrough(Number.POSITIVE_INFINITY);

  const linearFinal = linearMutationResolver
    ? linearMutationResolver.finalize({
        kind: "beforeStatement",
        // Geometry still stops at the document's stop marker, but a
        // printLayout-local scalar binding is an explicit post-stop
        // evaluation exception carried by its resolved BindingId.
        sourceOrder: options.bindingVersions!.postStopBindingIds?.size
          ? Number.POSITIVE_INFINITY
          : options.bindingVersions!.evaluationLimitSourceOrder ?? Number.POSITIVE_INFINITY
      })
    : undefined;
  const computedScalarBindings = linearFinal?.resultsByBindingId ?? declarationResolver?.finalize().resultsByBindingId;

  // Generated ids are runtime identities. Their modifier semantics belong to
  // the source template, so use the evaluator-owned structured relationship
  // instead of inferring a template from the generated id string.
  for (const row of forGroupGeneratedRows) {
    const stroke = effectiveDrawingModifierStrokes.get(row.templateElementId);
    if (stroke) effectiveDrawingModifierStrokes.set(row.generatedElementId, { ...stroke, color: { ...stroke.color } });
    const resolution = effectiveDrawingModifierResolutions.get(row.templateElementId);
    if (resolution) effectiveDrawingModifierResolutions.set(row.generatedElementId, structuredClone(resolution));
  }

  return {
    computedGeometry,
    computedGeometryValues,
    geometryValueErrors,
    preMutationGeometry,
    geometryMutationExecutions,
    instanceBaseGeometry,
    errors,
    warnings,
    evaluatedElementIds,
    evaluationLimitIndex,
    effectiveVisibleElementIds: effectiveVisibleIds,
    effectiveEnabledElementIds: effectiveEnabledIds,
    effectiveDrawingModifierStrokes,
    effectiveDrawingModifierResolutions,
    conditionInactiveElementIds,
    conditionEvaluationTraces,
    forGroupGeneratedRows,
    forGroupEffectiveShowGeneratedIds,
    ...(computedScalarBindings ? { computedScalarBindings } : {}),
    ...(linearFinal ? { computedScalarBindingVersions: linearFinal.historyByVersionId } : {})
  };
};
