import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, RefObject } from "react";
import { Folder, FolderOpen, Search, X } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { ElementEditor } from "./ElementEditor";
import { getDependencyJumpTargets, getDependencySummary } from "../model/dependencies";
import { elementSearchResults } from "../model/elementSearch";
import {
  descendantIdsForGroup,
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isGroupElement,
  subtreeIdsForElement,
  visibleOutlineElements
} from "../model/groups";
import {
  isPointElement,
  lineEndpointReferenceForAnchor,
  referenceAnchor,
  selectablePointsForElement
} from "../model/pointAnchors";
import {
  numericReferencePropertiesForGeometry,
  pickCandidates,
  resolvedPickCursor
} from "../model/pickCandidates";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { useCadStore } from "../state/useCadStore";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import {
  arcLineInfoRows,
  bezierCurveInfoRows,
  lineInfoRows,
  numericReferenceExpression,
  numericReferenceValue,
  offsetLineInfoRows,
  pointCoordinateRows
} from "./geometryDisplay";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
  elementSearchInputRef: RefObject<HTMLInputElement | null>;
};

type RightPanelProps = {
  evaluation: EvaluationResult;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

type NumericReferenceGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

const isComputedPoint = (geometry: ComputedGeometry | undefined): geometry is ComputedPoint =>
  geometry?.kind === "point";

const isComputedLine = (geometry: ComputedGeometry | undefined): geometry is ComputedLine =>
  geometry?.kind === "line";

const isComputedArcLine = (geometry: ComputedGeometry | undefined): geometry is ComputedArcLine =>
  geometry?.kind === "arcLine";

const isComputedBezierCurve = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedBezierCurve => geometry?.kind === "bezierCurve";

const isComputedOffsetLine = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedOffsetLine => geometry?.kind === "offsetLine";

const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine";

const formatDependencyCount = (count: number) => (count > 99 ? "99+" : `${count}`);

type ElementStatusIconKind = "visible" | "hidden" | "enabled" | "disabled";

const ElementStatusIcon = ({ kind }: { kind: ElementStatusIconKind }) => {
  return (
    <svg
      className={`element-status-icon element-status-icon-${kind}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "visible" ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.7" />
        </>
      ) : kind === "hidden" ? (
        <>
          <path d="M3.5 3.5l17 17" />
          <path d="M10.7 6.2A10.1 10.1 0 0 1 12 6c6 0 9.5 6 9.5 6a15.1 15.1 0 0 1-2.3 2.9" />
          <path d="M14.1 14.1A2.7 2.7 0 0 1 9.9 9.9" />
          <path d="M6.4 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6 9.5 6a9.9 9.9 0 0 0 4.1-.9" />
        </>
      ) : kind === "enabled" ? (
        <path d="M5 12.5l4.2 4.2L19 6.8" />
      ) : (
        <>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </>
      )}
    </svg>
  );
};

type ElementDropTarget = {
  elementId: ElementId;
  insertionIndex: number;
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
          : isComputedArcLine(geometry)
            ? arcLineInfoRows(geometry)
            : isComputedBezierCurve(geometry)
              ? bezierCurveInfoRows(geometry)
              : isComputedOffsetLine(geometry)
                ? offsetLineInfoRows(geometry)
            : [];
  const selectDependency = (id: ElementId) => setSelectedElementId(id);
  const dependencyButtonClass = (id: ElementId) => {
    const jumpIndex = jumpTargetIndexes.get(id);
    return `dependency-row ${
      isDependencyJumpMode && jumpIndex === selectedDependencyJumpIndex ? "selected-dependency" : ""
    }`;
  };
  const dependencyNameWithCount = (name: string, count: number) => (
    <span className="dependency-primary">
      <span className="dependency-name">{name}</span>
      <span className="dependency-count-badge" aria-label={`関連要素 ${count} 件`}>
        {formatDependencyCount(count)}
      </span>
    </span>
  );

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
                      {dependencyNameWithCount(parent.element.name, parent.ancestorCount)}
                      <small>{elementTypeLabels[parent.element.type]}</small>
                    </button>
                  ) : (
                    <div key={`${parent.id}-${index}`} className="dependency-row unresolved">
                      {dependencyNameWithCount(parent.id, parent.ancestorCount)}
                      <small>未解決</small>
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
                    {dependencyNameWithCount(child.element.name, child.descendantCount)}
                    <small>{elementTypeLabels[child.element.type]}</small>
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
  elementListFocusRef,
  elementSearchInputRef
}: LeftPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedElementIds = useCadStore((state) => state.selectedElementIds);
  const elementSearchQuery = useCadStore((state) => state.elementSearchQuery);
  const elementSearchCursorId = useCadStore((state) => state.elementSearchCursorId);
  const elementSearchPickableOnly = useCadStore((state) => state.elementSearchPickableOnly);
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadStore((state) => state.activeLinePickTarget);
  const activePickCursor = useCadStore((state) => state.activePickCursor);
  const setElementSearchQuery = useCadStore((state) => state.setElementSearchQuery);
  const setElementSearchCursorId = useCadStore((state) => state.setElementSearchCursorId);
  const setElementSearchPickableOnly = useCadStore((state) => state.setElementSearchPickableOnly);
  const [draggedElementIds, setDraggedElementIds] = useState<ElementId[]>([]);
  const [dropTarget, setDropTarget] = useState<ElementDropTarget | null>(null);
  const rowRefs = useRef(new Map<ElementId, HTMLDivElement>());
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const warningElementIds = new Set(evaluation.warnings.map((warning) => warning.elementId));
  const selectedElementIdSet = new Set(selectedElementIds);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const outlineElements = visibleOutlineElements(elements);
  const isSearchActive = elementSearchQuery.trim().length > 0;
  const rawSearchResults = useMemo(
    () => elementSearchResults(elements, elementSearchQuery),
    [elements, elementSearchQuery]
  );
  const groupStates = groupStateByElementId(elements);
  const effectiveVisibleIds = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds(elements);
  const effectiveEnabledIds = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds(elements);
  const descendantIdsByGroupId = new Map(
    elements
      .filter(isGroupElement)
      .map((element) => [element.id, descendantIdsForGroup(elements, element.id)])
  );
  const groupIssueCounts = (elementId: ElementId) => {
    const descendantIds = descendantIdsByGroupId.get(elementId) ?? [];
    return {
      childCount: descendantIds.length,
      errorCount: descendantIds.filter((id) => errorElementIds.has(id)).length,
      warningCount: descendantIds.filter((id) => warningElementIds.has(id)).length
    };
  };
  const activePointPickTargetElement = activePointPickTarget
    ? elements.find((element) => element.id === activePointPickTarget.elementId)
    : null;
  const activePointPickTargetDefinition = activePointPickTargetElement && activePointPickTarget
    ? getParameterDefinitions(activePointPickTargetElement).find(
        (definition) => definition.key === activePointPickTarget.parameterKey
      )
    : null;
  const isLineEndpointPointPick =
    activePointPickTargetDefinition?.kind === "lineEndpointReference";
  const activeLinePickTargetElement = activeLinePickTarget
    ? elements.find((element) => element.id === activeLinePickTarget.elementId)
    : null;
  const activeLinePickParameterValue =
    activeLinePickTargetElement && activeLinePickTarget
      ? getParameterValue(activeLinePickTargetElement, activeLinePickTarget.parameterKey)
      : null;
  const activeLinePickSelectedLineIds = new Set<ElementId>(
    Array.isArray(activeLinePickParameterValue)
      ? (activeLinePickParameterValue as unknown[]).filter(
          (id): id is ElementId => typeof id === "string"
        )
      : []
  );
  const candidateList = pickCandidates(elements, evaluation, {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  });
  const candidateByElementId = new Map(
    candidateList.map((candidate) => [candidate.elementId, candidate])
  );
  const selectedPickCursor = resolvedPickCursor(candidateList, activePickCursor);
  const selectablePointOptions = (element: CadElement) => {
    const rawSelectablePoints = selectablePointsForElement(
      element,
      evaluation.computedGeometry,
      elementsById
    );
    return isLineEndpointPointPick
      ? rawSelectablePoints.filter((point) =>
          lineEndpointReferenceForAnchor(point.anchor, elements)
        )
      : rawSelectablePoints;
  };

  useEffect(() => {
    if (!selectedPickCursor) return;
    const row = rowRefs.current.get(selectedPickCursor.elementId);
    if (!row?.scrollIntoView) return;
    row.scrollIntoView({
      block: "nearest"
    });
  }, [selectedPickCursor]);

  const clearElementDrag = () => {
    setDraggedElementIds([]);
    setDropTarget(null);
  };
  const isNoopDrop = (elementIds: ElementId[], insertionIndex: number) => {
    const movingIds = elementIds.flatMap((id) => subtreeIdsForElement(elements, id));
    const indexes = elements
      .map((element, index) => (movingIds.includes(element.id) ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length === 0) return true;
    const minIndex = indexes[0];
    const maxIndex = indexes[indexes.length - 1];
    return insertionIndex >= minIndex && insertionIndex <= maxIndex + 1;
  };
  const dragElementIds = (event: DragEvent<HTMLElement>) => {
    if (draggedElementIds.length > 0) return draggedElementIds;
    const ids = event.dataTransfer.getData("application/x-nuinui-element-ids");
    if (ids) return ids.split(",").filter(Boolean);
    const id = event.dataTransfer.getData("application/x-nuinui-element-id");
    return id ? [id] : [];
  };
  const rowInsertionIndex = (event: DragEvent<HTMLElement>, element: CadElement, rowIndex: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const isAfter = event.clientY >= rect.top + rect.height / 2;
    if (isAfter && isGroupElement(element)) {
      const subtreeIds = subtreeIdsForElement(elements, element.id);
      const indexes = elements
        .map((item, index) => (subtreeIds.includes(item.id) ? index : -1))
        .filter((index) => index >= 0);
      return (indexes.at(-1) ?? rowIndex) + 1;
    }
    return rowIndex + (isAfter ? 1 : 0);
  };
  const updateDropTarget = (event: DragEvent<HTMLElement>, element: CadElement, rowIndex: number) => {
    const elementIds = dragElementIds(event);
    if (elementIds.length === 0 || elementIds.includes(element.id)) {
      setDropTarget(null);
      return;
    }

    const insertionIndex = rowInsertionIndex(event, element, rowIndex);
    if (isNoopDrop(elementIds, insertionIndex)) {
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ elementId: element.id, insertionIndex });
  };
  const dropMarkerClass = (elementId: ElementId, insertionIndex: number, position: "before" | "after") =>
    dropTarget?.elementId === elementId && dropTarget.insertionIndex === insertionIndex
      ? ` drop-${position}`
      : "";
  const selectElement = (elementId: ElementId, event: MouseEvent<HTMLElement>) => {
    if (activeLinePickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (
        element &&
        isLineLikeElement(element) &&
        element.id !== activeLinePickTarget.elementId &&
        !activeLinePickSelectedLineIds.has(element.id)
      ) {
        dispatchCommand("applyPickedLine", { pickedLineId: element.id });
      }
      return;
    }
    if (activePointPickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (!isLineEndpointPointPick && element && isPointElement(element)) {
        dispatchCommand("applyPickedPoint", { pickedPointAnchor: referenceAnchor(element.id) });
      }
      return;
    }
    if (activeNumericReferencePickTarget) {
      return;
    }
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    });
  };
  const numericReferenceGeometry = (elementId: ElementId) => {
    const geometry = evaluation.computedGeometry.get(elementId);
    return isComputedLine(geometry) ||
      isComputedArcLine(geometry) ||
      isComputedBezierCurve(geometry) ||
      isComputedOffsetLine(geometry)
      ? geometry
      : null;
  };
  const applyNumericReference = (
    geometry: NumericReferenceGeometry,
    property: ReturnType<typeof numericReferencePropertiesForGeometry>[number]
  ) => {
    dispatchCommand("applyPickedNumericReference", {
      numericReferenceExpression: numericReferenceExpression(geometry, property)
    });
  };
  const isSearchPickableElement = (element: CadElement) => {
    if (activeLinePickTarget) {
      return (
        isLineLikeElement(element) &&
        element.id !== activeLinePickTarget.elementId &&
        !activeLinePickSelectedLineIds.has(element.id)
      );
    }
    if (activeNumericReferencePickTarget) {
      return numericReferenceGeometry(element.id) !== null;
    }
    if (activePointPickTarget) {
      return (!isLineEndpointPointPick && isPointElement(element)) || selectablePointOptions(element).length > 0;
    }
    return true;
  };
  const searchResults = rawSearchResults.filter(
    (result) => !elementSearchPickableOnly || isSearchPickableElement(result.element)
  );
  const displayedElements = isSearchActive ? searchResults.map((result) => result.element) : outlineElements;
  const searchResultByElementId = new Map(searchResults.map((result) => [result.element.id, result]));
  const activeSearchCursorId =
    isSearchActive && searchResults.some((result) => result.element.id === elementSearchCursorId)
      ? elementSearchCursorId
      : searchResults[0]?.element.id ?? null;
  const moveSearchCursor = (offset: 1 | -1) => {
    if (searchResults.length === 0) {
      setElementSearchCursorId(null);
      return;
    }
    const currentIndex = activeSearchCursorId
      ? searchResults.findIndex((result) => result.element.id === activeSearchCursorId)
      : -1;
    const nextIndex =
      currentIndex < 0
        ? offset > 0 ? 0 : searchResults.length - 1
        : (currentIndex + offset + searchResults.length) % searchResults.length;
    setElementSearchCursorId(searchResults[nextIndex].element.id);
  };
  const applySearchResult = (element: CadElement) => {
    if (activeLinePickTarget) {
      if (isSearchPickableElement(element)) {
        dispatchCommand("applyPickedLine", { pickedLineId: element.id });
      }
      return;
    }
    if (activePointPickTarget) {
      if (!isLineEndpointPointPick && isPointElement(element)) {
        dispatchCommand("applyPickedPoint", { pickedPointAnchor: referenceAnchor(element.id) });
        return;
      }
      const point = selectablePointOptions(element)[0];
      if (point) {
        dispatchCommand("applyPickedPoint", { pickedPointAnchor: point.anchor });
      }
      return;
    }
    if (activeNumericReferencePickTarget) {
      const geometry = numericReferenceGeometry(element.id);
      const property = geometry ? numericReferencePropertiesForGeometry(geometry)[0] : null;
      if (geometry && property) applyNumericReference(geometry, property);
      return;
    }
    dispatchCommand("selectElement", { elementId: element.id });
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSearchCursor(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchCursor(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults.find((item) => item.element.id === activeSearchCursorId) ?? searchResults[0];
      if (result) applySearchResult(result.element);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (elementSearchQuery) {
        setElementSearchQuery("");
        return;
      }
      event.currentTarget.blur();
    }
  };

  useEffect(() => {
    if (!activeSearchCursorId) return;
    const row = rowRefs.current.get(activeSearchCursorId);
    if (!row?.scrollIntoView) return;
    row.scrollIntoView({
      block: "nearest"
    });
  }, [activeSearchCursorId]);

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
      </header>

      <section className="panel-section element-list-section">
        <div className="section-header">
          <div>
            <h2>構成リスト</h2>
            <p className={`section-subtitle ${
              activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget
                ? "point-pick-list-subtitle"
                : ""
            }`}>
              {activePointPickTarget
                ? "点選択中: 点の行だけ選択できます"
                : activeNumericReferencePickTarget
                  ? "数値選択中: 線と曲線の行だけ選択できます"
                  : activeLinePickTarget
                    ? "線選択中: 線と曲線の行だけ選択できます"
                : "gで戻る / Enterで要素設定"}
            </p>
          </div>
        </div>

        <div className={`element-search ${isSearchActive ? "is-searching" : ""}`}>
          <Search className="element-search-icon" aria-hidden="true" />
          <input
            ref={elementSearchInputRef}
            value={elementSearchQuery}
            placeholder="名前 / ID / 型 / 番号で検索"
            aria-label="要素を検索"
            onChange={(event) => setElementSearchQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {isSearchActive ? (
            <button
              type="button"
              className="element-search-clear"
              aria-label="要素検索をクリア"
              onClick={() => {
                setElementSearchQuery("");
                elementSearchInputRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </button>
          ) : (
            <kbd>Mod+F</kbd>
          )}
        </div>

        <div className="element-search-status">
          <span>
            {isSearchActive
              ? `${searchResults.length} / ${rawSearchResults.length} 件`
              : `${elements.length} 件`}
          </span>
          {isSearchActive ? <span className="search-mode-badge">検索中</span> : null}
          {activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget ? (
            <label className="search-pickable-toggle">
              <input
                type="checkbox"
                checked={elementSearchPickableOnly}
                onChange={(event) => setElementSearchPickableOnly(event.target.checked)}
              />
              選択可能のみ
            </label>
          ) : null}
        </div>

        <div
          className="element-list"
          ref={elementListFocusRef}
          tabIndex={-1}
          data-element-list="true"
          aria-label="要素リスト"
        >
          {displayedElements.map((element) => {
            const index = elements.findIndex((item) => item.id === element.id);
            const searchResult = searchResultByElementId.get(element.id);
            const groupState = groupStates.get(element.id);
            const depth = groupState?.depth ?? 0;
            const hiddenByGroup = Boolean(groupState?.hiddenByGroupId);
            const disabledByGroup = Boolean(groupState?.disabledByGroupId);
            const isEffectivelyVisible = effectiveVisibleIds.has(element.id);
            const isEffectivelyEnabled = effectiveEnabledIds.has(element.id);
            const groupIssues = isGroupElement(element) ? groupIssueCounts(element.id) : null;
            const hasError = errorElementIds.has(element.id) || Boolean(groupIssues?.errorCount);
            const hasWarning = warningElementIds.has(element.id) || Boolean(groupIssues?.warningCount);
            const selectablePoints = selectablePointOptions(element);
            const isPointPickCandidate =
              activePointPickTarget &&
              ((!isLineEndpointPointPick && isPointElement(element)) || selectablePoints.length > 0);
            const referenceGeometry = numericReferenceGeometry(element.id);
            const isNumericReferenceCandidate =
              Boolean(activeNumericReferencePickTarget) && referenceGeometry !== null;
            const isLinePickCandidate =
              Boolean(activeLinePickTarget) &&
              isLineLikeElement(element) &&
              element.id !== activeLinePickTarget?.elementId &&
              !activeLinePickSelectedLineIds.has(element.id);
            const pickCandidate = candidateByElementId.get(element.id);
            const selectedPickOptionIndex =
              selectedPickCursor?.elementId === element.id ? selectedPickCursor.optionIndex : -1;
            return (
            <div
              key={element.id}
              ref={(node) => {
                if (node) {
                  rowRefs.current.set(element.id, node);
                } else {
                  rowRefs.current.delete(element.id);
                }
              }}
              tabIndex={0}
              data-element-list-row="true"
              aria-selected={selectedPickOptionIndex >= 0 || activeSearchCursorId === element.id}
              className={`element-row ${selectedElementIdSet.has(element.id) ? "selected" : ""} ${
                element.id === selectedElementId ? "primary-selected" : ""
              } ${!isEffectivelyVisible ? "is-hidden" : ""} ${
                !isEffectivelyEnabled ? "is-disabled" : ""
              } ${
                hasError ? "has-error" : ""
              } ${
                hasWarning ? "has-warning" : ""
              } ${
                isGroupElement(element) ? "is-group" : ""
              } ${
                hiddenByGroup ? "is-hidden-by-group" : ""
              } ${
                disabledByGroup ? "is-disabled-by-group" : ""
              } ${activePointPickTarget ? "is-point-pick-mode" : ""} ${
                isPointPickCandidate ? "is-point-pick-candidate" : ""
              } ${
                activePointPickTarget && !isPointPickCandidate ? "is-not-point-pick-candidate" : ""
              } ${activeNumericReferencePickTarget ? "is-numeric-reference-pick-mode" : ""} ${
                isNumericReferenceCandidate ? "is-numeric-reference-pick-candidate" : ""
              } ${
                activeNumericReferencePickTarget && !isNumericReferenceCandidate
                  ? "is-not-numeric-reference-pick-candidate"
                  : ""
              } ${activeLinePickTarget ? "is-line-pick-mode" : ""} ${
                isLinePickCandidate ? "is-line-pick-candidate" : ""
              } ${
                activeLinePickTarget && !isLinePickCandidate
                  ? "is-not-line-pick-candidate"
                  : ""
              } ${
                selectedPickOptionIndex >= 0 ? "selected-pick-candidate" : ""
              } ${
                isSearchActive && activeSearchCursorId === element.id ? "search-cursor" : ""
              } ${
                isSearchActive && !isSearchPickableElement(element) ? "is-not-search-pickable" : ""
              } ${
                draggedElementIds.includes(element.id) ? "dragging" : ""}${dropMarkerClass(
                element.id,
                index,
                "before"
              )}${dropMarkerClass(element.id, index + 1, "after")}`}
              aria-label={`${index + 1}. ${element.name}, ${elementTypeLabels[element.type]}, ${
                isEffectivelyVisible ? "表示" : "非表示"
              }, ${isEffectivelyEnabled ? "評価する" : "評価しない"}`}
              onClick={(event) => selectElement(element.id, event)}
              onDragOver={(event) => {
                if (isSearchActive) return;
                updateDropTarget(event, element, index);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTarget(null);
                }
              }}
              onDrop={(event) => {
                if (isSearchActive) return;
                const elementIds = dragElementIds(event);
                const insertionIndex =
                  dropTarget?.elementId === element.id
                    ? dropTarget.insertionIndex
                    : rowInsertionIndex(event, element, index);
                event.preventDefault();
                if (elementIds.length > 0 && !isNoopDrop(elementIds, insertionIndex)) {
                  dispatchCommand("moveElementToInsertionIndex", {
                    elementId: elementIds[0],
                    insertionIndex
                  });
                }
                clearElementDrag();
              }}
            >
              <span
                className="element-outline-indent"
                style={{ "--outline-depth": depth } as CSSProperties}
                aria-hidden="true"
              />
              {isGroupElement(element) ? (
                <button
                  type="button"
                  className="element-expand-button"
                  aria-label={`${element.name}を${element.expanded ? "折り畳む" : "展開"} `}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand("toggleGroupExpanded", { elementId: element.id });
                  }}
                >
                  {element.expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="element-expand-spacer" aria-hidden="true" />
              )}
              <span className="element-index">{index + 1}</span>
              <span
                className="element-status-icons"
                data-visible-state={element.visible ? "visible" : "hidden"}
                data-evaluation-state={element.enabled ? "enabled" : "disabled"}
              >
                <button
                  type="button"
                  className="element-status-button"
                  aria-label={`${element.name}を${element.visible ? "非表示" : "表示"}にする`}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand("toggleElementVisibility", { elementId: element.id });
                  }}
                >
                  <ElementStatusIcon kind={element.visible ? "visible" : "hidden"} />
                </button>
                <button
                  type="button"
                  className="element-status-button"
                  aria-label={`${element.name}を${element.enabled ? "評価しない" : "評価する"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand("toggleElementEnabled", { elementId: element.id });
                  }}
                >
                  <ElementStatusIcon kind={element.enabled ? "enabled" : "disabled"} />
                </button>
              </span>
              <span className="element-name">
                {hasError || hasWarning ? "⚠ " : ""}
                {element.name}
                {isSearchActive && searchResult?.parentGroupNames.length ? (
                  <small className="group-mask-label">{searchResult.parentGroupNames.join(" / ")}</small>
                ) : null}
                {hiddenByGroup ? <small className="group-mask-label">親で非表示</small> : null}
                {disabledByGroup ? <small className="group-mask-label">親で評価OFF</small> : null}
              </span>
              <span className="element-type">
                {isGroupElement(element) && groupIssues ? (
                  <span className="element-group-summary">
                    {element.expanded ? (
                      <FolderOpen className="element-group-icon" aria-hidden="true" />
                    ) : (
                      <Folder className="element-group-icon" aria-hidden="true" />
                    )}
                    <span>{groupIssues.childCount}件</span>
                    {groupIssues.errorCount > 0 ? <span>/ エラー{groupIssues.errorCount}</span> : null}
                    {groupIssues.warningCount > 0 ? <span>/ 警告{groupIssues.warningCount}</span> : null}
                  </span>
                ) : (
                  elementTypeLabels[element.type]
                )}
              </span>
              <button
                type="button"
                className="element-drag-handle"
                draggable={!isSearchActive}
                disabled={isSearchActive}
                aria-label={`${element.name}を並び替え`}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchCommand("selectElement", { elementId: element.id });
                }}
                onDragStart={(event) => {
                  if (isSearchActive) {
                    event.preventDefault();
                    return;
                  }
                  const movingIds = selectedElementIdSet.has(element.id) ? selectedElementIds : [element.id];
                  if (!selectedElementIdSet.has(element.id)) {
                    dispatchCommand("selectElement", { elementId: element.id });
                  }
                  setDraggedElementIds(movingIds);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-nuinui-element-id", element.id);
                  event.dataTransfer.setData("application/x-nuinui-element-ids", movingIds.join(","));
                  event.dataTransfer.setData("text/plain", element.name);
                }}
                onDragEnd={clearElementDrag}
              >
                <span aria-hidden="true">::</span>
              </button>
              {activePointPickTarget && selectablePoints.length > 0 ? (
                <div className="element-point-pick-actions">
                  {selectablePoints.map((point) => (
                    <button
                      key={`${point.anchor.mode}-${point.label}`}
                      type="button"
                      className={
                        pickCandidate?.options[selectedPickOptionIndex]?.kind === "point" &&
                        pickCandidate.options[selectedPickOptionIndex].label === point.label
                          ? "selected-pick-option"
                          : ""
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatchCommand("applyPickedPoint", {
                          pickedPointAnchor: point.anchor
                        });
                      }}
                    >
                      {point.label.includes(".") ? point.label.split(".").at(-1) : "点"}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeNumericReferencePickTarget && referenceGeometry ? (
                <div className="element-numeric-reference-actions">
                  {numericReferencePropertiesForGeometry(referenceGeometry).map((property, optionIndex) => (
                    <button
                      key={property}
                      type="button"
                      className={
                        selectedPickOptionIndex === optionIndex ? "selected-pick-option" : ""
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        applyNumericReference(referenceGeometry, property);
                      }}
                    >
                      <span>{lineMeasurementLabel(property)}</span>
                      <small>{numericReferenceValue(referenceGeometry, property)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
          })}
        </div>

        <div className="button-row reorder-row">
          <button type="button" disabled={isSearchActive} onClick={() => dispatchCommand("moveSelectedElementUp")}>
            上へ
          </button>
          <button type="button" disabled={isSearchActive} onClick={() => dispatchCommand("moveSelectedElementDown")}>
            下へ
          </button>
          <button type="button" onClick={() => dispatchCommand("toggleSelectedElementVisibility")}>
            表示切替
          </button>
          <button type="button" onClick={() => dispatchCommand("toggleSelectedElementEnabled")}>
            評価切替
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
  const selectedDependencyJumpIndex = useCadStore((state) => state.selectedDependencyJumpIndex);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcutHint = isParameterEditMode || isDependencyJumpMode
    ? "Esc で終了 / ? でショートカット"
    : "? でショートカット";

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
        {evaluation.errors.length === 0 && evaluation.warnings.length === 0 ? (
          <p className="empty-state">エラーや警告はありません。</p>
        ) : (
          <ul className="error-list">
            {evaluation.errors.map((error) => (
              <li key={`${error.elementId}-${error.missingDependencyId}`}>
                <strong>{error.elementName}</strong>
                <span>{error.message}</span>
              </li>
            ))}
            {evaluation.warnings.map((warning, index) => (
              <li key={`${warning.elementId}-warning-${index}`} className="warning-item">
                <strong>{warning.elementName}</strong>
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <div className="section-header">
          <h2>ショートカット</h2>
          <button
            type="button"
            aria-label="ショートカット一覧を表示"
            onClick={() => dispatchCommand("toggleShortcutHelp")}
          >
            ?
          </button>
        </div>
        <p className="empty-state">{shortcutHint}</p>
      </section>

    </aside>
  );
};
