import { insertNumericExpressionSnippet } from "../geometry/numericExpressionInsertion";
import {
  makeNumericExpression,
  normalizeNumericExpressionInput,
  numericValueExpression,
  type NumericMeasurementKey
} from "../geometry/numericExpressions";
import {
  creationPlacementForEvaluationLimit,
  creationPlacementForTarget
} from "../model/elementCreationPlacement";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { commitDocumentChangeAndSelect } from "../commands/commitDocumentChangeAndSelect";
import { commitSourceCreationInsertion } from "../commands/sourceCreationCommit";
import { sourceCreationInsertionIsCurrent, type SourceCreationInsertion } from "../commands/sourceCreationInsertion";
import type { ElementId, NumericValue, PointAnchor } from "../types/geometry";
import { instantiateGroupTemplate, type GroupTemplate } from "./groupTemplate";
import {
  defaultTemplateInputValues,
  firstIncompleteTemplateInput,
  nextTemplateInputId,
  TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
  TEMPLATE_INSERTION_PICK_TARGET_ID,
  templateInsertionCanConfirm,
  type ActiveTemplateInsertion
} from "./templateInsertionMode";

const setPickTargetForTemplateInput = (insertion: ActiveTemplateInsertion | null) => {
  const input = insertion?.template.inputs.find((item) => item.id === insertion.currentInputId);
  if (!insertion || !input) {
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activePickCursor: null
    });
    return;
  }
  if (input.kind === "point") {
    useCadUiStore.setState({
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activePointPickTarget: {
        elementId: TEMPLATE_INSERTION_PICK_TARGET_ID,
        parameterKey: input.id,
        insertionIndex: insertion.insertionIndex
      },
      activePickCursor: null
    });
    return;
  }
  if (input.kind === "line") {
    useCadUiStore.setState({
      activeNumericReferencePickTarget: null,
      activePointPickTarget: null,
      activeLinePickTarget: {
        elementId: TEMPLATE_INSERTION_PICK_TARGET_ID,
        parameterKey: input.id,
        insertionIndex: insertion.insertionIndex
      },
      activePickCursor: null
    });
    return;
  }
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activePickCursor: null
  });
};

const setActiveTemplateInsertion = (insertion: ActiveTemplateInsertion | null) => {
  useCadUiStore.getState().setActiveTemplateInsertion(insertion);
  setPickTargetForTemplateInput(insertion);
};

const updateTemplateInsertion = (
  updater: (insertion: ActiveTemplateInsertion) => ActiveTemplateInsertion
) => {
  const current = useCadUiStore.getState().activeTemplateInsertion;
  if (!current) return;
  const next = updater(current);
  setActiveTemplateInsertion(next);
};

export const startTemplateInsertion = ({ template, insertionIndex, sourceInsertion = null }: {
  template: GroupTemplate;
  insertionIndex?: number;
  sourceInsertion?: SourceCreationInsertion | null;
}) => {
  const document = useCadDocumentStore.getState();
  if (sourceInsertion && !sourceCreationInsertionIsCurrent(sourceInsertion, document.sourceRevision)) {
    useCadUiStore.getState().setCommandErrorMessage("文書が変更されたため、テンプレート挿入を開始できません。もう一度実行してください。");
    return false;
  }
  const { elements, evaluationLimitIndex } = document;
  const placement = sourceInsertion
    ? creationPlacementForTarget(elements, sourceInsertion.insertionTarget, evaluationLimitIndex)
    : creationPlacementForEvaluationLimit(elements, insertionIndex ?? evaluationLimitIndex);
  const inputValues = defaultTemplateInputValues(template);
  const insertion: ActiveTemplateInsertion = {
    template,
    inputValues,
    currentInputId: template.inputs[0]?.id ?? null,
    insertionIndex: placement.insertionIndex,
    parentGroupId: placement.parentGroupId,
    conditionalBranch: placement.conditionalBranch,
    sourceInsertion,
    error: null
  };
  useCadUiStore.setState({
    showGroupTemplateLibrary: false,
    templateInsertionSourceInsertion: null,
    activeMeasurementInsertTarget: null,
    activeNumericReferencePickTarget: null
  });
  setActiveTemplateInsertion(insertion);
  return true;
};

