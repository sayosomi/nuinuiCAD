import { dispatchCommand } from "../commands/commands";
import { pointAnchorForElement, referenceAnchor } from "../model/pointAnchors";
import { supportsNumericVariables } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import {
  BooleanParameterEditor,
  ChoiceParameterEditor,
  LineEndpointReferenceEditor,
  LineReferenceEditor,
  LineReferenceListEditor,
  NumericParameterEditor,
  ParameterName,
  PointAnchorParameterEditor
} from "./ParameterEditors";

export const ElementEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: {
  element: CadElement;
  elements: CadElement[];
  isParameterEditMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
}) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const renameElement = useCadDocumentStore((state) => state.renameElement);
  const selectedParameterKey = useCadDocumentStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadDocumentStore((state) => state.setSelectedParameterKey);

  const commitName = (name: string) => renameElement(element.id, name);
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);
  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
    compact?: boolean;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;
  const pointAnchorEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
    allowCoordinate?: boolean;
  }) => <PointAnchorParameterEditor {...commonEditorProps} {...props} />;
  const lineEndpointEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    endpoint: LineEndpointReference;
  }) => <LineEndpointReferenceEditor {...commonEditorProps} {...props} />;
  const lineReferenceEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    lineId: ElementId;
  }) => <LineReferenceEditor {...commonEditorProps} {...props} />;

  return (
    <section className="panel-section">
      <div className="section-header">
        <div>
          <h2>要素設定</h2>
          <p className="section-subtitle">
            {element.name} ・ {elementTypeLabels[element.type]}
          </p>
        </div>
        <span className={`mode-pill ${isParameterEditMode ? "active" : ""}`}>
          {isParameterEditMode ? "要素設定中" : "eで要素設定"}
        </span>
      </div>
      <div className="editor-grid">
        <label className={parameterFieldClass("name")} onClick={() => selectParameter("name")}>
          <ParameterName element={element} parameterKey="name" label="名前" />
          <input
            key={`${element.id}-${element.name}`}
            ref={(node) => registerParameterControl("name", node)}
            defaultValue={element.name}
            onFocus={() => setSelectedParameterKey("name")}
            onBlur={(event) => commitName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitName(event.currentTarget.value);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.currentTarget.value = element.name;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <BooleanParameterEditor
          {...elementEditorProps}
          parameterKey="visible"
          label="表示する"
          checked={element.visible}
        />
        <BooleanParameterEditor
          {...elementEditorProps}
          parameterKey="enabled"
          label="評価する"
          checked={element.enabled}
        />

        {element.type === "group" && (
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="expanded"
            label="展開する"
            checked={element.expanded}
          />
        )}

        {supportsNumericVariables(element) && (
          <div className="curve-point-editor">
            <div className="curve-point-header">
              <span>共通変数</span>
              <button
                type="button"
                onClick={() => dispatchCommand("addNumericVariable")}
              >
                追加
              </button>
            </div>
            {(element.numericVariables ?? []).length === 0 ? (
              <p className="empty-state">共通変数はありません。</p>
            ) : (
              (element.numericVariables ?? []).map((variable, index) => (
                <div className="curve-point-group" key={variable.id}>
                  <div className="curve-point-header">
                    <span>変数{index + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        dispatchCommand("deleteNumericVariable", {
                          variableId: variable.id
                        })
                      }
                    >
                      削除
                    </button>
                  </div>
                  <label className="parameter-field">
                    <span className="parameter-name">名前 (@名前で参照)</span>
                    <input
                      type="text"
                      aria-label="共通変数名"
                      value={variable.name}
                      onChange={(event) =>
                        updateElement(element.id, {
                          numericVariables: (element.numericVariables ?? []).map((item) =>
                            item.id === variable.id ? { ...item, name: event.target.value } : item
                          )
                        } as Partial<CadElement>)
                      }
                    />
                  </label>
                  {numericInput({
                    parameterKey: `variable:${variable.id}:value`,
                    label: variable.name,
                    value: variable.value,
                    ariaLabel: `共通変数 ${variable.name}`
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {element.type === "freePoint" && (
          <>
            {numericInput({
              parameterKey: "x",
              label: "x",
              value: element.x,
              ariaLabel: "x 値"
            })}
            {numericInput({
              parameterKey: "y",
              label: "y",
              value: element.y,
              ariaLabel: "y 値"
            })}
          </>
        )}

        {element.type === "offsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPoint",
              label: "基準点",
              anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
              allowCoordinate: false
            })}
            {numericInput({
              parameterKey: "dx",
              label: "dx",
              value: element.dx,
              ariaLabel: "dx 値"
            })}
            {numericInput({
              parameterKey: "dy",
              label: "dy",
              value: element.dy,
              ariaLabel: "dy 値"
            })}
          </>
        )}

        {element.type === "polarOffsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPoint",
              label: "基準点",
              anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
              allowCoordinate: false
            })}
            {numericInput({
              parameterKey: "angleDeg",
              label: "角度",
              value: element.angleDeg,
              ariaLabel: "角度"
            })}
            {numericInput({
              parameterKey: "distance",
              label: "距離",
              value: element.distance,
              ariaLabel: "距離"
            })}
          </>
        )}

        {element.type === "divisionPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint,
              allowCoordinate: false
            })}
            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint,
              allowCoordinate: false
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="placementMode"
              label="方式"
              value={element.placementMode}
              options={["distance", "ratio"]}
              optionLabels={{ distance: "距離", ratio: "割合" }}
              ariaLabel="分点方式"
            />
            {element.placementMode === "distance"
              ? numericInput({
                  parameterKey: "distance",
                  label: "距離",
                  value: element.distance,
                  ariaLabel: "距離"
                })
              : numericInput({
                  parameterKey: "ratio",
                  label: "割合",
                  value: element.ratio,
                  ariaLabel: "割合"
                })}
          </>
        )}

        {element.type === "lineDivisionPoint" && (
          <>
            {lineEndpointEditor({
              parameterKey: "endpoint",
              label: "端点",
              endpoint: element.endpoint
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="placementMode"
              label="方式"
              value={element.placementMode}
              options={["distance", "ratio"]}
              optionLabels={{ distance: "距離", ratio: "割合" }}
              ariaLabel="線上分点方式"
            />
            {element.placementMode === "distance"
              ? numericInput({
                  parameterKey: "distance",
                  label: "距離",
                  value: element.distance,
                  ariaLabel: "距離"
                })
              : numericInput({
                  parameterKey: "ratio",
                  label: "割合",
                  value: element.ratio,
                  ariaLabel: "割合"
                })}
          </>
        )}

        {element.type === "intersectionPoint" && (
          <>
            {lineReferenceEditor({
              parameterKey: "line1Id",
              label: "線1",
              lineId: element.line1Id
            })}
            {lineReferenceEditor({
              parameterKey: "line2Id",
              label: "線2",
              lineId: element.line2Id
            })}
            {numericInput({
              parameterKey: "intersectionIndex",
              label: "番号",
              value: element.intersectionIndex,
              ariaLabel: "交点番号"
            })}
            <BooleanParameterEditor
              {...elementEditorProps}
              parameterKey="useExtensions"
              label="延長線上の交点を使う"
              checked={element.useExtensions}
            />
          </>
        )}

        {element.type === "lineTangentOffsetPoint" && (
          <>
            {lineReferenceEditor({
              parameterKey: "baseLineId",
              label: "基準線",
              lineId: element.baseLineId
            })}
            {pointAnchorEditor({
              parameterKey: "basePoint",
              label: "基準点",
              anchor: element.basePoint,
              allowCoordinate: false
            })}
            {numericInput({
              parameterKey: "tangentAngleDeg",
              label: "接線角度",
              value: element.tangentAngleDeg,
              ariaLabel: "接線角度"
            })}
            {numericInput({
              parameterKey: "distance",
              label: "距離",
              value: element.distance,
              ariaLabel: "距離"
            })}
          </>
        )}

        {element.type === "line" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint
            })}
            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint
            })}
          </>
        )}

        {element.type === "arcLine" && (
          <>
            {pointAnchorEditor({
              parameterKey: "centerPoint",
              label: "中心点",
              anchor: element.centerPoint
            })}
            {numericInput({
              parameterKey: "radius",
              label: "半径",
              value: element.radius,
              ariaLabel: "半径"
            })}
            {numericInput({
              parameterKey: "startAngleDeg",
              label: "始角度",
              value: element.startAngleDeg,
              ariaLabel: "始角度"
            })}
            {numericInput({
              parameterKey: "endAngleDeg",
              label: "終角度",
              value: element.endAngleDeg,
              ariaLabel: "終角度"
            })}
          </>
        )}

        {element.type === "threePointArcLine" && (
          <>
            {pointAnchorEditor({
              parameterKey: "point1",
              label: "点1",
              anchor: element.point1
            })}
            {pointAnchorEditor({
              parameterKey: "point2",
              label: "点2",
              anchor: element.point2
            })}
            {pointAnchorEditor({
              parameterKey: "point3",
              label: "点3",
              anchor: element.point3
            })}
            {numericInput({
              parameterKey: "startAngleDeg",
              label: "始角度",
              value: element.startAngleDeg,
              ariaLabel: "始角度"
            })}
            {numericInput({
              parameterKey: "endAngleDeg",
              label: "終角度",
              value: element.endAngleDeg,
              ariaLabel: "終角度"
            })}
          </>
        )}

        {element.type === "cornerRadiusArcLine" && (
          <>
            {lineEndpointEditor({
              parameterKey: "endpoint1",
              label: "端点1",
              endpoint: element.endpoint1
            })}
            {lineEndpointEditor({
              parameterKey: "endpoint2",
              label: "端点2",
              endpoint: element.endpoint2
            })}
            {numericInput({
              parameterKey: "radius",
              label: "半径",
              value: element.radius,
              ariaLabel: "半径"
            })}
            {numericInput({
              parameterKey: "intersectionIndex",
              label: "番号",
              value: element.intersectionIndex,
              ariaLabel: "交点番号"
            })}
          </>
        )}

        {element.type === "bezierCurve" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint
            })}
            {numericInput({
              parameterKey: "startHandleAngleDeg",
              label: "始点角度",
              value: element.startHandleAngleDeg,
              ariaLabel: "始点角度"
            })}
            {numericInput({
              parameterKey: "startHandleLength",
              label: "始点ハンドル長",
              value: element.startHandleLength,
              ariaLabel: "始点ハンドル長"
            })}

            <div className="curve-point-editor">
              <div className="curve-point-header">
                <span>中間点</span>
                <button
                  type="button"
                  onClick={() => dispatchCommand("addBezierIntermediatePoint")}
                >
                  追加
                </button>
              </div>
              {element.intermediatePoints.length === 0 ? (
                <p className="empty-state">中間点はありません。</p>
              ) : (
                element.intermediatePoints.map((point, index) => (
                  <div className="curve-point-group" key={point.id}>
                    <div className="curve-point-header">
                      <span>中間点{index + 1}</span>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand("deleteBezierIntermediatePoint", {
                            intermediatePointId: point.id
                          })
                        }
                      >
                        削除
                      </button>
                    </div>
                    {pointAnchorEditor({
                      parameterKey: `intermediate:${point.id}:point`,
                      label: "点",
                      anchor: point.point
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:handleAngleDeg`,
                      label: "角度",
                      value: point.handleAngleDeg,
                      ariaLabel: `中間点${index + 1}角度`
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:incomingHandleLength`,
                      label: "前長さ",
                      value: point.incomingHandleLength,
                      ariaLabel: `中間点${index + 1}前長さ`
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:outgoingHandleLength`,
                      label: "後長さ",
                      value: point.outgoingHandleLength,
                      ariaLabel: `中間点${index + 1}後長さ`
                    })}
                  </div>
                ))
              )}
            </div>

            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint
            })}
            {numericInput({
              parameterKey: "endHandleAngleDeg",
              label: "終点角度",
              value: element.endHandleAngleDeg,
              ariaLabel: "終点角度"
            })}
            {numericInput({
              parameterKey: "endHandleLength",
              label: "終点ハンドル長",
              value: element.endHandleLength,
              ariaLabel: "終点ハンドル長"
            })}
          </>
        )}

        {element.type === "offsetLine" && (
          <>
            <LineReferenceListEditor
              {...commonEditorProps}
              parameterKey="baseLineIds"
              label="基準線"
              lineIds={element.baseLineIds}
              emptyLabel="基準線はありません。"
            />
            {numericInput({
              parameterKey: "offset",
              label: "オフセット量",
              value: element.offset,
              ariaLabel: "オフセット量"
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="side"
              label="位置"
              value={element.side}
              options={["right", "left"]}
              optionLabels={{ right: "右", left: "左" }}
              ariaLabel="オフセット位置"
            />
            <BooleanParameterEditor
              {...elementEditorProps}
              parameterKey="closed"
              label="閉じる"
              checked={element.closed}
            />
          </>
        )}
      </div>
    </section>
  );
};
