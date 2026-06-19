import { useCadStore } from "../state/useCadStore";
import type { CadHistorySnapshot } from "../state/useCadStore";
import { evaluateElements } from "../geometry/evaluate";
import {
  addToNumericValue,
  makeNumericExpression
} from "../geometry/numericExpressions";
import { createCadElementId } from "../model/cadIds";
import { getDependencyJumpTargets } from "../model/dependencies";
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
  setNumericParameterOrLocalVariable,
  setParameterValue,
  supportsNumericVariables
} from "../parameters/parameterAccess";
import {
  anchorEquals,
  anchorReferenceElementId,
  pointAnchorForElement,
  referenceAnchor,
  resolveDerivedPoint
} from "../model/pointAnchors";
import type {
  CadElement,
  CadElementType,
  ComputedBezierCurve,
  ElementId,
  NumericValue,
  PointAnchor
} from "../types/geometry";

export type BezierHandleRole = "start" | "end" | "intermediateIncoming" | "intermediateOutgoing";

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
  | "startPointPick"
  | "applyPickedPoint"
  | "cancelPointPick"
  | "toggleElementVisibility"
  | "toggleElementEnabled"
  | "toggleSelectedElementVisibility"
  | "toggleSelectedElementEnabled"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addOffsetPoint"
  | "addPolarOffsetPoint"
  | "addLine"
  | "addArcLine"
  | "addBezierCurve"
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
  | "toggleSelectedBooleanParameter"
  | "toggleBooleanParameterByDirectKey"
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
  pickedPointId?: ElementId;
  pickedPointAnchor?: PointAnchor;
};

export type Command = {
  id: CommandId;
  label: string;
  run: (context?: CommandContext) => void;
};

const getSelectedIndex = (elements: CadElement[], selectedElementId: ElementId | null) =>
  selectedElementId ? elements.findIndex((element) => element.id === selectedElementId) : -1;

const elementIdsInDocumentOrder = (elements: CadElement[], ids: ElementId[]) => {
  const selectedIds = new Set(ids);
  return elements.filter((element) => selectedIds.has(element.id)).map((element) => element.id);
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

const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements, selectedElementId } = useCadStore.getState();
  if (!selectedElementId) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};

const isComputedPoint = (geometry: unknown): geometry is { kind: "point"; x: number; y: number } =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "point";

const isComputedBezierCurve = (geometry: unknown): geometry is ComputedBezierCurve =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "bezierCurve";