export const cancelTemplateInsertion = () => {
  useCadUiStore.setState({
    activeTemplateInsertion: null,
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null
  });
};

export const selectTemplateInsertionInputByOffset = (offset: number) => {
  updateTemplateInsertion((insertion) => ({
    ...insertion,
    currentInputId: nextTemplateInputId(insertion, offset),
    error: null
  }));
};

export const selectTemplateInsertionInput = (inputId: string) => {
  updateTemplateInsertion((insertion) => ({
    ...insertion,
    currentInputId: insertion.template.inputs.some((input) => input.id === inputId)
      ? inputId
      : insertion.currentInputId,
    error: null
  }));
};

export const applyTemplatePickedPoint = (anchor: PointAnchor) => {
  const current = useCadUiStore.getState().activeTemplateInsertion;
  const activeTarget = useCadUiStore.getState().activePointPickTarget;
  if (!current || activeTarget?.elementId !== TEMPLATE_INSERTION_PICK_TARGET_ID) return false;
  const input = current.template.inputs.find((item) => item.id === activeTarget.parameterKey);
  if (!input || input.kind !== "point") return false;
  const next: ActiveTemplateInsertion = {
    ...current,
    inputValues: {
      ...current.inputValues,
      [input.id]: anchor
    },
    currentInputId: nextTemplateInputId(current, 1),
    error: null
  };
  setActiveTemplateInsertion(next);
  return true;
};

export const applyTemplatePickedLine = (lineId: ElementId) => {
  const current = useCadUiStore.getState().activeTemplateInsertion;
  const activeTarget = useCadUiStore.getState().activeLinePickTarget;
  if (!current || activeTarget?.elementId !== TEMPLATE_INSERTION_PICK_TARGET_ID) return false;
  const input = current.template.inputs.find((item) => item.id === activeTarget.parameterKey);
  if (!input || input.kind !== "line") return false;
  const next: ActiveTemplateInsertion = {
    ...current,
    inputValues: {
      ...current.inputValues,
      [input.id]: lineId
    },
    currentInputId: nextTemplateInputId(current, 1),
    error: null
  };
  setActiveTemplateInsertion(next);
  return true;
};

export const setTemplateNumericInput = (inputId: string, value: NumericValue) => {
  updateTemplateInsertion((insertion) => ({
    ...insertion,
    inputValues: {
      ...insertion.inputValues,
      [inputId]: value
    },
    currentInputId: inputId,
    error: null
  }));
};

export const insertTemplateNumericExpressionSnippet = ({
  inputId,
  snippet,
  displayedExpression,
  selectionStart,
  selectionEnd,
  appendMode
}: {
  inputId: string;
  snippet: string;
  displayedExpression?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  appendMode?: "sum" | "raw";
}) => {
  const insertion = useCadUiStore.getState().activeTemplateInsertion;
  if (!insertion) return false;
  const input = insertion.template.inputs.find((item) => item.id === inputId);
  if (!input || input.kind !== "numeric") return false;
  const currentValue = insertion.inputValues[inputId] ?? input.defaultValue;
  const currentExpression =
    displayedExpression ?? numericValueExpression(currentValue as NumericValue);
  const nextDisplayExpression = insertNumericExpressionSnippet({
    currentExpression,
    snippet,
    selectionStart,
    selectionEnd,
    appendMode
  });
  const { elements } = useCadDocumentStore.getState();
  const normalized = normalizeNumericExpressionInput(nextDisplayExpression, elements, []);
  setTemplateNumericInput(inputId, makeNumericExpression(normalized));
  return true;
};

