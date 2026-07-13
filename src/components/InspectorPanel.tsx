import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { createDependencyIndex, getDependencySummary } from "../model/dependencies";
import {
  createElementPresentationStatusIndex,
  type ElementPresentationStatus
} from "../model/elementPresentationStatus";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { geometryInfoRows } from "./geometryDisplay";
import {
  dependencyInspectorPresentation,
  moveInspectorRowKey,
  parameterInspectorRows,
  reconcileInspectorActiveRowKey,
  type InspectorDependencyRow,
  type InspectorRow,
  type InspectorUnresolvedDependencyRow
} from "./inspectorPresentation";

export type InspectorPanelHandle = {
  focusParameterRows: () => void;
  focusDependencyRows: () => void;
  moveParameterRow: (direction: -1 | 1) => boolean;
  moveDependencyRow: (direction: -1 | 1) => boolean;
  activateRow: () => boolean;
  exit: () => void;
  isFocused: () => boolean;
};

const statusLabels = (status: ElementPresentationStatus) => [
  status.hasError ? "エラー" : null,
  status.hasWarning ? "警告" : null,
  status.disabledSelf || status.disabledByGroup ? "無効" : null,
  status.hiddenSelf || status.hiddenByGroup || status.hiddenByProfile ? "非表示" : null,
  status.conditionInactive ? "条件外" : null,
  status.locked ? "ロック" : null
].filter((value): value is string => Boolean(value));

const relatedCountBadge = (count: number) => (
  <span className="dependency-count-badge" aria-label={`関連要素 ${count} 件`}>
    {count > 99 ? "99+" : count}
  </span>
);

