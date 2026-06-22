import { useCadStore } from "../state/useCadStore";
import type { CadHistorySnapshot } from "../state/useCadStore";
import {
  addToNumericValue,
  makeNumericExpression
} from "../geometry/numericExpressions";
import { evaluateElements } from "../geometry/evaluate";
import { createCadElementId } from "../model/cadIds";
import { getDependencyJumpTargets } from "../model/dependencies";
import { moveElementsToInsertionIndex as moveDocumentElementsToInsertionIndex } from "../model/documentOrder";
import { pickCandidates, selectedPickOption } from "../model/pickCandidates";
import {
  elementIdByOffset,
  elementIdsInDocumentOrder,
  selectedIndexes,
  toggleSelectionIds
} from "../model/documentSelection";
import {
  type BezierHandleRole,
  moveBezierHandleByDeltaInElements,
  movePointElementByDeltaInElements
} from "../model/elementDragTransforms";
import { createCadElement } from "../model/elementFactory";
import {
  findParameterByDirectKey,
  findParameterDefinition,
  getFirstParameterKey,
  getNumericParameterStep,
  getNumericParameterStepLevels,
  getParameterDefinitions,
  normalizeParameterKey,
  pointAnchorReferenceOptions
} from "../parameters/parameterDefinitions";
import {
  getParameterValue,
  getPointAnchor,
  parseAnchorCoordinateParameterKey,
  setParameterValue,
  supportsNumericVariables
} from "../parameters/parameterAccess";
import {
  anchorEquals,
  lineEndpointReferenceForAnchor,
  lineEndpointReferenceEquals,
  lineEndpointReferenceOptions,
  derivedAnchor,
  referenceAnchor
} from "../model/pointAnchors";
import type {
  CadElement,
  CadElementType,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";

export type { BezierHandleRole };

export type CommandId =
  | "undo"
  | "redo"
  | "selectElement"
  | "selectNextElement"
  | "selectPreviousElement"
  | "extendSelectionToNextElement"
  | "extendSelectionToPreviousElement"
  | "moveSelectedElementUp"
  | "moveSelectedElementDown"
  | "moveElementToInsertionIndex"
  | "movePointElementByDelta"
  | "moveBezierHandleByDelta"
  | "applyNumericExpressionReference"
  | "startNumericReferencePick"
  | "applyPickedNumericReference"
  | "cancelNumericReferencePick"
  | "selectNextPickCandidate"
  | "selectPreviousPickCandidate"
  | "selectNextPickOption"
  | "selectPreviousPickOption"
  | "applySelectedPickCandidate"
  | "startPointPick"
  | "applyPickedPoint"
  | "cancelPointPick"
  | "startLinePick"
  | "applyPickedLine"
  | "cancelLinePick"
  | "toggleElementVisibility"
  | "toggleElementEnabled"
  | "toggleSelectedElementVisibility"
  | "toggleSelectedElementEnabled"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addOffsetPoint"
  | "addPolarOffsetPoint"
  | "addDivisionPoint"
  | "addLineDivisionPoint"
  | "addIntersectionPoint"
  | "addLineTangentOffsetPoint"
  | "addLine"
  | "addArcLine"
  | "addThreePointArcLine"
  | "addBezierCurve"
  | "addOffsetLine"
  | "addNumericVariable"
  | "deleteNumericVariable"
  | "addBezierNumericVariable"
  | "deleteBezierNumericVariable"
  | "addBezierIntermediatePoint"
  | "deleteBezierIntermediatePoint"
  | "zoomInCanvas"
  | "zoomOutCanvas"
  | "resetCanvasView"
  | "openCommandPalette"
  | "closeCommandPalette"
  | "focusCanvas"
  | "focusElementList"
  | "enterElementListMode"
  | "toggleShortcutHelp"
  | "toggleElementInfoPanel"
  | "enterDependencyJumpMode"
  | "exitDependencyJumpMode"
  | "selectNextDependencyJumpTarget"
  | "selectPreviousDependencyJumpTarget"
  | "jumpToSelectedDependencyTarget"
  | "enterParameterEditMode"
  | "exitParameterEditMode"
  | "selectNextParameter"
  | "selectPreviousParameter"
  | "selectParameterByKey"
  | "incrementSelectedParameter"
  | "decrementSelectedParameter"
  | "increaseSelectedParameterStep"
  | "decreaseSelectedParameterStep"
  | "cycleSelectedReferenceForward"
  | "cycleSelectedReferenceBackward"
  | "toggleSelectedParameterValue"
  | "toggleSelectedPointAnchorMode"
  | "setSelectedPointAnchorReferenceMode"
  | "setSelectedPointAnchorCoordinateMode"
  | "toggleSelectedBooleanParameter"
  | "toggleBooleanParameterByDirectKey"
  | "activateSelectedParameter"
  | "focusSelectedParameterInput";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
  focusSelectedParameterInput?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
  parameterDirectKey?: string;
  stepMultiplier?: number;
  elementId?: ElementId;
  insertionIndex?: number;
  selectionMode?: "replace" | "toggle" | "range";
  dx?: number;
  dy?: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
  bezierHandleRole?: BezierHandleRole;
  commitMode?: "preview" | "commit";
  baseElements?: CadElement[];
  historySnapshot?: CadHistorySnapshot;
  parameterKey?: string;
  numericExpression?: string;
  numericReferenceExpression?: string;
  intermediatePointId?: string;
  variableId?: string;
  pointAnchorMode?: "reference" | "coordinate";
  pickedPointId?: ElementId;
  pickedPointAnchor?: PointAnchor;
  pickedLineId?: ElementId;
};

export type Command = {
  id: CommandId;
  label: string;
  run: (context?: CommandContext) => void;
};

const getSelectedElementIds = () => {
  const { elements, selectedElementId, selectedElementIds } = useCadStore.getState();
  if (selectedElementId && !selectedElementIds.includes(selectedElementId)) {
    return [selectedElementId];
  }
  if (selectedElementIds.length > 0) {
    return elementIdsInDocumentOrder(elements, selectedElementIds);
  }
  return selectedElementId ? [selectedElementId] : [];
};

const getSelectedElement = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  return selectedElementId ? elements.find((element) => element.id === selectedElementId) ?? null : null;
};

const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine";

const isPointLikeElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint";

const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements, selectedElementId } = useCadStore.getState();
  if (!selectedElementId) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};

const movePointElementByDelta = ({
  elementId,
  dx = 0,
  dy = 0,
  angleLocked,
  distanceLocked,
  commitMode = "commit",
  baseElements,
  historySnapshot
}: CommandContext) => {
  if (!elementId) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadStore.getState().elements;
  const nextElements = movePointElementByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    angleLocked,
    distanceLocked
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadStore.getState().commitDocumentChange({ elements: nextElements });
};

