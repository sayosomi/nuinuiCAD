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
import {
  activatePickModeDraftEntry,
  matchingPickModeSessionForTargets,
  movePickModeDraftEntry as moveDraftEntry,
  pickModeDraftEntryForOption,
  pickModeDraftForLineIds,
  pickModeDraftForPointAnchors,
  pickModeSelectionCardinalityFor,
  pickModeSessionForTarget,
  removePickModeDraftEntry,
  type PickModeDraftEntry,
  type PickModeSession
} from "../model/pickModeSession";
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

const sourceReferenceValue = (sourceReference: Parameters<typeof sourceReferenceText>[0]) => {
  const token = sourceReferenceText(sourceReference);
  return token ? token.slice(1) : null;
};

const endpointForSourceReference = (sourceReference: CommandContext["pickedPointSourceReference"]) => {
  const lineId = sourceReferenceValue(sourceReference ?? null);
  const pointKey = sourceReference?.pointKey;
  if (!lineId || (pointKey !== "start" && pointKey !== "end")) return null;
  return { lineId, endpointKey: pointKey as "start" | "end" };
};

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
  const activePointPickTarget = {
    elementId: target.elementId,
    parameterKey: target.parameterKey,
    measurementSlot: "point1" as const
  };
  useCadUiStore.setState({
    activeMeasurementInsertTarget: nextTarget,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget,
    activePickModeSession: pickModeSessionForTarget("point", activePointPickTarget)
  });
};

export const startMeasurementPointPick = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  const measurementSlot = context?.measurementPointSlot;
  if (!target || !measurementSlot) return;

  const activePointPickTarget = {
    elementId: target.elementId,
    parameterKey: target.parameterKey,
    measurementSlot
  };
  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget,
    activePickModeSession: pickModeSessionForTarget("point", activePointPickTarget)
  });
};

