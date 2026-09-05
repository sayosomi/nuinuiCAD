import { evaluateElements } from "../geometry/evaluate";
import {
  initialNumericReferencePickProperty,
  numericReferencePickProperties
} from "../geometry/numericReferenceProperties";
import { insertNumericExpressionSnippet as insertSnippetIntoExpression } from "../geometry/numericExpressionInsertion";
import {
  makeNumericExpression,
  normalizeNumericExpressionInput,
  numericValueExpression,
  pointAnchorExpression
} from "../geometry/numericExpressions";
import {
  generatedElementIdForTargetForGroup,
  isValidPickedPointAnchorForTarget,
  lineEndpointReferenceForPickedAnchor,
  pickedPointAnchorReferencesTarget,
  pickedPointAnchorForTargetForGroup
} from "../model/forGroupGeneratedReferences";
import { creationPlacementForTarget } from "../model/elementCreationPlacement";
import {
  pickCandidates,
  selectedPickOption,
  type PickOption
} from "../model/pickCandidates";
import {
  pointAnchorForSourceReference,
  sourceReferenceText
} from "../model/moduleSemanticCandidateBoundary";
import { findPickOptionByRef, type PickRef } from "../model/pickReferences";
import { referenceAnchor } from "../model/pointAnchors";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import type { ElementId, EvaluationResult, PointAnchor } from "../types/geometry";
import type { NumericValue } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import {
  commandLinePickNormalizationTargetId,
  commandLinePointPickTargetIds,
  commandLineStepForPickTarget
} from "./commandLinePickRouting";
import {
  cancelStaleCommandLineSession,
  fillCommandLineCurrentStep
} from "./commandLineSessionCommands";
import { isLineLikeElement } from "./commandRuntime";

export const applyNumericExpressionReference = (context?: CommandContext) => {
  const numericExpression = context?.numericExpression;
  if (!numericExpression) return;
  const { elements } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement) return;

  const key = context?.parameterKey ?? null;
  const definition = findParameterDefinition(targetElement, key);
  if (definition?.kind !== "number") return;

  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(element, definition.key, makeNumericExpression(numericExpression))
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
};

const isNumericValue = (value: unknown): value is NumericValue =>
  typeof value === "number" ||
  (typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "expression");

const numericExpressionTarget = (context?: CommandContext) => {
  const { elements } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement) return null;

  const key = context?.parameterKey ?? null;
  const definition = findParameterDefinition(targetElement, key);
  if (definition?.kind !== "number" && !(targetElement.type === "text" && definition?.key === "text")) {
    return null;
  }

  return { elements, targetElement, definition };
};

const isTextExpressionInsertionPoint = (text: string, position: number) => {
  const before = text.slice(0, position);
  const lastOpen = before.lastIndexOf("{");
  if (lastOpen < 0 || before.lastIndexOf("}") > lastOpen) return false;
  const after = text.slice(position);
  const nextClose = after.indexOf("}");
  const nextOpen = after.indexOf("{");
  return nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen);
};

const textExpressionSnippet = (
  text: string,
  snippet: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
) => {
  const start = typeof selectionStart === "number" ? selectionStart : text.length;
  const end = typeof selectionEnd === "number" ? selectionEnd : start;
  const selectedText = text.slice(Math.min(start, end), Math.max(start, end)).trim();
  if (selectedText.startsWith("{") && selectedText.endsWith("}")) return snippet;
  return isTextExpressionInsertionPoint(text, Math.min(start, end)) ? snippet : `{${snippet}}`;
};

export const insertNumericExpressionSnippet = (context?: CommandContext) => {
  const snippet = context?.numericExpressionSnippet;
  if (!snippet) return;

  const target = numericExpressionTarget(context);
  if (!target) return;

  if (target.targetElement.type === "text" && target.definition.key === "text") {
    const currentValue = getParameterValue(target.targetElement, target.definition.key);
    const displayedText =
      context?.displayedExpression ??
      (typeof currentValue === "string" ? currentValue : target.targetElement.text);
    const nextDisplayText = insertSnippetIntoExpression({
      currentExpression: displayedText,
      snippet: textExpressionSnippet(
        displayedText,
        snippet,
        context?.selectionStart,
        context?.selectionEnd
      ),
      selectionStart: context?.selectionStart,
      selectionEnd: context?.selectionEnd,
      appendMode: "raw"
    });
    commitDocumentChangeAndSelect({
      elements: target.elements.map((element) =>
        element.id === target.targetElement.id
          ? setParameterValue(element, target.definition.key, nextDisplayText)
          : element
      )
    }, {
      selectedElementId: target.targetElement.id,
      selectedElementIds: [target.targetElement.id],
      selectionAnchorElementId: target.targetElement.id
    });
    return;
  }

  const currentValue = getParameterValue(target.targetElement, target.definition.key);
  const displayedExpression =
    context?.displayedExpression ??
    (isNumericValue(currentValue) ? numericValueExpression(currentValue) : "");
  const nextDisplayExpression = insertSnippetIntoExpression({
    currentExpression: displayedExpression,
    snippet,
    selectionStart: context?.selectionStart,
    selectionEnd: context?.selectionEnd,
    appendMode: context?.numericExpressionAppendMode
  });
  const nextExpression = normalizeNumericExpressionInput(
    nextDisplayExpression,
    target.elements,
    target.targetElement
  );

  commitDocumentChangeAndSelect({
    elements: target.elements.map((element) =>
      element.id === target.targetElement.id
        ? setParameterValue(element, target.definition.key, makeNumericExpression(nextExpression))
        : element
    )
  }, {
    selectedElementId: target.targetElement.id,
    selectedElementIds: [target.targetElement.id],
    selectionAnchorElementId: target.targetElement.id
  });
};

