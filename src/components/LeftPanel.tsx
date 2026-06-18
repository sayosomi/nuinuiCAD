import type { KeyboardEvent, RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { shortcutHelpItems } from "../keyboard/shortcuts";
import { getDependencyJumpTargets, getDependencySummary } from "../model/dependencies";
import { formatReferenceOptionLabel } from "../model/elementNames";
import {
  defaultNumericParameterStep,
  getNumericParameterStep,
  getParameterDefinitions
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type {
  CadElement,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
};

type RightPanelProps = {
  evaluation: EvaluationResult;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

const isComputedPoint = (geometry: ComputedGeometry | undefined): geometry is ComputedPoint =>
  geometry?.kind === "point";

const isComputedLine = (geometry: ComputedGeometry | undefined): geometry is ComputedLine =>
  geometry?.kind === "line";

const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");

const formatMillimeters = (value: number) => `${formatNumber(value)} mm`;

const formatCoordinate = (point: ComputedPoint) => `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

const formatAngle = (radians: number) => `${formatNumber(normalizeDegrees((radians * 180) / Math.PI))}°`;

const pointCoordinateRows = (point: ComputedPoint) => [
  { label: "座標", value: formatCoordinate(point) }
];

const lineInfoRows = (line: ComputedLine) => {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const length = Math.hypot(dx, dy);
  const hasLength = length > 0;

  return [
    { label: "始点", value: formatCoordinate(line.start) },
    { label: "終点", value: formatCoordinate(line.end) },
    { label: "始角度", value: hasLength ? formatAngle(Math.atan2(dy, dx)) : "未定義" },
    { label: "終角度", value: hasLength ? formatAngle(Math.atan2(-dy, -dx)) : "未定義" },
    { label: "長さ", value: formatMillimeters(length) }
  ];
};

const pointOptions = (elements: CadElement[]) =>
  elements
    .filter((element) => element.type === "freePoint" || element.type === "offsetPoint")
    .map((element) => (
      <option key={element.id} value={element.id}>
        {formatReferenceOptionLabel(element)}
      </option>
    ));

const ParameterName = ({
  element,
  parameterKey,
  label
}: {
  element: CadElement;
  parameterKey: ParameterKey;
  label: string;
}) => {
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  return (
    <span className="parameter-name">
      <kbd>{definition?.directKey}</kbd>
      {label}
    </span>
  );
};

const ElementEditor = ({
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
  const updateElement = useCadStore((state) => state.updateElement);
  const renameElement = useCadStore((state) => state.renameElement);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadStore((state) => state.setSelectedParameterKey);

  const commitName = (name: string) => renameElement(element.id, name);
  const updateVisible = (visible: boolean) => updateElement(element.id, { visible });
  const updateEnabled = (enabled: boolean) => updateElement(element.id, { enabled });
  const updateField = (field: ParameterKey, value: string) => {
    updateElement(element.id, { [field]: Number(value) } as Partial<CadElement>);
  };
  const updateRef = (field: ParameterKey, value: ElementId) => {
    updateElement(element.id, { [field]: value } as Partial<CadElement>);
  };
  const updateStep = (field: ParameterKey, value: string) => {
    const nextStep = Number(value);
    updateElement(element.id, {
      numericParameterSteps: {
        ...element.numericParameterSteps,
        [field]: Number.isFinite(nextStep) && nextStep > 0 ? nextStep : defaultNumericParameterStep
      }
    } as Partial<CadElement>);
  };
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
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);

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
          {isParameterEditMode ? "パラメーター編集中" : "Enterで編集"}
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
        <label
          className={`checkbox-line ${parameterFieldClass("visible")}`}
          onClick={() => selectParameter("visible")}
        >
          <input
            {...controlProps("visible")}
            type="checkbox"
            checked={element.visible}
            onChange={(event) => updateVisible(event.target.checked)}
          />
          <ParameterName element={element} parameterKey="visible" label="表示する" />
        </label>
        <label
          className={`checkbox-line ${parameterFieldClass("enabled")}`}
          onClick={() => selectParameter("enabled")}
        >
          <input
            {...controlProps("enabled")}
            type="checkbox"
            checked={element.enabled}
            onChange={(event) => updateEnabled(event.target.checked)}
          />
          <ParameterName element={element} parameterKey="enabled" label="評価する" />
        </label>

        {element.type === "freePoint" && (
          <>
            <label className={parameterFieldClass("x")} onClick={() => selectParameter("x")}>
              <ParameterName element={element} parameterKey="x" label="x" />
              <input
                {...controlProps("x")}
                type="number"
                step="1"
                value={element.x}
                onChange={(event) => updateField("x", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={getNumericParameterStep(element, "x")}
                  onFocus={() => selectParameter("x")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("x", event.target.value)}
                />
              </span>
            </label>
            <label className={parameterFieldClass("y")} onClick={() => selectParameter("y")}>
              <ParameterName element={element} parameterKey="y" label="y" />
              <input
                {...controlProps("y")}
                type="number"
                step="1"
                value={element.y}
                onChange={(event) => updateField("y", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={getNumericParameterStep(element, "y")}
                  onFocus={() => selectParameter("y")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("y", event.target.value)}
                />
              </span>
            </label>
          </>
        )}

        {element.type === "offsetPoint" && (
          <>
            <label
              className={parameterFieldClass("fromPointId")}
              onClick={() => selectParameter("fromPointId")}
            >
              <ParameterName element={element} parameterKey="fromPointId" label="基準点" />
              <select
                {...controlProps("fromPointId")}
                value={element.fromPointId}
                onChange={(event) => updateRef("fromPointId", event.target.value)}
              >
                {pointOptions(elements)}
              </select>
            </label>
            <label className={parameterFieldClass("dx")} onClick={() => selectParameter("dx")}>
              <ParameterName element={element} parameterKey="dx" label="dx" />
              <input
                {...controlProps("dx")}
                type="number"
                step="1"
                value={element.dx}
                onChange={(event) => updateField("dx", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={getNumericParameterStep(element, "dx")}
                  onFocus={() => selectParameter("dx")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("dx", event.target.value)}
                />
              </span>
            </label>
            <label className={parameterFieldClass("dy")} onClick={() => selectParameter("dy")}>
              <ParameterName element={element} parameterKey="dy" label="dy" />
              <input
                {...controlProps("dy")}
                type="number"
                step="1"
                value={element.dy}
                onChange={(event) => updateField("dy", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={getNumericParameterStep(element, "dy")}
                  onFocus={() => selectParameter("dy")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("dy", event.target.value)}
                />
              </span>
            </label>
          </>
        )}

        {element.type === "line" && (
          <>
            <label
              className={parameterFieldClass("startPointId")}
              onClick={() => selectParameter("startPointId")}
            >
              <ParameterName element={element} parameterKey="startPointId" label="始点" />
              <select
                {...controlProps("startPointId")}
                value={element.startPointId}
                onChange={(event) => updateRef("startPointId", event.target.value)}
              >
                {pointOptions(elements)}
              </select>
            </label>
            <label
              className={parameterFieldClass("endPointId")}
              onClick={() => selectParameter("endPointId")}
            >
              <ParameterName element={element} parameterKey="endPointId" label="終点" />
              <select
                {...controlProps("endPointId")}
                value={element.endPointId}
                onChange={(event) => updateRef("endPointId", event.target.value)}
              >
                {pointOptions(elements)}
              </select>
            </label>
          </>
        )}
      </div>
    </section>
  );
};

const ElementInfoPanel = ({
  element,
  elements,
  evaluation,
  isDependencyJumpMode,
  selectedDependencyJumpIndex,
  setSelectedElementId
}: {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  isDependencyJumpMode: boolean;
  selectedDependencyJumpIndex: number;
  setSelectedElementId: (id: ElementId | null) => void;
}) => {
  const showElementInfoPanel = useCadStore((state) => state.showElementInfoPanel);
  const geometry = element ? evaluation.computedGeometry.get(element.id) : undefined;
  const dependencySummary = element ? getDependencySummary(element, elements) : null;
  const jumpTargets = getDependencyJumpTargets(element, elements);
  const jumpTargetIndexes = new Map(jumpTargets.map((target, index) => [target.id, index]));
  const infoRows =
    isComputedPoint(geometry)
      ? pointCoordinateRows(geometry)
      : isComputedLine(geometry)
        ? lineInfoRows(geometry)
        : [];
  const selectDependency = (id: ElementId) => setSelectedElementId(id);
  const dependencyButtonClass = (id: ElementId) => {
    const jumpIndex = jumpTargetIndexes.get(id);
    return `dependency-row ${
      isDependencyJumpMode && jumpIndex === selectedDependencyJumpIndex ? "selected-dependency" : ""
    }`;
  };

  return (
    <section className="panel-section">
      <div className="section-header">
        <div>
          <h2>要素詳細</h2>
          {element ? (
            <p className="section-subtitle">
              {isDependencyJumpMode ? "親子要素ジャンプ中" : "iで折り畳み / jで親子ジャンプ"}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => dispatchCommand("toggleElementInfoPanel")}>
          i
        </button>
      </div>

      {!showElementInfoPanel ? (
        <p className="empty-state">折り畳み中です。</p>
      ) : !element ? (
        <p className="empty-state">要素を選択してください。</p>
      ) : (
        <>
          {infoRows.length > 0 ? (
            <dl className="element-info-grid">
              {infoRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="empty-state">未評価です。</p>
          )}

          <div className="dependency-group">
            <h3 className="shortcut-group-title">親要素</h3>
            {dependencySummary && dependencySummary.parents.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.parents.map((parent, index) =>
                  parent.element ? (
                    <button
                      key={`${parent.id}-${index}`}
                      type="button"
                      className={dependencyButtonClass(parent.element.id)}
                      onClick={() => selectDependency(parent.element!.id)}
                    >
                      <span>{parent.element.name}</span>
                      <small>
                        {elementTypeLabels[parent.element.type]} / 祖父母 {parent.ancestorCount} 件
                      </small>
                    </button>
                  ) : (
                    <div key={`${parent.id}-${index}`} className="dependency-row unresolved">
                      <span>{parent.id}</span>
                      <small>未解決 / 祖父母 {parent.ancestorCount} 件</small>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="empty-state">親要素はありません。</p>
            )}
          </div>

          <div className="dependency-group">
            <h3 className="shortcut-group-title">子要素</h3>
            {dependencySummary && dependencySummary.children.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.children.map((child) => (
                  <button
                    key={child.element.id}
                    type="button"
                    className={dependencyButtonClass(child.element.id)}
                    onClick={() => selectDependency(child.element.id)}
                  >
                    <span>{child.element.name}</span>
                    <small>
                      {elementTypeLabels[child.element.type]} / 孫 {child.descendantCount} 件
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">子要素はありません。</p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export const LeftPanel = ({
  evaluation,
  elementListFocusRef
}: LeftPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
        <p>パラメトリック洋裁型紙CAD</p>
      </header>

      <section className="panel-section">
        <div className="section-header">
          <h2>構成リスト</h2>
        </div>

        <div
          className="element-list"
          ref={elementListFocusRef}
          tabIndex={-1}
          aria-label="要素リスト"
        >
          {elements.map((element, index) => (
            <button
              key={element.id}
              type="button"
              className={`element-row ${element.id === selectedElementId ? "selected" : ""} ${
                errorElementIds.has(element.id) ? "has-error" : ""
              }`}
              onClick={() => setSelectedElementId(element.id)}
            >
              <span className="element-index">{index + 1}</span>
              <span className="element-name">
                {errorElementIds.has(element.id) ? "⚠ " : ""}
                {element.name}
              </span>
              <span className="element-type">{elementTypeLabels[element.type]}</span>
              <span className="element-state">{element.visible ? "表示" : "非表示"}</span>
            </button>
          ))}
        </div>

        <div className="button-row reorder-row">
          <button type="button" onClick={() => dispatchCommand("moveSelectedElementUp")}>
            上へ
          </button>
          <button type="button" onClick={() => dispatchCommand("moveSelectedElementDown")}>
            下へ
          </button>
          <button type="button" onClick={() => dispatchCommand("toggleSelectedElementVisibility")}>
            表示切替
          </button>
          <button type="button" onClick={() => dispatchCommand("deleteSelectedElement")}>
            削除
          </button>
        </div>
      </section>
    </aside>
  );
};

export const RightPanel = ({
  evaluation,
  isParameterEditMode,
  isDependencyJumpMode,
  registerParameterControl
}: RightPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const selectedDependencyJumpIndex = useCadStore((state) => state.selectedDependencyJumpIndex);
  const showShortcutHelp = useCadStore((state) => state.showShortcutHelp);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcuts = shortcutHelpItems({
    isParameterEditMode,
    isDependencyJumpMode,
    selectedElement,
    selectedParameterKey
  });

  return (
    <aside className="right-panel">
      {selectedElement ? (
        <ElementEditor
          element={selectedElement}
          elements={elements}
          isParameterEditMode={isParameterEditMode}
          registerParameterControl={registerParameterControl}
        />
      ) : (
        <section className="panel-section">
          <div className="section-header">
            <h2>要素設定</h2>
          </div>
          <p className="empty-state">要素を選択してください。</p>
        </section>
      )}

      <ElementInfoPanel
        element={selectedElement}
        elements={elements}
        evaluation={evaluation}
        isDependencyJumpMode={isDependencyJumpMode}
        selectedDependencyJumpIndex={selectedDependencyJumpIndex}
        setSelectedElementId={setSelectedElementId}
      />

      <section className="panel-section">
        <div className="section-header">
          <h2>バリデーション</h2>
        </div>
        {evaluation.errors.length === 0 ? (
          <p className="empty-state">エラーはありません。</p>
        ) : (
          <ul className="error-list">
            {evaluation.errors.map((error) => (
              <li key={`${error.elementId}-${error.missingDependencyId}`}>
                <strong>{error.elementName}</strong>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <div className="section-header">
          <h2>ショートカット</h2>
          <button type="button" onClick={() => dispatchCommand("toggleShortcutHelp")}>
            ?
          </button>
        </div>
        {showShortcutHelp ? (
          <>
            <h3 className="shortcut-group-title">
              {isParameterEditMode ? "パラメーター編集" : "通常"}
            </h3>
            <dl className="shortcut-list">
              {shortcuts.map((shortcut) => (
                <div key={shortcut.id}>
                  <dt>{shortcut.keys}</dt>
                  <dd>{shortcut.label}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="empty-state">
            {isParameterEditMode ? "ボタンで表示します。" : "? で表示します。"}
          </p>
        )}
      </section>

    </aside>
  );
};