export const startMeasurementLinePick = (context?: CommandContext) => {
  const target = ensureMeasurementTarget(context);
  if (!target) return;

  const activeLinePickTarget = {
    elementId: target.elementId,
    parameterKey: target.parameterKey,
    measurementSlot: "line" as const
  };
  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activePointPickTarget: null,
    activeLinePickTarget,
    activePickModeSession: pickModeSessionForTarget("line", activeLinePickTarget)
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

  const activeNumericReferencePickTarget = {
    elementId: selectedElement.id,
    parameterKey: definition.key,
    mode: "replace" as const,
    property: initialNumericReferencePickProperty(definition.stepLevels)
  };
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget,
    activePickModeSession: pickModeSessionForTarget("numeric-reference", activeNumericReferencePickTarget)
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

  const activeNumericReferencePickTarget = {
    elementId: target.targetElement.id,
    parameterKey: target.definition.key,
    mode: "insert" as const,
    property: context?.numericReferenceProperty ?? "length",
    displayedExpression,
    selectionStart: context?.selectionStart ?? null,
    selectionEnd: context?.selectionEnd ?? null
  };
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget,
    activePickModeSession: pickModeSessionForTarget("numeric-reference", activeNumericReferencePickTarget)
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
  if (!context?.pickModeFinish) {
    const draftEntry = numericDraftEntryFor(numericExpression, context);
    if (draftEntry && activatePickModeDraft(draftEntry)) return;
  }
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

export const activePickCandidates = (currentEvaluation?: EvaluationResult) => {
  const ui = useCadUiStore.getState();
  const {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  } = ui;
  const { elements, evaluationLimitIndex, doc } = useCadDocumentStore.getState();
  const pickModeSession = matchingPickModeSessionForTargets(ui.activePickModeSession, {
    point: activePointPickTarget,
    numericReference: activeNumericReferencePickTarget,
    line: activeLinePickTarget
  });
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
    pickModeDraft: pickModeSession?.draft,
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

const applyPickOption = (
  candidateElementId: ElementId,
  option: PickOption,
  context?: CommandContext
) => {
  if (option.kind === "point") {
    applyPickedPoint({
      ...context,
      pickedPointCandidateElementId: candidateElementId,
      pickedPointAnchor: option.anchor,
      ...(option.sourceReference ? { pickedPointSourceReference: option.sourceReference } : {})
    });
    return;
  }
  if (option.kind === "line") {
    applyPickedLine({
      ...context,
      pickedLineCandidateElementId: candidateElementId,
      pickedLineId: option.lineId,
      ...(option.sourceReference ? { pickedLineSourceReference: option.sourceReference } : {})
    });
    return;
  }
  applyPickedNumericReference({
    ...context,
    numericReferenceCandidateElementId: candidateElementId,
    numericReferenceExpression: option.expression
  });
};

const pickModeSessionForUi = () => {
  const ui = useCadUiStore.getState();
  return matchingPickModeSessionForTargets(ui.activePickModeSession, {
    point: ui.activePointPickTarget,
    numericReference: ui.activeNumericReferencePickTarget,
    line: ui.activeLinePickTarget
  });
};

/** Re-resolves committed ordered values through the current candidate authority. */
export const seedPickModeDraft = (
  kind: "point" | "line",
  values: readonly PointAnchor[] | readonly ElementId[]
) => {
  const session = pickModeSessionForUi();
  if (!session || session.kind !== kind) return false;
  const candidates = activePickCandidates();
  const draft = kind === "point"
    ? pickModeDraftForPointAnchors(values as readonly PointAnchor[], candidates)
    : pickModeDraftForLineIds(values as readonly ElementId[], candidates);
  useCadUiStore.setState({
    activePickModeSession: { ...session, draft }
  });
  return true;
};

const activatePickModeDraft = (entry: PickModeDraftEntry) => {
  const session = pickModeSessionForUi();
  if (!session || session.kind !== entry.kind) return false;
  useCadUiStore.setState({
    activePickModeSession: activatePickModeDraftEntry(session, entry),
    activePickCursor: null
  });
  return true;
};

export const removePickModeDraftEntryFromSession = (key: string) => {
  const session = pickModeSessionForUi();
  if (!session || session.selectionCardinality !== "ordered-multiple") return false;
  if (!session.draft.some((entry) => entry.key === key)) return false;
  useCadUiStore.setState({
    activePickModeSession: {
      ...session,
      draft: removePickModeDraftEntry(session.draft, key)
    },
    activePickCursor: null
  });
  return true;
};

export const movePickModeDraftEntryInSession = (key: string, toIndex: number) => {
  const session = pickModeSessionForUi();
  if (!session || session.selectionCardinality !== "ordered-multiple") return false;
  const nextDraft = moveDraftEntry(session.draft, key, toIndex);
  if (nextDraft.every((entry, index) => entry.key === session.draft[index]?.key)) return false;
  useCadUiStore.setState({
    activePickModeSession: { ...session, draft: nextDraft },
    activePickCursor: null
  });
  return true;
};

const pointDraftEntryFor = (
  anchor: PointAnchor,
  context?: CommandContext
) => {
  const candidateElementId = context?.pickedPointCandidateElementId ??
    (anchor.mode === "reference" ? anchor.pointId : anchor.mode === "derived" ? anchor.elementId : null);
  if (!candidateElementId) return null;
  return pickModeDraftEntryForOption(candidateElementId, {
    kind: "point",
    label: "",
    anchor: context?.pickedPointCandidateElementId
      ? anchor
      : context?.pickedPointSourceReference
        ? pointAnchorForSourceReference(context.pickedPointSourceReference)
        : anchor,
    ...(context?.pickedPointSourceReference ? { sourceReference: context.pickedPointSourceReference } : {})
  });
};

const lineDraftEntryFor = (lineId: ElementId, context?: CommandContext) => {
  const candidateElementId = context?.pickedLineCandidateElementId ?? lineId;
  return pickModeDraftEntryForOption(candidateElementId, {
    kind: "line",
    label: "",
    lineId,
    ...(context?.pickedLineSourceReference ? { sourceReference: context.pickedLineSourceReference } : {})
  });
};

const numericDraftEntryFor = (expression: string, context?: CommandContext) => {
  const target = useCadUiStore.getState().activeNumericReferencePickTarget;
  const candidateElementId = context?.numericReferenceCandidateElementId ?? expression.split(".", 1)[0];
  if (!target || !candidateElementId) return null;
  return pickModeDraftEntryForOption(candidateElementId as ElementId, {
    kind: "numericReference",
    label: target.property,
    property: target.property,
    expression
  });
};

export const applyPickReference = (
  ref: PickRef,
  currentEvaluation?: EvaluationResult,
  context?: CommandContext
) => {
  if (cancelStaleCommandLineSession()) return false;
  const resolved = findPickOptionByRef(activePickCandidates(currentEvaluation), ref);
  if (!resolved) return false;
  applyPickOption(resolved.candidate.elementId, resolved.option, context);
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

  applyPickOption(selected.candidate.elementId, selected.option, context);
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

  const activePointPickTarget = {
    elementId: selectedElement.id,
    parameterKey: definition.key,
    ...(draftPointAnchors ? { selectionCardinality: "ordered-multiple" as const } : {}),
    ...(context?.nextParameterKey ? { nextParameterKey: context.nextParameterKey } : {}),
    ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
  };
  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget,
    activePickModeSession: pickModeSessionForTarget(
      "point",
      activePointPickTarget,
      pickModeSelectionCardinalityFor(activePointPickTarget),
      []
    )
  });
  if (draftPointAnchors?.length) seedPickModeDraft("point", draftPointAnchors);
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
  const hasSourceReference = Boolean(sourceReference);
  const { activePointPickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activePointPickTarget) return;
  const commandLineSession = useCadUiStore.getState().commandLineSession;
  const commandLineStep = commandLineStepForPickTarget(activePointPickTarget, commandLineSession);
  if (!context?.pickModeFinish && pickModeSessionForUi()?.kind === "point") {
    if (commandLineStep?.kind === "point" || commandLineStep?.kind === "endpoint" || commandLineStep?.kind === "pointList") {
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
      if (!hasSourceReference && !isValidPickedPointAnchorForTarget({
        elements,
        ...pointPickTargetIds,
        anchor,
        allowLineEndpoint: commandLineStep.kind === "endpoint"
      })) return;
      const pickedAnchor = pickedPointAnchorForTargetForGroup({
        elements,
        targetElementId: pointPickTargetIds.normalizationTargetElementId ?? pointPickTargetIds.targetElementId,
        anchor
      });
      const resolvedPickedAnchor = pickedAnchor ?? (hasSourceReference ? sourceAnchor : null);
      if (!resolvedPickedAnchor) return;
      if (commandLineStep.kind === "endpoint" && !hasSourceReference && !lineEndpointReferenceForPickedAnchor({
        elements,
        targetElementId: pointPickTargetIds.normalizationTargetElementId ?? pointPickTargetIds.targetElementId,
        anchor
      })) return;
      if (!hasSourceReference && resolvedPickedAnchor.mode === "reference") {
        const pointElement = elements.find((element) => element.id === resolvedPickedAnchor.pointId);
        if (!pointElement || !["freePoint", "offsetPoint", "polarOffsetPoint", "divisionPoint", "lineDivisionPoint", "intersectionPoint", "lineTangentOffsetPoint"].includes(pointElement.type)) return;
      }
      if (!hasSourceReference && resolvedPickedAnchor.mode === "derived" && !elements.some((element) => element.id === resolvedPickedAnchor.elementId)) return;
      const entry = pointDraftEntryFor(
        commandLineStep.kind === "endpoint" ? anchor : resolvedPickedAnchor,
        context
      );
      if (!entry) return;
      activatePickModeDraft(entry);
      return;
    }
    if (activePointPickTarget.measurementSlot) {
      const entry = pointDraftEntryFor(anchor, context);
      if (entry) activatePickModeDraft(entry);
      return;
    }
    const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
    if (!targetElement) return;
    const definition = findParameterDefinition(targetElement, activePointPickTarget.parameterKey);
    if (!hasSourceReference && pickedPointAnchorReferencesTarget({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor
    })) return;
    const pickedAnchor = pickedPointAnchorForTargetForGroup({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor
    });
    const resolvedPickedAnchor = pickedAnchor ?? (hasSourceReference ? sourceAnchor : null);
    if (!resolvedPickedAnchor) return;
    if (definition?.kind === "lineEndpointReference" && !hasSourceReference && !lineEndpointReferenceForPickedAnchor({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor
    })) return;
    if (definition?.kind !== "reference" && definition?.kind !== "lineEndpointReference" && definition?.kind !== "pointReferenceList") return;
    if (!hasSourceReference && resolvedPickedAnchor.mode === "reference") {
      const pointElement = elements.find((element) => element.id === resolvedPickedAnchor.pointId);
      if (!pointElement || !["freePoint", "offsetPoint", "polarOffsetPoint", "divisionPoint", "lineDivisionPoint", "intersectionPoint", "lineTangentOffsetPoint"].includes(pointElement.type)) return;
    }
    if (!hasSourceReference && resolvedPickedAnchor.mode === "derived" && !elements.some((element) => element.id === resolvedPickedAnchor.elementId)) return;
    const entry = pointDraftEntryFor(resolvedPickedAnchor, context);
    if (entry) activatePickModeDraft(entry);
    return;
  }
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
    if (!hasSourceReference && !isValidPickedPointAnchorForTarget({
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
    const resolvedPickedAnchor = pickedAnchor ?? (hasSourceReference ? sourceAnchor : null);
    if (!resolvedPickedAnchor) return;
    if (commandLineStep.kind === "endpoint") {
      const endpoint = endpointForSourceReference(sourceReference) ?? lineEndpointReferenceForPickedAnchor({
        elements,
        targetElementId: normalizationTargetId,
        anchor
      });
      if (endpoint) {
        const sourceLineId = sourceReferenceValue(context?.pickedPointSourceReference ?? null);
        fillCommandLineCurrentStep(sourceLineId ? { ...endpoint, lineId: sourceLineId } : endpoint, context);
      }
      return;
    }
    if (!hasSourceReference && resolvedPickedAnchor.mode === "reference") {
      const pointElement = elements.find((element) => element.id === resolvedPickedAnchor.pointId);
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
    if (!hasSourceReference && resolvedPickedAnchor.mode === "derived" && !elements.some((element) => element.id === resolvedPickedAnchor.elementId)) {
      return;
    }
    if (commandLineStep.kind === "pointList") {
      fillCommandLineCurrentStep(
        [context?.pickedPointSourceReference ? sourceAnchor : resolvedPickedAnchor],
        context
      );
      return;
    }
    fillCommandLineCurrentStep(context?.pickedPointSourceReference ? sourceAnchor : resolvedPickedAnchor, context);
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
        const activeLinePickTarget = {
          elementId: current.elementId,
          parameterKey: current.parameterKey,
          measurementSlot: "line" as const
        };
        useCadUiStore.setState({
          activePointPickTarget: null,
          activeLinePickTarget,
          activePickModeSession: pickModeSessionForTarget("line", activeLinePickTarget)
        });
        return;
      }
      const activePointPickTarget = {
        elementId: current.elementId,
        parameterKey: current.parameterKey,
        measurementSlot: "point2"
      } as const;
      useCadUiStore.setState({
        activePointPickTarget,
        activePickModeSession: pickModeSessionForTarget("point", activePointPickTarget),
        activePickCursor: null
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
    !hasSourceReference && pickedPointAnchorReferencesTarget({
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
  const resolvedPickedAnchor = pickedAnchor ?? (hasSourceReference ? sourceAnchor : null);
  if (!resolvedPickedAnchor) return;

  if (definition?.kind === "lineEndpointReference") {
    const endpoint = endpointForSourceReference(sourceReference) ?? lineEndpointReferenceForPickedAnchor({
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
                    lineId: sourceReferenceValue(context.pickedPointSourceReference) ?? endpoint.lineId
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
        const nextPointPickTarget = {
          elementId: activePointPickTarget.elementId,
          parameterKey: nextDefinition.key,
          ...(activePointPickTarget.pickFlow ? { pickFlow: activePointPickTarget.pickFlow } : {})
        };
        useCadUiStore.setState({
          activePointPickTarget: nextPointPickTarget,
          activePickModeSession: pickModeSessionForTarget("point", nextPointPickTarget),
          activePickCursor: null
        });
        return;
      }
    }
    useCadUiStore.getState().setActivePointPickTarget(null);
    return;
  }

  if (definition?.kind !== "reference" && definition?.kind !== "pointReferenceList") return;

  if (!hasSourceReference && resolvedPickedAnchor.mode === "reference") {
    const pointElement = elements.find((element) => element.id === resolvedPickedAnchor.pointId);
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

  if (!hasSourceReference && resolvedPickedAnchor.mode === "derived" && !elements.some((element) => element.id === resolvedPickedAnchor.elementId)) {
    return;
  }

  if (definition.kind === "pointReferenceList") {
    commitDocumentChangeAndSelect({
      elements: elements.map((element) =>
        element.id === activePointPickTarget.elementId
          ? setParameterValue(element, activePointPickTarget.parameterKey, [
              context?.pickedPointSourceReference ? sourceAnchor : resolvedPickedAnchor
            ])
          : element
      )
    }, {
      selectedElementId: activePointPickTarget.elementId,
      selectedElementIds: [activePointPickTarget.elementId],
      selectionAnchorElementId: activePointPickTarget.elementId
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
      const nextPointPickTarget = {
        elementId: activePointPickTarget.elementId,
        parameterKey: nextDefinition.key,
        ...(activePointPickTarget.pickFlow ? { pickFlow: activePointPickTarget.pickFlow } : {})
      };
      useCadUiStore.setState({
        activePointPickTarget: nextPointPickTarget,
        activePickModeSession: pickModeSessionForTarget("point", nextPointPickTarget),
        activePickCursor: null
      });
      return;
    }
  }
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

  const activeLinePickTarget = {
    elementId: selectedElement.id,
    parameterKey: definition.key,
    ...(draftLineIds ? { selectionCardinality: "ordered-multiple" as const } : {}),
    ...(context?.nextParameterKey ? { nextPointParameterKey: context.nextParameterKey } : {}),
    ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
  };
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget,
    activePickModeSession: pickModeSessionForTarget(
      "line",
      activeLinePickTarget,
      pickModeSelectionCardinalityFor(activeLinePickTarget),
      []
    )
  });
  if (draftLineIds?.length) seedPickModeDraft("line", draftLineIds);
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
  const sourceReferenceId = sourceReferenceValue(context?.pickedLineSourceReference ?? null);
  const hasSourceReference = Boolean(context?.pickedLineSourceReference);
  const { activeLinePickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activeLinePickTarget) return;
  const commandLineSession = useCadUiStore.getState().commandLineSession;
  const commandLineStep = commandLineStepForPickTarget(activeLinePickTarget, commandLineSession);
  if (!context?.pickModeFinish && pickModeSessionForUi()?.kind === "line") {
    let normalizedLineId: ElementId | null = pickedLineId;
    if (commandLineStep?.kind === "line" || commandLineStep?.kind === "lineList") {
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
      normalizedLineId = generatedElementIdForTargetForGroup({
        elements,
        targetElementId: normalizationTargetId,
        pickedElementId: pickedLineId
      });
    } else if (activeLinePickTarget.measurementSlot) {
      normalizedLineId = pickedLineId;
    } else {
      normalizedLineId = generatedElementIdForTargetForGroup({
        elements,
        targetElementId: activeLinePickTarget.elementId,
        pickedElementId: pickedLineId
      });
    }
    const pickedLine = normalizedLineId ? elements.find((element) => element.id === normalizedLineId) : null;
    if (!normalizedLineId || (!pickedLine && !hasSourceReference) || (pickedLine && !isLineLikeElement(pickedLine))) return;
    if (!activeLinePickTarget.measurementSlot && normalizedLineId === activeLinePickTarget.elementId) return;
    const entry = lineDraftEntryFor(normalizedLineId, context);
    if (entry) activatePickModeDraft(entry);
    return;
  }
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
    if (!normalizedPickedLineId || (!pickedLine && !hasSourceReference) || (pickedLine && !isLineLikeElement(pickedLine))) return;
    if (commandLineStep.kind === "line") {
      fillCommandLineCurrentStep(sourceReferenceToken ?? normalizedPickedLineId, context);
      return;
    }
    fillCommandLineCurrentStep([sourceReferenceId ?? normalizedPickedLineId], context);
    return;
  }
  if (activeLinePickTarget.measurementSlot) {
    const pickedLine = elements.find((element) => element.id === pickedLineId);
    const current = useCadUiStore.getState().activeMeasurementInsertTarget;
    if (
      !current ||
      (!pickedLine && !hasSourceReference) ||
      (pickedLine && !isLineLikeElement(pickedLine)) ||
      pickedLine?.id === activeLinePickTarget.elementId
    ) return;
    const lineId = sourceReferenceId ?? pickedLine?.id;
    if (!lineId) return;
    useCadUiStore.getState().setActiveMeasurementInsertTarget({
      ...current,
      lineId
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
  if (!normalizedPickedLineId && !hasSourceReference) return;

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
    (!hasSourceReference && (!pickedLine || !isLineLikeElement(pickedLine))) ||
    (!hasSourceReference && normalizedPickedLineId === targetElement.id)
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
        const activePointPickTarget = {
          elementId: targetElement.id,
          parameterKey: nextDefinition.key,
          ...(activeLinePickTarget.pickFlow ? { pickFlow: activeLinePickTarget.pickFlow } : {})
        };
        useCadUiStore.setState({
          activeLinePickTarget: null,
          activePickCursor: null,
          activePointPickTarget,
          activePickModeSession: pickModeSessionForTarget("point", activePointPickTarget)
        });
        return;
      }
    }
    useCadUiStore.getState().setActiveLinePickTarget(null);
    return;
  }

  if (!currentLineIds) return;
  const adoptedLineId = sourceReferenceId ?? normalizedPickedLineId;
  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, [adoptedLineId])
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
};

const pickModeEmptyDraftError = "選択を1件以上追加してから完了してください。";

const clearFinishedPickTarget = (kind: PickModeSession["kind"]) => {
  useCadUiStore.setState({
    ...(kind === "point" ? { activePointPickTarget: null } : {}),
    ...(kind === "line" ? { activeLinePickTarget: null } : {}),
    ...(kind === "numeric-reference" ? { activeNumericReferencePickTarget: null } : {}),
    activePickModeSession: null,
    activePickCursor: null
  });
};

const finishPointDraft = (session: PickModeSession, context?: CommandContext) => {
  const ui = useCadUiStore.getState();
  const target = ui.activePointPickTarget;
  if (!target) return false;
  const pointEntries = session.draft.filter((entry): entry is Extract<PickModeDraftEntry, { kind: "point" }> => entry.kind === "point");
  if (pointEntries.length === 0) return false;
  if (session.selectionCardinality === "single") {
    const entry = pointEntries[0];
    if (!entry) return false;
    applyPickedPoint({
      ...context,
      pickModeFinish: true,
      pickedPointAnchor: entry.anchor,
      ...(entry.sourceReference ? { pickedPointSourceReference: entry.sourceReference } : {})
    });
    return true;
  }

  const values = pointEntries.map((entry) => entry.sourceReference
    ? pointAnchorForSourceReference(entry.sourceReference)
    : entry.anchor);
  const commandLineStep = commandLineStepForPickTarget(target, ui.commandLineSession);
  if (commandLineStep?.kind === "pointList") {
    if (cancelStaleCommandLineSession()) return false;
    fillCommandLineCurrentStep(values, context);
    return true;
  }
  const { elements } = useCadDocumentStore.getState();
  const targetElement = elements.find((element) => element.id === target.elementId);
  const definition = targetElement ? findParameterDefinition(targetElement, target.parameterKey) : null;
  if (!targetElement || definition?.kind !== "pointReferenceList") return false;
  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, target.parameterKey, values)
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
  clearFinishedPickTarget("point");
  return true;
};

const finishLineDraft = (session: PickModeSession, context?: CommandContext) => {
  const ui = useCadUiStore.getState();
  const target = ui.activeLinePickTarget;
  if (!target) return false;
  const lineEntries = session.draft.filter((entry): entry is Extract<PickModeDraftEntry, { kind: "line" }> => entry.kind === "line");
  if (lineEntries.length === 0) return false;
  if (session.selectionCardinality === "single") {
    const entry = lineEntries[0];
    if (!entry) return false;
    applyPickedLine({
      ...context,
      pickModeFinish: true,
      pickedLineId: entry.lineId,
      ...(entry.sourceReference ? { pickedLineSourceReference: entry.sourceReference } : {})
    });
    return true;
  }

  const values = lineEntries.map((entry) => sourceReferenceValue(entry.sourceReference ?? null) ?? entry.lineId);
  const commandLineStep = commandLineStepForPickTarget(target, ui.commandLineSession);
  if (commandLineStep?.kind === "lineList") {
    if (cancelStaleCommandLineSession()) return false;
    fillCommandLineCurrentStep(values, context);
    return true;
  }
  const { elements } = useCadDocumentStore.getState();
  const targetElement = elements.find((element) => element.id === target.elementId);
  const definition = targetElement ? findParameterDefinition(targetElement, target.parameterKey) : null;
  if (!targetElement || definition?.kind !== "lineReferenceList") return false;
  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, target.parameterKey, values)
        : element
    )
  }, {
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id
  });
  clearFinishedPickTarget("line");
  return true;
};

