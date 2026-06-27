import { evaluateElements } from "../geometry/evaluate";
import { insertNumericExpressionSnippet as insertSnippetIntoExpression } from "../geometry/numericExpressionInsertion";
import {
  makeNumericExpression,
  normalizeNumericExpressionInput,
  numericValueExpression
} from "../geometry/numericExpressions";
import { pickCandidates, selectedPickOption } from "../model/pickCandidates";
import { lineEndpointReferenceForAnchor, referenceAnchor } from "../model/pointAnchors";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId } from "../types/geometry";
import type { NumericValue } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElement, isLineLikeElement, selectedParameterDefinition } from "./commandRuntime";

export const applyNumericExpressionReference = (context?: CommandContext) => {
  const numericExpression = context?.numericExpression;
  if (!numericExpression) return;
  const { elements, selectedElementId, selectedParameterKey } = useCadDocumentStore.getState();
  const targetElementId = context.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement) return;

  const key = context.parameterKey ?? selectedParameterKey;
  const definition = findParameterDefinition(targetElement, key);
  if (definition?.kind !== "number") return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(element, definition.key, makeNumericExpression(numericExpression))
        : element
    ),
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id,
    selectedParameterKey: definition.key
  });
};

const isNumericValue = (value: unknown): value is NumericValue =>
  typeof value === "number" ||
  (typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "expression");

const numericExpressionTarget = (context?: CommandContext) => {
  const { elements, selectedElementId, selectedParameterKey } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement) return null;

  const key = context?.parameterKey ?? selectedParameterKey;
  const definition = findParameterDefinition(targetElement, key);
  if (definition?.kind !== "number") return null;

  return { elements, targetElement, definition };
};

export const insertNumericExpressionSnippet = (context?: CommandContext) => {
  const snippet = context?.numericExpressionSnippet;
  if (!snippet) return;

  const target = numericExpressionTarget(context);
  if (!target) return;

  const currentValue = getParameterValue(target.targetElement, target.definition.key);
  const displayedExpression =
    context?.displayedExpression ??
    (isNumericValue(currentValue) ? numericValueExpression(currentValue) : "");
  const nextDisplayExpression = insertSnippetIntoExpression({
    currentExpression: displayedExpression,
    snippet,
    selectionStart: context?.selectionStart,
    selectionEnd: context?.selectionEnd
  });
  const nextExpression = normalizeNumericExpressionInput(
    nextDisplayExpression,
    target.elements,
    target.targetElement.numericVariables ?? []
  );

  useCadDocumentStore.getState().commitDocumentChange({
    elements: target.elements.map((element) =>
      element.id === target.targetElement.id
        ? setParameterValue(element, target.definition.key, makeNumericExpression(nextExpression))
        : element
    ),
    selectedElementId: target.targetElement.id,
    selectedElementIds: [target.targetElement.id],
    selectionAnchorElementId: target.targetElement.id,
    selectedParameterKey: target.definition.key
  });
};

export const toggleExpressionInsertTray = (context?: CommandContext) => {
  const target = numericExpressionTarget(context);
  if (!target) return;

  const current = useCadUiStore.getState().activeExpressionInsertTarget;
  const nextTarget = {
    elementId: target.targetElement.id,
    parameterKey: target.definition.key
  };
  useCadUiStore.getState().setActiveExpressionInsertTarget(
    current?.elementId === nextTarget.elementId && current.parameterKey === nextTarget.parameterKey
      ? null
      : nextTarget
  );
};

export const closeExpressionInsertTray = () => {
  useCadUiStore.getState().setActiveExpressionInsertTarget(null);
};

export const startNumericReferencePick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "number") return;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

export const applyPickedNumericReference = (context?: Pick<CommandContext, "numericReferenceExpression">) => {
  const numericExpression = context?.numericReferenceExpression;
  if (!numericExpression) return;
  const { activeNumericReferencePickTarget } = useCadUiStore.getState();
  if (!activeNumericReferencePickTarget) return;

  applyNumericExpressionReference({
    elementId: activeNumericReferencePickTarget.elementId,
    parameterKey: activeNumericReferencePickTarget.parameterKey,
    numericExpression
  });
  useCadUiStore.getState().setActiveNumericReferencePickTarget(null);
};

export const cancelNumericReferencePick = () => {
  useCadUiStore.getState().setActiveNumericReferencePickTarget(null);
};

