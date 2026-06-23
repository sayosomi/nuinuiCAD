import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, RefObject } from "react";
import { Search, X } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import {
  isGroupElement,
  subtreeIdsForElement
} from "../model/groups";
import {
  isPointElement,
  referenceAnchor
} from "../model/pointAnchors";
import {
  numericReferencePropertiesForGeometry,
} from "../model/pickCandidates";
import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import { useCadStore } from "../state/useCadStore";
import type {
  CadElement,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import {
  numericReferenceExpression,
} from "./geometryDisplay";
import { ElementListRow } from "./ElementListRow";
import { useElementListData } from "./useElementListData";
import type { NumericReferenceGeometry } from "./useElementListData";
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
  element.type === "offsetLine";

type ElementDropTarget = {
  elementId: ElementId;
  insertionIndex: number;
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
  const selectedElementIdSet = new Set(selectedElementIds);
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
            const rowData = getRowData(element);
            return (
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
                hiddenByGroup={rowData.hiddenByGroup}
                disabledByGroup={rowData.disabledByGroup}
                hasError={rowData.hasError}
                hasWarning={rowData.hasWarning}
                groupIssues={rowData.groupIssues}
                selectablePoints={rowData.selectablePoints}
                referenceGeometry={rowData.referenceGeometry}
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
                dropAfter={dropMarkerClass(element.id, rowData.index + 1, "after") !== ""}
                onSelectElement={selectElement}
                onDragOver={(event, rowElement, rowIndex) => {
                  if (isSearchActive) return;
                  updateDropTarget(event, rowElement, rowIndex);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget(null);
                  }
                }}
                onDrop={(event, rowElement, rowIndex) => {
                  if (isSearchActive) return;
                  const elementIds = dragElementIds(event);
                  const insertionIndex =
                    dropTarget?.elementId === rowElement.id
                      ? dropTarget.insertionIndex
                      : rowInsertionIndex(event, rowElement, rowIndex);
                  event.preventDefault();
                  if (elementIds.length > 0 && !isNoopDrop(elementIds, insertionIndex)) {
                    dispatchCommand("moveElementToInsertionIndex", {
                      elementId: elementIds[0],
                      insertionIndex
                    });
                  }
                  clearElementDrag();
                }}
                onDragStart={(event, rowElement) => {
                  if (isSearchActive) {
                    event.preventDefault();
                    return;
                  }
                  const movingIds = selectedElementIdSet.has(rowElement.id) ? selectedElementIds : [rowElement.id];
                  if (!selectedElementIdSet.has(rowElement.id)) {
                    dispatchCommand("selectElement", { elementId: rowElement.id });
                  }
                  setDraggedElementIds(movingIds);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-nuinui-element-id", rowElement.id);
                  event.dataTransfer.setData("application/x-nuinui-element-ids", movingIds.join(","));
                  event.dataTransfer.setData("text/plain", rowElement.name);
                }}
                onDragEnd={clearElementDrag}
                onApplyNumericReference={applyNumericReference}
              />
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