export const finishPickMode = (context?: CommandContext) => {
  const session = pickModeSessionForUi();
  if (!session) return false;
  if (session.draft.length === 0) {
    useCadUiStore.getState().setCommandErrorMessage(pickModeEmptyDraftError);
    return false;
  }
  if (session.kind === "point") return finishPointDraft(session, context);
  if (session.kind === "line") return finishLineDraft(session, context);
  const entry = session.draft.find((candidate): candidate is Extract<PickModeDraftEntry, { kind: "numeric-reference" }> => candidate.kind === "numeric-reference");
  if (!entry) return false;
  applyPickedNumericReference({
    ...context,
    pickModeFinish: true,
    numericReferenceExpression: entry.expression
  });
  return true;
};

export const cancelPickMode = (context?: CommandContext) => {
  const session = pickModeSessionForUi();
  if (!session) return false;
  const ui = useCadUiStore.getState();
  const commandLineOwned = commandLineStepForPickTarget(
    session.kind === "point" ? ui.activePointPickTarget : session.kind === "line" ? ui.activeLinePickTarget : ui.activeNumericReferencePickTarget,
    ui.commandLineSession
  ) !== null;
  useCadUiStore.setState({
    ...(commandLineOwned ? {} : session.kind === "point" ? { activePointPickTarget: null } : session.kind === "line" ? { activeLinePickTarget: null } : { activeNumericReferencePickTarget: null }),
    activePickModeSession: null,
    activePickCursor: null
  });
  if (!commandLineOwned) context?.focusSourceEditor?.();
  return true;
};

export const cancelLinePick = (context?: CommandContext) => {
  if (!cancelPickMode(context)) useCadUiStore.getState().setActiveLinePickTarget(null);
};

export const finishLinePick = (context?: CommandContext) => finishPickMode(context);

export const finishPointPick = (context?: CommandContext) => finishPickMode(context);

export const cancelPointPick = (context?: CommandContext) => {
  if (!cancelPickMode(context)) useCadUiStore.getState().setActivePointPickTarget(null);
};

export const cancelNumericReferencePick = (context?: CommandContext) => {
  if (!cancelPickMode(context)) useCadUiStore.getState().setActiveNumericReferencePickTarget(null);
};
