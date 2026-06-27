import { useMemo, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { numericReferencePropertiesForElement } from "../geometry/numericReferenceProperties";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { isPointElement } from "../model/pointAnchors";
import { parseVariableParameterKey } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { variableIsInScope } from "../geometry/variableScope";
import type { CadElement, ElementId } from "../types/geometry";

type MeasurementInsertMode = "distance" | "angle" | "lineDistance";

type InsertTargetInput = {
  displayedExpression: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

type ExpressionInsertTrayProps = {
  element: CadElement;
  elements: CadElement[];
  parameterKey: ParameterKey;
  input: HTMLInputElement | null;
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
  input,
  getInputTarget
}: ExpressionInsertTrayProps) => {
  const [mode, setMode] = useState<MeasurementInsertMode>("distance");
  const previousElements = useMemo(() => {
    const targetIndex = elements.findIndex((item) => item.id === element.id);
    return targetIndex < 0 ? [] : elements.slice(0, targetIndex);
  }, [element.id, elements]);
  const pointOptions = useMemo(() => previousElements.filter(isPointElement), [previousElements]);
  const lineOptions = useMemo(
    () => previousElements.filter((item) => item.type === "line"),
    [previousElements]
  );
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
  const [point1Id, setPoint1Id] = useState<ElementId>(pointOptions[0]?.id ?? "");
  const [point2Id, setPoint2Id] = useState<ElementId>(pointOptions[1]?.id ?? pointOptions[0]?.id ?? "");
  const [lineId, setLineId] = useState<ElementId>(lineOptions[0]?.id ?? "");
  const effectivePoint1Id = pointOptions.some((point) => point.id === point1Id)
    ? point1Id
    : pointOptions[0]?.id ?? "";
  const effectivePoint2Id = pointOptions.some((point) => point.id === point2Id)
    ? point2Id
    : pointOptions[1]?.id ?? pointOptions[0]?.id ?? "";
  const effectiveLineId = lineOptions.some((line) => line.id === lineId)
    ? lineId
    : lineOptions[0]?.id ?? "";
  const selectedMode = measurementModes.find((item) => item.mode === mode) ?? measurementModes[0];
  const canInsertMeasurement =
    mode === "lineDistance"
      ? Boolean(effectivePoint1Id && effectiveLineId)
      : Boolean(effectivePoint1Id && effectivePoint2Id);
  const measurementExpression =
    mode === "lineDistance"
      ? `${selectedMode.functionName}(${effectivePoint1Id}, ${effectiveLineId})`
      : `${selectedMode.functionName}(${effectivePoint1Id}, ${effectivePoint2Id})`;
  const measurementPreview =
    mode === "lineDistance"
      ? `${selectedMode.functionName}(${selectedElementName(elements, effectivePoint1Id)}, ${selectedElementName(elements, effectiveLineId)})`
      : `${selectedMode.functionName}(${selectedElementName(elements, effectivePoint1Id)}, ${selectedElementName(elements, effectivePoint2Id)})`;

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
    requestAnimationFrame(() => input?.focus());
  };

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
        <div className="measurement-insert-grid">
          <label>
            {mode === "lineDistance" ? "点" : "点1"}
            <select
              aria-label={mode === "lineDistance" ? "点" : "点1"}
              value={effectivePoint1Id}
              onChange={(event) => setPoint1Id(event.target.value)}
            >
              {pointOptions.map((point) => (
                <option key={point.id} value={point.id}>{point.name}</option>
              ))}
            </select>
          </label>
          {mode === "lineDistance" ? (
            <label>
              線
              <select aria-label="線" value={effectiveLineId} onChange={(event) => setLineId(event.target.value)}>
                {lineOptions.map((line) => (
                  <option key={line.id} value={line.id}>{line.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              点2
              <select aria-label="点2" value={effectivePoint2Id} onChange={(event) => setPoint2Id(event.target.value)}>
                {pointOptions.map((point) => (
                  <option key={point.id} value={point.id}>{point.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          type="button"
          className="expression-insert-button"
          onClick={() => insertSnippet(measurementExpression)}
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