const moveBezierHandleByDelta = ({
  elementId,
  dx = 0,
  dy = 0,
  bezierHandleRole,
  intermediatePointId,
  angleLocked,
  distanceLocked,
  commitMode = "commit",
  baseElements,
  historySnapshot
}: CommandContext) => {
  if (!elementId || !bezierHandleRole) return;
  if (dx === 0 && dy === 0) {
    if (baseElements) {
      useCadStore.getState().previewDocumentChange({ elements: baseElements });
    }
    return;
  }

  const sourceElements = baseElements ?? useCadStore.getState().elements;
  const nextElements = moveBezierHandleByDeltaInElements(sourceElements, elementId, {
    dx,
    dy,
    role: bezierHandleRole,
    intermediatePointId,
    angleLocked,
    distanceLocked
  });
  if (!nextElements) return;

  if (commitMode === "preview") {
    useCadStore.getState().previewDocumentChange({ elements: nextElements });
    return;
  }

  if (historySnapshot) {
    useCadStore.getState().commitDocumentChangeFromSnapshot(historySnapshot, {
      elements: nextElements
    });
    return;
  }

  useCadStore.getState().commitDocumentChange({ elements: nextElements });
};

const selectedParameterDefinition = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return null;
  const { selectedParameterKey } = useCadStore.getState();
  return findParameterDefinition(selectedElement, selectedParameterKey);
};

const coordinateAnchor = (x: NumericValue = 0, y: NumericValue = 0): PointAnchor => ({
  mode: "coordinate",
  x,
  y
});

const anchorPointId = (anchor: PointAnchor) => (anchor.mode === "reference" ? anchor.pointId : null);

const parentPointAnchorParameterKey = (parameterKey: string | null | undefined) => {
  if (!parameterKey) return null;
  return parseAnchorCoordinateParameterKey(parameterKey)?.anchorKey ?? parameterKey;
};

const pointAnchorParameterTarget = (context?: CommandContext) => {
  const { elements, selectedElementId, selectedParameterKey } = useCadStore.getState();
  const elementId = context?.elementId ?? selectedElementId;
  const element = elementId ? elements.find((item) => item.id === elementId) ?? null : null;
  if (!element) return null;

  const parameterKey = parentPointAnchorParameterKey(context?.parameterKey ?? selectedParameterKey);
  if (!parameterKey) return null;

  const definition = findParameterDefinition(element, parameterKey);
  if (definition?.kind !== "reference") return null;

  const anchor = getPointAnchor(element, parameterKey);
  if (!anchor) return null;

  return { element, parameterKey, definition, anchor };
};

const isLineEndpointReferenceValue = (value: unknown): value is LineEndpointReference =>
  typeof value === "object" &&
  value !== null &&
  "lineId" in value &&
  "endpointKey" in value &&
  typeof value.lineId === "string" &&
  (value.endpointKey === "start" || value.endpointKey === "end");

const addElement = (type: CadElementType) => {
  const { elements } = useCadStore.getState();
  const element = createCadElement(type, elements);
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, element],
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id,
    selectedParameterKey: getFirstParameterKey(element)
  });
};

const addOffsetLine = () => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedBaseLineIds = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackBaseLineId = elements.find(isLineLikeElement)?.id;
  const element = createCadElement("offsetLine", elements);
  if (element.type !== "offsetLine") return;
  const offsetLine: CadElement = {
    ...element,
    baseLineIds: selectedBaseLineIds.length > 0
      ? selectedBaseLineIds
      : fallbackBaseLineId
        ? [fallbackBaseLineId]
        : []
  };
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, offsetLine],
    selectedElementId: offsetLine.id,
    selectedElementIds: [offsetLine.id],
    selectionAnchorElementId: offsetLine.id,
    selectedParameterKey: getFirstParameterKey(offsetLine)
  });
};

const selectParameterByOffset = (offset: number) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return;

  const definitions = getParameterDefinitions(selectedElement);
  const { selectedParameterKey } = useCadStore.getState();
  const index = definitions.findIndex((definition) => definition.key === selectedParameterKey);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = (currentIndex + offset + definitions.length) % definitions.length;
  useCadStore.setState({ selectedParameterKey: definitions[nextIndex].key });
};

const stepForContext = (context?: CommandContext) => context?.stepMultiplier ?? 1;

const nextNumericParameterStep = (
  currentStep: number,
  direction: 1 | -1,
  stepLevels: readonly number[]
) => {
  if (direction > 0) {
    return stepLevels.find((step) => step > currentStep) ?? stepLevels.at(-1)!;
  }

  for (let index = stepLevels.length - 1; index >= 0; index -= 1) {
    const step = stepLevels[index];
    if (step < currentStep) return step;
  }
  return stepLevels[0];
};

const updateNumericParameter = (direction: 1 | -1, context?: CommandContext) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || !definition) return;
  if (definition.kind === "reference") {
    cycleReferenceParameter(direction);
    return;
  }
  if (definition.kind === "lineEndpointReference") {
    cycleLineEndpointParameter(direction);
    return;
  }
  if (definition.kind === "lineReference") {
    cycleLineReferenceParameter(direction);
    return;
  }
  if (definition.kind === "choice") {
    cycleChoiceParameter(direction);
    return;
  }
  if (definition.kind !== "number") return;

  const delta = getNumericParameterStep(selectedElement, definition.key) * stepForContext(context) * direction;
  updateSelectedElement((element) => ({
    ...setParameterValue(
      element,
      definition.key,
      addToNumericValue(getParameterValue(element, definition.key) as NumericValue, delta)
    )
  }));
};

const cycleChoiceParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "choice" || !definition.choiceOptions?.length) return;

  const currentValue = getParameterValue(selectedElement, definition.key);
  const currentIndex = definition.choiceOptions.findIndex((option) => option === currentValue);
  const nextIndex =
    currentIndex < 0
      ? 0
      : (currentIndex + direction + definition.choiceOptions.length) % definition.choiceOptions.length;
  updateSelectedElement((element) =>
    setParameterValue(element, definition.key, definition.choiceOptions![nextIndex])
  );
};

const nextChoiceValue = (
  element: CadElement,
  definition: NonNullable<ReturnType<typeof selectedParameterDefinition>>
) => {
  if (definition.kind !== "choice" || !definition.choiceOptions?.length) return null;
  const currentValue = getParameterValue(element, definition.key);
  const currentIndex = definition.choiceOptions.findIndex((option) => option === currentValue);
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + 1) % definition.choiceOptions.length;
  return definition.choiceOptions[nextIndex];
};

const applyParameterDirectKey = (
  directKey: string | undefined,
  focusSelectedParameterInput?: () => void
) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !directKey) return;

  const definition = findParameterByDirectKey(selectedElement, directKey);
  if (!definition) return;

  if (definition.kind === "boolean") {
    useCadStore.getState().commitDocumentChange({
      elements: useCadStore.getState().elements.map((element) =>
        element.id === selectedElement.id
          ? setParameterValue(
              element,
              definition.key,
              !getParameterValue(element, definition.key)
            )
          : element
      ),
      selectedParameterKey: definition.key
    });
    return;
  }

  if (definition.kind === "choice") {
    const nextValue = nextChoiceValue(selectedElement, definition);
    if (nextValue === null) {
      useCadStore.setState({ selectedParameterKey: definition.key });
      return;
    }
    useCadStore.getState().commitDocumentChange({
      elements: useCadStore.getState().elements.map((element) =>
        element.id === selectedElement.id
          ? setParameterValue(element, definition.key, nextValue)
          : element
      ),
      selectedParameterKey: definition.key
    });
    return;
  }

  useCadStore.setState({ selectedParameterKey: definition.key });
  focusSelectedParameterInput?.();
};