const measurementTargetFromContext = (context?: CommandContext) => {
  const target = numericExpressionTarget(context);
  if (!target) return null;
  const { activeMeasurementInsertTarget } = useCadUiStore.getState();
  const mode =
    context?.measurementInsertMode ??
    (activeMeasurementInsertTarget?.elementId === target.targetElement.id &&
    activeMeasurementInsertTarget.parameterKey === target.definition.key
      ? activeMeasurementInsertTarget.mode
      : "distance");
  const currentValue = getParameterValue(target.targetElement, target.definition.key);
  const displayedExpression =
    context?.displayedExpression ??
    activeMeasurementInsertTarget?.displayedExpression ??
    (isNumericValue(currentValue)
      ? numericValueExpression(currentValue)
      : typeof currentValue === "string"
        ? currentValue
        : "");

  return {
    elementId: target.targetElement.id,
    parameterKey: target.definition.key,
    mode,
    displayedExpression,
    selectionStart: context?.selectionStart ?? activeMeasurementInsertTarget?.selectionStart ?? null,
    selectionEnd: context?.selectionEnd ?? activeMeasurementInsertTarget?.selectionEnd ?? null
  };
};

const ensureMeasurementTarget = (context?: CommandContext) => {
  const target = measurementTargetFromContext(context);
  if (!target) return null;
  const current = useCadUiStore.getState().activeMeasurementInsertTarget;
  const isSame =
    current?.elementId === target.elementId && current.parameterKey === target.parameterKey;
  const next = {
    elementId: target.elementId,
    parameterKey: target.parameterKey,
    mode: target.mode,
    point1Anchor: isSame ? current.point1Anchor : null,
    point2Anchor: isSame ? current.point2Anchor : null,
    lineId: isSame ? current.lineId : null,
    displayedExpression: target.displayedExpression,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd
  };
  useCadUiStore.getState().setActiveMeasurementInsertTarget(next);
  return next;
};

export const setMeasurementInsertMode = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  if (!target || !context?.measurementInsertMode) return;
  useCadUiStore.getState().setActiveMeasurementInsertTarget({
    ...target,
    mode: context.measurementInsertMode
  });
};

export const startMeasurementFunctionInsert = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  if (!target || !context?.measurementInsertMode) return;
  const nextTarget = {
    ...target,
    mode: context.measurementInsertMode,
    point1Anchor: null,
    point2Anchor: null,
    lineId: null
  };
  useCadUiStore.setState({
    activeMeasurementInsertTarget: nextTarget,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: target.elementId,
      parameterKey: target.parameterKey,
      measurementSlot: "point1"
    }
  });
};

export const startMeasurementPointPick = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  const measurementSlot = context?.measurementPointSlot;
  if (!target || !measurementSlot) return;

  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: target.elementId,
      parameterKey: target.parameterKey,
      measurementSlot
    }
  });
};

export const startMeasurementLinePick = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  if (!target) return;

  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activePointPickTarget: null,
    activeLinePickTarget: {
      elementId: target.elementId,
      parameterKey: target.parameterKey,
      measurementSlot: "line"
    }
  });
};