const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const movePolarOffsetPointByDelta = ({
  element,
  sourceElements,
  dx,
  dy,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "polarOffsetPoint" }>;
  sourceElements: CadElement[];
  dx: number;
  dy: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const evaluation = evaluateElements(sourceElements);
  const point = evaluation.computedGeometry.get(element.id);
  const fromAnchor = pointAnchorForElement(element);
  const fromPointId = fromAnchor ? anchorReferenceElementId(fromAnchor) : null;
  const fromGeometry = fromPointId ? evaluation.computedGeometry.get(fromPointId) : null;
  const fromPoint =
    fromAnchor?.mode === "derived"
      ? resolveDerivedPoint(
          fromGeometry ?? undefined,
          fromAnchor.pointKey,
          new Map(sourceElements.map((item) => [item.id, item]))
        )
      : fromGeometry;
  if (!isComputedPoint(point) || !isComputedPoint(fromPoint)) return element;

  const currentVector = {
    x: point.x - fromPoint.x,
    y: fromPoint.y - point.y
  };
  const currentDistance = Math.hypot(currentVector.x, currentVector.y);
  const currentAngleDeg =
    currentDistance === 0
      ? 0
      : normalizeDegrees(radiansToDegrees(Math.atan2(currentVector.y, currentVector.x)));

  const target = {
    x: point.x + dx,
    y: point.y + dy
  };
  const vector = {
    x: target.x - fromPoint.x,
    y: fromPoint.y - target.y
  };

  if (angleLocked) {
    const angleRad = degreesToRadians(currentAngleDeg);
    const unit = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const projectedDistance = Math.max(0, vector.x * unit.x + vector.y * unit.y);
    if (projectedDistance === currentDistance) return element;
    return { ...element, distance: projectedDistance };
  }

  if (distanceLocked) {
    if (Math.hypot(vector.x, vector.y) === 0) return element;
    const angleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
    if (angleDeg === currentAngleDeg) return element;
    return { ...element, angleDeg };
  }

  const distance = Math.hypot(vector.x, vector.y);
  const angleDeg =
    distance === 0
      ? currentAngleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
  if (distance === currentDistance && angleDeg === currentAngleDeg) return element;
  return {
    ...element,
    distance,
    angleDeg
  };
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
  let didMove = false;
  const nextElements = sourceElements.map((element) => {
    if (element.id !== elementId) return element;

    if (element.type === "freePoint") {
      didMove = true;
      return {
        ...element,
        x: addToNumericValue(element.x, dx),
        y: addToNumericValue(element.y, dy)
      };
    }

    if (element.type === "offsetPoint") {
      didMove = true;
      return {
        ...element,
        dx: addToNumericValue(element.dx, dx),
        dy: addToNumericValue(element.dy, dy)
      };
    }

    if (element.type === "polarOffsetPoint") {
      const nextElement = movePolarOffsetPointByDelta({
        element,
        sourceElements,
        dx,
        dy,
        angleLocked,
        distanceLocked
      });
      didMove = didMove || nextElement !== element;
      return nextElement;
    }

    return element;
  });

  if (!didMove) return;

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

type BezierHandleTarget = {
  anchor: { x: number; y: number };
  control: { x: number; y: number };
  angleKey: string;
  lengthKey: string;
  storedAngleOffsetDeg: number;
};

const bezierHandleTarget = ({
  element,
  sourceElements,
  role,
  intermediatePointId
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  sourceElements: CadElement[];
  role: BezierHandleRole;
  intermediatePointId?: string;
}): BezierHandleTarget | null => {
  const curve = evaluateElements(sourceElements).computedGeometry.get(element.id);
  if (!isComputedBezierCurve(curve) || curve.segments.length === 0) return null;

  if (role === "start") {
    const segment = curve.segments[0];
    return {
      anchor: segment.start,
      control: segment.control1,
      angleKey: "startHandleAngleDeg",
      lengthKey: "startHandleLength",
      storedAngleOffsetDeg: 0
    };
  }

  if (role === "end") {
    const segment = curve.segments.at(-1);
    if (!segment) return null;
    return {
      anchor: segment.end,
      control: segment.control2,
      angleKey: "endHandleAngleDeg",
      lengthKey: "endHandleLength",
      storedAngleOffsetDeg: 180
    };
  }

  const intermediateIndex = element.intermediatePoints.findIndex(
    (point) => point.id === intermediatePointId
  );
  if (intermediateIndex < 0) return null;
  const intermediate = element.intermediatePoints[intermediateIndex];

  if (role === "intermediateIncoming") {
    const segment = curve.segments[intermediateIndex];
    if (!segment) return null;
    return {
      anchor: segment.end,
      control: segment.control2,
      angleKey: `intermediate:${intermediate.id}:handleAngleDeg`,
      lengthKey: `intermediate:${intermediate.id}:incomingHandleLength`,
      storedAngleOffsetDeg: 180
    };
  }

  const segment = curve.segments[intermediateIndex + 1];
  if (!segment) return null;
  return {
    anchor: segment.start,
    control: segment.control1,
    angleKey: `intermediate:${intermediate.id}:handleAngleDeg`,
    lengthKey: `intermediate:${intermediate.id}:outgoingHandleLength`,
    storedAngleOffsetDeg: 0
  };
};

const moveBezierHandle = ({
  element,
  sourceElements,
  dx,
  dy,
  role,
  intermediatePointId,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  sourceElements: CadElement[];
  dx: number;
  dy: number;
  role: BezierHandleRole;
  intermediatePointId?: string;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const target = bezierHandleTarget({ element, sourceElements, role, intermediatePointId });
  if (!target) return element;

  const currentVector = {
    x: target.control.x - target.anchor.x,
    y: target.anchor.y - target.control.y
  };
  const currentLength = Math.hypot(currentVector.x, currentVector.y);
  const currentControlAngleDeg =
    currentLength === 0
      ? target.storedAngleOffsetDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(currentVector.y, currentVector.x)));
  const currentStoredAngleDeg = normalizeDegrees(
    currentControlAngleDeg - target.storedAngleOffsetDeg
  );

  const movedControl = {
    x: target.control.x + dx,
    y: target.control.y + dy
  };
  const movedVector = {
    x: movedControl.x - target.anchor.x,
    y: target.anchor.y - movedControl.y
  };

  if (angleLocked) {
    const angleRad = degreesToRadians(currentControlAngleDeg);
    const unit = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const projectedLength = Math.max(0, movedVector.x * unit.x + movedVector.y * unit.y);
    if (projectedLength === currentLength) return element;
    return setNumericParameterOrLocalVariable(element, target.lengthKey, projectedLength);
  }

  const movedLength = Math.hypot(movedVector.x, movedVector.y);
  if (distanceLocked) {
    if (movedLength === 0) return element;
    const controlAngleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(movedVector.y, movedVector.x)));
    const storedAngleDeg = normalizeDegrees(controlAngleDeg - target.storedAngleOffsetDeg);
    if (storedAngleDeg === currentStoredAngleDeg) return element;
    return setNumericParameterOrLocalVariable(element, target.angleKey, storedAngleDeg);
  }

  const controlAngleDeg =
    movedLength === 0
      ? currentControlAngleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(movedVector.y, movedVector.x)));
  const storedAngleDeg = normalizeDegrees(controlAngleDeg - target.storedAngleOffsetDeg);
  if (movedLength === currentLength && storedAngleDeg === currentStoredAngleDeg) return element;
  return setNumericParameterOrLocalVariable(
    setNumericParameterOrLocalVariable(element, target.angleKey, storedAngleDeg),
    target.lengthKey,
    movedLength
  );
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
  let didMove = false;
  const nextElements = sourceElements.map((element) => {
    if (element.id !== elementId || element.type !== "bezierCurve") return element;
    const nextElement = moveBezierHandle({
      element,
      sourceElements,
      dx,
      dy,
      role: bezierHandleRole,
      intermediatePointId,
      angleLocked,
      distanceLocked
    });
    didMove = nextElement !== element;
    return nextElement;
  });

  if (!didMove) return;

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

