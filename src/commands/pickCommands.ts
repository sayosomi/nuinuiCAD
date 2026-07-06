import { evaluateElements } from "../geometry/evaluate";
import { numericReferencePickProperties } from "../geometry/numericReferenceProperties";
import { insertNumericExpressionSnippet as insertSnippetIntoExpression } from "../geometry/numericExpressionInsertion";
import {
  makeNumericExpression,
  normalizeNumericExpressionInput,
  numericValueExpression,
  pointAnchorExpression
} from "../geometry/numericExpressions";
import {
  generatedElementIdForTargetForGroup,
  lineEndpointReferenceForPickedAnchor,
  pickedPointAnchorReferencesTarget,
  pickedPointAnchorForTargetForGroup
} from "../model/forGroupGeneratedReferences";
import { pickCandidates, selectedPickOption } from "../model/pickCandidates";
import { referenceAnchor } from "../model/pointAnchors";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  applyTemplatePickedLine,
  applyTemplatePickedPoint,
  insertTemplateNumericExpressionSnippet,
  startTemplateNumericReferenceInsertPick,
  templateNumericTargetContext
} from "../templates/templateInsertionCommands";
import { TEMPLATE_INSERTION_NUMERIC_TARGET_ID } from "../templates/templateInsertionMode";
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

  const templateTarget = templateNumericTargetContext(context?.elementId, context?.parameterKey);
  if (templateTarget) {
    insertTemplateNumericExpressionSnippet({
      inputId: templateTarget.inputId,
      snippet,
      displayedExpression: context?.displayedExpression,
      selectionStart: context?.selectionStart,
      selectionEnd: context?.selectionEnd,
      appendMode: context?.numericExpressionAppendMode
    });
    return;
  }

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
    selectionEnd: context?.selectionEnd,
    appendMode: context?.numericExpressionAppendMode
  });
  const nextExpression = normalizeNumericExpressionInput(
    nextDisplayExpression,
    target.elements,
    target.targetElement.numericVariables ?? [],
    target.targetElement
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

export const openExpressionInsertTray = (context?: CommandContext) => {
  const target = numericExpressionTarget(context);
  if (!target) return;

  useCadUiStore.getState().setActiveExpressionInsertTarget({
    elementId: target.targetElement.id,
    parameterKey: target.definition.key
  });
};

export const closeExpressionInsertTray = () => {
  useCadUiStore.setState({
    activeExpressionInsertTarget: null,
    activeMeasurementInsertTarget: null,
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activePickCursor: null
  });
};

const measurementTargetFromContext = (context?: CommandContext) => {
  const templateTarget = templateNumericTargetContext(context?.elementId, context?.parameterKey);
  if (templateTarget) {
    const { activeMeasurementInsertTarget } = useCadUiStore.getState();
    const mode =
      context?.measurementInsertMode ??
      (activeMeasurementInsertTarget?.elementId === TEMPLATE_INSERTION_NUMERIC_TARGET_ID &&
      activeMeasurementInsertTarget.parameterKey === templateTarget.inputId
        ? activeMeasurementInsertTarget.mode
        : "distance");
    const currentValue =
      templateTarget.insertion.inputValues[templateTarget.inputId] ?? templateTarget.input.defaultValue;
    const displayedExpression =
      context?.displayedExpression ??
      activeMeasurementInsertTarget?.displayedExpression ??
      numericValueExpression(currentValue as NumericValue);

    return {
      elementId: TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
      parameterKey: templateTarget.inputId,
      mode,
      displayedExpression,
      selectionStart: context?.selectionStart ?? activeMeasurementInsertTarget?.selectionStart ?? null,
      selectionEnd: context?.selectionEnd ?? activeMeasurementInsertTarget?.selectionEnd ?? null
    };
  }

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
    (isNumericValue(currentValue) ? numericValueExpression(currentValue) : "");

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

export const startNumericReferencePick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "number") return;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      mode: "replace",
      property: "length"
    }
  });
};