const applyNumericExpressionReference = (context?: CommandContext) => {
  const numericExpression = context?.numericExpression;
  if (!numericExpression) return;
  const { elements, selectedElementId, selectedParameterKey } = useCadStore.getState();
  const targetElementId = context.elementId ?? selectedElementId;
  const targetElement = targetElementId
    ? elements.find((element) => element.id === targetElementId) ?? null
    : null;
  if (!targetElement) return;

  const key = context.parameterKey ?? selectedParameterKey;
  const definition = findParameterDefinition(targetElement, key);
  if (definition?.kind !== "number") return;

  useCadStore.getState().commitDocumentChange({
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

const startNumericReferencePick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "number") return;

  useCadStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

const applyPickedNumericReference = (context?: Pick<CommandContext, "numericReferenceExpression">) => {
  const numericExpression = context?.numericReferenceExpression;
  if (!numericExpression) return;
  const { activeNumericReferencePickTarget } = useCadStore.getState();
  if (!activeNumericReferencePickTarget) return;

  applyNumericExpressionReference({
    elementId: activeNumericReferencePickTarget.elementId,
    parameterKey: activeNumericReferencePickTarget.parameterKey,
    numericExpression
  });
  useCadStore.getState().setActiveNumericReferencePickTarget(null);
};

const cancelNumericReferencePick = () => {
  useCadStore.getState().setActiveNumericReferencePickTarget(null);
};

const activePickCandidates = () => {
  const {
    elements,
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  } = useCadStore.getState();
  return pickCandidates(elements, evaluateElements(elements), {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  });
};

const selectPickCandidateByOffset = (offset: number) => {
  const candidates = activePickCandidates();
  if (candidates.length === 0) {
    useCadStore.getState().setActivePickCursor(null);
    return;
  }

  const { activePickCursor } = useCadStore.getState();
  const currentIndex = activePickCursor
    ? candidates.findIndex((candidate) => candidate.elementId === activePickCursor.elementId)
    : -1;
  const nextIndex =
    currentIndex < 0
      ? offset > 0 ? 0 : candidates.length - 1
      : (currentIndex + offset + candidates.length) % candidates.length;
  const candidate = candidates[nextIndex];
  const optionIndex = Math.min(activePickCursor?.optionIndex ?? 0, candidate.options.length - 1);
  useCadStore.getState().setActivePickCursor({
    elementId: candidate.elementId,
    optionIndex
  });
};

const selectPickOptionByOffset = (offset: number) => {
  const candidates = activePickCandidates();
  const selected = selectedPickOption(candidates, useCadStore.getState().activePickCursor);
  if (!selected) {
    useCadStore.getState().setActivePickCursor(null);
    return;
  }

  const optionCount = selected.candidate.options.length;
  const optionIndex = (selected.cursor.optionIndex + offset + optionCount) % optionCount;
  useCadStore.getState().setActivePickCursor({
    elementId: selected.candidate.elementId,
    optionIndex
  });
};

const applySelectedPickCandidate = () => {
  const candidates = activePickCandidates();
  const selected = selectedPickOption(candidates, useCadStore.getState().activePickCursor);
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

const updateSelectedNumericParameterStep = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "number") return;

  const currentStep = getNumericParameterStep(selectedElement, definition.key);
  const nextStep = nextNumericParameterStep(
    currentStep,
    direction,
    getNumericParameterStepLevels(definition)
  );
  updateSelectedElement((element) => ({
    ...element,
    numericParameterSteps: {
      ...element.numericParameterSteps,
      [definition.key]: nextStep
    }
  }));
};

const cycleReferenceParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "reference") return;

  const options = pointAnchorReferenceOptions(useCadStore.getState().elements);
  if (options.length === 0) return;

  const parameterValue = getParameterValue(selectedElement, definition.key);
  const currentAnchor =
    typeof parameterValue === "string"
      ? referenceAnchor(parameterValue)
      : parameterValue && typeof parameterValue === "object" && "mode" in parameterValue
        ? parameterValue as PointAnchor
        : null;
  const currentIndex = options.findIndex((option) => anchorEquals(option, currentAnchor));
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => setParameterValue(element, definition.key, options[nextIndex]));
};

const cycleLineEndpointParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "lineEndpointReference") return;

  const options = lineEndpointReferenceOptions(useCadStore.getState().elements);
  if (options.length === 0) return;

  const parameterValue = getParameterValue(selectedElement, definition.key);
  const currentEndpoint = isLineEndpointReferenceValue(parameterValue) ? parameterValue : null;
  const currentIndex = options.findIndex((option) =>
    lineEndpointReferenceEquals(option, currentEndpoint)
  );
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => setParameterValue(element, definition.key, options[nextIndex]));
};

const lineReferenceOptions = (elements: CadElement[]) => elements.filter(isLineLikeElement);

const cycleLineReferenceParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "lineReference") return;

  const options = lineReferenceOptions(useCadStore.getState().elements).filter(
    (element) => element.id !== selectedElement.id
  );
  if (options.length === 0) return;

  const currentValue = getParameterValue(selectedElement, definition.key);
  const currentIndex = options.findIndex((option) => option.id === currentValue);
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => setParameterValue(element, definition.key, options[nextIndex].id));
};

const addLineDivisionPoint = () => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = elements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? elements.find(isLineLikeElement);
  const element = createCadElement("lineDivisionPoint", elements);
  if (element.type !== "lineDivisionPoint") return;
  const lineDivisionPoint: CadElement = {
    ...element,
    endpoint: {
      lineId: fallbackLine?.id ?? "",
      endpointKey: "start"
    }
  };
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, lineDivisionPoint],
    selectedElementId: lineDivisionPoint.id,
    selectedElementIds: [lineDivisionPoint.id],
    selectionAnchorElementId: lineDivisionPoint.id,
    selectedParameterKey: getFirstParameterKey(lineDivisionPoint)
  });
};

const addIntersectionPoint = () => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLines = elements
    .filter((element) => selectedIds.has(element.id) && isLineLikeElement(element))
    .map((element) => element.id);
  const fallbackLines = elements.filter(isLineLikeElement).map((element) => element.id);
  const element = createCadElement("intersectionPoint", elements);
  if (element.type !== "intersectionPoint") return;
  const line1Id = selectedLines[0] ?? fallbackLines[0] ?? "";
  const line2Id =
    selectedLines.find((id) => id !== line1Id) ??
    fallbackLines.find((id) => id !== line1Id) ??
    line1Id;
  const intersectionPoint: CadElement = {
    ...element,
    line1Id,
    line2Id
  };
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, intersectionPoint],
    selectedElementId: intersectionPoint.id,
    selectedElementIds: [intersectionPoint.id],
    selectionAnchorElementId: intersectionPoint.id,
    selectedParameterKey: getFirstParameterKey(intersectionPoint)
  });
};