export const startTemplateNumericReferenceInsertPick = ({
  inputId,
  property,
  displayedExpression,
  selectionStart,
  selectionEnd
}: {
  inputId: string;
  property: NumericMeasurementKey;
  displayedExpression: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}) => {
  const insertion = useCadUiStore.getState().activeTemplateInsertion;
  const input = insertion?.template.inputs.find((item) => item.id === inputId);
  if (!insertion || input?.kind !== "numeric") return false;
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
      parameterKey: inputId,
      insertionIndex: insertion.insertionIndex,
      mode: "insert",
      property,
      displayedExpression,
      selectionStart,
      selectionEnd
    }
  });
  return true;
};

export const confirmTemplateInsertion = () => {
  const insertion = useCadUiStore.getState().activeTemplateInsertion;
  if (!insertion) return;
  const incomplete = firstIncompleteTemplateInput(insertion);
  if (incomplete || !templateInsertionCanConfirm(insertion)) {
    setActiveTemplateInsertion({
      ...insertion,
      currentInputId: incomplete?.id ?? insertion.currentInputId,
      error: incomplete ? `${incomplete.label} を指定してください。` : "未入力があります。"
    });
    return;
  }

  const { elements, evaluationLimitIndex, sourceRevision } = useCadDocumentStore.getState();
  if (insertion.sourceInsertion && !sourceCreationInsertionIsCurrent(insertion.sourceInsertion, sourceRevision)) {
    cancelTemplateInsertion();
    useCadUiStore.getState().setCommandErrorMessage("文書が変更されたため、テンプレート挿入を中止しました。もう一度実行してください。");
    return false;
  }
  try {
    const change = instantiateGroupTemplate({
      elements,
      template: insertion.template,
      inputValues: insertion.inputValues,
      insertionIndex: insertion.insertionIndex,
      parentGroupId: insertion.parentGroupId,
      conditionalBranch: insertion.conditionalBranch
    });
    if (insertion.sourceInsertion) {
      const insertedElements = change.elements.slice(
        change.insertionIndex,
        change.insertionIndex + change.insertedCount
      );
      const selectedElementOffset = insertedElements.findIndex(
        (element) => element.id === change.selectedElementId
      );
      const sourceCommit = commitSourceCreationInsertion({
        elements,
        insertionIndex: change.insertionIndex,
        insertedElements,
        sourceInsertionLine: insertion.sourceInsertion.sourceInsertionLine,
        selectedElementOffset: selectedElementOffset < 0 ? 0 : selectedElementOffset
      });
      if (sourceCommit.result.status !== "applied" || !sourceCommit.selectedElementId) {
        setActiveTemplateInsertion({ ...insertion, error: "現在のDSLテキストにはこの操作を適用できません。" });
        return false;
      }
      useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, {
        selectedElementId: sourceCommit.selectedElementId,
        selectedElementIds: sourceCommit.insertedElementIds,
        selectionAnchorElementId: sourceCommit.selectedElementId
      });
    } else {
      commitDocumentChangeAndSelect({
      elements: change.elements,
      evaluationLimitIndex: adjustEvaluationLimitForInsertion({
        elements,
        evaluationLimitIndex,
        insertionIndex: change.insertionIndex,
        insertedCount: change.insertedCount
      })
      }, change);
    }
    cancelTemplateInsertion();
    return true;
  } catch (error) {
    setActiveTemplateInsertion({
      ...insertion,
      error: error instanceof Error ? error.message : "テンプレートを挿入できません。"
    });
    return false;
  }
};

export const templateNumericTargetContext = (elementId?: string, parameterKey?: string | null) => {
  if (elementId !== TEMPLATE_INSERTION_NUMERIC_TARGET_ID || !parameterKey) return null;
  const insertion = useCadUiStore.getState().activeTemplateInsertion;
  const input = insertion?.template.inputs.find((item) => item.id === parameterKey);
  if (!insertion || !input || input.kind !== "numeric") return null;
  return {
    insertion,
    input,
    inputId: parameterKey
  };
};