export const insertSelectedMeasurement = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  if (!target) return;

  const { activeMeasurementInsertTarget } = useCadUiStore.getState();
  if (!activeMeasurementInsertTarget) return;

  const point1 = activeMeasurementInsertTarget.point1Anchor
    ? pointAnchorExpression(activeMeasurementInsertTarget.point1Anchor)
    : "";
  const point2 = activeMeasurementInsertTarget.point2Anchor
    ? pointAnchorExpression(activeMeasurementInsertTarget.point2Anchor)
    : "";
  const lineId = activeMeasurementInsertTarget.lineId ?? "";
  const functionName =
    activeMeasurementInsertTarget.mode === "angle"
      ? "角度"
      : activeMeasurementInsertTarget.mode === "lineDistance"
        ? "点線距離"
        : "距離";
  const snippet =
    activeMeasurementInsertTarget.mode === "lineDistance"
      ? point1 && lineId ? `${functionName}(${point1}, ${lineId})` : ""
      : point1 && point2 ? `${functionName}(${point1}, ${point2})` : "";
  if (!snippet) return;

  insertNumericExpressionSnippet({
    elementId: activeMeasurementInsertTarget.elementId,
    parameterKey: activeMeasurementInsertTarget.parameterKey,
    numericExpressionSnippet: snippet,
    displayedExpression: activeMeasurementInsertTarget.displayedExpression,
    selectionStart: activeMeasurementInsertTarget.selectionStart,
    selectionEnd: activeMeasurementInsertTarget.selectionEnd
  });
};

export const startNumericReferencePick = (context?: CommandContext) => {
  const explicitTarget = numericExpressionTarget(context);
  const selectedElement = explicitTarget?.targetElement;
  const definition = explicitTarget?.definition;
  if (!selectedElement || definition?.kind !== "number") return false;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      mode: "replace",
      property: initialNumericReferencePickProperty(definition.stepLevels)
    }
  });
  return true;
};

export const startNumericReferenceInsertPick = (context?: CommandContext) => {
  const target = numericExpressionTarget(context);
  if (!target) return;
  const currentValue = getParameterValue(target.targetElement, target.definition.key);
  const displayedExpression =
    context?.displayedExpression ??
    (isNumericValue(currentValue)
      ? numericValueExpression(currentValue)
      : typeof currentValue === "string"
        ? currentValue
        : "");

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: target.targetElement.id,
      parameterKey: target.definition.key,
      mode: "insert",
      property: context?.numericReferenceProperty ?? "length",
      displayedExpression,
      selectionStart: context?.selectionStart ?? null,
      selectionEnd: context?.selectionEnd ?? null
    }
  });
};

export const setNumericReferencePickProperty = (context?: CommandContext) => {
  const property = context?.numericReferenceProperty;
  const current = useCadUiStore.getState().activeNumericReferencePickTarget;
  if (!current || !property) return;
  useCadUiStore.getState().setActiveNumericReferencePickTarget({
    ...current,
    property
  });
};

export const applyPickedNumericReference = (context?: CommandContext) => {
  const numericExpression = context?.numericReferenceExpression;
  if (!numericExpression) return;
  const { activeNumericReferencePickTarget } = useCadUiStore.getState();
  if (!activeNumericReferencePickTarget) return;
  const commandLineStep = commandLineStepForPickTarget(
    activeNumericReferencePickTarget,
    useCadUiStore.getState().commandLineSession
  );
  if (commandLineStep?.kind === "number") {
    if (cancelStaleCommandLineSession()) return;
    fillCommandLineCurrentStep(makeNumericExpression(numericExpression), context);
    return;
  }
  if (numericExpression.startsWith(`${activeNumericReferencePickTarget.elementId}.`)) return;

  if (activeNumericReferencePickTarget.mode === "insert") {
    insertNumericExpressionSnippet({
      elementId: activeNumericReferencePickTarget.elementId,
      parameterKey: activeNumericReferencePickTarget.parameterKey,
      numericExpressionSnippet: numericExpression,
      displayedExpression: activeNumericReferencePickTarget.displayedExpression,
      selectionStart: activeNumericReferencePickTarget.selectionStart,
      selectionEnd: activeNumericReferencePickTarget.selectionEnd
    });
  } else {
    applyNumericExpressionReference({
      elementId: activeNumericReferencePickTarget.elementId,
      parameterKey: activeNumericReferencePickTarget.parameterKey,
      numericExpression
    });
  }
  useCadUiStore.getState().setActiveNumericReferencePickTarget(null);
};

export const cancelNumericReferencePick = () => {
  useCadUiStore.getState().setActiveNumericReferencePickTarget(null);
};

export const activePickCandidates = (currentEvaluation?: EvaluationResult) => {
  const ui = useCadUiStore.getState();
  const {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  } = ui;
  const { elements, evaluationLimitIndex, doc } = useCadDocumentStore.getState();
  const commandLinePlacement = ui.commandLineSession
    ? creationPlacementForTarget(
        elements,
        ui.commandLineSession.insertionTarget,
        evaluationLimitIndex
      )
    : null;
  return pickCandidates(elements, currentEvaluation ?? evaluateElements(elements, { evaluationLimitIndex }), {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    commandLineSession: ui.commandLineSession,
    commandLinePickParentGroupId: commandLinePlacement?.parentGroupId,
    referenceElements: commandLinePlacement?.referenceElements,
    moduleSemanticContext: {
      moduleMaterialization: doc.moduleMaterialization,
      moduleSemanticAnalysis: doc.moduleSemanticAnalysis,
      sourceLexicalNamespace: doc.sourceLexicalNamespace,
      statementInfoByElementId: doc.statementMap?.byElementId
    }
  });
};

