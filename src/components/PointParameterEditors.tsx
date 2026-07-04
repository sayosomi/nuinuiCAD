import { dispatchCommand } from "../commands/commands";
import { lineEndpointReferenceLabel, pointAnchorLabel } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadUiStore } from "../state/cadUiStore";
import type { LineEndpointReference, PointAnchor } from "../types/geometry";
import { NumericParameterEditor } from "./NumericParameterEditor";
import { ParameterName } from "./ParameterName";
import {
  isEditorBackgroundClick,
  useParameterEditor,
  type CommonEditorProps
} from "./parameterEditorShared";

export const PointAnchorParameterEditor = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  anchor,
  allowCoordinate = true
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  anchor: PointAnchor;
  allowCoordinate?: boolean;
}) => {
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const { parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisPoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;
  const numericProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  const canUseCoordinate = definition?.allowCoordinate ?? allowCoordinate;
  const commandContext = { elementId: element.id, parameterKey };
  const togglePointPick = () => {
    selectParameter(parameterKey);
    if (isPickingThisPoint) {
      dispatchCommand("cancelPointPick");
      return;
    }
    dispatchCommand("startPointPick", commandContext);
  };

  return (
    <div className={`point-anchor-editor ${parameterFieldClass(parameterKey)} ${
      isPickingThisPoint ? "is-picking-point" : ""
    }`} onClick={(event) => {
      if (anchor.mode !== "coordinate" && isEditorBackgroundClick(event)) {
        togglePointPick();
      }
    }}>
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <div className="point-anchor-actions">
          <div className="point-anchor-mode" role="group" aria-label={`${label}の指定方法`}>
            <button
              type="button"
              className={anchor.mode === "reference" ? "active-toggle" : ""}
              onClick={() => {
                selectParameter(parameterKey);
                dispatchCommand("setSelectedPointAnchorReferenceMode", commandContext);
              }}
            >
              既存点
            </button>
            {canUseCoordinate ? (
              <button
                type="button"
                className={anchor.mode === "coordinate" ? "active-toggle" : ""}
                onClick={() => {
                  selectParameter(parameterKey);
                  dispatchCommand("setSelectedPointAnchorCoordinateMode", commandContext);
                }}
              >
                座標
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {isPickingThisPoint ? (
        <p className="point-pick-hint">canvas または構成リストから点を選択します。</p>
      ) : isParameterEditMode ? (
        <p className="point-pick-hint">
          Enterで点選択{canUseCoordinate ? " / Spaceで座標切替" : ""}
        </p>
      ) : null}
      {anchor.mode !== "coordinate" ? (
        <button
          type="button"
          className={`point-anchor-reference ${isPickingThisPoint ? "active" : ""}`}
          onClick={togglePointPick}
        >
          <span className="reference-label">参照点</span>
          <span className="reference-value">{pointAnchorLabel(anchor, elements)}</span>
        </button>
      ) : (
        <div className="point-anchor-coordinate-grid">
          <NumericParameterEditor
            {...numericProps}
            parameterKey={`${parameterKey}:x`}
            label={`${label} x`}
            value={anchor.x}
            ariaLabel={`${label} x`}
            compact
          />
          <NumericParameterEditor
            {...numericProps}
            parameterKey={`${parameterKey}:y`}
            label={`${label} y`}
            value={anchor.y}
            ariaLabel={`${label} y`}
            compact
          />
        </div>
      )}
    </div>
  );
};

export const LineEndpointReferenceEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  endpoint
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  endpoint: LineEndpointReference;
}) => {
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisEndpoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;
  const commandContext = { elementId: element.id, parameterKey };
  const toggleEndpointPick = () => {
    selectParameter(parameterKey);
    if (isPickingThisEndpoint) {
      dispatchCommand("cancelPointPick");
      return;
    }
    dispatchCommand("startPointPick", commandContext);
  };

  return (
    <div className={`point-anchor-editor ${parameterFieldClass(parameterKey)} ${
      isPickingThisEndpoint ? "is-picking-point" : ""
    }`} onClick={(event) => {
      if (isEditorBackgroundClick(event)) {
        toggleEndpointPick();
      }
    }}>
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
      </div>
      {isPickingThisEndpoint ? (
        <p className="point-pick-hint">canvas または構成リストから線の始点/終点を選択します。</p>
      ) : null}
      <button
        {...controlProps(parameterKey)}
        type="button"
        className={`point-anchor-reference ${isPickingThisEndpoint ? "active" : ""}`}
        onClick={toggleEndpointPick}
      >
        <span className="reference-label">参照端点</span>
        <span className="reference-value">{lineEndpointReferenceLabel(endpoint, elements)}</span>
      </button>
    </div>
  );
};
