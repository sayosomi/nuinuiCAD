import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, RefObject } from "react";
import { Search, X } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { fileNameFromPath } from "../document/documentFormat";
import {
  isPointElement,
  referenceAnchor
} from "../model/pointAnchors";
import { descendantIdsForGroup, isConditionalGroupElement, isForGroupElement } from "../model/groups";
import {
  numericReferenceGeometrySupportsProperty,
  type NumericReferenceGeometry
} from "../geometry/numericReferenceProperties";
import { lineMeasurementLabel, type NumericMeasurementKey } from "../geometry/numericExpressions";
import { resolvedElementColorMap } from "../palette/elementColors";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  ForGroupElement,
  ForGroupGeneratedRow
} from "../types/geometry";
import { elementCategoryLabels, elementTypeCategories, elementTypeLabels } from "../types/geometry";
import {
  numericReferenceExpression,
} from "./geometryDisplay";
import { ElementListRow } from "./ElementListRow";
import { PalettePanel } from "./PalettePanel";
import {
  elementListAutoScrollDelta,
  elementListDropTargetForClientY,
  isNoopElementDrop,
  type ElementListPointerDrag
} from "./elementListPointerDrag";
import { useElementListData } from "./useElementListData";
export { RightPanel } from "./RightPanel";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
  elementSearchInputRef: RefObject<HTMLInputElement | null>;
};

const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "cornerRadiusArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine" ||
  element.type === "splitLine" ||
  element.type === "copyLine" ||
  element.type === "symmetricCopyLine";

type EvaluationDividerRowProps = {
  evaluationLimitIndex: number;
  evaluatedCount: number;
  totalCount: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
};

const moveEvaluationDividerToIndex = (evaluationLimitIndex: number) => {
  dispatchCommand("setEvaluationLimitIndex", { evaluationLimitIndex });
};

const EvaluationDividerRow = ({
  evaluationLimitIndex,
  evaluatedCount,
  totalCount,
  isDragging,
  isDropTarget,
  onPointerDown
}: EvaluationDividerRowProps) => (
  <div
    className={`evaluation-divider-row ${isDragging ? "dragging" : ""} ${
      isDropTarget ? "drop-target" : ""
    }`}
    tabIndex={0}
    role="separator"
    aria-orientation="horizontal"
    data-evaluation-divider="true"
    aria-label={`評価区切り線。${totalCount}件中${evaluatedCount}件を評価。上下矢印で移動、Shift+上下矢印で10件移動、Homeで先頭、Endで末尾`}
    onKeyDown={(event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveEvaluationDividerToIndex(evaluationLimitIndex - (event.shiftKey ? 10 : 1));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveEvaluationDividerToIndex(evaluationLimitIndex + (event.shiftKey ? 10 : 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        moveEvaluationDividerToIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        moveEvaluationDividerToIndex(totalCount);
      }
    }}
    onPointerDown={onPointerDown}
  >
    <button
      type="button"
      className="evaluation-divider-button"
      aria-label="評価区切り線を上へ"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => dispatchCommand("moveEvaluationDividerUp")}
    >
      ↑
    </button>
    <span className="evaluation-divider-line" aria-hidden="true" />
    <span className="evaluation-divider-label">
      ここまで評価
      <small>{evaluationLimitIndex} / {totalCount}</small>
    </span>
    <span className="evaluation-divider-line" aria-hidden="true" />
    <button
      type="button"
      className="evaluation-divider-button"
      aria-label="評価区切り線を下へ"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => dispatchCommand("moveEvaluationDividerDown")}
    >
      ↓
    </button>
  </div>
);

const ElseDividerRow = ({ depth }: { depth: number }) => (
  <div className="element-else-row">
    <span
      className="element-outline-indent"
      style={{ "--outline-depth": Math.max(depth, 0) } as CSSProperties}
      aria-hidden="true"
    />
    <span className="element-expand-spacer" aria-hidden="true" />
    <span className="element-index" aria-hidden="true" />
    <span className="element-else-label">else</span>
  </div>
);

const ForSectionDividerRow = ({
  depth,
  label
}: {
  depth: number;
  label: string;
}) => (
  <div className="element-for-section-row">
    <span
      className="element-outline-indent"
      style={{ "--outline-depth": Math.max(depth, 0) } as CSSProperties}
      aria-hidden="true"
    />
    <span className="element-expand-spacer" aria-hidden="true" />
    <span className="element-index" aria-hidden="true" />
    <span className="element-for-section-label">{label}</span>
  </div>
);

