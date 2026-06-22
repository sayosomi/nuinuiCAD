import { dispatchCommand } from "../commands/commands";
import { lineEndpointReferenceLabel, pointAnchorLabel } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type { LineEndpointReference, PointAnchor } from "../types/geometry";
import { NumericParameterEditor } from "./NumericParameterEditor";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";

export const PointAnchorParameterEditor = ({
  element,
  elements,
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
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const { parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisPoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;
  const numericProps = { element, elements, isParameterEditMode, registerParameterControl };
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  const canUseCoordinate = definition?.allowCoordinate ?? allowCoordinate;
  const commandContext = { elementId: element.id, parameterKey };

  return (
    <div className={`point-anchor-editor ${isPickingThisPoint ? "is-picking-point" : ""}`}>
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
          <button
            type="button"
            className={`point-pick-button ${isPickingThisPoint ? "active" : ""}`}
            onClick={() => {
              selectParameter(parameterKey);
              if (isPickingThisPoint) {
                dispatchCommand("cancelPointPick");
                return;
              }
              dispatchCommand("startPointPick");
            }}
          >
            {isPickingThisPoint ? "点選択中" : "点を選択"}
          </button>
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
          className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
          onClick={() => selectParameter(parameterKey)}
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
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisEndpoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;

  return (
    <div className={`point-anchor-editor ${isPickingThisEndpoint ? "is-picking-point" : ""}`}>
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`point-pick-button ${isPickingThisEndpoint ? "active" : ""}`}
          onClick={() => {
            selectParameter(parameterKey);
            if (isPickingThisEndpoint) {
              dispatchCommand("cancelPointPick");
              return;
            }
            dispatchCommand("startPointPick");
          }}
        >
          {isPickingThisEndpoint ? "端点選択中" : "端点を選択"}
        </button>
      </div>
      {isPickingThisEndpoint ? (
        <p className="point-pick-hint">canvas または構成リストから線の始点/終点を選択します。</p>
      ) : null}
      <button
        {...controlProps(parameterKey)}
        type="button"
        className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
        onClick={() => selectParameter(parameterKey)}
      >
        <span className="reference-label">参照端点</span>
        <span className="reference-value">{lineEndpointReferenceLabel(endpoint, elements)}</span>
      </button>
    </div>
  );
};
