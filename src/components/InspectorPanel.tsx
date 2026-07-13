import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { numericValueExpression } from "../geometry/numericExpressions";
import { createDependencyIndex, getDependencySummary } from "../model/dependencies";
import {
  createElementPresentationStatusIndex,
  type ElementPresentationStatus
} from "../model/elementPresentationStatus";
import { getParameterValue } from "../parameters/parameterAccess";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { geometryInfoRows } from "./geometryDisplay";

type InspectorRow =
  | { key: string; kind: "parameter"; parameterKey: string; label: string; value: string }
  | {
    key: string;
    kind: "dependency";
    elementId: ElementId;
    label: string;
    detail: string;
    issues: readonly InspectorIssue[];
  };

type InspectorIssue = { severity: "error" | "warning"; message: string };

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

const displayValue = (value: unknown): string => {
  if (typeof value === "number" || (typeof value === "object" && value !== null && "kind" in value)) {
    return numericValueExpression(value as Parameters<typeof numericValueExpression>[0]);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value || "（空）";
  if (value === null || value === undefined) return "未設定";
  if (typeof value === "object" && "mode" in value) {
    const anchor = value as { mode: string; pointId?: string; x?: unknown; y?: unknown };
    return anchor.mode === "coordinate"
      ? `(${displayValue(anchor.x)}, ${displayValue(anchor.y)})`
      : anchor.pointId ?? "未設定";
  }
  return String(value);
};

const evaluationIssuesFor = (elementId: ElementId, evaluation: EvaluationResult): InspectorIssue[] => [
  ...evaluation.errors.filter((item) => item.elementId === elementId).map((item) => ({ severity: "error" as const, message: item.message })),
  ...evaluation.warnings.filter((item) => item.elementId === elementId).map((item) => ({ severity: "warning" as const, message: item.message }))
];

export const InspectorPanel = forwardRef<InspectorPanelHandle, {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationEngineLabel?: string | null;
  isEvaluationFallback?: boolean;
  isEvaluationStale?: boolean;
  sourceEditorRef: React.RefObject<SourceEditorHandle | null>;
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
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const activeRowKeyRef = useRef<string | null>(null);
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const showElementInfoPanel = useCadUiStore((state) => state.showElementInfoPanel);
  const setSelectedParameterKey = useCadUiStore((state) => state.setSelectedParameterKey);
  const palette = useCadDocumentStore((state) => state.palette);
  const profiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const doc = useCadDocumentStore((state) => state.doc);
  const docText = useCadDocumentStore((state) => state.docText);
  const sourceText = useCadDocumentStore((state) => state.sourceText);

  const dependencyIndex = useMemo(() => createDependencyIndex(elements), [elements]);
  const dependencySummary = useMemo(
    () => element ? getDependencySummary(element, elements, dependencyIndex) : null,
    [dependencyIndex, element, elements]
  );
  const status = useMemo(() => element ? createElementPresentationStatusIndex({
    elements,
    evaluation,
    groupFoldById,
    palette,
    visibilityProfiles: profiles,
    activeVisibilityProfileId: activeProfileId
  }).get(element.id) ?? null : null, [activeProfileId, element, elements, evaluation, groupFoldById, palette, profiles]);
  const parameterRows = useMemo<InspectorRow[]>(() => element
    ? getParameterDefinitions(element).map((definition) => ({
      key: `parameter:${definition.key}`,
      kind: "parameter" as const,
      parameterKey: definition.key,
      label: definition.label,
      value: displayValue(getParameterValue(element, definition.key))
    }))
    : [], [element]);
  const dependencyRows = useMemo<InspectorRow[]>(() => dependencySummary ? [
    ...dependencySummary.parents.flatMap((parent) => parent.element ? [{
      key: `parent:${parent.element.id}`,
      kind: "dependency" as const,
      elementId: parent.element.id,
      label: parent.element.name,
      detail: `親・${elementTypeLabels[parent.element.type]}`,
      issues: element
        ? evaluation.errors
          .filter((issue) => issue.elementId === element.id && issue.missingDependencyId === parent.element?.id)
          .map((issue) => ({ severity: "error" as const, message: issue.message }))
        : []
    }] : []),
    ...dependencySummary.children.map((child) => ({
      key: `child:${child.element.id}`,
      kind: "dependency" as const,
      elementId: child.element.id,
      label: child.element.name,
      detail: `子・${elementTypeLabels[child.element.type]}`,
      issues: evaluationIssuesFor(child.element.id, evaluation)
    }))
  ] : [], [dependencySummary, element, evaluation]);
  const allRows = useMemo(() => [...dependencyRows, ...parameterRows], [dependencyRows, parameterRows]);
  const resolvedParentIds = new Set(
    dependencySummary?.parents.flatMap((parent) => parent.element ? [parent.element.id] : []) ?? []
  );
  const issues = element
    ? evaluationIssuesFor(element.id, evaluation).filter((issue) =>
      !evaluation.errors.some(
        (error) => error.elementId === element.id && error.message === issue.message && resolvedParentIds.has(error.missingDependencyId)
      )
    )
    : [];
  const parseIssues = useMemo(() => {
    if (!element || docText !== sourceText) return [];
    const line = doc.statementMap.byElementId.get(element.id)?.line;
    return line ? diagnostics.filter((item) => item.line === line) : [];
  }, [diagnostics, doc.statementMap, docText, element, sourceText]);
  const infoRows = element ? geometryInfoRows(
    evaluation.computedGeometry.get(element.id),
    evaluation.computedVariables.get(element.id)
  ) : [];
  const setActiveRow = useCallback((key: string | null) => {
    activeRowKeyRef.current = key;
    setActiveRowKey(key);
  }, []);
  const initialRowKey = parameterRows[0]?.key ?? dependencyRows[0]?.key ?? null;

  useEffect(() => {
    setActiveRow(initialRowKey);
  }, [element?.id, initialRowKey, setActiveRow]);
  useEffect(() => {
    if (activeRowKey && allRows.some((row) => row.key === activeRowKey)) return;
    setActiveRow(allRows[0]?.key ?? null);
  }, [activeRowKey, allRows, setActiveRow]);
  useEffect(() => {
    if (!activeRowKey) return;
    const row = rowRefs.current.get(activeRowKey);
    if (typeof row?.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeRowKey]);
  useEffect(() => {
    if (!showElementInfoPanel || !pendingFocusRef.current || !rootRef.current) return;
    rootRef.current.focus();
    pendingFocusRef.current = false;
  }, [activeRowKey, showElementInfoPanel]);

  const focusRows = useCallback((rows: readonly InspectorRow[]) => {
    const key = rows[0]?.key ?? allRows[0]?.key ?? null;
    setActiveRow(key);
    pendingFocusRef.current = true;
    if (rootRef.current) {
      rootRef.current.focus();
      pendingFocusRef.current = false;
    }
  }, [allRows, setActiveRow]);
  const moveRows = useCallback((rows: readonly InspectorRow[], direction: -1 | 1) => {
    if (rows.length === 0) return false;
    const index = Math.max(0, rows.findIndex((row) => row.key === activeRowKeyRef.current));
    const next = rows[Math.min(Math.max(index + direction, 0), rows.length - 1)];
    if (!next) return false;
    setActiveRow(next.key);
    if (next.kind === "parameter") setSelectedParameterKey(next.parameterKey);
    return true;
  }, [setActiveRow, setSelectedParameterKey]);
  const activate = useCallback((row = allRows.find((item) => item.key === activeRowKeyRef.current)): boolean => {
    if (!row || !element) return false;
    if (row.kind === "parameter") return sourceEditorRef.current?.jumpToParameterValue(element.id, row.parameterKey) ?? false;
    dispatchCommand("selectElement", { elementId: row.elementId });
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
  return (
    <section className="panel-section inspector-panel" aria-label="インスペクタ">
      <div className="section-header">
        <div>
          <h2>インスペクタ</h2>
          {element ? <p className="section-subtitle">{element.name} ・ {elementTypeLabels[element.type]}</p> : null}
        </div>
        {evaluationEngineLabel ? <small className={`evaluation-engine-status ${isEvaluationStale ? "stale" : ""} ${isEvaluationFallback ? "fallback" : ""}`}>{evaluationEngineLabel}</small> : null}
      </div>
      {!showElementInfoPanel ? <p className="empty-state">折り畳み中です。</p> : !element ? <p className="empty-state">要素を選択してください。</p> : (
        <div ref={rootRef} className="inspector-navigation" tabIndex={0} role="listbox" aria-label="インスペクタ行" aria-activedescendant={activeId}>
          {status ? <div className="inspector-status-badges">{statusLabels(status).map((label) => <span key={label} className={`inspector-status ${label}`}>{label}</span>)}</div> : null}
          {infoRows.length > 0 ? <dl className="element-info-grid">{infoRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p className="empty-state">未評価です。</p>}
          {issues.length + parseIssues.length > 0 ? <div className="dependency-group"><h3 className="shortcut-group-title">診断</h3>{[...issues, ...parseIssues].map((issue, index) => <p key={`${issue.message}-${index}`} className={`inspector-diagnostic ${issue.severity}`}>{issue.message}</p>)}</div> : null}
          <div className="dependency-group"><h3 className="shortcut-group-title">親要素</h3>{dependencySummary?.parents.length ? dependencySummary.parents.map((parent) => parent.element ? null : <p key={parent.id} className="dependency-row unresolved">未解決: {parent.id}</p>) : <p className="empty-state">親要素はありません。</p>}</div>
          <div className="dependency-group"><h3 className="shortcut-group-title">依存・パラメーター</h3>{allRows.map((row) => <div
            key={row.key}
            id={`inspector-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
            ref={(node) => { if (node) rowRefs.current.set(row.key, node); else rowRefs.current.delete(row.key); }}
            role="option"
            aria-selected={row.key === activeRowKey}
            className={`inspector-row ${row.key === activeRowKey ? "is-active" : ""}`}
            onClick={() => { setActiveRow(row.key); activate(row); }}
          >
            <span className="inspector-row-main"><span>{row.label}</span><small>{row.kind === "parameter" ? row.value : row.detail}</small></span>
            {row.kind === "dependency" && row.issues.length > 0 ? <span className="dependency-issue-list">{row.issues.map((issue, index) => <span key={`${issue.message}-${index}`} className={`dependency-issue ${issue.severity}`}>{issue.message}</span>)}</span> : null}
          </div>)}</div>
        </div>
      )}
    </section>
  );
});
