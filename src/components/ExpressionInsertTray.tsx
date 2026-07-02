import { useMemo, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  numericReferencePickProperties
} from "../geometry/numericReferenceProperties";
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

type NumericExpressionAppendMode = "sum" | "raw";

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

const conditionalOperators = [
  { operator: ">", description: "A > B: AがBより大きいとき真" },
  { operator: ">=", description: "A >= B: AがB以上のとき真" },
  { operator: "<", description: "A < B: AがBより小さいとき真" },
  { operator: "<=", description: "A <= B: AがB以下のとき真" },
  { operator: "==", description: "A == B: AとBが等しいとき真" },
  { operator: "!=", description: "A != B: AとBが等しくないとき真" },
  { operator: "&&", description: "A && B: AとBの両方が真のとき真" },
  { operator: "||", description: "A || B: AとBのどちらかが真のとき真" }
] as const;

const selectedElementName = (elements: CadElement[], elementId: ElementId) =>
  elements.find((element) => element.id === elementId)?.name ?? elementId;

const MAX_VISIBLE_VARIABLE_OPTIONS = 20;

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
  const [variableSearch, setVariableSearch] = useState("");
  const [numericReferenceProperty, setLocalNumericReferenceProperty] =
    useState<typeof numericReferencePickProperties[number]>("length");
  const activeMeasurementInsertTarget = useCadUiStore((state) => state.activeMeasurementInsertTarget);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const isMeasurementTarget =
    activeMeasurementInsertTarget?.elementId === element.id &&
    activeMeasurementInsertTarget.parameterKey === parameterKey;
  const isNumericReferenceInsertPickTarget =
    activeNumericReferencePickTarget?.elementId === element.id &&
    activeNumericReferencePickTarget.parameterKey === parameterKey &&
    activeNumericReferencePickTarget.mode === "insert";
  const mode = isMeasurementTarget ? activeMeasurementInsertTarget.mode : "distance";
  const variableOptions = useMemo(
    () => scopedVariableOptions({ element, elements, parameterKey }),
    [element, elements, parameterKey]
  );
  const visibleVariableOptions = useMemo(() => {
    const normalizedSearch = variableSearch.trim().toLocaleLowerCase();
    const filtered =
      normalizedSearch.length === 0
        ? variableOptions
        : variableOptions.filter((option) =>
            `${option.label} ${option.expression} ${option.detail}`
              .toLocaleLowerCase()
              .includes(normalizedSearch)
          );
    return filtered.slice(0, MAX_VISIBLE_VARIABLE_OPTIONS);
  }, [variableOptions, variableSearch]);
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

  const insertSnippet = (snippet: string, appendMode: NumericExpressionAppendMode = "sum") => {
    const target = getInputTarget();
    dispatchCommand("insertNumericExpressionSnippet", {
      elementId: element.id,
      parameterKey,
      numericExpressionSnippet: snippet,
      numericExpressionAppendMode: appendMode,
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
  const selectedNumericReferenceProperty =
    isNumericReferenceInsertPickTarget ? activeNumericReferencePickTarget.property : numericReferenceProperty;
  const setNumericReferenceProperty = (numericReferenceProperty: typeof numericReferencePickProperties[number]) => {
    setLocalNumericReferenceProperty(numericReferenceProperty);
    if (isNumericReferenceInsertPickTarget) {
      dispatchCommand("setNumericReferencePickProperty", { numericReferenceProperty });
    }
  };
  const startNumericReferenceInsertPick = () => {
    dispatchCommand("startNumericReferenceInsertPick", {
      ...inputTargetContext(),
      numericReferenceProperty: selectedNumericReferenceProperty
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
  const showConditionalOperators = element.type === "conditionalGroup" && parameterKey === "condition";

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

      {showConditionalOperators ? (
        <div className="expression-insert-section">
          <div className="expression-insert-title">
            <span>条件演算子</span>
          </div>
          <div className="expression-operator-grid" role="group" aria-label="挿入する条件演算子">
            {conditionalOperators.map(({ operator, description }) => (
              <button
                key={operator}
                type="button"
                title={description}
                aria-label={`${operator} ${description}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSnippet(` ${operator} `, "raw")}
              >
                <code>{operator}</code>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="expression-insert-section">
        <div className="expression-insert-title">
          <span>線・曲線プロパティ</span>
        </div>
        <div className="numeric-reference-property-grid" role="group" aria-label="挿入する線・曲線プロパティ">
          {numericReferencePickProperties.map((property) => (
            <button
              key={property}
              type="button"
              className={selectedNumericReferenceProperty === property ? "active-toggle" : ""}
              onClick={() => setNumericReferenceProperty(property)}
            >
              {lineMeasurementLabel(property)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="expression-insert-button"
          onClick={startNumericReferenceInsertPick}
        >
          {isNumericReferenceInsertPickTarget ? "線・曲線選択中" : "線・曲線を選択"}
        </button>
      </div>

      <div className="expression-insert-section">
        <div className="expression-insert-title">
          <span>変数参照</span>
          {variableOptions.length > MAX_VISIBLE_VARIABLE_OPTIONS ? (
            <small>{visibleVariableOptions.length} / {variableOptions.length} 件</small>
          ) : null}
        </div>
        {variableOptions.length > MAX_VISIBLE_VARIABLE_OPTIONS ? (
          <input
            className="expression-variable-search"
            value={variableSearch}
            placeholder="変数を検索"
            aria-label="変数参照を検索"
            onChange={(event) => setVariableSearch(event.target.value)}
          />
        ) : null}
        <div className="expression-token-grid">
          {variableOptions.length === 0 ? (
            <p className="empty-state">参照できる変数はありません。</p>
          ) : visibleVariableOptions.length === 0 ? (
            <p className="empty-state">一致する変数はありません。</p>
          ) : (
            visibleVariableOptions.map((option) => (
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
