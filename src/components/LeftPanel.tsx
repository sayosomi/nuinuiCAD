import type { KeyboardEvent, RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { shortcutHelpItems } from "../keyboard/shortcuts";
import { formatReferenceOptionLabel } from "../model/elementNames";
import {
  defaultNumericParameterStep,
  getNumericParameterStep,
  getParameterDefinitions
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
  isParameterEditMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
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
        <h2>選択中要素</h2>
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

export const LeftPanel = ({
  evaluation,
  elementListFocusRef,
  isParameterEditMode,
  registerParameterControl
}: LeftPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const showShortcutHelp = useCadStore((state) => state.showShortcutHelp);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const shortcuts = shortcutHelpItems({
    isParameterEditMode,
    selectedElement,
    selectedParameterKey
  });

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
        <p>パラメトリック洋裁型紙CAD</p>
      </header>

      <section className="panel-section">
        <div className="section-header">
          <h2>要素</h2>
          <div className="button-row">
            <button type="button" onClick={() => dispatchCommand("addFreePoint")}>
              + Point
            </button>
            <button type="button" onClick={() => dispatchCommand("addOffsetPoint")}>
              + Offset
            </button>
            <button type="button" onClick={() => dispatchCommand("addLine")}>
              + Line
            </button>
          </div>
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

      {selectedElement ? (
        <ElementEditor
          element={selectedElement}
          elements={elements}
          isParameterEditMode={isParameterEditMode}
          registerParameterControl={registerParameterControl}
        />
      ) : null}

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
