import type { KeyboardEvent } from "react";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement, EvaluationResult } from "../types/geometry";

export type RegisterParameterControl = (key: string, element: HTMLElement | null) => void;

export type CommonEditorProps = {
  element: CadElement;
  elements: CadElement[];
  evaluation?: EvaluationResult;
  isParameterEditMode: boolean;
  registerParameterControl: RegisterParameterControl;
};

export const useParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl
}: Pick<CommonEditorProps, "element" | "isParameterEditMode" | "registerParameterControl">) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const selectedParameterKey = useCadDocumentStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadDocumentStore((state) => state.setSelectedParameterKey);
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const controlProps = (key: ParameterKey) => ({
    ref: (node: HTMLElement | null) => registerParameterControl(key, node),
    onFocus: () => setSelectedParameterKey(key),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.currentTarget.blur();
      }
    }
  });
  const updateParameterValue = (field: ParameterKey, value: unknown) => {
    updateElement(element.id, setParameterValue(element, field, value) as Partial<CadElement>);
  };
  return {
    controlProps,
    parameterFieldClass,
    selectParameter,
    selectedParameterKey,
    updateElement,
    updateParameterValue
  };
};
