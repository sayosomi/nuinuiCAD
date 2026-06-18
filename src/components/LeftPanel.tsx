import type { RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { shortcutDefinitions } from "../keyboard/shortcuts";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
};

const pointOptions = (elements: CadElement[]) =>
  elements
    .filter((element) => element.type === "freePoint" || element.type === "offsetPoint")
    .map((element) => (
      <option key={element.id} value={element.id}>
        {element.name}
      </option>
    ));

const ElementEditor = ({ element, elements }: { element: CadElement; elements: CadElement[] }) => {
  const updateElement = useCadStore((state) => state.updateElement);

  const updateName = (name: string) => updateElement(element.id, { name });
  const updateVisible = (visible: boolean) => updateElement(element.id, { visible });
  const updateEnabled = (enabled: boolean) => updateElement(element.id, { enabled });
  const updateField = (field: string, value: string) => {
    updateElement(element.id, { [field]: Number(value) } as Partial<CadElement>);
  };
  const updateRef = (field: string, value: ElementId) => {
    updateElement(element.id, { [field]: value } as Partial<CadElement>);
  };

  return (
    <section className="panel-section">
      <div className="section-header">
        <h2>選択中要素</h2>
      </div>
      <div className="editor-grid">
        <label>
          名前
          <input value={element.name} onChange={(event) => updateName(event.target.value)} />
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={element.visible}
            onChange={(event) => updateVisible(event.target.checked)}
          />
          表示する
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={element.enabled}
            onChange={(event) => updateEnabled(event.target.checked)}
          />
          評価する
        </label>

        {element.type === "freePoint" && (
          <>
            <label>
              x
              <input
                type="number"
                step="1"
                value={element.x}
                onChange={(event) => updateField("x", event.target.value)}
              />
            </label>
            <label>
              y
              <input
                type="number"
                step="1"
                value={element.y}
                onChange={(event) => updateField("y", event.target.value)}
              />
            </label>
          </>
        )}

        {element.type === "offsetPoint" && (
          <>
            <label>
              基準点
              <select
                value={element.fromPointId}
                onChange={(event) => updateRef("fromPointId", event.target.value)}
              >
                {pointOptions(elements)}
              </select>
            </label>
            <label>
              dx
              <input
                type="number"
                step="1"
                value={element.dx}
                onChange={(event) => updateField("dx", event.target.value)}
              />
            </label>
            <label>
              dy
              <input
                type="number"
                step="1"
                value={element.dy}
                onChange={(event) => updateField("dy", event.target.value)}
              />
            </label>
          </>
        )}

        {element.type === "line" && (
          <>
            <label>
              始点
              <select
                value={element.startPointId}
                onChange={(event) => updateRef("startPointId", event.target.value)}
              >
                {pointOptions(elements)}
              </select>
            </label>
            <label>
              終点
              <select
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

export const LeftPanel = ({ evaluation, elementListFocusRef }: LeftPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const showShortcutHelp = useCadStore((state) => state.showShortcutHelp);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));

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

      {selectedElement ? <ElementEditor element={selectedElement} elements={elements} /> : null}

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
          <dl className="shortcut-list">
            {shortcutDefinitions.map((shortcut) => (
              <div key={shortcut.commandId}>
                <dt>{shortcut.keys}</dt>
                <dd>{shortcut.label}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="empty-state">? で表示します。</p>
        )}
      </section>

    </aside>
  );
};