const addLineTangentOffsetPoint = () => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selectedLine = elements.find((element) => selectedIds.has(element.id) && isLineLikeElement(element));
  const fallbackLine = selectedLine ?? elements.find(isLineLikeElement);
  const selectedPoint = elements.find((element) => selectedIds.has(element.id) && isPointLikeElement(element));
  const fallbackPoint = selectedPoint ?? elements.find(isPointLikeElement);
  const element = createCadElement("lineTangentOffsetPoint", elements);
  if (element.type !== "lineTangentOffsetPoint") return;
  const point: CadElement = {
    ...element,
    baseLineId: fallbackLine?.id ?? "",
    basePoint: selectedPoint
      ? referenceAnchor(selectedPoint.id)
      : fallbackLine
        ? derivedAnchor(fallbackLine.id, "start")
        : referenceAnchor(fallbackPoint?.id ?? "")
  };
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, point],
    selectedElementId: point.id,
    selectedElementIds: [point.id],
    selectionAnchorElementId: point.id,
    selectedParameterKey: getFirstParameterKey(point)
  });
};

const startPointPick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (
    !selectedElement ||
    (definition?.kind !== "reference" && definition?.kind !== "lineEndpointReference")
  ) return;

  useCadStore.setState({
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePointPickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

const applyPickedPoint = (context?: Pick<CommandContext, "pickedPointId" | "pickedPointAnchor">) => {
  const anchor = context?.pickedPointAnchor ?? (context?.pickedPointId ? referenceAnchor(context.pickedPointId) : null);
  if (!anchor) return;
  const { activePointPickTarget, elements } = useCadStore.getState();
  if (!activePointPickTarget) return;
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  if (!targetElement) return;

  const definition = findParameterDefinition(targetElement, activePointPickTarget.parameterKey);
  if (definition?.kind === "lineEndpointReference") {
    const endpoint = lineEndpointReferenceForAnchor(anchor, elements);
    if (!endpoint) return;

    useCadStore.getState().commitDocumentChange({
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
    useCadStore.getState().setActivePointPickTarget(null);
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

  useCadStore.getState().commitDocumentChange({
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
  useCadStore.getState().setActivePointPickTarget(null);
};

const cancelPointPick = () => {
  useCadStore.getState().setActivePointPickTarget(null);
};

const startLinePick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || (definition?.kind !== "lineReferenceList" && definition?.kind !== "lineReference")) return;

  useCadStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: {
      elementId: selectedElement.id,
      parameterKey: definition.key
    }
  });
};

const applyPickedLine = (context?: Pick<CommandContext, "pickedLineId">) => {
  const pickedLineId = context?.pickedLineId;
  if (!pickedLineId) return;
  const { activeLinePickTarget, elements } = useCadStore.getState();
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
    useCadStore.getState().commitDocumentChange({
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
    useCadStore.getState().setActiveLinePickTarget(null);
    return;
  }

  if (!currentLineIds || currentLineIds.includes(pickedLine.id)) return;

  useCadStore.getState().commitDocumentChange({
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

const cancelLinePick = () => {
  useCadStore.getState().setActiveLinePickTarget(null);
};

const addNumericVariable = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !supportsNumericVariables(selectedElement)) return;

  const variableCount = selectedElement.numericVariables?.length ?? 0;
  const variable = {
    id: createCadElementId(selectedElement.type),
    name: `v${variableCount + 1}`,
    value: 30
  };

  updateSelectedElement((element) => {
    if (!supportsNumericVariables(element)) return element;
    return {
      ...element,
      numericVariables: [...(element.numericVariables ?? []), variable]
    };
  });
  useCadStore.setState({ selectedParameterKey: `variable:${variable.id}:value` });
};

const deleteNumericVariable = (variableId: string | undefined) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !supportsNumericVariables(selectedElement)) return;
  const targetId = variableId ?? selectedElement.numericVariables?.at(-1)?.id;
  if (!targetId) return;

  updateSelectedElement((element) => {
    if (!supportsNumericVariables(element)) return element;
    return {
      ...element,
      numericVariables: (element.numericVariables ?? []).filter((variable) => variable.id !== targetId)
    };
  });
};

const addBezierIntermediatePoint = () => {
  const selectedElement = getSelectedElement();
  if (selectedElement?.type !== "bezierCurve") return;

  const options = pointAnchorReferenceOptions(useCadStore.getState().elements);
  const startPointId = anchorPointId(selectedElement.startPoint);
  const endPointId = anchorPointId(selectedElement.endPoint);
  const pointAnchor = options.find((anchor) => {
    const pointId = anchorPointId(anchor);
    return pointId !== startPointId && pointId !== endPointId;
  }) ?? options[0] ?? referenceAnchor("");
  const intermediatePoint = {
    id: createCadElementId("bezierCurve"),
    point: pointAnchor,
    handleAngleDeg: 0,
    incomingHandleLength: 30,
    outgoingHandleLength: 30
  };

  updateSelectedElement((element) => {
    if (element.type !== "bezierCurve") return element;
    return {
      ...element,
      intermediatePoints: [...element.intermediatePoints, intermediatePoint]
    };
  });
  useCadStore.setState({ selectedParameterKey: `intermediate:${intermediatePoint.id}:point` });
};

const deleteBezierIntermediatePoint = (intermediatePointId: string | undefined) => {
  const selectedElement = getSelectedElement();
  if (selectedElement?.type !== "bezierCurve") return;
  const targetId = intermediatePointId ?? selectedElement.intermediatePoints.at(-1)?.id;
  if (!targetId) return;

  updateSelectedElement((element) => {
    if (element.type !== "bezierCurve") return element;
    return {
      ...element,
      intermediatePoints: element.intermediatePoints.filter((point) => point.id !== targetId)
    };
  });
};

const toggleBooleanParameter = () => {
  const definition = selectedParameterDefinition();
  if (definition?.kind !== "boolean") return;

  updateSelectedElement((element) => ({
    ...element,
    [definition.key]: !element[definition.key as keyof CadElement]
  } as CadElement));
};

const setSelectedPointAnchorMode = (
  mode: "reference" | "coordinate",
  context?: CommandContext
) => {
  const target = pointAnchorParameterTarget(context);
  if (!target) return false;
  if (mode === "coordinate" && !target.definition.allowCoordinate) return false;
  if (target.anchor.mode === mode) {
    useCadStore.setState({
      selectedParameterKey: mode === "coordinate" ? `${target.parameterKey}:x` : target.parameterKey
    });
    return true;
  }

  const nextAnchor =
    mode === "coordinate"
      ? coordinateAnchor()
      : referenceAnchor(
          target.anchor.mode === "reference"
            ? target.anchor.pointId
            : useCadStore.getState().elements.find(isPointLikeElement)?.id ?? ""
        );
  const selectedParameterKey = mode === "coordinate" ? `${target.parameterKey}:x` : target.parameterKey;

  useCadStore.getState().commitDocumentChange({
    elements: useCadStore.getState().elements.map((element) =>
      element.id === target.element.id
        ? setParameterValue(element, target.parameterKey, nextAnchor)
        : element
    ),
    selectedElementId: target.element.id,
    selectedElementIds: [target.element.id],
    selectionAnchorElementId: target.element.id,
    selectedParameterKey
  });
  return true;
};

const toggleSelectedPointAnchorMode = (context?: CommandContext) => {
  const target = pointAnchorParameterTarget(context);
  if (!target || !target.definition.allowCoordinate) return false;
  return setSelectedPointAnchorMode(
    target.anchor.mode === "coordinate" ? "reference" : "coordinate",
    {
      ...context,
      elementId: target.element.id,
      parameterKey: target.parameterKey
    }
  );
};

const toggleSelectedParameterValue = () => {
  if (toggleSelectedPointAnchorMode()) return;
  toggleBooleanParameter();
};

const toggleBooleanParameterByDirectKey = (directKey: string | undefined) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !directKey) return;

  const definition = findParameterByDirectKey(selectedElement, directKey);
  if (definition?.kind !== "boolean") return;

  useCadStore.getState().commitDocumentChange({
    elements: useCadStore.getState().elements.map((element) =>
      element.id === selectedElement.id
        ? setParameterValue(
            element,
            definition.key,
            !getParameterValue(element, definition.key)
          )
        : element
    ),
    selectedParameterKey: definition.key
  });
};

const toggleSelectedElementsBooleanProperty = (property: "visible" | "enabled") => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedIds.has(element.id) ? { ...element, [property]: !element[property] } : element
    )
  });
};