export const startNumericReferenceInsertPick = (context?: CommandContext) => {
  const templateTarget = templateNumericTargetContext(context?.elementId, context?.parameterKey);
  if (templateTarget) {
    startTemplateNumericReferenceInsertPick({
      inputId: templateTarget.inputId,
      property: context?.numericReferenceProperty ?? "length",
      displayedExpression: context?.displayedExpression ?? numericValueExpression(
        (templateTarget.insertion.inputValues[templateTarget.inputId] ?? templateTarget.input.defaultValue) as NumericValue
      ),
      selectionStart: context?.selectionStart ?? null,
      selectionEnd: context?.selectionEnd ?? null
    });
    return;
  }

  const target = numericExpressionTarget(context);
  if (!target) return;
  const currentValue = getParameterValue(target.targetElement, target.definition.key);
  const displayedExpression =
    context?.displayedExpression ??
    (isNumericValue(currentValue) ? numericValueExpression(currentValue) : "");

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

export const applyPickedNumericReference = (context?: Pick<CommandContext, "numericReferenceExpression">) => {
  const numericExpression = context?.numericReferenceExpression;
  if (!numericExpression) return;
  const { activeNumericReferencePickTarget } = useCadUiStore.getState();
  if (!activeNumericReferencePickTarget) return;
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

const activePickCandidates = () => {
  const {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  } = useCadUiStore.getState();
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  return pickCandidates(elements, evaluateElements(elements, { evaluationLimitIndex }), {
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
  if (selected.option.kind === "numericReference" || selected.option.kind === "variableReference") {
    applyPickedNumericReference({
      numericReferenceExpression: selected.option.expression
    });
  }
};

export const startPointPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey"> & {
    pickFlow?: "lineEndpointPair" | "lineAndPoint" | "endpointPair" | "endpointAndPoint";
  }
) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const selectedElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : getSelectedElement();
  const definition = context?.parameterKey
    ? selectedElement
      ? findParameterDefinition(selectedElement, context.parameterKey)
      : null
    : selectedParameterDefinition();
  if (
    !selectedElement ||
    (definition?.kind !== "reference" && definition?.kind !== "lineEndpointReference")
  ) return;

  useCadUiStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      ...(context?.nextParameterKey ? { nextParameterKey: context.nextParameterKey } : {}),
      ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
    }
  });
};

export const startLineEndpointPairPick = (context?: Pick<CommandContext, "elementId">) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
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
  const { elements, selectedElementId } = useCadDocumentStore.getState();
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
  const { elements, selectedElementId } = useCadDocumentStore.getState();
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

export const applyPickedPoint = (context?: Pick<CommandContext, "pickedPointId" | "pickedPointAnchor">) => {
  const anchor = context?.pickedPointAnchor ?? (context?.pickedPointId ? referenceAnchor(context.pickedPointId) : null);
  if (!anchor) return;
  if (applyTemplatePickedPoint(anchor)) return;
  const { activePointPickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activePointPickTarget) return;
  if (activePointPickTarget.measurementSlot) {
    const current = useCadUiStore.getState().activeMeasurementInsertTarget;
    if (!current) return;
    useCadUiStore.getState().setActiveMeasurementInsertTarget({
      ...current,
      [activePointPickTarget.measurementSlot === "point1" ? "point1Anchor" : "point2Anchor"]: anchor
    });
    useCadUiStore.getState().setActivePointPickTarget(null);
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

  if (definition?.kind !== "reference") return;

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

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === activePointPickTarget.elementId
        ? setParameterValue(element, activePointPickTarget.parameterKey, pickedAnchor)
        : element
    ),
    selectedElementId: activePointPickTarget.elementId,
    selectedElementIds: [activePointPickTarget.elementId],
    selectionAnchorElementId: activePointPickTarget.elementId,
    selectedParameterKey: activePointPickTarget.parameterKey
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
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const targetElementId = context?.elementId ?? selectedElementId;
  const selectedElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : getSelectedElement();
  const definition = context?.parameterKey
    ? selectedElement
      ? findParameterDefinition(selectedElement, context.parameterKey)
      : null
    : selectedParameterDefinition();
  if (!selectedElement || (definition?.kind !== "lineReferenceList" && definition?.kind !== "lineReference")) return;

  useCadUiStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key,
      ...(context?.nextParameterKey ? { nextPointParameterKey: context.nextParameterKey } : {}),
      ...(context?.pickFlow ? { pickFlow: context.pickFlow } : {})
    }
  });
};

export const startLineAndPointPick = (
  context?: Pick<CommandContext, "elementId" | "parameterKey" | "nextParameterKey">
) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
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

export const applyPickedLine = (context?: Pick<CommandContext, "pickedLineId">) => {
  const pickedLineId = context?.pickedLineId;
  if (!pickedLineId) return;
  if (applyTemplatePickedLine(pickedLineId)) return;
  const { activeLinePickTarget } = useCadUiStore.getState();
  const { elements } = useCadDocumentStore.getState();
  if (!activeLinePickTarget) return;
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
      lineId: pickedLine.id
    });
    useCadUiStore.getState().setActiveLinePickTarget(null);
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
    useCadDocumentStore.getState().commitDocumentChange({
      elements: elements.map((element) =>
        element.id === targetElement.id
          ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, normalizedPickedLineId)
          : element
      ),
      selectedElementId: targetElement.id,
      selectedElementIds: [targetElement.id],
      selectionAnchorElementId: targetElement.id,
      selectedParameterKey: activeLinePickTarget.parameterKey
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

  if (!currentLineIds || currentLineIds.includes(normalizedPickedLineId)) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === targetElement.id
        ? setParameterValue(targetElement, activeLinePickTarget.parameterKey, [
            ...currentLineIds,
            normalizedPickedLineId
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