const applyPickOption = (option: PickOption, context?: CommandContext) => {
  if (option.kind === "point") {
    applyPickedPoint({
      ...context,
      pickedPointAnchor: option.anchor,
      ...(option.sourceReference ? { pickedPointSourceReference: option.sourceReference } : {})
    });
    return;
  }
  if (option.kind === "line") {
    applyPickedLine({
      ...context,
      pickedLineId: option.lineId,
      ...(option.sourceReference ? { pickedLineSourceReference: option.sourceReference } : {})
    });
    return;
  }
  applyPickedNumericReference({ ...context, numericReferenceExpression: option.expression });
};

export const applyPickReference = (
  ref: PickRef,
  currentEvaluation?: EvaluationResult,
  context?: CommandContext
) => {
  if (cancelStaleCommandLineSession()) return false;
  const resolved = findPickOptionByRef(activePickCandidates(currentEvaluation), ref);
  if (!resolved) return false;
  applyPickOption(resolved.option, context);
  return true;
};

export const selectPickCandidateByOffset = (offset: number, currentEvaluation?: EvaluationResult) => {
  const candidates = activePickCandidates(currentEvaluation);
  if (candidates.length === 0) {
    useCadUiStore.getState().setActivePickCursor(null);
    return;
  }

  const { activePickCursor } = useCadUiStore.getState();
  const currentIndex = activePickCursor
    ? candidates.findIndex((candidate) => candidate.elementId === activePickCursor.elementId)
    : -1;
  const nextIndex =
    currentIndex < 0
      ? offset > 0 ? 0 : candidates.length - 1
      : (currentIndex + offset + candidates.length) % candidates.length;
  const candidate = candidates[nextIndex];
  const optionIndex = Math.min(activePickCursor?.optionIndex ?? 0, candidate.options.length - 1);
  useCadUiStore.getState().setActivePickCursor({
    elementId: candidate.elementId,
    optionIndex
  });
};

export const selectPickOptionByOffset = (offset: number, currentEvaluation?: EvaluationResult) => {
  const { activeNumericReferencePickTarget } = useCadUiStore.getState();
  if (activeNumericReferencePickTarget) {
    const currentIndex = numericReferencePickProperties.indexOf(activeNumericReferencePickTarget.property);
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + offset + numericReferencePickProperties.length) %
          numericReferencePickProperties.length;
    useCadUiStore.getState().setActiveNumericReferencePickTarget({
      ...activeNumericReferencePickTarget,
      property: numericReferencePickProperties[nextIndex]
    });
    return;
  }

  const candidates = activePickCandidates(currentEvaluation);
  const selected = selectedPickOption(candidates, useCadUiStore.getState().activePickCursor);
  if (!selected) {
    useCadUiStore.getState().setActivePickCursor(null);
    return;
  }

  const optionCount = selected.candidate.options.length;
  const optionIndex = (selected.cursor.optionIndex + offset + optionCount) % optionCount;
  useCadUiStore.getState().setActivePickCursor({
    elementId: selected.candidate.elementId,
    optionIndex
  });
};

export const applySelectedPickCandidate = (
  currentEvaluation?: EvaluationResult,
  context?: CommandContext
) => {
  const candidates = activePickCandidates(currentEvaluation);
  const selected = selectedPickOption(candidates, useCadUiStore.getState().activePickCursor);
  if (!selected) return;

  applyPickOption(selected.option, context);
};

export const startPointPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey"> & {
    pickFlow?: "lineEndpointPair" | "lineAndPoint" | "endpointPair" | "endpointAndPoint";
  }
) => {
  const { elements } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId;
  const selectedElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  const definition = context?.parameterKey
    ? selectedElement
      ? findParameterDefinition(selectedElement, context.parameterKey)
      : null
    : null;
  if (
    !selectedElement ||
    (definition?.kind !== "reference" &&
      definition?.kind !== "lineEndpointReference" &&
      definition?.kind !== "pointReferenceList")
  ) return;

  const currentValue = getParameterValue(selectedElement, definition.key);
  const draftPointAnchors = definition.kind === "pointReferenceList"
    ? Array.isArray(currentValue)
      ? (currentValue as unknown[]).filter((value): value is PointAnchor => Boolean(value && typeof value === "object" && "mode" in value))
      : []
    : undefined;

  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      ...(draftPointAnchors ? { draftPointAnchors } : {}),
      ...(context?.nextParameterKey ? { nextParameterKey: context.nextParameterKey } : {}),
      ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
    }
  });
};