const anchorPointId = (anchor: PointAnchor) => (anchor.mode === "reference" ? anchor.pointId : null);

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

const startPointPick = () => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "reference") return;

  useCadStore.setState({
    activeNumericReferencePickTarget: null,
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

  if (anchor.mode === "reference") {
    const pointElement = elements.find((element) => element.id === anchor.pointId);
    if (
      !pointElement ||
      (pointElement.type !== "freePoint" &&
        pointElement.type !== "offsetPoint" &&
        pointElement.type !== "polarOffsetPoint")
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

const toggleBooleanParameterByDirectKey = (directKey: string | undefined) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !directKey) return;

  const definition = findParameterByDirectKey(selectedElement, directKey);
  if (definition?.kind !== "boolean") return;

  updateSelectedElement((element) => ({
    ...element,
    [definition.key]: !element[definition.key as keyof CadElement]
  } as CadElement));
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
  if (elements.length === 0) return;

  const index = getSelectedIndex(elements, selectedElementId);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = Math.min(Math.max(currentIndex + offset, 0), elements.length - 1);

  useCadStore.getState().setSelectedElementId(elements[nextIndex].id);
  updateDependencyJumpModeAfterSelectionChange();
};

const extendSelectionByOffset = (offset: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadStore.getState();
  if (elements.length === 0) return;

  const index = getSelectedIndex(elements, selectedElementId);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = Math.min(Math.max(currentIndex + offset, 0), elements.length - 1);
  const anchorId = selectionAnchorElementId ?? selectedElementId ?? elements[currentIndex].id;
  useCadStore.getState().setSelectedElementRange(anchorId, elements[nextIndex].id);
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
    const selectedIds = new Set(selectedElementIds);
    let primaryId = elementId;
    if (selectedIds.has(elementId) && selectedIds.size > 1) {
      selectedIds.delete(elementId);
      primaryId = [...selectedIds][0];
    } else {
      selectedIds.add(elementId);
    }
    useCadStore.getState().setSelectedElementIds([...selectedIds], primaryId);
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  useCadStore.getState().setSelectedElementId(elementId);
  updateDependencyJumpModeAfterSelectionChange();
};

const selectedIndexes = (elements: CadElement[], selectedIds: ElementId[]) => {
  const idSet = new Set(selectedIds);
  return elements
    .map((element, index) => (idSet.has(element.id) ? index : -1))
    .filter((index) => index >= 0);
};

const moveElementsToInsertionIndex = (elementIds: ElementId[], insertionIndex: number) => {
  const { elements, selectedElementId } = useCadStore.getState();
  const movingIds = elementIdsInDocumentOrder(elements, elementIds);
  if (movingIds.length === 0) return;

  const movingIdSet = new Set(movingIds);
  const firstMovingIndex = elements.findIndex((element) => movingIdSet.has(element.id));
  const clampedInsertionIndex = Math.min(Math.max(insertionIndex, 0), elements.length);
  const movedBeforeInsertion = elements
    .slice(0, clampedInsertionIndex)
    .filter((element) => movingIdSet.has(element.id)).length;
  const remainingElements = elements.filter((element) => !movingIdSet.has(element.id));
  const targetIndex = clampedInsertionIndex - movedBeforeInsertion;
  const movingElements = elements.filter((element) => movingIdSet.has(element.id));

  if (targetIndex === firstMovingIndex && movingElements.every((element, index) => elements[firstMovingIndex + index]?.id === element.id)) {
    return;
  }

  const nextElements = [
    ...remainingElements.slice(0, targetIndex),
    ...movingElements,
    ...remainingElements.slice(targetIndex)
  ];

  useCadStore.getState().commitDocumentChange({
    elements: nextElements,
    selectedElementId: selectedElementId && movingIdSet.has(selectedElementId) ? selectedElementId : movingIds[0],
    selectedElementIds: movingIds,
    selectionAnchorElementId: useCadStore.getState().selectionAnchorElementId ?? movingIds[0]
  });
};

const moveElementToInsertionIndex = (elementId: ElementId, insertionIndex: number) => {
  const { elements, selectedElementIds } = useCadStore.getState();
  const elementIds = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
  if (elementIds.length > 1) {
    moveElementsToInsertionIndex(elementIds, insertionIndex);
    return;
  }

  const fromIndex = elements.findIndex((element) => element.id === elementId);
  if (fromIndex < 0) return;

  const clampedInsertionIndex = Math.min(Math.max(insertionIndex, 0), elements.length);
  if (clampedInsertionIndex === fromIndex || clampedInsertionIndex === fromIndex + 1) return;

  const nextElements = [...elements];
  const [movedElement] = nextElements.splice(fromIndex, 1);
  const toIndex =
    clampedInsertionIndex > fromIndex ? clampedInsertionIndex - 1 : clampedInsertionIndex;
  nextElements.splice(toIndex, 0, movedElement);

  useCadStore.getState().commitDocumentChange({
    elements: nextElements,
    selectedElementId: movedElement.id,
    selectedElementIds: [movedElement.id],
    selectionAnchorElementId: movedElement.id
  });
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
  addBezierCurve: {
    id: "addBezierCurve",
    label: "Bezier curve を追加",
    run: () => addElement("bezierCurve")
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
    run: (context) => {
      const selectedElement = getSelectedElement();
      if (!selectedElement || !context?.parameterDirectKey) return;
      const definition = findParameterByDirectKey(selectedElement, context.parameterDirectKey);
      if (!definition) return;
      useCadStore.setState({ selectedParameterKey: definition.key });
      context.focusSelectedParameterInput?.();
    }
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
  focusSelectedParameterInput: {
    id: "focusSelectedParameterInput",
    label: "選択パラメーターの入力欄へフォーカス",
    run: (context) => {
      const definition = selectedParameterDefinition();
      if (definition?.kind === "reference") {
        startPointPick();
        return;
      }
      if (definition?.kind === "number") {
        startNumericReferencePick();
        return;
      }
      context?.focusSelectedParameterInput?.();
    }
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
  "addLine",
  "addArcLine",
  "addBezierCurve",
  "startPointPick",
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
  addLine: ["line", "直線", "線", "追加"],
  addArcLine: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"],
  addBezierCurve: ["bezier", "curve", "曲線", "ベジェ", "追加"],
  startNumericReferencePick: ["number", "reference", "measurement", "数値", "参照", "選択"],
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