const toggleElementBooleanProperty = (
  elementId: ElementId | undefined,
  property: "visible" | "enabled"
) => {
  if (!elementId) return;
  const { elements } = useCadStore.getState();
  if (!elements.some((element) => element.id === elementId)) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === elementId ? { ...element, [property]: !element[property] } : element
    )
  });
};

const selectedDependencyJumpTargets = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  const selectedElement = selectedElementId
    ? elements.find((element) => element.id === selectedElementId) ?? null
    : null;
  return getDependencyJumpTargets(selectedElement, elements);
};

const updateDependencyJumpModeAfterSelectionChange = () => {
  const { isDependencyJumpMode } = useCadStore.getState();
  if (!isDependencyJumpMode) return;

  const targets = selectedDependencyJumpTargets();
  useCadStore.setState({
    isDependencyJumpMode: targets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};

const selectElementByOffset = (offset: number) => {
  const { elements, selectedElementId } = useCadStore.getState();
  const nextElementId = elementIdByOffset(elements, selectedElementId, offset);
  if (!nextElementId) return;

  useCadStore.getState().setSelectedElementId(nextElementId);
  updateDependencyJumpModeAfterSelectionChange();
};

const extendSelectionByOffset = (offset: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadStore.getState();
  const nextElementId = elementIdByOffset(elements, selectedElementId, offset);
  if (!nextElementId) return;

  const anchorId = selectionAnchorElementId ?? selectedElementId ?? elements[0]?.id ?? nextElementId;
  useCadStore.getState().setSelectedElementRange(anchorId, nextElementId);
  updateDependencyJumpModeAfterSelectionChange();
};

const selectElement = (elementId: ElementId, selectionMode: CommandContext["selectionMode"] = "replace") => {
  const { elements, selectedElementIds, selectionAnchorElementId } = useCadStore.getState();
  const element = elements.find((item) => item.id === elementId);
  if (!element) return;

  if (selectionMode === "range") {
    useCadStore.getState().setSelectedElementRange(selectionAnchorElementId ?? elementId, elementId);
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  if (selectionMode === "toggle") {
    const selection = toggleSelectionIds(elements, selectedElementIds, elementId);
    if (!selection) return;
    useCadStore.getState().setSelectedElementIds(
      selection.selectedElementIds,
      selection.selectedElementId
    );
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  useCadStore.getState().setSelectedElementId(elementId);
  updateDependencyJumpModeAfterSelectionChange();
};

const moveElementsToInsertionIndex = (elementIds: ElementId[], insertionIndex: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadStore.getState();
  const change = moveDocumentElementsToInsertionIndex({
    elements,
    elementIds,
    insertionIndex,
    selectedElementId,
    selectionAnchorElementId
  });
  if (!change) return;

  useCadStore.getState().commitDocumentChange(change);
};

const moveElementToInsertionIndex = (elementId: ElementId, insertionIndex: number) => {
  const { elements, selectedElementIds } = useCadStore.getState();
  const elementIds = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
  if (selectedElementIds.includes(elementId) || elements.some((element) => element.id === elementId)) {
    moveElementsToInsertionIndex(elementIds, insertionIndex);
  }
};

const selectDependencyJumpTargetByOffset = (offset: number) => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const currentIndex =
    selectedDependencyJumpIndex >= 0 && selectedDependencyJumpIndex < targets.length
      ? selectedDependencyJumpIndex
      : 0;
  const nextIndex = (currentIndex + offset + targets.length) % targets.length;
  useCadStore.setState({ selectedDependencyJumpIndex: nextIndex });
};

const jumpToSelectedDependencyTarget = () => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const target = targets[Math.min(Math.max(selectedDependencyJumpIndex, 0), targets.length - 1)];
  if (!target) return;

  useCadStore.getState().setSelectedElementId(target.id);
  const nextTargets = selectedDependencyJumpTargets();
  useCadStore.setState({
    isDependencyJumpMode: nextTargets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};

const canvasZoomAnchor = (context?: CommandContext) => {
  const rect = context?.getCanvasViewportRect?.();
  if (!rect) return undefined;
  return {
    x: rect.width / 2,
    y: rect.height / 2,
    width: rect.width,
    height: rect.height
  };
};

export const commands: Record<CommandId, Command> = {
  undo: {
    id: "undo",
    label: "元に戻す",
    run: () => useCadStore.getState().undo()
  },
  redo: {
    id: "redo",
    label: "やり直す",
    run: () => useCadStore.getState().redo()
  },
  selectElement: {
    id: "selectElement",
    label: "要素を選択",
    run: (context) => {
      if (!context?.elementId) return;
      selectElement(context.elementId, context.selectionMode);
    }
  },
  selectNextElement: {
    id: "selectNextElement",
    label: "次の要素を選択",
    run: () => selectElementByOffset(1)
  },
  selectPreviousElement: {
    id: "selectPreviousElement",
    label: "前の要素を選択",
    run: () => selectElementByOffset(-1)
  },
  extendSelectionToNextElement: {
    id: "extendSelectionToNextElement",
    label: "次の要素まで選択",
    run: () => extendSelectionByOffset(1)
  },
  extendSelectionToPreviousElement: {
    id: "extendSelectionToPreviousElement",
    label: "前の要素まで選択",
    run: () => extendSelectionByOffset(-1)
  },
  moveSelectedElementUp: {
    id: "moveSelectedElementUp",
    label: "選択要素を上へ",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = getSelectedElementIds();
      const indexes = selectedIndexes(elements, selectedIds);
      if (indexes.length === 0 || indexes[0] <= 0) return;
      moveElementsToInsertionIndex(selectedIds, indexes[0] - 1);
    }
  },
  moveSelectedElementDown: {
    id: "moveSelectedElementDown",
    label: "選択要素を下へ",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = getSelectedElementIds();
      const indexes = selectedIndexes(elements, selectedIds);
      const lastIndex = indexes.at(-1) ?? -1;
      if (indexes.length === 0 || lastIndex >= elements.length - 1) return;
      moveElementsToInsertionIndex(selectedIds, lastIndex + 2);
    }
  },
  moveElementToInsertionIndex: {
    id: "moveElementToInsertionIndex",
    label: "要素を指定位置へ移動",
    run: (context) => {
      if (!context?.elementId || context.insertionIndex === undefined) return;
      moveElementToInsertionIndex(context.elementId, context.insertionIndex);
    }
  },
  movePointElementByDelta: {
    id: "movePointElementByDelta",
    label: "点を移動",
    run: (context) => {
      if (!context) return;
      movePointElementByDelta(context);
    }
  },
  moveBezierHandleByDelta: {
    id: "moveBezierHandleByDelta",
    label: "曲線ハンドルを移動",
    run: (context) => {
      if (!context) return;
      moveBezierHandleByDelta(context);
    }
  },
  applyNumericExpressionReference: {
    id: "applyNumericExpressionReference",
    label: "数値参照式を採用",
    run: (context) => applyNumericExpressionReference(context)
  },
  startNumericReferencePick: {
    id: "startNumericReferencePick",
    label: "数値選択モードに入る",
    run: () => startNumericReferencePick()
  },
  applyPickedNumericReference: {
    id: "applyPickedNumericReference",
    label: "選択した数値を設定",
    run: (context) => applyPickedNumericReference(context)
  },
  cancelNumericReferencePick: {
    id: "cancelNumericReferencePick",
    label: "数値選択をキャンセル",
    run: () => cancelNumericReferencePick()
  },
  selectNextPickCandidate: {
    id: "selectNextPickCandidate",
    label: "次の選択候補へ",
    run: () => selectPickCandidateByOffset(1)
  },
  selectPreviousPickCandidate: {
    id: "selectPreviousPickCandidate",
    label: "前の選択候補へ",
    run: () => selectPickCandidateByOffset(-1)
  },
  selectNextPickOption: {
    id: "selectNextPickOption",
    label: "行内の次の候補へ",
    run: () => selectPickOptionByOffset(1)
  },
  selectPreviousPickOption: {
    id: "selectPreviousPickOption",
    label: "行内の前の候補へ",
    run: () => selectPickOptionByOffset(-1)
  },
  applySelectedPickCandidate: {
    id: "applySelectedPickCandidate",
    label: "選択候補を確定",
    run: () => applySelectedPickCandidate()
  },
  startPointPick: {
    id: "startPointPick",
    label: "点を選択して参照に設定",
    run: () => startPointPick()
  },
  applyPickedPoint: {
    id: "applyPickedPoint",
    label: "選択した点を参照に設定",
    run: (context) => applyPickedPoint(context)
  },
  cancelPointPick: {
    id: "cancelPointPick",
    label: "点選択をキャンセル",
    run: () => cancelPointPick()
  },
  startLinePick: {
    id: "startLinePick",
    label: "線を選択して基準線に追加",
    run: () => startLinePick()
  },
  applyPickedLine: {
    id: "applyPickedLine",
    label: "選択した線を基準線に追加",
    run: (context) => applyPickedLine(context)
  },
  cancelLinePick: {
    id: "cancelLinePick",
    label: "線選択をキャンセル",
    run: () => cancelLinePick()
  },
  toggleElementVisibility: {
    id: "toggleElementVisibility",
    label: "要素の表示/非表示を切替",
    run: (context) => toggleElementBooleanProperty(context?.elementId, "visible")
  },
  toggleElementEnabled: {
    id: "toggleElementEnabled",
    label: "要素の評価する/しないを切替",
    run: (context) => toggleElementBooleanProperty(context?.elementId, "enabled")
  },
  toggleSelectedElementVisibility: {
    id: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    run: () => toggleSelectedElementsBooleanProperty("visible")
  },
  toggleSelectedElementEnabled: {
    id: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    run: () => toggleSelectedElementsBooleanProperty("enabled")
  },
  deleteSelectedElement: {
    id: "deleteSelectedElement",
    label: "選択要素を削除",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = new Set(getSelectedElementIds());
      const indexes = selectedIndexes(elements, [...selectedIds]);
      if (indexes.length === 0) return;
      const index = indexes[0];
      const nextElements = elements.filter((element) => !selectedIds.has(element.id));
      const nextSelectedElementId = nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null;
      useCadStore.getState().commitDocumentChange({
        elements: nextElements,
        selectedElementId: nextSelectedElementId,
        selectedElementIds: nextSelectedElementId ? [nextSelectedElementId] : [],
        selectionAnchorElementId: nextSelectedElementId
      });
    }
  },
  addFreePoint: {
    id: "addFreePoint",
    label: "free point を追加",
    run: () => addElement("freePoint")
  },
  addOffsetPoint: {
    id: "addOffsetPoint",
    label: "offset point を追加",
    run: () => addElement("offsetPoint")
  },
  addPolarOffsetPoint: {
    id: "addPolarOffsetPoint",
    label: "polar offset point を追加",
    run: () => addElement("polarOffsetPoint")
  },
  addDivisionPoint: {
    id: "addDivisionPoint",
    label: "点間分点を追加",
    run: () => addElement("divisionPoint")
  },
  addLineDivisionPoint: {
    id: "addLineDivisionPoint",
    label: "線上分点を追加",
    run: () => addLineDivisionPoint()
  },
  addIntersectionPoint: {
    id: "addIntersectionPoint",
    label: "交点を追加",
    run: () => addIntersectionPoint()
  },
  addLineTangentOffsetPoint: {
    id: "addLineTangentOffsetPoint",
    label: "線上オフセット点を追加",
    run: () => addLineTangentOffsetPoint()
  },
  addLine: {
    id: "addLine",
    label: "line を追加",
    run: () => addElement("line")
  },
  addArcLine: {
    id: "addArcLine",
    label: "円弧線を追加",
    run: () => addElement("arcLine")
  },
  addThreePointArcLine: {
    id: "addThreePointArcLine",
    label: "三点円弧線を追加",
    run: () => addElement("threePointArcLine")
  },
  addBezierCurve: {
    id: "addBezierCurve",
    label: "Bezier curve を追加",
    run: () => addElement("bezierCurve")
  },
  addOffsetLine: {
    id: "addOffsetLine",
    label: "オフセット線を追加",
    run: () => addOffsetLine()
  },
  addNumericVariable: {
    id: "addNumericVariable",
    label: "共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteNumericVariable: {
    id: "deleteNumericVariable",
    label: "共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierNumericVariable: {
    id: "addBezierNumericVariable",
    label: "曲線の共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteBezierNumericVariable: {
    id: "deleteBezierNumericVariable",
    label: "曲線の共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierIntermediatePoint: {
    id: "addBezierIntermediatePoint",
    label: "曲線の中間点を追加",
    run: () => addBezierIntermediatePoint()
  },
  deleteBezierIntermediatePoint: {
    id: "deleteBezierIntermediatePoint",
    label: "曲線の中間点を削除",
    run: (context) => deleteBezierIntermediatePoint(context?.intermediatePointId)
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "キャンバスを拡大",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1.1, canvasZoomAnchor(context))
  },
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "キャンバスを縮小",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1 / 1.1, canvasZoomAnchor(context))
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: "キャンバス表示をリセット",
    run: () => useCadStore.getState().resetCanvasViewport()
  },
  openCommandPalette: {
    id: "openCommandPalette",
    label: "コマンドパレットを開く",
    run: () => useCadStore.setState({ showCommandPalette: true })
  },
  closeCommandPalette: {
    id: "closeCommandPalette",
    label: "コマンドパレットを閉じる",
    run: () => useCadStore.setState({ showCommandPalette: false })
  },
  focusCanvas: {
    id: "focusCanvas",
    label: "キャンバスへフォーカス",
    run: (context) => context?.focusCanvas?.()
  },
  focusElementList: {
    id: "focusElementList",
    label: "要素リストへフォーカス",
    run: (context) => context?.focusElementList?.()
  },
  enterElementListMode: {
    id: "enterElementListMode",
    label: "構成リストモードに入る",
    run: (context) => {
      useCadStore.setState({
        isParameterEditMode: false,
        isDependencyJumpMode: false,
        selectedDependencyJumpIndex: 0
      });
      context?.focusElementList?.();
    }
  },
  toggleShortcutHelp: {
    id: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    run: () => {
      const { showShortcutHelp } = useCadStore.getState();
      useCadStore.setState({ showShortcutHelp: !showShortcutHelp });
    }
  },
  toggleElementInfoPanel: {
    id: "toggleElementInfoPanel",
    label: "要素詳細を表示/非表示",
    run: () => {
      const { showElementInfoPanel } = useCadStore.getState();
      useCadStore.setState({
        showElementInfoPanel: !showElementInfoPanel,
        isDependencyJumpMode: showElementInfoPanel ? false : useCadStore.getState().isDependencyJumpMode
      });
    }
  },
  enterDependencyJumpMode: {
    id: "enterDependencyJumpMode",
    label: "親子要素ジャンプモードに入る",
    run: () => {
      cancelPointPick();
      cancelNumericReferencePick();
      cancelLinePick();
      const targets = selectedDependencyJumpTargets();
      if (targets.length === 0) return;
      useCadStore.setState({
        showElementInfoPanel: true,
        isParameterEditMode: false,
        isDependencyJumpMode: true,
        selectedDependencyJumpIndex: 0
      });
    }
  },
  exitDependencyJumpMode: {
    id: "exitDependencyJumpMode",
    label: "親子要素ジャンプモードを終了",
    run: () => useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 })
  },
  selectNextDependencyJumpTarget: {
    id: "selectNextDependencyJumpTarget",
    label: "次の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(1)
  },
  selectPreviousDependencyJumpTarget: {
    id: "selectPreviousDependencyJumpTarget",
    label: "前の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(-1)
  },
  jumpToSelectedDependencyTarget: {
    id: "jumpToSelectedDependencyTarget",
    label: "選択中の親子要素へジャンプ",
    run: () => jumpToSelectedDependencyTarget()
  },
  enterParameterEditMode: {
    id: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    run: () => {
      const selectedElement = getSelectedElement();
      if (!selectedElement) return;
      useCadStore.setState({
        isParameterEditMode: true,
        isDependencyJumpMode: false,
        selectedParameterKey: normalizeParameterKey(
          selectedElement,
          useCadStore.getState().selectedParameterKey
        )
      });
    }
  },
  exitParameterEditMode: {
    id: "exitParameterEditMode",
    label: "パラメーター編集モードを終了",
    run: () => useCadStore.setState({ isParameterEditMode: false })
  },
  selectNextParameter: {
    id: "selectNextParameter",
    label: "次のパラメーターを選択",
    run: () => selectParameterByOffset(1)
  },
  selectPreviousParameter: {
    id: "selectPreviousParameter",
    label: "前のパラメーターを選択",
    run: () => selectParameterByOffset(-1)
  },
  selectParameterByKey: {
    id: "selectParameterByKey",
    label: "キーでパラメーターを選択",
    run: (context) =>
      applyParameterDirectKey(context?.parameterDirectKey, context?.focusSelectedParameterInput)
  },
  incrementSelectedParameter: {
    id: "incrementSelectedParameter",
    label: "選択パラメーターを増やす",
    run: (context) => updateNumericParameter(1, context)
  },
  decrementSelectedParameter: {
    id: "decrementSelectedParameter",
    label: "選択パラメーターを減らす",
    run: (context) => updateNumericParameter(-1, context)
  },
  increaseSelectedParameterStep: {
    id: "increaseSelectedParameterStep",
    label: "増減単位を大きくする",
    run: () => updateSelectedNumericParameterStep(1)
  },
  decreaseSelectedParameterStep: {
    id: "decreaseSelectedParameterStep",
    label: "増減単位を小さくする",
    run: () => updateSelectedNumericParameterStep(-1)
  },
  cycleSelectedReferenceForward: {
    id: "cycleSelectedReferenceForward",
    label: "参照パラメーターを次へ",
    run: () => cycleReferenceParameter(1)
  },
  cycleSelectedReferenceBackward: {
    id: "cycleSelectedReferenceBackward",
    label: "参照パラメーターを前へ",
    run: () => cycleReferenceParameter(-1)
  },
  toggleSelectedParameterValue: {
    id: "toggleSelectedParameterValue",
    label: "選択パラメーターを切替",
    run: () => toggleSelectedParameterValue()
  },
  toggleSelectedPointAnchorMode: {
    id: "toggleSelectedPointAnchorMode",
    label: "点指定方法を切替",
    run: (context) => toggleSelectedPointAnchorMode(context)
  },
  setSelectedPointAnchorReferenceMode: {
    id: "setSelectedPointAnchorReferenceMode",
    label: "点指定を既存点にする",
    run: (context) => setSelectedPointAnchorMode("reference", context)
  },
  setSelectedPointAnchorCoordinateMode: {
    id: "setSelectedPointAnchorCoordinateMode",
    label: "点指定を座標にする",
    run: (context) => setSelectedPointAnchorMode("coordinate", context)
  },
  toggleSelectedBooleanParameter: {
    id: "toggleSelectedBooleanParameter",
    label: "真偽値パラメーターを切替",
    run: () => toggleBooleanParameter()
  },
  toggleBooleanParameterByDirectKey: {
    id: "toggleBooleanParameterByDirectKey",
    label: "キーに対応する真偽値パラメーターを切替",
    run: (context) => toggleBooleanParameterByDirectKey(context?.parameterDirectKey)
  },
  activateSelectedParameter: {
    id: "activateSelectedParameter",
    label: "選択パラメーターを実行",
    run: (context) => {
      const definition = selectedParameterDefinition();
      if (definition?.kind === "reference") {
        startPointPick();
        return;
      }
      if (definition?.kind === "lineReferenceList") {
        startLinePick();
        return;
      }
      if (definition?.kind === "lineReference") {
        startLinePick();
        return;
      }
      if (definition?.kind === "lineEndpointReference") {
        startPointPick();
        return;
      }
      if (definition?.kind === "number") {
        startNumericReferencePick();
        return;
      }
      context?.focusSelectedParameterInput?.();
    }
  },
  focusSelectedParameterInput: {
    id: "focusSelectedParameterInput",
    label: "選択パラメーターの入力欄へフォーカス",
    run: (context) => commands.activateSelectedParameter.run(context)
  }
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  commands[commandId].run(context);
};