export const startLineEndpointPairPick = (context?: Pick<CommandContext, "elementId">) => {
  const { elements } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement || targetElement.type !== "line") return;

  startPointPick({
    elementId: targetElement.id,
    parameterKey: "startPoint",
    nextParameterKey: "endPoint",
    pickFlow: "lineEndpointPair"
  });
};

export const startEndpointPairPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey">
) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement || !context?.parameterKey || !context.nextParameterKey) return;

  const firstDefinition = findParameterDefinition(targetElement, context.parameterKey);
  const nextDefinition = findParameterDefinition(targetElement, context.nextParameterKey);
  if (firstDefinition?.kind !== "lineEndpointReference" || nextDefinition?.kind !== "lineEndpointReference") return;

  startPointPick({
    elementId: targetElement.id,
    parameterKey: firstDefinition.key,
    nextParameterKey: nextDefinition.key,
    pickFlow: "endpointPair"
  });
};

export const startEndpointAndPointPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey">
) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement || !context?.parameterKey || !context.nextParameterKey) return;

  const endpointDefinition = findParameterDefinition(targetElement, context.parameterKey);
  const pointDefinition = findParameterDefinition(targetElement, context.nextParameterKey);
  if (endpointDefinition?.kind !== "lineEndpointReference" || pointDefinition?.kind !== "reference") return;

  startPointPick({
    elementId: targetElement.id,
    parameterKey: endpointDefinition.key,
    nextParameterKey: pointDefinition.key,
    pickFlow: "endpointAndPoint"
  });
};

