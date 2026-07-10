import { addToNumericValue } from "../geometry/numericExpressions";
import { createCadElementId } from "../model/cadIds";
import { anchorEquals, lineEndpointReferenceEquals, lineEndpointReferenceOptions, referenceAnchor } from "../model/pointAnchors";
import {
  findParameterByDirectKey,
  findParameterDefinition,
  getNumericParameterStep,
  getNumericParameterStepLevels,
  getParameterDefinitions,
  pointAnchorReferenceOptions
} from "../parameters/parameterDefinitions";
import {
  getParameterValue,
  getPointAnchor,
  parseAnchorCoordinateParameterKey,
  setParameterValue,
  supportsNumericVariables
} from "../parameters/parameterAccess";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, LineEndpointReference, NumericValue, PointAnchor } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import {
  getSelectedElement,
  isLineLikeElement,
  isPointLikeElement,
  selectedParameterDefinition,
  updateSelectedElement
} from "./commandRuntime";

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
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId, selectedParameterKey } = useCadUiStore.getState();
  const elementId = context?.elementId ?? selectedElementId;
  const element = elementId ? elements.find((item) => item.id === elementId) ?? null : null;
  if (!element) return null;

  const parameterKey = parentPointAnchorParameterKey(context?.parameterKey ?? selectedParameterKey);
  if (!parameterKey) return null;

  const definition = findParameterDefinition(element, parameterKey);
  if (definition?.kind !== "reference") return null;

  const anchor = getPointAnchor(element, parameterKey);
  if (!anchor && !definition.allowNone) return null;

  return { element, parameterKey, definition, anchor };
};

const isLineEndpointReferenceValue = (value: unknown): value is LineEndpointReference =>
  typeof value === "object" &&
  value !== null &&
  "lineId" in value &&
  "endpointKey" in value &&
  typeof value.lineId === "string" &&
  (value.endpointKey === "start" || value.endpointKey === "end");

export const selectParameterByOffset = (offset: number) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return;

  const definitions = getParameterDefinitions(selectedElement);
  const { selectedParameterKey } = useCadUiStore.getState();
  const index = definitions.findIndex((definition) => definition.key === selectedParameterKey);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = (currentIndex + offset + definitions.length) % definitions.length;
  useCadUiStore.setState({ selectedParameterKey: definitions[nextIndex].key });
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

export const updateNumericParameter = (direction: 1 | -1, context?: CommandContext) => {
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
  if (definition.kind === "color") {
    cycleColorParameter(direction);
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

const cycleColorParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "color") return;

  const options = [undefined, ...useCadDocumentStore.getState().palette.colors.map((color) => color.id)];
  const currentValue = getParameterValue(selectedElement, definition.key);
  const currentIndex = options.findIndex((option) => option === currentValue);
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => setParameterValue(element, definition.key, options[nextIndex]));
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

export const applyParameterDirectKey = (
  directKey: string | undefined,
  focusSelectedParameterInput?: () => void
) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !directKey) return;

  const definition = findParameterByDirectKey(selectedElement, directKey);
  if (!definition) return;

  if (definition.kind === "boolean") {
    useCadDocumentStore.getState().commitDocumentChange({
      elements: useCadDocumentStore.getState().elements.map((element) =>
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
      useCadUiStore.setState({ selectedParameterKey: definition.key });
      return;
    }
    useCadDocumentStore.getState().commitDocumentChange({
      elements: useCadDocumentStore.getState().elements.map((element) =>
        element.id === selectedElement.id
          ? setParameterValue(element, definition.key, nextValue)
          : element
      ),
      selectedParameterKey: definition.key
    });
    return;
  }

  if (definition.kind === "color") {
    useCadUiStore.setState({ selectedParameterKey: definition.key });
    cycleColorParameter(1);
    return;
  }

  useCadUiStore.setState({ selectedParameterKey: definition.key });
  focusSelectedParameterInput?.();
};

export const updateSelectedNumericParameterStep = (direction: 1 | -1) => {
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

export const cycleReferenceParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "reference") return;

  const options = pointAnchorReferenceOptions(useCadDocumentStore.getState().elements);
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

  const options = lineEndpointReferenceOptions(useCadDocumentStore.getState().elements);
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

  const options = lineReferenceOptions(useCadDocumentStore.getState().elements).filter(
    (element) => element.id !== selectedElement.id
  );
  if (options.length === 0) return;

  const currentValue = getParameterValue(selectedElement, definition.key);
  const currentIndex = options.findIndex((option) => option.id === currentValue);
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => setParameterValue(element, definition.key, options[nextIndex].id));
};

export const addNumericVariable = () => {
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
  useCadUiStore.setState({ selectedParameterKey: `variable:${variable.id}:value` });
};

export const deleteNumericVariable = (variableId: string | undefined) => {
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

export const addBezierIntermediatePoint = () => {
  const selectedElement = getSelectedElement();
  if (selectedElement?.type !== "bezierCurve") return;

  const options = pointAnchorReferenceOptions(useCadDocumentStore.getState().elements);
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
  useCadUiStore.setState({ selectedParameterKey: `intermediate:${intermediatePoint.id}:point` });
};

export const deleteBezierIntermediatePoint = (intermediatePointId: string | undefined) => {
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

export const toggleBooleanParameter = () => {
  const definition = selectedParameterDefinition();
  if (definition?.kind !== "boolean") return;

  updateSelectedElement((element) => ({
    ...element,
    [definition.key]: !element[definition.key as keyof CadElement]
  } as CadElement));
};

export const setSelectedPointAnchorMode = (
  mode: "reference" | "coordinate",
  context?: CommandContext
) => {
  const target = pointAnchorParameterTarget(context);
  if (!target) return false;
  if (mode === "coordinate" && !target.definition.allowCoordinate) return false;
  if (target.anchor?.mode === mode) {
    useCadUiStore.setState({
      selectedParameterKey: mode === "coordinate" ? `${target.parameterKey}:x` : target.parameterKey
    });
    return true;
  }

  const nextAnchor =
    mode === "coordinate"
      ? coordinateAnchor()
      : referenceAnchor(
          target.anchor?.mode === "reference"
            ? target.anchor.pointId
            : useCadDocumentStore.getState().elements.find(isPointLikeElement)?.id ?? ""
        );
  const selectedParameterKey = mode === "coordinate" ? `${target.parameterKey}:x` : target.parameterKey;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: useCadDocumentStore.getState().elements.map((element) =>
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

export const toggleSelectedPointAnchorMode = (context?: CommandContext) => {
  const target = pointAnchorParameterTarget(context);
  if (!target || !target.definition.allowCoordinate) return false;
  return setSelectedPointAnchorMode(
    target.anchor?.mode === "coordinate" ? "reference" : "coordinate",
    {
      ...context,
      elementId: target.element.id,
      parameterKey: target.parameterKey
    }
  );
};

export const toggleSelectedParameterValue = () => {
  if (toggleSelectedPointAnchorMode()) return;
  toggleBooleanParameter();
};

export const toggleBooleanParameterByDirectKey = (directKey: string | undefined) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !directKey) return;

  const definition = findParameterByDirectKey(selectedElement, directKey);
  if (definition?.kind !== "boolean") return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: useCadDocumentStore.getState().elements.map((element) =>
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