export const InspectorPanel = forwardRef<InspectorPanelHandle, {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationEngineLabel?: string | null;
  isEvaluationFallback?: boolean;
  isEvaluationStale?: boolean;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
  onExit: () => void;
}>(function InspectorPanel({
  element,
  elements,
  evaluation,
  evaluationEngineLabel,
  isEvaluationFallback = false,
  isEvaluationStale = false,
  sourceEditorRef,
  onExit
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocusRef = useRef(false);
  const selectedElementIdRef = useRef(element?.id ?? null);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const activeRowKeyRef = useRef<string | null>(null);
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const showElementInfoPanel = useCadUiStore((state) => state.showElementInfoPanel);
  const palette = useCadDocumentStore((state) => state.palette);
  const profiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const doc = useCadDocumentStore((state) => state.doc);
  const docText = useCadDocumentStore((state) => state.docText);
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const isLastGood = docText !== sourceText;

  const dependencyIndex = useMemo(() => createDependencyIndex(elements), [elements]);
  const dependencySummary = useMemo(
    () => element ? getDependencySummary(element, elements, dependencyIndex) : null,
    [dependencyIndex, element, elements]
  );
  const presentationStatusIndex = useMemo(() => createElementPresentationStatusIndex({
    elements,
    evaluation,
    groupFoldById,
    palette,
    visibilityProfiles: profiles,
    activeVisibilityProfileId: activeProfileId
  }), [activeProfileId, elements, evaluation, groupFoldById, palette, profiles]);
  const status = element ? presentationStatusIndex.get(element.id) ?? null : null;
  const parameterRows = useMemo(() => element ? parameterInspectorRows(element) : [], [element]);
  const dependencyPresentation = useMemo(
    () => element && dependencySummary ? dependencyInspectorPresentation(element, dependencySummary, evaluation) : null,
    [dependencySummary, element, evaluation]
  );
  const dependencyRows = useMemo(() => dependencyPresentation?.rows ?? [], [dependencyPresentation]);
  const allRows = useMemo<InspectorRow[]>(() => [...dependencyRows, ...parameterRows], [dependencyRows, parameterRows]);
  const parseIssues = useMemo(() => {
    if (!element || isLastGood) return [];
    const line = doc.statementMap.byElementId.get(element.id)?.line;
    return line ? diagnostics.filter((item) => item.line === line) : [];
  }, [diagnostics, doc.statementMap, element, isLastGood]);
  const infoRows = element ? geometryInfoRows(
    evaluation.computedGeometry.get(element.id),
    evaluation.computedVariables.get(element.id)
  ) : [];
  const setActiveRow = useCallback((key: string | null) => {
    activeRowKeyRef.current = key;
    setActiveRowKey(key);
  }, []);

  useLayoutEffect(() => {
    const selectedElementChanged = selectedElementIdRef.current !== (element?.id ?? null);
    selectedElementIdRef.current = element?.id ?? null;
    const next = selectedElementChanged
      ? reconcileInspectorActiveRowKey(null, allRows, activeRowKeyRef.current?.startsWith("dependency:") ? "dependency" : "parameter")
      : reconcileInspectorActiveRowKey(activeRowKeyRef.current, allRows);
    if (next !== activeRowKeyRef.current) setActiveRow(next);
  }, [allRows, element?.id, setActiveRow]);
  useEffect(() => {
    if (!activeRowKey) return;
    const row = rowRefs.current.get(activeRowKey);
    row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeRowKey]);
  useEffect(() => {
    if (!showElementInfoPanel || !pendingFocusRef.current || !rootRef.current) return;
    rootRef.current.focus();
    pendingFocusRef.current = false;
  }, [activeRowKey, showElementInfoPanel]);

  const focusRows = useCallback((rows: readonly InspectorRow[]) => {
    setActiveRow(rows[0]?.key ?? allRows[0]?.key ?? null);
    pendingFocusRef.current = true;
    if (rootRef.current) {
      rootRef.current.focus();
      pendingFocusRef.current = false;
    }
  }, [allRows, setActiveRow]);
  const moveRows = useCallback((rows: readonly InspectorRow[], direction: -1 | 1) => {
    const nextKey = moveInspectorRowKey(rows, activeRowKeyRef.current, direction);
    if (!nextKey) return false;
    setActiveRow(nextKey);
    return true;
  }, [setActiveRow]);
  const activate = useCallback((row = allRows.find((item) => item.key === activeRowKeyRef.current)): boolean => {
    if (!row || !element) return false;
    if (row.kind === "parameter") {
      return sourceEditorRef.current?.jumpToParameterValue(element.id, row.parameterKey) ?? false;
    }
    // Selection may flush dirty source text. Do not move the editor cursor if IME blocked
    // that command or the row's target disappeared during the flush.
    if (dispatchCommand("selectElement", { elementId: row.elementId }) === false) return false;
    if (!useCadDocumentStore.getState().elements.some((candidate) => candidate.id === row.elementId)) return false;
    // Dependency navigation deliberately keeps Inspector DOM focus, enabling continued ↑/↓ traversal.
    sourceEditorRef.current?.jumpToElement(row.elementId);
    return true;
  }, [allRows, element, sourceEditorRef]);

  useImperativeHandle(ref, () => ({
    focusParameterRows: () => focusRows(parameterRows),
    focusDependencyRows: () => focusRows(dependencyRows),
    moveParameterRow: (direction) => moveRows(parameterRows, direction),
    moveDependencyRow: (direction) => moveRows(dependencyRows, direction),
    activateRow: () => activate(),
    exit: onExit,
    isFocused: () => Boolean(rootRef.current?.contains(document.activeElement))
  }), [activate, dependencyRows, focusRows, moveRows, onExit, parameterRows]);

  const activeId = activeRowKey ? `inspector-row-${activeRowKey.replace(/[^a-zA-Z0-9_-]/g, "-")}` : undefined;
  const evaluationLabel = isLastGood ? "評価: last-good" : evaluationEngineLabel;
  const renderDependencyRow = (row: InspectorDependencyRow) => (
    <div
      key={row.key}
      id={`inspector-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
      ref={(node) => { if (node) rowRefs.current.set(row.key, node); else rowRefs.current.delete(row.key); }}
      role="option"
      aria-selected={row.key === activeRowKey}
      className={`inspector-row ${row.key === activeRowKey ? "is-active" : ""}`}
      onClick={() => { setActiveRow(row.key); activate(row); }}
    >
      <span className="inspector-row-main"><span>{row.label} {relatedCountBadge(row.relatedCount)}</span><small>{row.detail}</small></span>
      {row.issues.length > 0 ? <span className="dependency-issue-list">{row.issues.map((issue, index) => <span key={`${issue.message}-${index}`} className={`dependency-issue ${issue.severity}`}>{issue.message}</span>)}</span> : null}
    </div>
  );
  const renderUnresolvedRow = (row: InspectorUnresolvedDependencyRow) => (
    <div key={row.key} className="dependency-row unresolved">
      <span className="dependency-row-main"><span>未解決: {row.id} {relatedCountBadge(row.relatedCount)}</span><small>親要素を解決できません。</small></span>
      {row.issues.length > 0 ? <span className="dependency-issue-list">{row.issues.map((issue, index) => <span key={`${issue.message}-${index}`} className={`dependency-issue ${issue.severity}`}>{issue.message}</span>)}</span> : null}
    </div>
  );

  return (
    <section className="panel-section inspector-panel" aria-label="インスペクタ">
      <div className="section-header">
        <div>
          <h2>インスペクタ</h2>
          {element ? <p className="section-subtitle">{element.name} ・ {elementTypeLabels[element.type]}</p> : null}
        </div>
        <div className="section-header-actions">
          {evaluationLabel ? <small className={`evaluation-engine-status ${isEvaluationStale || isLastGood ? "stale" : ""} ${isEvaluationFallback ? "fallback" : ""}`}>{evaluationLabel}</small> : null}
          <button type="button" onClick={() => dispatchCommand("toggleElementInfoPanel")}>i</button>
        </div>
      </div>
      {!showElementInfoPanel ? <p className="empty-state">折り畳み中です。</p> : !element ? <p className="empty-state">要素を選択してください。</p> : (
        <div ref={rootRef} className="inspector-navigation" tabIndex={0} role="listbox" aria-label="インスペクタ行" aria-activedescendant={activeId}>
          {status ? <div className="inspector-status-badges">{statusLabels(status).map((label) => <span key={label} className={`inspector-status ${label}`}>{label}</span>)}</div> : null}
          {infoRows.length > 0 ? <dl className="element-info-grid">{infoRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p className="empty-state">未評価です。</p>}
          {(dependencyPresentation?.ownIssues.length ?? 0) + parseIssues.length > 0 ? <div className="dependency-group"><h3 className="shortcut-group-title">診断</h3>{[...(dependencyPresentation?.ownIssues ?? []), ...parseIssues].map((issue, index) => <p key={`${issue.message}-${index}`} className={`inspector-diagnostic ${issue.severity}`}>{issue.message}</p>)}</div> : null}
          <div className="dependency-group"><h3 className="shortcut-group-title">親要素</h3>{dependencyPresentation?.parentRows.length || dependencyPresentation?.unresolvedParentRows.length ? <div className="dependency-list">{dependencyPresentation.parentRows.map(renderDependencyRow)}{dependencyPresentation.unresolvedParentRows.map(renderUnresolvedRow)}</div> : <p className="empty-state">親要素はありません。</p>}</div>
          <div className="dependency-group"><h3 className="shortcut-group-title">子要素</h3>{dependencyPresentation?.childRows.length ? <div className="dependency-list">{dependencyPresentation.childRows.map(renderDependencyRow)}</div> : <p className="empty-state">子要素はありません。</p>}</div>
          <div className="dependency-group"><h3 className="shortcut-group-title">パラメーター</h3><div className="dependency-list">{parameterRows.map((row) => <div
            key={row.key}
            id={`inspector-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
            ref={(node) => { if (node) rowRefs.current.set(row.key, node); else rowRefs.current.delete(row.key); }}
            role="option"
            aria-selected={row.key === activeRowKey}
            className={`inspector-row ${row.key === activeRowKey ? "is-active" : ""}`}
            onClick={() => { setActiveRow(row.key); activate(row); }}
          ><span className="inspector-row-main"><span>{row.label}</span><small>{row.value}</small></span></div>)}</div></div>
        </div>
      )}
    </section>
  );
});
