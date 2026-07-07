import { Check, FileInput, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext, CommandId } from "../commands/commands";
import { compileDslToElements } from "../dsl/dslCompiler";
import {
  createDslExportSelection,
  dslExportAnnotationComment,
  type DslExportSelection
} from "../dsl/dslDependencyClosure";
import { serializeElementsToDsl } from "../dsl/dslSerializer";
import type { DslDiagnostic } from "../dsl/dslTypes";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import { loadLayoutSettings, saveLayoutSettings } from "../layout/layoutSettingsStorage";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { DslPanelWindow } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
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
const dslPanelCommandIds = new Set<CommandId>([
  "exportDslSelection",
  "validateDslPanel",
  "applyDslPanel",
  "closeDslPanel"
]);

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

type DslPanelProps = {
  commandContext?: CommandContext;
  evaluation?: EvaluationResult;
};

const restoreFocusTargetKind = (element: HTMLElement | null): "canvas" | "elementList" | null => {
  if (!element) return null;
  if (element.closest("[data-canvas-viewport='true']")) return "canvas";
  if (element.closest("[data-element-list='true'], [data-element-list-row='true']")) return "elementList";
  return null;
};

const serializeExportSelectionToDsl = (selection: DslExportSelection) =>
  selection.elements.map((element) => {
    const annotation = selection.annotationsByElementId.get(element.id);
    const body = serializeElementsToDsl([element]);
    return annotation ? `${dslExportAnnotationComment(annotation)}\n${body}` : body;
  }).join("\n");

const exportStatus = (selection: DslExportSelection) => {
  const parts = [
    `実選択${selection.selectedCount}件`,
    selection.groupContentCount > 0 ? `グループ内${selection.groupContentCount}件` : null,
    selection.dependencyCount > 0 ? `依存元${selection.dependencyCount}件` : null,
    selection.parentCount > 0 ? `親要素${selection.parentCount}件` : null
  ].filter(Boolean);
  const warnings = [
    selection.warningCounts.disabled > 0 ? `評価OFF${selection.warningCounts.disabled}件` : null,
    selection.warningCounts.invalid > 0 ? `評価エラー${selection.warningCounts.invalid}件` : null,
    selection.warningCounts["too-late"] > 0 ? `順序違い${selection.warningCounts["too-late"]}件` : null
  ].filter(Boolean);
  return `${parts.join("、")}をDSLへ書き出しました。${warnings.length > 0 ? ` 注意: ${warnings.join("、")}。` : ""}`;
};