export type CommandPaletteItem = {
  commandId: CommandId;
  label: string;
  keywords: string[];
};

const paletteCommandIds: CommandId[] = [
  "addFreePoint",
  "addOffsetPoint",
  "addPolarOffsetPoint",
  "addDivisionPoint",
  "addLineDivisionPoint",
  "addIntersectionPoint",
  "addLineTangentOffsetPoint",
  "addLine",
  "addArcLine",
  "addThreePointArcLine",
  "addBezierCurve",
  "addOffsetLine",
  "startPointPick",
  "startLinePick",
  "startNumericReferencePick",
  "addNumericVariable",
  "deleteNumericVariable",
  "addBezierIntermediatePoint",
  "deleteBezierIntermediatePoint",
  "zoomInCanvas",
  "zoomOutCanvas",
  "resetCanvasView",
  "undo",
  "redo",
  "selectNextElement",
  "selectPreviousElement",
  "moveSelectedElementUp",
  "moveSelectedElementDown",
  "toggleSelectedElementVisibility",
  "toggleSelectedElementEnabled",
  "deleteSelectedElement",
  "focusCanvas",
  "focusElementList",
  "enterElementListMode",
  "toggleShortcutHelp",
  "toggleElementInfoPanel",
  "enterDependencyJumpMode",
  "enterParameterEditMode",
  "exitParameterEditMode",
  "focusSelectedParameterInput"
];