export const applyPickedPoint = (context?: CommandContext) => {
  const anchor = context?.pickedPointAnchor ?? (context?.pickedPointId ? referenceAnchor(context.pickedPointId) : null);
  if (!anchor) return;
  const sourceReference = context?.pickedPointSourceReference;
  const sourceAnchor = sourceReference ? pointAnchorForSourceReference(sourceReference) : anchor;
  const { activePointPickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activePointPickTarget) return;
  const commandLineSession = useCadUiStore.getState().commandLineSession;
  const commandLineStep = commandLineStepForPickTarget(activePointPickTarget, commandLineSession);
  if (commandLineStep?.kind === "point" || commandLineStep?.kind === "endpoint" || commandLineStep?.kind === "pointList") {
    if (cancelStaleCommandLineSession()) return;
    const parentGroupId = commandLineSession
      ? creationPlacementForTarget(
          elements,
          commandLineSession.insertionTarget,
          useCadDocumentStore.getState().evaluationLimitIndex
        ).parentGroupId
      : undefined;
    const pointPickTargetIds = commandLinePointPickTargetIds({
      target: activePointPickTarget,
      session: commandLineSession,
      parentGroupId,
      elements
    });
    if (!isValidPickedPointAnchorForTarget({
      elements,
      ...pointPickTargetIds,
      anchor,
      allowLineEndpoint: commandLineStep.kind === "endpoint"
    })) return;
    const normalizationTargetId = pointPickTargetIds.normalizationTargetElementId ??
      pointPickTargetIds.targetElementId;
    const pickedAnchor = pickedPointAnchorForTargetForGroup({
      elements,
      targetElementId: normalizationTargetId,
      anchor
    });
    if (!pickedAnchor) return;
    if (commandLineStep.kind === "endpoint") {
      const endpoint = lineEndpointReferenceForPickedAnchor({
        elements,
        targetElementId: normalizationTargetId,
        anchor
      });
      if (endpoint) {
        const sourceLineId = context?.pickedPointSourceReference?.base;
        fillCommandLineCurrentStep(sourceLineId ? { ...endpoint, lineId: sourceLineId } : endpoint, context);
      }
      return;
    }
    if (pickedAnchor.mode === "reference") {
      const pointElement = elements.find((element) => element.id === pickedAnchor.pointId);
      if (
        !pointElement ||
        (pointElement.type !== "freePoint" &&
          pointElement.type !== "offsetPoint" &&
          pointElement.type !== "polarOffsetPoint" &&
          pointElement.type !== "divisionPoint" &&
          pointElement.type !== "lineDivisionPoint" &&
          pointElement.type !== "intersectionPoint" &&
          pointElement.type !== "lineTangentOffsetPoint")
      ) return;
    }
    if (pickedAnchor.mode === "derived" && !elements.some((element) => element.id === pickedAnchor.elementId)) {
      return;
    }
    if (commandLineStep.kind === "pointList") {
      useCadUiStore.getState().setActivePointPickTarget({
        ...activePointPickTarget,
        draftPointAnchors: [
          ...(activePointPickTarget.draftPointAnchors ?? []),
          context?.pickedPointSourceReference ? sourceAnchor : pickedAnchor
        ]
      });
      return;
    }
    fillCommandLineCurrentStep(context?.pickedPointSourceReference ? sourceAnchor : pickedAnchor, context);
    return;
  }
  if (activePointPickTarget.measurementSlot) {
    const current = useCadUiStore.getState().activeMeasurementInsertTarget;
    if (!current) return;
    const nextTarget = {
      ...current,
      [activePointPickTarget.measurementSlot === "point1" ? "point1Anchor" : "point2Anchor"]: sourceAnchor
    };
    useCadUiStore.getState().setActiveMeasurementInsertTarget(nextTarget);
    if (activePointPickTarget.measurementSlot === "point1") {
      if (current.mode === "lineDistance") {
        useCadUiStore.setState({
          activePointPickTarget: null,
          activeLinePickTarget: {
            elementId: current.elementId,
            parameterKey: current.parameterKey,
            measurementSlot: "line"
          }
        });
        return;
      }
      useCadUiStore.getState().setActivePointPickTarget({
        elementId: current.elementId,
        parameterKey: current.parameterKey,
        measurementSlot: "point2"
      });
      return;
    }
    useCadUiStore.getState().setActivePointPickTarget(null);
    insertSelectedMeasurement({
      elementId: current.elementId,
      parameterKey: current.parameterKey
    });
    return;
  }
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  if (!targetElement) return;

  const definition = findParameterDefinition(targetElement, activePointPickTarget.parameterKey);
  if (
    pickedPointAnchorReferencesTarget({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor
    })
  ) {
    return;
  }
  const pickedAnchor = pickedPointAnchorForTargetForGroup({
    elements,
    targetElementId: activePointPickTarget.elementId,
    anchor
  });
  if (!pickedAnchor) return;

  if (definition?.kind === "lineEndpointReference") {
    const endpoint = lineEndpointReferenceForPickedAnchor({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor
    });
    if (!endpoint) return;

    commitDocumentChangeAndSelect({
      elements: elements.map((element) =>
        element.id === activePointPickTarget.elementId
          ? setParameterValue(
              element,
              activePointPickTarget.parameterKey,
              context?.pickedPointSourceReference
                ? {
                    ...endpoint,
                    lineId: context.pickedPointSourceReference.base
                  }
                : endpoint
            )
          : element
      )
    }, {
      selectedElementId: activePointPickTarget.elementId,
      selectedElementIds: [activePointPickTarget.elementId],
      selectionAnchorElementId: activePointPickTarget.elementId
    });
    if (activePointPickTarget.nextParameterKey) {
      const nextDefinition = findParameterDefinition(targetElement, activePointPickTarget.nextParameterKey);
      if (nextDefinition?.kind === "reference" || nextDefinition?.kind === "lineEndpointReference") {
        useCadUiStore.getState().setActivePointPickTarget({
          elementId: activePointPickTarget.elementId,
          parameterKey: nextDefinition.key,
          ...(activePointPickTarget.pickFlow ? { pickFlow: activePointPickTarget.pickFlow } : {})
        });
        return;
      }
    }
    useCadUiStore.getState().setActivePointPickTarget(null);
    return;
  }

  if (definition?.kind !== "reference" && definition?.kind !== "pointReferenceList") return;

  if (pickedAnchor.mode === "reference") {
    const pointElement = elements.find((element) => element.id === pickedAnchor.pointId);
    if (
      !pointElement ||
      (pointElement.type !== "freePoint" &&
        pointElement.type !== "offsetPoint" &&
        pointElement.type !== "polarOffsetPoint" &&
        pointElement.type !== "divisionPoint" &&
        pointElement.type !== "lineDivisionPoint" &&
        pointElement.type !== "intersectionPoint" &&
        pointElement.type !== "lineTangentOffsetPoint")
    ) {
      return;
    }
  }

  if (pickedAnchor.mode === "derived" && !elements.some((element) => element.id === pickedAnchor.elementId)) {
    return;
  }

  if (definition.kind === "pointReferenceList") {
    useCadUiStore.getState().setActivePointPickTarget({
      ...activePointPickTarget,
      draftPointAnchors: [
        ...(activePointPickTarget.draftPointAnchors ?? []),
        context?.pickedPointSourceReference ? sourceAnchor : pickedAnchor
      ]
    });
    return;
  }

  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === activePointPickTarget.elementId
        ? setParameterValue(element, activePointPickTarget.parameterKey, sourceAnchor)
        : element
    )
  }, {
    selectedElementId: activePointPickTarget.elementId,
    selectedElementIds: [activePointPickTarget.elementId],
    selectionAnchorElementId: activePointPickTarget.elementId
  });
  if (activePointPickTarget.nextParameterKey) {
    const nextDefinition = findParameterDefinition(targetElement, activePointPickTarget.nextParameterKey);
    if (nextDefinition?.kind === "reference" || nextDefinition?.kind === "lineEndpointReference") {
      useCadUiStore.getState().setActivePointPickTarget({
        elementId: activePointPickTarget.elementId,
        parameterKey: nextDefinition.key,
        ...(activePointPickTarget.pickFlow ? { pickFlow: activePointPickTarget.pickFlow } : {})
      });
      return;
    }
  }
  useCadUiStore.getState().setActivePointPickTarget(null);
};

