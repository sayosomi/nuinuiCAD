import { Check, FileInput, Play, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import { compileDslToElements } from "../dsl/dslCompiler";
import { serializeElementsToDsl } from "../dsl/dslSerializer";
import type { DslDiagnostic } from "../dsl/dslTypes";
import { loadLayoutSettings, saveLayoutSettings } from "../layout/layoutSettingsStorage";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { DslPanelWindow } from "../state/cadUiStore";
import { DslEditor } from "./DslEditor";

const defaultSource = [
  "# nuinuiCAD DSL",
  "var bust = 840",
  "point A = (0, 0)",
  "point B = offset A dx=0 dy=-(bust / 4)",
  "line AB = A -> B"
].join("\n");

const diagnosticText = (diagnostic: DslDiagnostic) =>
  `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;

const INTERACTIVE_HEADER_SELECTOR = "button, select, input, textarea, [contenteditable='true']";
const PANEL_VIEWPORT_MARGIN = 8;

const isInteractiveHeaderTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest(INTERACTIVE_HEADER_SELECTOR));

const clampedDslPanelWindow = (
  panelWindow: DslPanelWindow,
  panelSize: { width: number; height: number },
  viewportSize: { width: number; height: number }
): DslPanelWindow => {
  const maxX = Math.max(viewportSize.width - panelSize.width - PANEL_VIEWPORT_MARGIN, PANEL_VIEWPORT_MARGIN);
  const maxY = Math.max(viewportSize.height - panelSize.height - PANEL_VIEWPORT_MARGIN, PANEL_VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(panelWindow.x, PANEL_VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(panelWindow.y, PANEL_VIEWPORT_MARGIN), maxY)
  };
};

const saveDslPanelWindowSettings = (dslPanelWindow: DslPanelWindow | null) => {
  void loadLayoutSettings()
    .then((settings) => saveLayoutSettings({ ...settings, dslPanelWindow }))
    .catch((error: unknown) => {
      console.error("failed to save DSL panel window settings", error);
    });
};

type DslPanelDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  panelWindow: DslPanelWindow;
  panelSize: { width: number; height: number };
};

export const DslPanel = () => {
  const showDslPanel = useCadUiStore((state) => state.showDslPanel);
  const dslPanelSourceRequest = useCadUiStore((state) => state.dslPanelSourceRequest);
  const dslPanelWindow = useCadUiStore((state) => state.dslPanelWindow);
  const setDslPanelWindow = useCadUiStore((state) => state.setDslPanelWindow);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const commitDocumentChange = useCadDocumentStore((state) => state.commitDocumentChange);
  const panelRef = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<DslPanelDrag | null>(null);
  const [sourceState, setSourceState] = useState<{ source: string; requestId: number | null }>({
    source: defaultSource,
    requestId: null
  });
  const [diagnostics, setDiagnostics] = useState<DslDiagnostic[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const selectedElements = useMemo(
    () => elements.filter((element) => selectedElementIds.includes(element.id)),
    [elements, selectedElementIds]
  );
  const requestedElements = useMemo(() => {
    if (!showDslPanel || !dslPanelSourceRequest) return [];
    const requestedIds = new Set(dslPanelSourceRequest.elementIds);
    return elements.filter((element) => requestedIds.has(element.id));
  }, [dslPanelSourceRequest, elements, showDslPanel]);
  const activeRequestId = dslPanelSourceRequest?.requestId ?? null;
  const hasPendingSourceRequest =
    requestedElements.length > 0 && sourceState.requestId !== activeRequestId;
  const source = hasPendingSourceRequest
    ? serializeElementsToDsl(requestedElements)
    : sourceState.source;
  const visibleDiagnostics = hasPendingSourceRequest ? [] : diagnostics;
  const visibleStatus = hasPendingSourceRequest
    ? `${requestedElements.length}件の要素をDSLへ書き出しました。`
    : status;

  if (!showDslPanel) return null;

  const insertionIndex = selectedElementIds.length > 0
    ? Math.max(
        ...elements
          .map((element, index) => (selectedElementIds.includes(element.id) ? index : -1))
          .filter((index) => index >= 0)
      ) + 1
    : elements.length;

  const validate = () => {
    setSourceState({ source, requestId: activeRequestId });
    const result = compileDslToElements(source, {
      elements,
      insertionIndex,
      selectedElementIds
    });
    setDiagnostics(result.diagnostics);
    const errorCount = result.diagnostics.filter((item) => item.severity === "error").length;
    setStatus(errorCount === 0 ? `${result.changedCount}件の要素を適用できます。` : `${errorCount}件のエラーがあります。`);
    return result;
  };

  const apply = () => {
    const result = validate();
    if (result.diagnostics.some((item) => item.severity === "error")) return;
    const insertedCount = Math.max(result.elements.length - elements.length, 0);
    commitDocumentChange({
      elements: result.elements,
      selectedElementId: result.selectedElementId,
      selectedElementIds: result.selectedElementIds,
      selectionAnchorElementId: result.selectedElementId,
      evaluationLimitIndex: insertedCount > 0
        ? adjustEvaluationLimitForInsertion({
            elements,
            evaluationLimitIndex,
            insertionIndex,
            insertedCount
          })
        : evaluationLimitIndex
    });
    setStatus(`${result.changedCount}件の要素を適用しました。`);
  };

  const exportSelection = () => {
    const targets = selectedElements.length > 0 ? selectedElements : elements;
    setSourceState({
      source: serializeElementsToDsl(targets),
      requestId: activeRequestId
    });
    setDiagnostics([]);
    setStatus(selectedElements.length > 0 ? "選択要素をDSLへ書き出しました。" : "全要素をDSLへ書き出しました。");
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (isInteractiveHeaderTarget(event.target)) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const panelWindow = dslPanelWindow ?? { x: rect.left, y: rect.top };
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panelWindow,
      panelSize: { width: rect.width, height: rect.height }
    });
    setDslPanelWindow(clampedDslPanelWindow(panelWindow, rect, {
      width: window.innerWidth,
      height: window.innerHeight
    }));
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDslPanelWindow(
      clampedDslPanelWindow(
        {
          x: drag.panelWindow.x + event.clientX - drag.startX,
          y: drag.panelWindow.y + event.clientY - drag.startY
        },
        drag.panelSize,
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const nextWindow = useCadUiStore.getState().dslPanelWindow;
    saveDslPanelWindowSettings(nextWindow);
    setDrag(null);
  };

  const panelStyle = dslPanelWindow
    ? ({
        left: `${dslPanelWindow.x}px`,
        top: `${dslPanelWindow.y}px`,
        right: "auto",
        bottom: "auto"
      } satisfies CSSProperties)
    : undefined;

  return (
    <aside
      ref={panelRef}
      className={`dsl-panel ${dslPanelWindow ? "is-positioned" : ""}`}
      style={panelStyle}
      aria-label="DSLパネル"
    >
      <div
        className={`dsl-panel-header ${drag ? "is-dragging" : ""}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div>
          <span>DSL</span>
          <h2>テキスト作図</h2>
        </div>
        <button type="button" onClick={() => dispatchCommand("closeDslPanel")} aria-label="DSLパネルを閉じる">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="dsl-panel-toolbar">
        <button type="button" onClick={exportSelection}>
          <FileInput size={15} aria-hidden="true" />
          選択を書き出し
        </button>
        <button type="button" onClick={validate}>
          <Check size={15} aria-hidden="true" />
          検証
        </button>
        <button type="button" className="primary-action" onClick={apply}>
          <Play size={15} aria-hidden="true" />
          適用
        </button>
      </div>

      <DslEditor
        source={source}
        onSourceChange={(nextSource) => {
          setSourceState({ source: nextSource, requestId: activeRequestId });
          setStatus(null);
        }}
      />

      {visibleStatus ? <p className="dsl-status">{visibleStatus}</p> : null}
      {visibleDiagnostics.length > 0 ? (
        <div className="dsl-diagnostics" aria-label="DSL診断">
          {visibleDiagnostics.map((item, index) => (
            <p key={`${item.line}-${item.column}-${index}`} className={item.severity}>
              {diagnosticText(item)}
            </p>
          ))}
        </div>
      ) : null}
    </aside>
  );
};
