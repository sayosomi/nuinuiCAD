import { dispatchCommand } from "../commands/commands";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId } from "../types/geometry";
import { ParameterName } from "./ParameterName";
import {
  isEditorBackgroundClick,
  useParameterEditor,
  type CommonEditorProps
} from "./parameterEditorShared";

export const ChoiceParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  value,
  options,
  optionLabels,
  ariaLabel
}: Omit<CommonEditorProps, "elements"> & {
  parameterKey: ParameterKey;
  label: string;
  value: string;
  options: readonly string[];
  optionLabels: Record<string, string>;
  ariaLabel: string;
}) => {
  const { parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  return (
    <div
      className={`choice-parameter-editor ${parameterFieldClass(parameterKey)}`}
      onClick={() => selectParameter(parameterKey)}
    >
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
      <div className="point-anchor-mode" role="group" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "active-toggle" : ""}
            onClick={() => {
              updateParameterValue(parameterKey, option);
              selectParameter(parameterKey);
            }}
          >
            {optionLabels[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
};

export const BooleanParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  checked
}: Omit<CommonEditorProps, "elements"> & {
  parameterKey: ParameterKey;
  label: string;
  checked: boolean;
}) => {
  const { controlProps, parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  return (
    <label
      className={`checkbox-line ${parameterFieldClass(parameterKey)}`}
      onClick={() => selectParameter(parameterKey)}
    >
      <input
        {...controlProps(parameterKey)}
        type="checkbox"
        checked={checked}
        onChange={(event) => updateParameterValue(parameterKey, event.target.checked)}
      />
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
    </label>
  );
};

export const LineReferenceListEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  lineIds,
  emptyLabel
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  lineIds: ElementId[];
  emptyLabel: string;
}) => {
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const { parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisLine =
    activeLinePickTarget?.elementId === element.id &&
    activeLinePickTarget.parameterKey === parameterKey;
  const updateLineIds = (nextLineIds: ElementId[]) => {
    updateParameterValue(parameterKey, nextLineIds);
    selectParameter(parameterKey);
  };
  const moveLineId = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= lineIds.length) return;
    const next = [...lineIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateLineIds(next);
  };

  return (
    <div
      className={`line-anchor-editor ${parameterFieldClass(parameterKey)} ${
        isPickingThisLine ? "is-picking-line" : ""
      }`}
      onClick={() => selectParameter(parameterKey)}
    >
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`line-pick-button ${isPickingThisLine ? "active" : ""}`}
          onClick={() => {
            selectParameter(parameterKey);
            if (isPickingThisLine) {
              dispatchCommand("cancelLinePick");
              return;
            }
            dispatchCommand("startLinePick");
          }}
        >
          {isPickingThisLine ? "線選択中" : "線を選択"}
        </button>
      </div>
      {isPickingThisLine ? (
        <p className="line-pick-hint">canvas または構成リストから線を選択します。</p>
      ) : null}
      {lineIds.length === 0 ? (
        <p className="empty-state">{emptyLabel}</p>
      ) : (
        lineIds.map((lineId, index) => {
          const line = elements.find((item) => item.id === lineId);
          return (
            <div className="curve-point-group" key={`${lineId}-${index}`}>
              <div className="curve-point-header">
                <span>{line?.name ?? lineId}</span>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => moveLineId(index, -1)}
                    disabled={index === 0}
                  >
                    上
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLineId(index, 1)}
                    disabled={index === lineIds.length - 1}
                  >
                    下
                  </button>
                  <button
                    type="button"
                    onClick={() => updateLineIds(lineIds.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export const LineReferenceEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  lineId
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  lineId: ElementId;
}) => {
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisLine =
    activeLinePickTarget?.elementId === element.id &&
    activeLinePickTarget.parameterKey === parameterKey;
  const line = elements.find((item) => item.id === lineId);
  const commandContext = { elementId: element.id, parameterKey };
  const toggleLinePick = () => {
    selectParameter(parameterKey);
    if (isPickingThisLine) {
      dispatchCommand("cancelLinePick");
      return;
    }
    dispatchCommand("startLinePick", commandContext);
  };

  return (
    <div
      className={`line-anchor-editor ${parameterFieldClass(parameterKey)} ${
        isPickingThisLine ? "is-picking-line" : ""
      }`}
      onClick={(event) => {
        selectParameter(parameterKey);
        if (isEditorBackgroundClick(event)) {
          toggleLinePick();
        }
      }}
    >
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
      </div>
      {isPickingThisLine ? (
        <p className="line-pick-hint">canvas または構成リストから線を選択します。</p>
      ) : null}
      <button
        {...controlProps(parameterKey)}
        type="button"
        className={`${parameterFieldClass(parameterKey)} point-anchor-reference ${isPickingThisLine ? "active" : ""}`}
        onClick={toggleLinePick}
      >
        <span className="reference-label">参照線</span>
        <span className="reference-value">{line?.name ?? lineId}</span>
      </button>
    </div>
  );
};