export const cancelPointPick = () => {
  useCadUiStore.getState().setActivePointPickTarget(null);
};

export const startLinePick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey"> & {
    pickFlow?: "lineAndPoint";
  }
) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const selectedElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  const definition = context?.parameterKey
    ? selectedElement
      ? findParameterDefinition(selectedElement, context.parameterKey)
      : null
    : null;
  if (!selectedElement || (definition?.kind !== "lineReferenceList" && definition?.kind !== "lineReference")) return;

  const currentValue = getParameterValue(selectedElement, definition.key);
  const draftLineIds = definition.kind === "lineReferenceList"
    ? Array.isArray(currentValue)
      ? (currentValue as unknown[]).filter((id): id is ElementId => typeof id === "string")
      : []
    : undefined;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      ...(draftLineIds ? { draftLineIds } : {}),
      ...(context?.nextParameterKey ? { nextPointParameterKey: context.nextParameterKey } : {}),
      ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
    }
  });
};

export const startLineAndPointPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey">
) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement || !context?.parameterKey || !context.nextParameterKey) return;

  const lineDefinition = findParameterDefinition(targetElement, context.parameterKey);
  const pointDefinition = findParameterDefinition(targetElement, context.nextParameterKey);
  if (lineDefinition?.kind !== "lineReference" || pointDefinition?.kind !== "reference") return;

  startLinePick({
    elementId: targetElement.id,
    parameterKey: lineDefinition.key,
    nextParameterKey: pointDefinition.key,
    pickFlow: "lineAndPoint"
  });
};