const paletteKeywords: Partial<Record<CommandId, string[]>> = {
  addFreePoint: ["point", "free", "free point", "点", "追加"],
  addOffsetPoint: ["offset", "offset point", "オフセット", "点", "追加"],
  addPolarOffsetPoint: ["polar", "angle", "distance", "角度", "距離", "点", "追加"],
  addDivisionPoint: ["division", "between", "ratio", "distance", "分点", "点間", "中点", "割合", "距離", "点", "追加"],
  addLineDivisionPoint: ["division", "line", "endpoint", "ratio", "distance", "分点", "線上", "端点", "割合", "距離", "点", "追加"],
  addIntersectionPoint: ["intersection", "cross", "line", "交点", "交差", "線", "点", "追加"],
  addLineTangentOffsetPoint: ["line", "tangent", "offset", "angle", "distance", "線上", "オフセット", "接線", "角度", "距離", "点", "追加"],
  addLine: ["line", "直線", "線", "追加"],
  addArcLine: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"],
  addThreePointArcLine: [
    "arc",
    "three point arc",
    "3 point arc",
    "circle",
    "三点円弧",
    "3点円弧",
    "円弧",
    "線",
    "追加"
  ],
  addBezierCurve: ["bezier", "curve", "曲線", "ベジェ", "追加"],
  addOffsetLine: ["offset", "line", "curve", "オフセット", "線", "曲線", "追加"],
  startNumericReferencePick: ["number", "reference", "measurement", "数値", "参照", "選択"],
  startLinePick: ["line", "reference", "base", "基準線", "線", "選択"],
  addNumericVariable: ["variable", "共有", "共通", "変数", "追加"],
  deleteNumericVariable: ["variable", "共有", "共通", "変数", "削除"],
  addBezierNumericVariable: ["bezier", "curve", "variable", "共有", "変数", "追加"],
  deleteBezierNumericVariable: ["bezier", "curve", "variable", "共有", "変数", "削除"],
  addBezierIntermediatePoint: ["bezier", "curve", "middle", "中間点", "追加"],
  deleteBezierIntermediatePoint: ["bezier", "curve", "middle", "中間点", "削除"],
  zoomInCanvas: ["zoom", "in", "拡大", "キャンバス"],
  zoomOutCanvas: ["zoom", "out", "縮小", "キャンバス"],
  resetCanvasView: ["zoom", "reset", "pan", "origin", "リセット", "原点", "キャンバス"],
  undo: ["undo", "戻す"],
  redo: ["redo", "やり直す"],
  selectNextElement: ["select", "next", "次", "要素"],
  selectPreviousElement: ["select", "previous", "前", "要素"],
  moveSelectedElementUp: ["move", "up", "上", "並べ替え"],
  moveSelectedElementDown: ["move", "down", "下", "並べ替え"],
  toggleSelectedElementVisibility: ["visibility", "visible", "hide", "show", "表示", "非表示"],
  toggleSelectedElementEnabled: ["enabled", "active", "evaluate", "評価", "有効", "無効"],
  deleteSelectedElement: ["delete", "remove", "削除"],
  focusCanvas: ["focus", "canvas", "キャンバス"],
  focusElementList: ["focus", "element list", "構成リスト", "要素リスト"],
  enterElementListMode: ["mode", "element list", "構成リスト", "要素リスト"],
  toggleShortcutHelp: ["shortcut", "help", "ショートカット", "ヘルプ"],
  toggleElementInfoPanel: ["information", "info", "要素詳細", "折り畳み", "表示"],
  enterDependencyJumpMode: ["dependency", "parent", "child", "親子", "ジャンプ"],
  enterParameterEditMode: ["parameter", "edit", "パラメーター", "編集"],
  exitParameterEditMode: ["parameter", "edit", "escape", "パラメーター", "終了"],
  focusSelectedParameterInput: ["parameter", "input", "direct", "パラメーター", "入力"]
};

export const commandPaletteItems: CommandPaletteItem[] = paletteCommandIds.map((commandId) => ({
  commandId,
  label: commands[commandId].label,
  keywords: paletteKeywords[commandId] ?? []
}));

const normalizePaletteText = (text: string) => text.trim().toLowerCase();

export const filterCommandPaletteItems = (query: string) => {
  const normalizedQuery = normalizePaletteText(query);
  if (!normalizedQuery) return commandPaletteItems;

  return commandPaletteItems.filter((item) => {
    const searchableText = [item.commandId, item.label, ...item.keywords]
      .map(normalizePaletteText)
      .join(" ");
    return searchableText.includes(normalizedQuery);
  });
};