const ForGeneratedPreviewRow = ({
  row,
  depth
}: {
  row: ForGroupGeneratedRow;
  depth: number;
}) => (
  <div
    className="element-generated-row"
    aria-label={`${row.variableName}=${row.variableValue} の生成結果 ${row.elementName}`}
  >
    <span
      className="element-outline-indent"
      style={{ "--outline-depth": Math.max(depth, 0) } as CSSProperties}
      aria-hidden="true"
    />
    <span className="element-expand-spacer" aria-hidden="true" />
    <span className="element-index" aria-hidden="true" />
    <span className="element-status-icons" aria-hidden="true" />
    <span className="element-name">{row.elementName}</span>
    <span className="element-type">
      {elementCategoryLabels[elementTypeCategories[row.elementType]]} / {elementTypeLabels[row.elementType]}
    </span>
    <span className="element-drag-handle" aria-hidden="true" />
  </div>
);

export const LeftPanel = ({
  evaluation,
  elementListFocusRef,
  elementSearchInputRef
}: LeftPanelProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const palette = useCadDocumentStore((state) => state.palette);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const selectedElementId = useCadDocumentStore((state) => state.selectedElementId);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
  const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
  const dirtySinceSave = useCadDocumentStore((state) => state.dirtySinceSave);
  const elementSearchQuery = useCadUiStore((state) => state.elementSearchQuery);
  const elementSearchCursorId = useCadUiStore((state) => state.elementSearchCursorId);
  const elementSearchPickableOnly = useCadUiStore((state) => state.elementSearchPickableOnly);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const activePickCursor = useCadUiStore((state) => state.activePickCursor);
  const setElementSearchQuery = useCadUiStore((state) => state.setElementSearchQuery);
  const setElementSearchCursorId = useCadUiStore((state) => state.setElementSearchCursorId);
  const setElementSearchPickableOnly = useCadUiStore((state) => state.setElementSearchPickableOnly);
  const [pointerDrag, setPointerDrag] = useState<ElementListPointerDrag | null>(null);
  const rowRefs = useRef(new Map<ElementId, HTMLDivElement>());
  const pointerDragRef = useRef<ElementListPointerDrag | null>(null);
  const pointerDragClientYRef = useRef<number | null>(null);
  const selectedElementIdSet = new Set(selectedElementIds);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const elementColors = useMemo(
    () => resolvedElementColorMap(elements, palette),
    [elements, palette]
  );
  const generatedRowsByForGroupId = new Map<ElementId, ForGroupGeneratedRow[]>();
  for (const row of evaluation.forGroupGeneratedRows ?? []) {
    generatedRowsByForGroupId.set(row.forGroupId, [
      ...(generatedRowsByForGroupId.get(row.forGroupId) ?? []),
      row
    ]);
  }
  const firstVisibleChildForGroupId = (forGroupId: ElementId) =>
    displayedElements.find((element) => element.parentGroupId === forGroupId)?.id ?? null;
  const lastVisibleDescendantForGroupId = (forGroupId: ElementId) => {
    const descendantIds = new Set(descendantIdsForGroup(elements, forGroupId));
    for (let index = displayedElements.length - 1; index >= 0; index -= 1) {
      if (descendantIds.has(displayedElements[index].id)) return displayedElements[index].id;
    }
    return null;
  };
  const generatedPreviewOwnerAfter = (element: CadElement): ForGroupElement | null => {
    if (isSearchActive) return null;
    if (isForGroupElement(element)) {
      return lastVisibleDescendantForGroupId(element.id) ? null : element;
    }
    return elements.find((candidate): candidate is ForGroupElement =>
      isForGroupElement(candidate) &&
      candidate.showGenerated &&
      lastVisibleDescendantForGroupId(candidate.id) === element.id
    ) ?? null;
  };
  const draggedElementIds = pointerDrag?.kind === "elements" ? pointerDrag.movingIds : [];
  const isDividerDragging = pointerDrag?.kind === "divider";
  const isPointerDragging = pointerDrag !== null;
  const dropTarget = pointerDrag?.target ?? null;
  const evaluatedElementIdSet =
    evaluation.evaluatedElementIds ?? new Set(elements.map((element) => element.id));
  const {
    rawSearchResults,
    searchResults,
    displayedElements,
    activeSearchCursorId,
    selectedPickCursor,
    isSearchActive,
    isLineEndpointPointPick,
    activeLinePickSelectedLineIds,
    selectablePointOptions,
    numericReferenceGeometry,
    isSearchPickableElement,
    getRowData
  } = useElementListData({
    elements,
    evaluation,
    elementSearchQuery,
    elementSearchCursorId,
    elementSearchPickableOnly,
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    activePickCursor
  });
  const generatedSearchRows = isSearchActive
    ? Array.from(generatedRowsByForGroupId.values())
        .flat()
        .filter((row) => {
          const owner = elementsById.get(row.forGroupId);
          if (!owner || !isForGroupElement(owner) || !owner.showGenerated) return false;
          const query = elementSearchQuery.trim().toLowerCase();
          const typeLabel = `${elementCategoryLabels[elementTypeCategories[row.elementType]]} ${elementTypeLabels[row.elementType]}`;
          return [
            row.generatedElementId,
            row.elementName,
            row.variableName,
            `${row.variableValue}`,
            typeLabel
          ].some((value) => value.toLowerCase().includes(query));
        })
    : [];

  useEffect(() => {
    if (!selectedPickCursor) return;
    const row = rowRefs.current.get(selectedPickCursor.elementId);
    if (!row?.scrollIntoView) return;
    row.scrollIntoView({
      block: "nearest"
    });
  }, [selectedPickCursor]);

  useEffect(() => {
    pointerDragRef.current = pointerDrag;
  }, [pointerDrag]);

  const clearPointerDrag = () => setPointerDrag(null);
  const dropMarkerClass = (
    elementId: ElementId,
    rowIndex: number,
    position: "before" | "after"
  ) => {
    if (dropTarget?.elementId !== elementId) return "";
    if (position === "before" && dropTarget.insertionIndex === rowIndex) return " drop-before";
    if (position === "after" && dropTarget.insertionIndex !== rowIndex) return " drop-after";
    return "";
  };
  const startElementPointerDrag = (
    event: PointerEvent<HTMLButtonElement>,
    rowElement: CadElement
  ) => {
    if (event.button !== 0 || isSearchActive) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const movingIds = selectedElementIdSet.has(rowElement.id) ? selectedElementIds : [rowElement.id];
    if (!selectedElementIdSet.has(rowElement.id)) {
      dispatchCommand("selectElement", { elementId: rowElement.id });
    }
    setPointerDrag({
      kind: "elements",
      pointerId: event.pointerId,
      movingIds,
      sourceElementId: rowElement.id,
      target: null
    });
    pointerDragClientYRef.current = event.clientY;
  };
  const startDividerPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isSearchActive) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPointerDrag({
      kind: "divider",
      pointerId: event.pointerId,
      target: null
    });
    pointerDragClientYRef.current = event.clientY;
  };
  const selectElement = (elementId: ElementId, event: MouseEvent<HTMLElement>) => {
    if (activeLinePickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (
        element &&
        evaluatedElementIdSet.has(element.id) &&
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
      if (
        !isLineEndpointPointPick &&
        element &&
        evaluatedElementIdSet.has(element.id) &&
        isPointElement(element)
      ) {
        dispatchCommand("applyPickedPoint", { pickedPointAnchor: referenceAnchor(element.id) });
      }
      return;
    }
    if (activeNumericReferencePickTarget) {
      const property = activeNumericReferencePickTarget.property;
      const geometry = numericReferenceGeometry(elementId);
      if (geometry && numericReferenceGeometrySupportsProperty(geometry, property)) {
        applyNumericReference(geometry, property);
      }
      return;
    }
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    });
  };
  const applyNumericReference = (
    geometry: NumericReferenceGeometry,
    property: NumericMeasurementKey
  ) => {
    dispatchCommand("applyPickedNumericReference", {
      numericReferenceExpression: numericReferenceExpression(geometry, property)
    });
  };
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
      const property = activeNumericReferencePickTarget.property;
      if (geometry && numericReferenceGeometrySupportsProperty(geometry, property)) {
        applyNumericReference(geometry, property);
      }
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

  useEffect(() => {
    if (!isPointerDragging) return;
    let animationFrameId: number | null = null;

    const refreshDropTarget = (clientY: number) => {
      const target = elementListDropTargetForClientY(elements, rowRefs.current, clientY);
      setPointerDrag((currentDrag) => {
        if (!currentDrag) return currentDrag;
        if (
          currentDrag.kind === "elements" &&
          target &&
          isNoopElementDrop(elements, currentDrag.movingIds, target.insertionIndex)
        ) {
          return { ...currentDrag, target: null };
        }
        return { ...currentDrag, target };
      });
    };

    const stopAutoScroll = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      pointerDragClientYRef.current = null;
    };

    const autoScroll = () => {
      const list = elementListFocusRef.current;
      const clientY = pointerDragClientYRef.current;
      if (list && clientY !== null) {
        const delta = elementListAutoScrollDelta(list.getBoundingClientRect(), clientY);
        if (delta !== 0) {
          list.scrollTop += delta;
          refreshDropTarget(clientY);
        }
      }
      animationFrameId = requestAnimationFrame(autoScroll);
    };

    animationFrameId = requestAnimationFrame(autoScroll);

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      pointerDragClientYRef.current = event.clientY;
      refreshDropTarget(event.clientY);
    };
    const onPointerUp = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const target = drag.target;
      if (target) {
        if (drag.kind === "divider") {
          dispatchCommand("setEvaluationLimitIndex", {
            evaluationLimitIndex: target.insertionIndex
          });
        } else if (!isNoopElementDrop(elements, drag.movingIds, target.insertionIndex)) {
          dispatchCommand("moveElementToInsertionIndex", {
            elementId: drag.movingIds[0],
            insertionIndex: target.insertionIndex
          });
        }
      }
      stopAutoScroll();
      clearPointerDrag();
    };
    const onPointerCancel = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      stopAutoScroll();
      clearPointerDrag();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stopAutoScroll();
      clearPointerDrag();
    };
    const onBlur = () => {
      stopAutoScroll();
      clearPointerDrag();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      stopAutoScroll();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [isPointerDragging, elements, elementListFocusRef]);

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
        <p className="document-status" title={currentFilePath ?? "未保存"}>
          <span>{fileNameFromPath(currentFilePath)}</span>
          {dirtySinceSave ? <span className="document-dirty">未保存の変更</span> : null}
        </p>
      </header>

      <PalettePanel />

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
                  ? `数値選択中: ${lineMeasurementLabel(activeNumericReferencePickTarget.property)}を持つ線と曲線だけ選択できます`
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
              : `${evaluationLimitIndex} / ${elements.length} 件を評価`}
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
          {displayedElements.flatMap((element, displayIndex) => {
            const rowData = getRowData(element);
            const parent = element.parentGroupId
              ? elementsById.get(element.parentGroupId)
              : null;
            const forParent = parent && isForGroupElement(parent) ? parent : null;
            const insertForTemplateDivider =
              !isSearchActive &&
              forParent &&
              forParent.expanded &&
              firstVisibleChildForGroupId(forParent.id) === element.id;
            const insertElseDivider =
              !isSearchActive &&
              element.conditionalBranch === "else" &&
              parent &&
              isConditionalGroupElement(parent) &&
              !displayedElements
                .slice(0, displayIndex)
                .some((item) => item.parentGroupId === parent.id && item.conditionalBranch === "else");
            const dividerBeforeRow =
              !isSearchActive &&
              rowData.index >= evaluationLimitIndex &&
              !displayedElements.some((item) => {
                const itemIndex = elements.findIndex((candidate) => candidate.id === item.id);
                return itemIndex >= evaluationLimitIndex && itemIndex < rowData.index;
              });
            const rows = [];
            if (dividerBeforeRow) {
              rows.push(
                <EvaluationDividerRow
                  key="evaluation-divider"
                  evaluationLimitIndex={evaluationLimitIndex}
                  evaluatedCount={evaluationLimitIndex}
                  totalCount={elements.length}
                  isDragging={isDividerDragging}
                  isDropTarget={
                    pointerDrag?.kind === "elements" &&
                    pointerDrag.target?.insertionIndex === evaluationLimitIndex
                  }
                  onPointerDown={startDividerPointerDrag}
                />
              );
            }
            if (insertElseDivider) {
              rows.push(<ElseDividerRow key={`${parent.id}:else`} depth={rowData.depth} />);
            }
            if (insertForTemplateDivider) {
              rows.push(
                <ForSectionDividerRow
                  key={`${forParent.id}:template`}
                  depth={rowData.depth}
                  label="テンプレート"
                />
              );
            }
            rows.push(
              <ElementListRow
                key={element.id}
                element={element}
                index={rowData.index}
                rowRef={(node) => {
                  if (node) {
                    rowRefs.current.set(element.id, node);
                  } else {
                    rowRefs.current.delete(element.id);
                  }
                }}
                depth={rowData.depth}
                selectedElementId={selectedElementId}
                selectedElementIdSet={selectedElementIdSet}
                isEffectivelyVisible={rowData.isEffectivelyVisible}
                isEffectivelyEnabled={rowData.isEffectivelyEnabled}
                isEvaluated={rowData.isEvaluated}
                hiddenByGroup={rowData.hiddenByGroup}
                disabledByGroup={rowData.disabledByGroup}
                conditionInactive={rowData.conditionInactive}
                hasError={rowData.hasError}
                hasWarning={rowData.hasWarning}
                groupIssues={rowData.groupIssues}
                selectablePoints={rowData.selectablePoints}
                pickCandidate={rowData.pickCandidate}
                selectedPickOptionIndex={rowData.selectedPickOptionIndex}
                activeSearchCursorId={activeSearchCursorId}
                isSearchActive={isSearchActive}
                isSearchPickable={rowData.isSearchPickable}
                searchParentGroupNames={rowData.searchParentGroupNames}
                isPointPickMode={Boolean(activePointPickTarget)}
                isPointPickCandidate={rowData.isPointPickCandidate}
                isNumericReferencePickMode={Boolean(activeNumericReferencePickTarget)}
                isNumericReferenceCandidate={rowData.isNumericReferenceCandidate}
                isLinePickMode={Boolean(activeLinePickTarget)}
                isLinePickCandidate={rowData.isLinePickCandidate}
                isDragging={draggedElementIds.includes(element.id)}
                dropBefore={dropMarkerClass(element.id, rowData.index, "before") !== ""}
                dropAfter={dropMarkerClass(element.id, rowData.index, "after") !== ""}
                elementColor={elementColors.get(element.id) ?? "#31322f"}
                onSelectElement={selectElement}
                onHandlePointerDown={startElementPointerDrag}
              />
            );
            const forGeneratedAfterElement = generatedPreviewOwnerAfter(element);
            if (
              forGeneratedAfterElement &&
              forGeneratedAfterElement.showGenerated &&
              forGeneratedAfterElement.expanded
            ) {
              const generatedRows = generatedRowsByForGroupId.get(forGeneratedAfterElement.id) ?? [];
              const generatedDepth =
                (getRowData(forGeneratedAfterElement).depth ?? rowData.depth) + 1;
              rows.push(
                <ForSectionDividerRow
                  key={`${forGeneratedAfterElement.id}:generated`}
                  depth={generatedDepth}
                  label="生成結果"
                />
              );
              rows.push(
                ...generatedRows.map((generatedRow) => (
                  <ForGeneratedPreviewRow
                    key={generatedRow.generatedElementId}
                    row={generatedRow}
                    depth={generatedDepth + 1}
                  />
                ))
              );
            }
            return rows;
          })}
          {isSearchActive && generatedSearchRows.length > 0 ? (
            <>
              <ForSectionDividerRow key="generated-search" depth={0} label="生成結果" />
              {generatedSearchRows.map((generatedRow) => (
                <ForGeneratedPreviewRow
                  key={generatedRow.generatedElementId}
                  row={generatedRow}
                  depth={1}
                />
              ))}
            </>
          ) : null}
          {!isSearchActive && evaluationLimitIndex >= elements.length ? (
            <EvaluationDividerRow
              key="evaluation-divider"
              evaluationLimitIndex={evaluationLimitIndex}
              evaluatedCount={evaluationLimitIndex}
              totalCount={elements.length}
              isDragging={isDividerDragging}
              isDropTarget={
                pointerDrag?.kind === "elements" &&
                pointerDrag.target?.insertionIndex === evaluationLimitIndex
              }
              onPointerDown={startDividerPointerDrag}
            />
          ) : null}
        </div>

        <div className="button-row reorder-row">
          <button type="button" disabled={isSearchActive} onClick={() => dispatchCommand("moveSelectedElementUp")}>
            上へ
          </button>
          <button type="button" disabled={isSearchActive} onClick={() => dispatchCommand("moveSelectedElementDown")}>
            下へ
          </button>
          <button type="button" onClick={() => dispatchCommand("duplicateSelectedElement")}>
            複製
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