export const applyPickedLine = (context?: CommandContext) => {
  const pickedLineId = context?.pickedLineId;
  if (!pickedLineId) return;
  const sourceReferenceToken = sourceReferenceText(context?.pickedLineSourceReference ?? null);
  const sourceReferenceId = context?.pickedLineSourceReference?.base ?? null;
  const { activeLinePickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activeLinePickTarget) return;
  const commandLineSession = useCadUiStore.getState().commandLineSession;
  const commandLineStep = commandLineStepForPickTarget(activeLinePickTarget, commandLineSession);
  if (commandLineStep?.kind === "line" || commandLineStep?.kind === "lineList") {
    if (cancelStaleCommandLineSession()) return;
    const parentGroupId = commandLineSession
      ? creationPlacementForTarget(
          elements,
          commandLineSession.insertionTarget,
          useCadDocumentStore.getState().evaluationLimitIndex
        ).parentGroupId
      : undefined;
    const normalizationTargetId = commandLinePickNormalizationTargetId(
      activeLinePickTarget,
      commandLineSession,
      parentGroupId,
      elements
    );
    const normalizedPickedLineId = generatedElementIdForTargetForGroup({
      elements,
      targetElementId: normalizationTargetId,
      pickedElementId: pickedLineId
    });
    const pickedLine = normalizedPickedLineId
      ? elements.find((element) => element.id === normalizedPickedLineId)
      : null;
    if (!normalizedPickedLineId || !pickedLine || !isLineLikeElement(pickedLine)) return;
    if (commandLineStep.kind === "line") {
      fillCommandLineCurrentStep(sourceReferenceToken ?? normalizedPickedLineId, context);
      return;
    }
    const draftLineIds = activeLinePickTarget.draftLineIds ?? [];
    const adoptedLineId = sourceReferenceId ?? normalizedPickedLineId;
    useCadUiStore.getState().setActiveLinePickTarget({
      ...activeLinePickTarget,
      draftLineIds: draftLineIds.includes(adoptedLineId)
        ? draftLineIds.filter((id) => id !== adoptedLineId)
        : [...draftLineIds, adoptedLineId]
    });
    return;
  }
  if (activeLinePickTarget.measurementSlot) {
    const pickedLine = elements.find((element) => element.id === pickedLineId);
    const current = useCadUiStore.getState().activeMeasurementInsertTarget;
    if (
      !current ||
      !pickedLine ||
      !isLineLikeElement(pickedLine) ||
      pickedLine.id === activeLinePickTarget.elementId
    ) return;
    useCadUiStore.getState().setActiveMeasurementInsertTarget({
      ...current,
      lineId: sourceReferenceId ?? pickedLine.id
    });
    useCadUiStore.getState().setActiveLinePickTarget(null);
    insertSelectedMeasurement({
      elementId: current.elementId,
      parameterKey: current.parameterKey
    });
    return;
  }

  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  const normalizedPickedLineId = generatedElementIdForTargetForGroup({
    elements,
    targetElementId: activeLinePickTarget.elementId,
    pickedElementId: pickedLineId
  });
  if (!normalizedPickedLineId) return;

  const pickedLine = elements.find((element) => element.id === normalizedPickedLineId);
  const definition = targetElement
    ? findParameterDefinition(targetElement, activeLinePickTarget.parameterKey)
    : null;
  const currentValue = targetElement
    ? getParameterValue(targetElement, activeLinePickTarget.parameterKey)
    : null;
  const currentLineIds = Array.isArray(currentValue)
    ? (currentValue as unknown[]).filter((id): id is ElementId => typeof id === "string")
    : null;
  if (
    !targetElement ||
    (definition?.kind !== "lineReferenceList" && definition?.kind !== "lineReference") ||
    !pickedLine ||
    !isLineLikeElement(pickedLine) ||
    normalizedPickedLineId === targetElement.id
  ) {
    return;
  }

  if (definition.kind === "lineReference") {
    commitDocumentChangeAndSelect({
      elements: elements.map((element) =>
        element.id === targetElement.id
          ? setParameterValue(
              targetElement,
              activeLinePickTarget.parameterKey,
              sourceReferenceId ?? normalizedPickedLineId
            )
          : element
      )
    }, {
      selectedElementId: targetElement.id,
      selectedElementIds: [targetElement.id],
      selectionAnchorElementId: targetElement.id
    });
    if (activeLinePickTarget.nextPointParameterKey) {
      const nextDefinition = findParameterDefinition(targetElement, activeLinePickTarget.nextPointParameterKey);
      if (nextDefinition?.kind === "reference") {
        useCadUiStore.setState({
          activeLinePickTarget: null,
          activePickCursor: null,
          activePointPickTarget: {
            elementId: targetElement.id,
            parameterKey: nextDefinition.key,
            ...(activeLinePickTarget.pickFlow ? { pickFlow: activeLinePickTarget.pickFlow } : {})
          }
        });
        return;
      }
    }
    useCadUiStore.getState().setActiveLinePickTarget(null);
    return;
  }

  if (!currentLineIds) return;
  const draftLineIds = activeLinePickTarget.draftLineIds ?? currentLineIds;
  const adoptedLineId = sourceReferenceId ?? normalizedPickedLineId;
  useCadUiStore.getState().setActiveLinePickTarget({
    ...activeLinePickTarget,
    draftLineIds: draftLineIds.includes(adoptedLineId)
      ? draftLineIds.filter((id) => id !== adoptedLineId)
      : [...draftLineIds, adoptedLineId]
  });
};

export const cancelLinePick = () => {
  useCadUiStore.getState().setActiveLinePickTarget(null);
};

export const finishLinePick = (context?: CommandContext) => {
  const { activeLinePickTarget } = useCadUiStore.getState();
  if (!activeLinePickTarget || activeLinePickTarget.draftLineIds === undefined) return;
  const commandLineStep = commandLineStepForPickTarget(
    activeLinePickTarget,
    useCadUiStore.getState().commandLineSession
  );
  if (commandLineStep?.kind === "lineList") {
    if (cancelStaleCommandLineSession()) return;
    fillCommandLineCurrentStep(activeLinePickTarget.draftLineIds, context);
    return;
  }
  const { elements } = useCadDocumentStore.getState();
  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  if (!targetElement) return;
  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, activeLinePickTarget.draftLineIds!)
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
  useCadUiStore.getState().setActiveLinePickTarget(null);
};

export const finishPointPick = (context?: CommandContext) => {
  const { activePointPickTarget } = useCadUiStore.getState();
  if (!activePointPickTarget || activePointPickTarget.draftPointAnchors === undefined) return;
  const commandLineStep = commandLineStepForPickTarget(
    activePointPickTarget,
    useCadUiStore.getState().commandLineSession
  );
  if (commandLineStep?.kind === "pointList") {
    if (cancelStaleCommandLineSession()) return;
    fillCommandLineCurrentStep(activePointPickTarget.draftPointAnchors, context);
    return;
  }
  const { elements } = useCadDocumentStore.getState();
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  if (!targetElement) return;
  const definition = findParameterDefinition(targetElement, activePointPickTarget.parameterKey);
  if (definition?.kind !== "pointReferenceList") return;
  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, activePointPickTarget.parameterKey, activePointPickTarget.draftPointAnchors!)
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
  useCadUiStore.getState().setActivePointPickTarget(null);
};
