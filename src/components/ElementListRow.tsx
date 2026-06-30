import type { CSSProperties, MouseEvent, PointerEvent, Ref } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { numericValueExpression } from "../geometry/numericExpressions";
import type { PickCandidate } from "../model/pickCandidates";
import {
  numericReferencePropertiesForGeometry,
  type NumericReferenceGeometry
} from "../geometry/numericReferenceProperties";
import { isForGroupElement, isGroupElement } from "../model/groups";
import type { SelectablePoint } from "../model/pointAnchors";
import type {
  CadElement,
  ElementId
} from "../types/geometry";
import { elementCategoryLabels, elementTypeCategories, elementTypeLabels } from "../types/geometry";
import { numericReferenceLabel, numericReferenceValue } from "./geometryDisplay";
import { ElementStatusIcon } from "./ElementStatusIcon";

const forGroupLabel = (element: CadElement) => {
  if (!isForGroupElement(element)) return element.name;
  const variableName = element.variableName.trim() || "i";
  const start = numericValueExpression(element.start);
  const count = numericValueExpression(element.count);
  const step = numericValueExpression(element.step);
  const numericEnd =
    typeof element.start === "number" &&
    typeof element.count === "number" &&
    typeof element.step === "number" &&
    Number.isInteger(element.count) &&
    element.count > 0
      ? element.start + (element.count - 1) * element.step
      : null;
  return numericEnd === null
    ? `for ${variableName} = ${start} / ${count}回 step ${step}`
    : `for ${variableName} = ${start}..${numericEnd} step ${step}`;
};

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
  isEvaluated: boolean;
  hiddenByGroup: boolean;
  disabledByGroup: boolean;
  conditionInactive: boolean;
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
  onHandlePointerDown: (event: PointerEvent<HTMLButtonElement>, element: CadElement) => void;
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
  isEvaluated,
  hiddenByGroup,
  disabledByGroup,
  conditionInactive,
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
  onHandlePointerDown,
  onApplyNumericReference
}: ElementListRowProps) => (
  <div
    ref={rowRef}
    tabIndex={0}
    data-element-list-row="true"
    aria-selected={selectedPickOptionIndex >= 0 || activeSearchCursorId === element.id}
    className={`element-row ${!isGroupElement(element) ? "is-flat-list" : ""} ${
      selectedElementIdSet.has(element.id) ? "selected" : ""
    } ${
      element.id === selectedElementId ? "primary-selected" : ""
    } ${!isEffectivelyVisible ? "is-hidden" : ""} ${
      !isEffectivelyEnabled ? "is-disabled" : ""
    } ${
      !isEvaluated ? "is-unevaluated" : ""
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
    } ${
      conditionInactive ? "is-condition-inactive" : ""
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
      element.type === "variable" ? "非描画" : isEffectivelyVisible ? "表示" : "非表示"
    }, ${isEffectivelyEnabled ? "評価する" : "評価しない"}${
      conditionInactive ? ", 条件OFF" : ""
    }`}
    onClick={(event) => onSelectElement(element.id, event)}
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
      {element.type !== "variable" ? (
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
      ) : null}
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
      {element.type === "conditionalGroup"
        ? `if ${numericValueExpression(element.condition)}`
        : element.type === "forGroup"
          ? forGroupLabel(element)
        : element.name}
      {isSearchActive && searchParentGroupNames.length ? (
        <small className="group-mask-label">{searchParentGroupNames.join(" / ")}</small>
      ) : null}
      {hiddenByGroup ? <small className="group-mask-label">親で非表示</small> : null}
      {disabledByGroup ? <small className="group-mask-label">親で評価OFF</small> : null}
      {conditionInactive ? <small className="group-mask-label">条件OFF</small> : null}
      {!isEvaluated ? <small className="group-mask-label">未評価</small> : null}
    </span>
    <span className="element-type">
      {isGroupElement(element) && groupIssues ? (
        <span className="element-group-summary">
          {element.expanded ? (
            <FolderOpen className="element-group-icon" aria-hidden="true" />
          ) : (
            <Folder className="element-group-icon" aria-hidden="true" />
          )}
          <span>
            {element.type === "forGroup"
              ? `繰り返し / ${numericValueExpression(element.count)}回`
              : `${groupIssues.childCount}件`}
          </span>
          {groupIssues.errorCount > 0 ? <span>/ エラー{groupIssues.errorCount}</span> : null}
          {groupIssues.warningCount > 0 ? <span>/ 警告{groupIssues.warningCount}</span> : null}
        </span>
      ) : (
        `${elementCategoryLabels[elementTypeCategories[element.type]]} / ${elementTypeLabels[element.type]}`
      )}
    </span>
    <button
      type="button"
      className="element-drag-handle"
      disabled={isSearchActive}
      aria-label={`${element.name}を並び替え`}
      onClick={(event) => {
        event.stopPropagation();
        dispatchCommand("selectElement", { elementId: element.id });
      }}
      onPointerDown={(event) => onHandlePointerDown(event, element)}
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
            <span>{numericReferenceLabel(referenceGeometry, property)}</span>
            <small>{numericReferenceValue(referenceGeometry, property)}</small>
          </button>
        ))}
      </div>
    ) : null}
  </div>
);
