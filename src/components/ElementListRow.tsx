import type { CSSProperties, DragEvent, MouseEvent, Ref } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import type { PickCandidate } from "../model/pickCandidates";
import { numericReferencePropertiesForGeometry } from "../model/pickCandidates";
import { isGroupElement } from "../model/groups";
import type { SelectablePoint } from "../model/pointAnchors";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ElementId
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { numericReferenceValue } from "./geometryDisplay";
import { ElementStatusIcon } from "./ElementStatusIcon";

type NumericReferenceGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

export type ElementListGroupIssues = {
  childCount: number;
  errorCount: number;
  warningCount: number;
};

type ElementListRowProps = {
  element: CadElement;
  index: number;
  rowRef: Ref<HTMLDivElement>;
  depth: number;
  selectedElementId: ElementId | null;
  selectedElementIdSet: Set<ElementId>;
  isEffectivelyVisible: boolean;
  isEffectivelyEnabled: boolean;
  hiddenByGroup: boolean;
  disabledByGroup: boolean;
  hasError: boolean;
  hasWarning: boolean;
  groupIssues: ElementListGroupIssues | null;
  selectablePoints: SelectablePoint[];
  referenceGeometry: NumericReferenceGeometry | null;
  pickCandidate: PickCandidate | undefined;
  selectedPickOptionIndex: number;
  activeSearchCursorId: ElementId | null;
  isSearchActive: boolean;
  isSearchPickable: boolean;
  searchParentGroupNames: string[];
  isPointPickMode: boolean;
  isPointPickCandidate: boolean;
  isNumericReferencePickMode: boolean;
  isNumericReferenceCandidate: boolean;
  isLinePickMode: boolean;
  isLinePickCandidate: boolean;
  isDragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onSelectElement: (elementId: ElementId, event: MouseEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>, element: CadElement, index: number) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>, element: CadElement, index: number) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, element: CadElement) => void;
  onDragEnd: () => void;
  onApplyNumericReference: (
    geometry: NumericReferenceGeometry,
    property: ReturnType<typeof numericReferencePropertiesForGeometry>[number]
  ) => void;
};

export const ElementListRow = ({
  element,
  index,
  rowRef,
  depth,
  selectedElementId,
  selectedElementIdSet,
  isEffectivelyVisible,
  isEffectivelyEnabled,
  hiddenByGroup,
  disabledByGroup,
  hasError,
  hasWarning,
  groupIssues,
  selectablePoints,
  referenceGeometry,
  pickCandidate,
  selectedPickOptionIndex,
  activeSearchCursorId,
  isSearchActive,
  isSearchPickable,
  searchParentGroupNames,
  isPointPickMode,
  isPointPickCandidate,
  isNumericReferencePickMode,
  isNumericReferenceCandidate,
  isLinePickMode,
  isLinePickCandidate,
  isDragging,
  dropBefore,
  dropAfter,
  onSelectElement,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onApplyNumericReference
}: ElementListRowProps) => (
  <div
    ref={rowRef}
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
    } ${isPointPickMode ? "is-point-pick-mode" : ""} ${
      isPointPickCandidate ? "is-point-pick-candidate" : ""
    } ${
      isPointPickMode && !isPointPickCandidate ? "is-not-point-pick-candidate" : ""
    } ${isNumericReferencePickMode ? "is-numeric-reference-pick-mode" : ""} ${
      isNumericReferenceCandidate ? "is-numeric-reference-pick-candidate" : ""
    } ${
      isNumericReferencePickMode && !isNumericReferenceCandidate
        ? "is-not-numeric-reference-pick-candidate"
        : ""
    } ${isLinePickMode ? "is-line-pick-mode" : ""} ${
      isLinePickCandidate ? "is-line-pick-candidate" : ""
    } ${
      isLinePickMode && !isLinePickCandidate
        ? "is-not-line-pick-candidate"
        : ""
    } ${
      selectedPickOptionIndex >= 0 ? "selected-pick-candidate" : ""
    } ${
      isSearchActive && activeSearchCursorId === element.id ? "search-cursor" : ""
    } ${
      isSearchActive && !isSearchPickable ? "is-not-search-pickable" : ""
    } ${isDragging ? "dragging" : ""}${dropBefore ? " drop-before" : ""}${dropAfter ? " drop-after" : ""}`}
    aria-label={`${index + 1}. ${element.name}, ${elementTypeLabels[element.type]}, ${
      isEffectivelyVisible ? "表示" : "非表示"
    }, ${isEffectivelyEnabled ? "評価する" : "評価しない"}`}
    onClick={(event) => onSelectElement(element.id, event)}
    onDragOver={(event) => onDragOver(event, element, index)}
    onDragLeave={onDragLeave}
    onDrop={(event) => onDrop(event, element, index)}
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
      {isSearchActive && searchParentGroupNames.length ? (
        <small className="group-mask-label">{searchParentGroupNames.join(" / ")}</small>
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
      onDragStart={(event) => onDragStart(event, element)}
      onDragEnd={onDragEnd}
    >
      <span aria-hidden="true">::</span>
    </button>
    {isPointPickMode && selectablePoints.length > 0 ? (
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
    {isNumericReferencePickMode && referenceGeometry ? (
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
              onApplyNumericReference(referenceGeometry, property);
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
