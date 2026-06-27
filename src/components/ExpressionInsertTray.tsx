import { useMemo } from "react";
import { dispatchCommand } from "../commands/commands";
import { numericReferencePropertiesForElement } from "../geometry/numericReferenceProperties";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { parseVariableParameterKey } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { variableIsInScope } from "../geometry/variableScope";
import { useCadUiStore } from "../state/cadUiStore";
import type { MeasurementInsertMode, MeasurementPointSlot } from "../state/cadUiStore";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";

type InsertTargetInput = {
  displayedExpression: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

type ExpressionInsertTrayProps = {
  element: CadElement;
  elements: CadElement[];
  parameterKey: ParameterKey;
  focusInput: () => void;
  getInputTarget: () => InsertTargetInput;
};

const measurementModes: {
  mode: MeasurementInsertMode;
  label: string;
  functionName: string;
  description: string;
}[] = [
  { mode: "distance", label: "2点距離", functionName: "距離", description: "点から点まで" },
  { mode: "angle", label: "2点角度", functionName: "角度", description: "点同士の角度" },
  { mode: "lineDistance", label: "点と線の距離", functionName: "点線距離", description: "垂直距離" }
];

const selectedElementName = (elements: CadElement[], elementId: ElementId) =>
  elements.find((element) => element.id === elementId)?.name ?? elementId;

const elementLabel = (element: CadElement) => `${element.name} (${element.id})`;

const pointAnchorLabel = (anchor: PointAnchor | null, elements: CadElement[]) => {
  if (!anchor) return "未選択";
  if (anchor.mode === "reference") return selectedElementName(elements, anchor.pointId);
  if (anchor.mode === "derived") {
    const elementName = selectedElementName(elements, anchor.elementId);
    if (anchor.pointKey === "start") return `${elementName}.始点`;
    if (anchor.pointKey === "end") return `${elementName}.終点`;
    if (anchor.pointKey === "center") return `${elementName}.中心点`;
    if (anchor.pointKey.startsWith("intermediate:")) return `${elementName}.中間点`;
    return `${elementName}.${anchor.pointKey}`;
  }
  return `座標(${anchor.x}, ${anchor.y})`;
};

const scopedVariableOptions = ({
  element,
  elements,
  parameterKey
}: {
  element: CadElement;
  elements: CadElement[];
  parameterKey: ParameterKey;
}) => {
  const targetIndex = elements.findIndex((item) => item.id === element.id);
  const elementsById = new Map(elements.map((item) => [item.id, item]));
  const options: { expression: string; label: string; detail: string }[] = [];

  const localVariable = parseVariableParameterKey(parameterKey);
  const localVariables = element.numericVariables ?? [];
  const localVariableLimit = localVariable
    ? localVariables.findIndex((variable) => variable.id === localVariable.variableId)
    : localVariables.length;
  for (const variable of localVariables.slice(0, Math.max(0, localVariableLimit))) {
    options.push({
      expression: `@${variable.id}`,
      label: `@${variable.name}`,
      detail: "要素内変数"
    });
  }

  for (let index = 0; index < targetIndex; index += 1) {
    const candidate = elements[index];
    if (candidate.type !== "variable") continue;
    if (!variableIsInScope({ variable: candidate, consumer: element, elementsById })) continue;
    options.push({
      expression: `@${candidate.id}`,
      label: `@${candidate.name}`,
      detail: candidate.scope === "global" ? "全体変数" : "グループ変数"
    });
  }

  return options;
};

export const ExpressionInsertTray = ({
  element,
  elements,
  parameterKey,
  focusInput,
  getInputTarget
}: ExpressionInsertTrayProps) => {
  const activeMeasurementInsertTarget = useCadUiStore((state) => state.activeMeasurementInsertTarget);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const isMeasurementTarget =
    activeMeasurementInsertTarget?.elementId === element.id &&
    activeMeasurementInsertTarget.parameterKey === parameterKey;
  const mode = isMeasurementTarget ? activeMeasurementInsertTarget.mode : "distance";
  const previousElements = useMemo(() => {
    const targetIndex = elements.findIndex((item) => item.id === element.id);
    return targetIndex < 0 ? [] : elements.slice(0, targetIndex);
  }, [element.id, elements]);
  const propertyOptions = useMemo(
    () =>
      previousElements.flatMap((item) =>
        numericReferencePropertiesForElement(item).map((property) => ({
          element: item,
          property,
          expression: `${item.id}.${property}`
        }))
      ),
    [previousElements]
  );
  const variableOptions = useMemo(
    () => scopedVariableOptions({ element, elements, parameterKey }),
    [element, elements, parameterKey]
  );
  const point1Anchor = isMeasurementTarget ? activeMeasurementInsertTarget.point1Anchor : null;
  const point2Anchor = isMeasurementTarget ? activeMeasurementInsertTarget.point2Anchor : null;
  const lineId = isMeasurementTarget ? activeMeasurementInsertTarget.lineId : null;
  const selectedMode = measurementModes.find((item) => item.mode === mode) ?? measurementModes[0];
  const canInsertMeasurement =
    mode === "lineDistance"
      ? Boolean(point1Anchor && lineId)
      : Boolean(point1Anchor && point2Anchor);
  const measurementPreview =
    mode === "lineDistance"
      ? `${selectedMode.functionName}(${pointAnchorLabel(point1Anchor, elements)}, ${lineId ? selectedElementName(elements, lineId) : "未選択"})`
      : `${selectedMode.functionName}(${pointAnchorLabel(point1Anchor, elements)}, ${pointAnchorLabel(point2Anchor, elements)})`;

  const insertSnippet = (snippet: string) => {
    const target = getInputTarget();
    dispatchCommand("insertNumericExpressionSnippet", {
      elementId: element.id,
      parameterKey,
      numericExpressionSnippet: snippet,
      displayedExpression: target.displayedExpression,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    });
    requestAnimationFrame(focusInput);
  };
  const inputTargetContext = () => {
    const target = getInputTarget();
    return {
      elementId: element.id,
      parameterKey,
      displayedExpression: target.displayedExpression,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    };
  };
  const startPointPick = (measurementPointSlot: MeasurementPointSlot) => {
    dispatchCommand("startMeasurementPointPick", {
      ...inputTargetContext(),
      measurementInsertMode: mode,
      measurementPointSlot
    });
  };
  const startLinePick = () => {
    dispatchCommand("startMeasurementLinePick", {
      ...inputTargetContext(),
      measurementInsertMode: mode
    });
  };
  const insertMeasurement = () => {
    dispatchCommand("insertSelectedMeasurement", {
      ...inputTargetContext(),
      measurementInsertMode: mode
    });
    requestAnimationFrame(focusInput);
  };
  const setMode = (measurementInsertMode: MeasurementInsertMode) => {
    dispatchCommand("setMeasurementInsertMode", {
      ...inputTargetContext(),
      measurementInsertMode
    });
  };
  const isPickingPoint = (slot: MeasurementPointSlot) =>
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey &&
    activePointPickTarget.measurementSlot === slot;
  const isPickingLine =
    activeLinePickTarget?.elementId === element.id &&
    activeLinePickTarget.parameterKey === parameterKey &&
    activeLinePickTarget.measurementSlot === "line";

  return (
    <div className="expression-insert-tray">
      <div className="expression-insert-header">
        <span>測定・参照を挿入</span>
        <button type="button" onClick={() => dispatchCommand("closeExpressionInsertTray")}>
          閉じる
        </button>
      </div>

      <div className="expression-insert-section">
        <div className="expression-insert-title">
          <span>測定を挿入</span>
          <code>{measurementPreview}</code>
        </div>
        <div className="measurement-mode-grid" role="group" aria-label="挿入する測定">
          {measurementModes.map((item) => (
            <button
              key={item.mode}
              type="button"
              className={mode === item.mode ? "active-toggle" : ""}
              onClick={() => setMode(item.mode)}
            >
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
        <div className="measurement-pick-grid">
          <div className="measurement-pick-field">
            <span>{mode === "lineDistance" ? "点" : "点1"}</span>
            <strong>{pointAnchorLabel(point1Anchor, elements)}</strong>
            <button
              type="button"
              className={isPickingPoint("point1") ? "active-toggle" : ""}
              onClick={() => startPointPick("point1")}
            >
              {isPickingPoint("point1") ? "点選択中" : "点を選択"}
            </button>
          </div>
          {mode === "lineDistance" ? (
            <div className="measurement-pick-field">
              <span>線</span>
              <strong>{lineId ? selectedElementName(elements, lineId) : "未選択"}</strong>
              <button
                type="button"
                className={isPickingLine ? "active-toggle" : ""}
                onClick={startLinePick}
              >
                {isPickingLine ? "線選択中" : "線を選択"}
              </button>
            </div>
          ) : (
            <div className="measurement-pick-field">
              <span>点2</span>
              <strong>{pointAnchorLabel(point2Anchor, elements)}</strong>
              <button
                type="button"
                className={isPickingPoint("point2") ? "active-toggle" : ""}
                onClick={() => startPointPick("point2")}
              >
                {isPickingPoint("point2") ? "点選択中" : "点を選択"}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="expression-insert-button"
          onClick={insertMeasurement}
          disabled={!canInsertMeasurement}
        >
          式に挿入
        </button>
      </div>

      <div className="expression-insert-section">
        <div className="expression-insert-title">
          <span>線・曲線プロパティ</span>
        </div>
        <div className="expression-token-grid">
          {propertyOptions.length === 0 ? (
            <p className="empty-state">参照できる線・曲線はありません。</p>
          ) : (
            propertyOptions.map((option) => (
              <button
                key={`${option.element.id}-${option.property}`}
                type="button"
                onClick={() => insertSnippet(option.expression)}
              >
                <strong>{lineMeasurementLabel(option.property)}</strong>
                <small>{elementLabel(option.element)}</small>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="expression-insert-section">
        <div className="expression-insert-title">
          <span>変数参照</span>
        </div>
        <div className="expression-token-grid">
          {variableOptions.length === 0 ? (
            <p className="empty-state">参照できる変数はありません。</p>
          ) : (
            variableOptions.map((option) => (
              <button
                key={option.expression}
                type="button"
                onClick={() => insertSnippet(option.expression)}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