export const DslPanel = ({ commandContext, evaluation }: DslPanelProps) => {
  const showDslPanel = useCadUiStore((state) => state.showDslPanel);
  const dslPanelSourceRequest = useCadUiStore((state) => state.dslPanelSourceRequest);
  const dslPanelWindow = useCadUiStore((state) => state.dslPanelWindow);
  const setDslPanelWindow = useCadUiStore((state) => state.setDslPanelWindow);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const elements = useCadDocumentStore((state) => state.elements);
  const visibilityRoles = useCadDocumentStore((state) => state.visibilityRoles);
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const printLayouts = useCadDocumentStore((state) => state.printLayouts);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const commitDocumentChange = useCadDocumentStore((state) => state.commitDocumentChange);
  const panelRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const returnFocusRef = useRef<{
    element: HTMLElement | null;
    kind: "canvas" | "elementList" | null;
  } | null>(null);
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
  const requestedExport = useMemo(() => {
    if (!showDslPanel || !dslPanelSourceRequest) return null;
    return createDslExportSelection({
      elements,
      selectedElementIds: dslPanelSourceRequest.elementIds,
      evaluation
    });
  }, [dslPanelSourceRequest, elements, evaluation, showDslPanel]);
  const activeRequestId = dslPanelSourceRequest?.requestId ?? null;
  const hasPendingSourceRequest =
    Boolean(requestedExport && requestedExport.elements.length > 0 && sourceState.requestId !== activeRequestId);
  const source = hasPendingSourceRequest
    ? serializeExportSelectionToDsl(requestedExport as DslExportSelection)
    : sourceState.source;
  const visibleDiagnostics = hasPendingSourceRequest ? [] : diagnostics;
  const visibleStatus = hasPendingSourceRequest
    ? exportStatus(requestedExport as DslExportSelection)
    : status;

  const insertionIndex = selectedElementIds.length > 0
    ? Math.max(
        ...elements
          .map((element, index) => (selectedElementIds.includes(element.id) ? index : -1))
          .filter((index) => index >= 0)
      ) + 1
    : elements.length;

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    if (target?.element?.isConnected) {
      target.element.focus();
      return;
    }
    if (target?.kind === "elementList") {
      commandContext?.focusElementList?.();
      return;
    }
    if (target?.kind === "canvas") {
      commandContext?.focusCanvas?.();
    }
  }, [commandContext]);

  const closePanel = useCallback(() => {
    useCadUiStore.getState().setShowDslPanel(false);
    restoreFocus();
  }, [restoreFocus]);

  const validate = useCallback(() => {
    setSourceState({ source, requestId: activeRequestId });
    const result = compileDslToElements(source, {
      elements,
      visibilityRoles,
      visibilityProfiles,
      activeVisibilityProfileId,
      printLayouts,
      insertionIndex,
      selectedElementIds
    });
    setDiagnostics(result.diagnostics);
    const errorCount = result.diagnostics.filter((item) => item.severity === "error").length;
    setStatus(errorCount === 0 ? `${result.changedCount}件の要素を適用できます。` : `${errorCount}件のエラーがあります。`);
    return result;
  }, [
    activeRequestId,
    activeVisibilityProfileId,
    elements,
    insertionIndex,
    printLayouts,
    selectedElementIds,
    source,
    visibilityProfiles,
    visibilityRoles
  ]);

  const apply = useCallback(() => {
    const result = validate();
    if (result.diagnostics.some((item) => item.severity === "error")) return;
    const insertedCount = Math.max(result.elements.length - elements.length, 0);
    commitDocumentChange({
      elements: result.elements,
      visibilityRoles: result.visibilityRoles ?? visibilityRoles,
      visibilityProfiles: result.visibilityProfiles ?? visibilityProfiles,
      activeVisibilityProfileId: result.activeVisibilityProfileId ?? activeVisibilityProfileId,
      printLayouts: result.printLayouts ?? printLayouts,
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
    closePanel();
  }, [
    activeVisibilityProfileId,
    closePanel,
    commitDocumentChange,
    elements,
    evaluationLimitIndex,
    insertionIndex,
    printLayouts,
    validate,
    visibilityProfiles,
    visibilityRoles
  ]);

  const exportSelection = useCallback(() => {
    if (selectedElements.length === 0) {
      setSourceState({
        source: serializeElementsToDsl(elements, {
          visibilityRoles,
          visibilityProfiles,
          activeVisibilityProfileId,
          printLayouts
        }),
        requestId: activeRequestId
      });
      setDiagnostics([]);
      setStatus("全要素をDSLへ書き出しました。");
      return;
    }
    const selection = createDslExportSelection({
      elements,
      selectedElementIds,
      evaluation
    });
    setSourceState({
      source: serializeExportSelectionToDsl(selection),
      requestId: activeRequestId
    });
    setDiagnostics([]);
    setStatus(exportStatus(selection));
  }, [
    activeRequestId,
    activeVisibilityProfileId,
    elements,
    evaluation,
    printLayouts,
    selectedElementIds,
    selectedElements,
    visibilityProfiles,
    visibilityRoles
  ]);

  const dslCommandContext = useMemo<CommandContext>(() => ({
    ...commandContext,
    exportDslSelection: exportSelection,
    validateDslPanel: validate,
    applyDslPanel: apply,
    closeDslPanel: closePanel
  }), [apply, closePanel, commandContext, exportSelection, validate]);

  useEffect(() => {
    if (!showDslPanel) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!panelRef.current?.contains(activeElement)) {
      returnFocusRef.current = {
        element: activeElement,
        kind: restoreFocusTargetKind(activeElement)
      };
    }
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [showDslPanel]);

  if (!showDslPanel) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const keyboardCommand = keyboardCommandForEvent(event.nativeEvent, {
      settings: shortcutSettings,
      isDslPanelMode: true,
      allowEditableCommandIds: dslPanelCommandIds
    });
    if (!keyboardCommand || !dslPanelCommandIds.has(keyboardCommand.commandId)) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchCommand(keyboardCommand.commandId, {
      ...dslCommandContext,
      ...keyboardCommand.context
    });
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
      onKeyDownCapture={handleKeyDown}
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
        <button type="button" onClick={() => dispatchCommand("closeDslPanel", dslCommandContext)} aria-label="DSLパネルを閉じる">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="dsl-panel-toolbar">
        <button type="button" onClick={() => dispatchCommand("exportDslSelection", dslCommandContext)}>
          <FileInput size={15} aria-hidden="true" />
          選択を書き出し
        </button>
        <button type="button" onClick={() => dispatchCommand("validateDslPanel", dslCommandContext)}>
          <Check size={15} aria-hidden="true" />
          検証
        </button>
        <button type="button" className="primary-action" onClick={() => dispatchCommand("applyDslPanel", dslCommandContext)}>
          <Play size={15} aria-hidden="true" />
          適用
        </button>
      </div>

      <DslEditor
        textareaRef={editorRef}
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