const activePickCandidates = () => {
  const {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  return pickCandidates(elements, evaluateElements(elements), {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  });
};

export const selectPickCandidateByOffset = (offset: number) => {
  const candidates = activePickCandidates();
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

export const selectPickOptionByOffset = (offset: number) => {
  const candidates = activePickCandidates();
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

export const applySelectedPickCandidate = () => {
  const candidates = activePickCandidates();
  const selected = selectedPickOption(candidates, useCadUiStore.getState().activePickCursor);
  if (!selected) return;

  if (selected.option.kind === "point") {
    applyPickedPoint({ pickedPointAnchor: selected.option.anchor });
    return;
  }
  if (selected.option.kind === "line") {
    applyPickedLine({ pickedLineId: selected.option.lineId });
    return;
  }
  applyPickedNumericReference({
    numericReferenceExpression: selected.option.expression
  });
};

export const startPointPick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (
    !selectedElement ||
    (definition?.kind !== "reference" && definition?.kind !== "lineEndpointReference")
  ) return;

  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

export const applyPickedPoint = (context?: Pick<CommandContext, "pickedPointId" | "pickedPointAnchor">) => {
  const anchor = context?.pickedPointAnchor ?? (context?.pickedPointId ? referenceAnchor(context.pickedPointId) : null);
  if (!anchor) return;
  const { activePointPickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activePointPickTarget) return;
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  if (!targetElement) return;

  const definition = findParameterDefinition(targetElement, activePointPickTarget.parameterKey);
  if (definition?.kind === "lineEndpointReference") {
    const endpoint = lineEndpointReferenceForAnchor(anchor, elements);
    if (!endpoint) return;

    useCadDocumentStore.getState().commitDocumentChange({
      elements: elements.map((element) =>
        element.id === activePointPickTarget.elementId
          ? setParameterValue(element, activePointPickTarget.parameterKey, endpoint)
          : element
      ),
      selectedElementId: activePointPickTarget.elementId,
      selectedElementIds: [activePointPickTarget.elementId],
      selectionAnchorElementId: activePointPickTarget.elementId,
      selectedParameterKey: activePointPickTarget.parameterKey
    });
    useCadUiStore.getState().setActivePointPickTarget(null);
    return;
  }

  if (definition?.kind !== "reference") return;

  if (anchor.mode === "reference") {
    const pointElement = elements.find((element) => element.id === anchor.pointId);
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

  if (anchor.mode === "derived" && !elements.some((element) => element.id === anchor.elementId)) {
    return;
  }

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === activePointPickTarget.elementId
        ? setParameterValue(element, activePointPickTarget.parameterKey, anchor)
        : element
    ),
    selectedElementId: activePointPickTarget.elementId,
    selectedElementIds: [activePointPickTarget.elementId],
    selectionAnchorElementId: activePointPickTarget.elementId,
    selectedParameterKey: activePointPickTarget.parameterKey
  });
  useCadUiStore.getState().setActivePointPickTarget(null);
};

export const cancelPointPick = () => {
  useCadUiStore.getState().setActivePointPickTarget(null);
};

export const startLinePick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || (definition?.kind !== "lineReferenceList" && definition?.kind !== "lineReference")) return;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

export const applyPickedLine = (context?: Pick<CommandContext, "pickedLineId">) => {
  const pickedLineId = context?.pickedLineId;
  if (!pickedLineId) return;
  const { activeLinePickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activeLinePickTarget) return;

  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  const pickedLine = elements.find((element) => element.id === pickedLineId);
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
    pickedLine.id === targetElement.id
  ) {
    return;
  }

  if (definition.kind === "lineReference") {
    useCadDocumentStore.getState().commitDocumentChange({
      elements: elements.map((element) =>
        element.id === targetElement.id
          ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, pickedLine.id)
          : element
      ),
      selectedElementId: targetElement.id,
      selectedElementIds: [targetElement.id],
      selectionAnchorElementId: targetElement.id,
      selectedParameterKey: activeLinePickTarget.parameterKey
    });
    useCadUiStore.getState().setActiveLinePickTarget(null);
    return;
  }

  if (!currentLineIds || currentLineIds.includes(pickedLine.id)) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, [
            ...currentLineIds,
            pickedLine.id
          ])
        : element
    ),
    selectedElementId: targetElement.id,
    selectedElementIds: [targetElement.id],
    selectionAnchorElementId: targetElement.id,
    selectedParameterKey: activeLinePickTarget.parameterKey
  });
};

export const cancelLinePick = () => {
  useCadUiStore.getState().setActiveLinePickTarget(null);
};
