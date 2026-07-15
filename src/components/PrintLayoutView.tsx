import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  WheelEvent as ReactWheelEvent
} from "react";
import { ChevronDown, Copy, FileCode, FileText, Plus, Trash2 } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { formatNumber } from "./geometryDisplay";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import {
  addToNumericValue,
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import {
  filteredNumericVariableSuggestions,
  numericVariableSuggestionMatch,
  replaceNumericVariableSuggestionToken
} from "./numericVariableSuggestion";
import {
  asNumericVariableReferenceOptions,
  elementParameterSuggestionMatch,
  filteredElementParameterSuggestions
} from "./elementParameterSuggestion";
import { elementParameterReferenceOptionsForPosition } from "../geometry/elementParameterReferenceOptions";
import { defaultPlacementForGroup, printableGroups, printableItemsForLayout } from "../print/printGeometry";
import {
  DEFAULT_PRINT_LAYOUT,
  PAPER_SIZES,
  activePrintLayout,
  orientedPaperSize,
  printCanvasSizeMm,
  resolvePrintLayout
} from "../print/printLayout";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  loadLayoutSettings,
  PRINT_PANEL_SECTION_IDS,
  saveLayoutSettings,
  type PrintPanelSectionId
} from "../layout/layoutSettingsStorage";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  NumericExpression,
  NumericVariable,
  NumericValue,
  PrintLayoutPlacement
} from "../types/geometry";
import { NumericVariableSuggestPopover } from "./NumericVariableSuggestPopover";
import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import { numericDragStepsForDelta } from "./numericDrag";

type PrintLayoutCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

const SVG_PADDING = 32;

type PrintNumberDragState = {
  pointerId: number;
  previousClientX: number;
  remainderX: number;
};

type PrintNumberInputSelection = {
  start: number | null;
  end: number | null;
};

type PrintCanvasDrag =
  | {
      kind: "placement";
      placementId: string;
      pointerId: number;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "pan";
      pointerId: number;
      lastX: number;
      lastY: number;
    };

const WHEEL_ZOOM_BASE = 1.1;

const deferredPrintNumberInputValues = new Set(["", "+", "-", ".", "+.", "-."]);
const DEFAULT_COLLAPSED_PRINT_PANEL_SECTIONS = new Set<PrintPanelSectionId>(["variables"]);

const isDeferredPrintNumberInput = (input: string) =>
  deferredPrintNumberInputValues.has(input.trim());

const clampNumericValue = (value: NumericValue, min: number | undefined): NumericValue =>
  typeof value === "number" && min !== undefined ? Math.max(value, min) : value;

const printVariableReferenceOptions = ({
  printVariables,
  elements
}: {
  printVariables: NumericVariable[];
  elements: CadElement[];
}): NumericVariableReferenceOption[] => [
  ...printVariables.map((variable) => ({
    expression: `@${variable.id}`,
    displayExpression: `@${variable.name}`,
    label: `@${variable.name}`,
    detail: "印刷変数",
    source: "local" as const,
    variableId: variable.id
  })),
  ...elements
    .filter((element): element is Extract<CadElement, { type: "variable" }> =>
      element.type === "variable" && element.scope === "global"
    )
    .map((variable) => ({
      expression: `@${variable.id}`,
      displayExpression: `@${variable.name}`,
      label: `@${variable.name}`,
      detail: "全体変数",
      source: "global" as const,
      elementId: variable.id
    }))
];

const PrintNumberInput = ({
  label,
  value,
  resolvedValue,
  defaultValue,
  elements,
  printVariables,
  evaluation,
  step,
  min,
  onChange
}: {
  label: string;
  value: NumericValue;
  resolvedValue: number;
  defaultValue: NumericValue;
  elements: ReturnType<typeof useCadDocumentStore.getState>["elements"];
  printVariables: NumericVariable[];
  evaluation: EvaluationResult;
  step: number;
  min?: number;
  onChange: (value: NumericValue) => void;
}) => {
  const [drag, setDrag] = useState<PrintNumberDragState | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [inputSelection, setInputSelection] = useState<PrintNumberInputSelection>({ start: null, end: null });
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  // Pre-existing gap fixed alongside this feature: this input never tracked
  // IME composition state at all (only the Enter-key isImeComposingKeyEvent
  // guard existed), so the new element-parameter suggestion source would
  // otherwise be the second IME-unsafe source in this same component.
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const globalVariables = elements
    .filter((element) => element.type === "variable" && element.scope === "global")
    .map((variable) => ({
      id: variable.id,
      name: variable.name,
      value: 0
    }));
  const availableVariables = [...printVariables, ...globalVariables];
  const displayValue = formatNumericExpressionForDisplay(value, elements, availableVariables);
  const inputValue = draft ?? displayValue;
  const valueFromInput = (input: string) =>
    makeNumericExpression(normalizeNumericExpressionInput(input, elements, availableVariables));
  const variableOptions = useMemo(
    () => printVariableReferenceOptions({ printVariables, elements }),
    [elements, printVariables]
  );
  const suggestionMatch = !isComposing
    ? numericVariableSuggestionMatch(inputValue, inputSelection.start, inputSelection.end)
    : null;
  const visibleSuggestions = suggestionMatch
    ? filteredNumericVariableSuggestions(variableOptions, suggestionMatch.query)
    : [];
  // Print layout numeric expressions never pass a currentElement (see
  // cmAutocomplete.ts's own comment on this), so element-parameter candidates
  // here are always global/root-scoped and unsliced by document position -
  // matching the existing @variable behavior for this surface.
  const elementParamMatch = !isComposing && !suggestionMatch
    ? elementParameterSuggestionMatch(inputValue, inputSelection.start, inputSelection.end)
    : null;
  // Not memoized: the element token changes on nearly every keystroke while
  // typing the name, so a useMemo boundary here would rarely hit (also avoids
  // depending on a value derived from a conditional expression, which the
  // React Compiler can't safely memoize around).
  const elementParamOptions = !elementParamMatch
    ? []
    : elementParameterReferenceOptionsForPosition({
        referenceElements: elements,
        elementToken: elementParamMatch.elementToken,
        currentElement: undefined,
        evaluation: {
          computedGeometry: evaluation.computedGeometry,
          computedVariables: evaluation.computedVariables,
          effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
          errors: evaluation.errors
        }
      });
  const visibleElementParamSuggestions = elementParamMatch
    ? filteredElementParameterSuggestions(elementParamOptions, elementParamMatch.query)
    : [];
  const activeSuggestionMatch = suggestionMatch ?? elementParamMatch;
  const activeSuggestions = suggestionMatch
    ? visibleSuggestions
    : asNumericVariableReferenceOptions(visibleElementParamSuggestions);
  const selectedSuggestionIndex =
    activeSuggestions.length === 0
      ? 0
      : Math.min(activeSuggestionIndex, activeSuggestions.length - 1);
  const commitValue = (nextValue: NumericValue) => {
    if (typeof nextValue === "number" && !Number.isFinite(nextValue)) return;
    onChange(clampNumericValue(nextValue, min));
  };
  const updateSelection = (input: HTMLInputElement) => {
    setInputSelection({ start: input.selectionStart, end: input.selectionEnd });
  };
  const applyVariableSuggestion = (option = activeSuggestions[selectedSuggestionIndex]) => {
    if (!activeSuggestionMatch || !option) return;
    const nextInput = replaceNumericVariableSuggestionToken(inputValue, activeSuggestionMatch, option.expression);
    setDraft(nextInput);
    commitValue({
      kind: "expression",
      expression: normalizeNumericExpressionInput(nextInput, elements, availableVariables)
    } satisfies NumericExpression);
    setActiveSuggestionIndex(0);
    const nextCursor = activeSuggestionMatch.tokenStart + option.expression.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      setInputSelection({ start: nextCursor, end: nextCursor });
    });
  };
  const finishDrag = (event: PointerEvent<HTMLInputElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDrag(null);
  };
  return (
    <label className="print-number-field">
      <span>{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={inputValue}
        title={`評価値 ${formatNumber(resolvedValue)}`}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setDraft(nextValue);
          updateSelection(event.currentTarget);
          setActiveSuggestionIndex(0);
          if (isDeferredPrintNumberInput(nextValue)) return;
          commitValue(valueFromInput(nextValue));
        }}
        onClick={(event) => updateSelection(event.currentTarget)}
        onSelect={(event) => updateSelection(event.currentTarget)}
        onKeyUp={(event) => updateSelection(event.currentTarget)}
        onKeyDown={(event) => {
          if (activeSuggestions.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveSuggestionIndex((index) => (index + 1) % activeSuggestions.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveSuggestionIndex(
                (index) => (index - 1 + activeSuggestions.length) % activeSuggestions.length
              );
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              applyVariableSuggestion();
              return;
            }
            if (event.key === "Enter" && !isImeComposingKeyEvent(event)) {
              event.preventDefault();
              applyVariableSuggestion();
              return;
            }
          }
          if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (draft !== null && draft.trim().length === 0) {
              commitValue(defaultValue);
            } else if (draft !== null && !isDeferredPrintNumberInput(draft)) {
              commitValue(valueFromInput(draft));
            }
            setDraft(null);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(null);
            setInputSelection({ start: null, end: null });
            event.currentTarget.blur();
          }
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onBlur={() => {
          setDraft(null);
          setInputSelection({ start: null, end: null });
        }}
        onPointerDown={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag({
            pointerId: event.pointerId,
            previousClientX: event.clientX,
            remainderX: 0
          });
        }}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          const deltaX = drag.remainderX + event.clientX - drag.previousClientX;
          const { steps, remainderX } = numericDragStepsForDelta(deltaX);
          setDrag({ ...drag, previousClientX: event.clientX, remainderX });
          if (steps === 0) return;
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          commitValue(addToNumericValue(value, steps * step * multiplier));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={(event) => {
          if (drag?.pointerId === event.pointerId) setDrag(null);
        }}
        onAuxClick={(event: MouseEvent<HTMLInputElement>) => {
          if (event.button === 1) event.preventDefault();
        }}
      />
      <NumericVariableSuggestPopover
        options={activeSuggestions}
        activeIndex={selectedSuggestionIndex}
        onHover={setActiveSuggestionIndex}
        onApply={applyVariableSuggestion}
      />
    </label>
  );
};

type CollapsiblePanelSectionProps = {
  id: PrintPanelSectionId;
  title: string;
  subtitle?: string;
  collapsedSections: Set<PrintPanelSectionId>;
  onToggle: (sectionId: PrintPanelSectionId) => void;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

const CollapsiblePanelSection = ({
  id,
  title,
  subtitle,
  collapsedSections,
  onToggle,
  actions,
  className,
  children
}: CollapsiblePanelSectionProps) => {
  const isCollapsed = collapsedSections.has(id);
  return (
    <section className={`panel-section print-collapsible-section ${className ?? ""}`}>
      <div className="section-header print-collapsible-header">
        <button
          type="button"
          className="print-section-toggle"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(id)}
        >
          <ChevronDown aria-hidden="true" />
          <span>
            <h2>{title}</h2>
            {subtitle ? <small className="section-subtitle">{subtitle}</small> : null}
          </span>
        </button>
        {actions}
      </div>
      {isCollapsed ? null : <div className="print-collapsible-body">{children}</div>}
    </section>
  );
};

const placementName = (
  placement: Pick<PrintLayoutPlacement, "groupId">,
  groupNames: Map<ElementId, string>
) => groupNames.get(placement.groupId) ?? placement.groupId;

export const PrintLayoutCanvas = ({ evaluation, canvasFocusRef }: PrintLayoutCanvasProps) => {
  const elements = useCadDocumentStore(effectiveElements);
  const layout = useCadDocumentStore((state) =>
    activePrintLayout(state.printLayouts, state.activePrintLayoutId)
  );
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const updatePrintLayout = useCadDocumentStore((state) => state.updatePrintLayout);
  const selectedPrintPlacementId = useCadUiStore((state) => state.selectedPrintPlacementId);
  const setSelectedPrintPlacementId = useCadUiStore((state) => state.setSelectedPrintPlacementId);
  const printCanvasViewport = useCadUiStore((state) => state.printCanvasViewport);
  const panPrintCanvasViewport = useCadUiStore((state) => state.panPrintCanvasViewport);
  const zoomPrintCanvasViewportAt = useCadUiStore((state) => state.zoomPrintCanvasViewportAt);
  const [drag, setDrag] = useState<PrintCanvasDrag | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const resolvedLayout = useMemo(
    () => resolvePrintLayout({ layout, elements, evaluation }),
    [elements, evaluation, layout]
  );
  const isSvgLayout = resolvedLayout.outputKind === "svg";
  const paper = orientedPaperSize(resolvedLayout);
  const printCanvas = printCanvasSizeMm(resolvedLayout);
  const canvas = isSvgLayout
    ? { widthMm: resolvedLayout.svgCanvasWidthMm, heightMm: resolvedLayout.svgCanvasHeightMm }
    : printCanvas;
  const printableItems = useMemo(
    () => printableItemsForLayout({
      elements,
      evaluation,
      layout,
      visibilityProfiles,
      activeVisibilityProfileId
    }),
    [activeVisibilityProfileId, elements, evaluation, layout, visibilityProfiles]
  );
  const groupNames = useMemo(
    () => new Map(elements.filter((element) => element.type === "group").map((element) => [element.id, element.name])),
    [elements]
  );
  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport) return;
    const updateSize = () => {
      setViewportSize({
        width: Math.max(viewport.clientWidth, 0),
        height: Math.max(viewport.clientHeight, 0)
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasFocusRef]);

  const visiblePrintBounds = (() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return {
        minX: -SVG_PADDING,
        maxX: canvas.widthMm + SVG_PADDING,
        minY: -SVG_PADDING,
        maxY: canvas.heightMm + SVG_PADDING
      };
    }
    const centerX = canvas.widthMm / 2;
    const centerY = canvas.heightMm / 2;
    return {
      minX: centerX + (-viewportSize.width / 2 - printCanvasViewport.panX) / printCanvasViewport.zoom,
      maxX: centerX + (viewportSize.width / 2 - printCanvasViewport.panX) / printCanvasViewport.zoom,
      minY: centerY + (-viewportSize.height / 2 + printCanvasViewport.panY) / printCanvasViewport.zoom,
      maxY: centerY + (viewportSize.height / 2 + printCanvasViewport.panY) / printCanvasViewport.zoom
    };
  })();
  const viewportWidth = visiblePrintBounds.maxX - visiblePrintBounds.minX;
  const viewportHeight = visiblePrintBounds.maxY - visiblePrintBounds.minY;
  const viewBoxX = SVG_PADDING + visiblePrintBounds.minX;
  const viewBoxY = SVG_PADDING + canvas.heightMm - visiblePrintBounds.maxY;
  const toSvg = (point: { x: number; y: number }) => ({
    x: SVG_PADDING + point.x,
    y: SVG_PADDING + canvas.heightMm - point.y
  });
  const screenToPrint = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = visiblePrintBounds.minX + ((event.clientX - rect.left) / rect.width) * viewportWidth;
    const y = visiblePrintBounds.maxY - ((event.clientY - rect.top) / rect.height) * viewportHeight;
    return { x, y };
  };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomPrintCanvasViewportAt(Math.pow(WHEEL_ZOOM_BASE, -event.deltaY / 100), {
      x: event.clientX - rect.left - event.currentTarget.clientLeft,
      y: event.clientY - rect.top - event.currentTarget.clientTop,
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight
    });
  };
  const updatePlacement = (placementId: string, patch: Partial<PrintLayoutPlacement>) => {
    updatePrintLayout({
      placements: layout.placements.map((placement) =>
        placement.id === placementId ? { ...placement, ...patch } : placement
      )
    });
  };
  const hitPlacement = (point: { x: number; y: number }) => {
    for (let index = resolvedLayout.placements.length - 1; index >= 0; index -= 1) {
      const placement = resolvedLayout.placements[index];
      if (Math.hypot(point.x - placement.x, point.y - placement.y) <= 8) return placement;
    }
    return null;
  };
  const pageStepX = Math.max(paper.widthMm - resolvedLayout.overlapMm, 1);
  const pageStepY = Math.max(paper.heightMm - resolvedLayout.overlapMm, 1);

  return (
    <section className="canvas-panel print-layout-panel">
      <div
        className="canvas-viewport print-layout-viewport"
        ref={canvasFocusRef}
        tabIndex={-1}
        onWheel={handleWheel}
      >
        <svg
          className="print-layout-svg"
          viewBox={`${viewBoxX} ${viewBoxY} ${viewportWidth} ${viewportHeight}`}
          role="img"
          aria-label="印刷レイアウト"
          onPointerDown={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({
                kind: "pan",
                pointerId: event.pointerId,
                lastX: event.clientX,
                lastY: event.clientY
              });
              return;
            }
            if (event.button !== 0) return;
            const point = screenToPrint(event);
            const placement = hitPlacement(point);
            if (!placement) return;
            setSelectedPrintPlacementId(placement.id);
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              kind: "placement",
              placementId: placement.id,
              pointerId: event.pointerId,
              offsetX: point.x - placement.x,
              offsetY: point.y - placement.y
            });
          }}
          onPointerMove={(event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (drag.kind === "pan") {
              if ((event.buttons & 4) === 0) {
                setDrag(null);
                return;
              }
              event.preventDefault();
              panPrintCanvasViewport(event.clientX - drag.lastX, event.clientY - drag.lastY);
              setDrag({
                ...drag,
                lastX: event.clientX,
                lastY: event.clientY
              });
              return;
            }
            const point = screenToPrint(event);
            updatePlacement(drag.placementId, {
              x: Number((point.x - drag.offsetX).toFixed(2)),
              y: Number((point.y - drag.offsetY).toFixed(2))
            });
          }}
          onPointerUp={(event) => {
            if (drag?.pointerId === event.pointerId) setDrag(null);
          }}
          onPointerCancel={(event) => {
            if (drag?.pointerId === event.pointerId) setDrag(null);
          }}
          onAuxClick={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
        >
          <rect
            x={SVG_PADDING}
            y={SVG_PADDING}
            width={canvas.widthMm}
            height={canvas.heightMm}
            className="print-canvas-background"
          />
          {!isSvgLayout ? Array.from({ length: resolvedLayout.rows }).flatMap((_, row) =>
            Array.from({ length: resolvedLayout.columns }).map((__, column) => {
              const x = column * pageStepX;
              const y = printCanvas.heightMm - paper.heightMm - row * pageStepY;
              const topLeft = toSvg({ x, y: y + paper.heightMm });
              return (
                <g key={`${column}-${row}`} className="print-page-tile">
                  <rect
                    x={topLeft.x}
                    y={topLeft.y}
                    width={paper.widthMm}
                    height={paper.heightMm}
                  />
                  {resolvedLayout.overlapMm > 0 ? (
                    <>
                      <line x1={topLeft.x + resolvedLayout.overlapMm} y1={topLeft.y} x2={topLeft.x + resolvedLayout.overlapMm} y2={topLeft.y + paper.heightMm} />
                      <line x1={topLeft.x + paper.widthMm - resolvedLayout.overlapMm} y1={topLeft.y} x2={topLeft.x + paper.widthMm - resolvedLayout.overlapMm} y2={topLeft.y + paper.heightMm} />
                      <line x1={topLeft.x} y1={topLeft.y + resolvedLayout.overlapMm} x2={topLeft.x + paper.widthMm} y2={topLeft.y + resolvedLayout.overlapMm} />
                      <line x1={topLeft.x} y1={topLeft.y + paper.heightMm - resolvedLayout.overlapMm} x2={topLeft.x + paper.widthMm} y2={topLeft.y + paper.heightMm - resolvedLayout.overlapMm} />
                    </>
                  ) : null}
                </g>
              );
            })
          ) : null}
          <g className="print-paths">
            {printableItems.paths.map((path, index) => {
              if (path.kind === "line") {
                const start = toSvg(path.start);
                const end = toSvg(path.end);
                return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
              }
              if (path.kind === "bezier") {
                const start = toSvg(path.start);
                const c1 = toSvg(path.control1);
                const c2 = toSvg(path.control2);
                const end = toSvg(path.end);
                return (
                  <path
                    key={index}
                    d={`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`}
                  />
                );
              }
              return (
                <polyline
                  key={index}
                  points={path.points.map((point) => {
                    const svgPoint = toSvg(point);
                    return `${svgPoint.x},${svgPoint.y}`;
                  }).join(" ")}
                />
              );
            })}
            {printableItems.texts.map((text, index) => {
              const anchor = toSvg(text.anchor);
              return (
                <text
                  key={`text-${index}`}
                  x={anchor.x}
                  y={anchor.y}
                  fontSize={text.fontSize}
                  dominantBaseline="text-before-edge"
                >
                  {text.text.split(/\r?\n/).map((line, lineIndex) => (
                    <tspan key={lineIndex} x={anchor.x} dy={lineIndex === 0 ? 0 : text.fontSize * 1.2}>
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })}
          </g>
          {resolvedLayout.placements.map((placement) => {
            const center = toSvg(placement);
            const isSelected = placement.id === selectedPrintPlacementId;
            return (
              <g
                key={placement.id}
                className={`print-placement-anchor ${isSelected ? "selected" : ""}`}
              >
                <circle cx={center.x} cy={center.y} r={isSelected ? 5.5 : 4} />
                <text x={center.x + 6} y={center.y - 6}>
                  {placementName(placement, groupNames)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="canvas-display-controls" aria-label="印刷レイアウト操作">
          <button type="button" onClick={() => dispatchCommand("closePrintLayout")}>
            CAD編集
          </button>
          {isSvgLayout ? (
            <button type="button" onClick={() => dispatchCommand("exportPrintSvg", { evaluation })}>
              SVG
            </button>
          ) : (
            <button type="button" onClick={() => dispatchCommand("exportPrintPdf", { evaluation })}>
              PDF
            </button>
          )}
        </div>
        <div className="canvas-scale-overlay">縮尺 {printCanvasViewport.zoom.toFixed(2)}px/mm</div>
      </div>
    </section>
  );
};

export const PrintLayoutPanel = ({ evaluation }: { evaluation: EvaluationResult }) => {
  const elements = useCadDocumentStore(effectiveElements);
  const layout = useCadDocumentStore((state) =>
    activePrintLayout(state.printLayouts, state.activePrintLayoutId)
  );
  const printLayouts = useCadDocumentStore((state) => state.printLayouts);
  const activePrintLayoutId = useCadDocumentStore((state) => state.activePrintLayoutId);
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const updatePrintLayout = useCadDocumentStore((state) => state.updatePrintLayout);
  const setActivePrintLayoutId = useCadDocumentStore((state) => state.setActivePrintLayoutId);
  const addPrintLayout = useCadDocumentStore((state) => state.addPrintLayout);
  const duplicatePrintLayout = useCadDocumentStore((state) => state.duplicatePrintLayout);
  const deletePrintLayout = useCadDocumentStore((state) => state.deletePrintLayout);
  const selectedPrintPlacementId = useCadUiStore((state) => state.selectedPrintPlacementId);
  const setSelectedPrintPlacementId = useCadUiStore((state) => state.setSelectedPrintPlacementId);
  const [groupQuery, setGroupQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<PrintPanelSectionId>>(
    DEFAULT_COLLAPSED_PRINT_PANEL_SECTIONS
  );
  const placementRowRefs = useRef(new Map<string, HTMLDivElement>());
  const validPrintPanelSectionIds = useMemo(() => new Set<PrintPanelSectionId>(PRINT_PANEL_SECTION_IDS), []);
  const resolvedLayout = useMemo(
    () => resolvePrintLayout({ layout, elements, evaluation }),
    [elements, evaluation, layout]
  );
  const isSvgLayout = resolvedLayout.outputKind === "svg";
  const canvas = isSvgLayout
    ? { widthMm: resolvedLayout.svgCanvasWidthMm, heightMm: resolvedLayout.svgCanvasHeightMm }
    : printCanvasSizeMm(resolvedLayout);
  const printVariables = layout.numericVariables ?? [];
  const groups = printableGroups(elements);
  const allGroups = elements.filter(
    (element): element is Extract<CadElement, { type: "group" }> => element.type === "group"
  );
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const allGroupsById = new Map(allGroups.map((group) => [group.id, group]));
  const selectedPlacement =
    layout.placements.find((placement) => placement.id === selectedPrintPlacementId) ??
    layout.placements[0] ??
    null;
  const selectedResolvedPlacement =
    selectedPlacement
      ? resolvedLayout.placements.find((placement) => placement.id === selectedPlacement.id) ?? null
      : null;
  const selectedPlacementGroup = selectedPlacement
    ? allGroupsById.get(selectedPlacement.groupId) ?? null
    : null;
  const selectedPlacementGroupOptions =
    selectedPlacementGroup && !groupsById.has(selectedPlacementGroup.id)
      ? [selectedPlacementGroup, ...groups]
      : groups;
  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(groupQuery.trim().toLowerCase())
  );
  const printSettingsSummary = isSvgLayout
    ? `SVG ${formatNumber(resolvedLayout.svgCanvasWidthMm)}x${formatNumber(resolvedLayout.svgCanvasHeightMm)}mm / 倍率 ${formatNumber(resolvedLayout.scale)}`
    : `${PAPER_SIZES.find((paper) => paper.id === layout.paperSizeId)?.label ?? "用紙"} / ${resolvedLayout.columns}x${resolvedLayout.rows} / 倍率 ${formatNumber(resolvedLayout.scale)}`;
  const placementCountByGroupId = new Map<ElementId, number>();
  for (const placement of layout.placements) {
    placementCountByGroupId.set(
      placement.groupId,
      (placementCountByGroupId.get(placement.groupId) ?? 0) + 1
    );
  }
  useEffect(() => {
    let cancelled = false;
    void loadLayoutSettings()
      .then((settings) => {
        if (cancelled) return;
        setCollapsedSections(
          new Set(settings.collapsedPrintPanelSections.filter((id) => validPrintPanelSectionIds.has(id)))
        );
      })
      .catch((error: unknown) => {
        console.error("failed to load print panel section settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [validPrintPanelSectionIds]);
  useEffect(() => {
    const selectedId = selectedPlacement?.id;
    if (!selectedId) return;
    placementRowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedPlacement?.id, layout.placements.length]);
  const saveCollapsedSections = (nextSections: Set<PrintPanelSectionId>) => {
    void loadLayoutSettings()
      .then((settings) =>
        saveLayoutSettings({
          ...settings,
          collapsedPrintPanelSections: Array.from(nextSections)
        })
      )
      .catch((error: unknown) => {
        console.error("failed to save print panel section settings", error);
      });
  };
  const toggleSection = (sectionId: PrintPanelSectionId) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      saveCollapsedSections(next);
      return next;
    });
  };
  const registerPlacementRow = (placementId: string, element: HTMLDivElement | null) => {
    if (element) {
      placementRowRefs.current.set(placementId, element);
    } else {
      placementRowRefs.current.delete(placementId);
    }
  };
  const addPlacement = (groupId: ElementId) => {
    const placement = defaultPlacementForGroup(groupId, resolvedLayout);
    updatePrintLayout({
      placements: [...layout.placements, placement]
    });
    setSelectedPrintPlacementId(placement.id);
  };
  const nextPrintVariableId = () => {
    let index = printVariables.length + 1;
    const existingIds = new Set(printVariables.map((variable) => variable.id));
    while (existingIds.has(`print-variable-${index}`)) {
      index += 1;
    }
    return `print-variable-${index}`;
  };
  const addPrintVariable = () => {
    const variable: NumericVariable = {
      id: nextPrintVariableId(),
      name: `v${printVariables.length + 1}`,
      value: 30
    };
    updatePrintLayout({
      numericVariables: [...printVariables, variable]
    });
  };
  const updatePrintVariable = (variableId: string, patch: Partial<NumericVariable>) => {
    updatePrintLayout({
      numericVariables: printVariables.map((variable) =>
        variable.id === variableId ? { ...variable, ...patch } : variable
      )
    });
  };
  const deletePrintVariable = (variableId: string) => {
    updatePrintLayout({
      numericVariables: printVariables.filter((variable) => variable.id !== variableId)
    });
  };
  const updatePlacement = (placementId: string, patch: Partial<PrintLayoutPlacement>) => {
    updatePrintLayout({
      placements: layout.placements.map((placement) =>
        placement.id === placementId ? { ...placement, ...patch } : placement
      )
    });
  };
  const deletePlacement = (placementId: string) => {
    const nextPlacements = layout.placements.filter((placement) => placement.id !== placementId);
    updatePrintLayout({
      placements: nextPlacements
    });
    if (selectedPrintPlacementId === placementId) {
      setSelectedPrintPlacementId(nextPlacements[0]?.id ?? null);
    }
  };
  const duplicatePlacement = (placement: PrintLayoutPlacement) => {
    let nextIndex = layout.placements.length + 1;
    const existingIds = new Set(layout.placements.map((item) => item.id));
    while (existingIds.has(`placement-${nextIndex}`)) {
      nextIndex += 1;
    }
    const copy = {
      ...placement,
      id: `placement-${nextIndex}`
    };
    updatePrintLayout({
      placements: [...layout.placements, copy]
    });
    setSelectedPrintPlacementId(copy.id);
  };
  const switchPrintLayout = (layoutId: string) => {
    const nextLayout = printLayouts.find((item) => item.id === layoutId);
    setActivePrintLayoutId(layoutId);
    setSelectedPrintPlacementId(nextLayout?.placements[0]?.id ?? null);
  };
  const addAndSelectPrintLayout = () => {
    addPrintLayout();
    setSelectedPrintPlacementId(null);
  };
  const duplicateAndSelectPrintLayout = () => {
    duplicatePrintLayout(activePrintLayoutId);
    setSelectedPrintPlacementId(selectedPrintPlacementId ?? layout.placements[0]?.id ?? null);
  };
  const deleteAndSelectNextPrintLayout = () => {
    if (printLayouts.length <= 1) return;
    const nextLayout = printLayouts.find((item) => item.id !== activePrintLayoutId);
    deletePrintLayout(activePrintLayoutId);
    setSelectedPrintPlacementId(nextLayout?.placements[0]?.id ?? null);
  };

  return (
    <aside className="right-panel print-settings-panel">
      <section className="panel-section print-settings-hero">
        <div className="section-header print-settings-title">
          <div>
            <h2>印刷設定</h2>
            <p className="section-subtitle">{printSettingsSummary}</p>
          </div>
          <div className="print-settings-actions">
            <button type="button" onClick={() => dispatchCommand("closePrintLayout")}>
              CAD編集
            </button>
            {isSvgLayout ? (
              <button type="button" onClick={() => dispatchCommand("exportPrintSvg", { evaluation })}>
                <FileCode aria-hidden="true" />
                SVG
              </button>
            ) : (
              <button type="button" onClick={() => dispatchCommand("exportPrintPdf", { evaluation })}>
                <FileText aria-hidden="true" />
                PDF
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="print-settings-scroll">
        <CollapsiblePanelSection
          id="output"
          title="出力設定"
          subtitle={printSettingsSummary}
          collapsedSections={collapsedSections}
          onToggle={toggleSection}
        >
        <div className="print-layout-switcher">
          <label className="print-select-field">
            <span>レイアウト</span>
            <select
              value={activePrintLayoutId}
              onChange={(event) => switchPrintLayout(event.currentTarget.value)}
            >
              {printLayouts.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {item.name.trim() || `レイアウト${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="print-select-field">
            <span>名前</span>
            <input
              type="text"
              aria-label="印刷レイアウト名"
              value={layout.name}
              placeholder="ファイル名"
              onChange={(event) => updatePrintLayout({ name: event.currentTarget.value })}
            />
          </label>
          <div className="print-layout-actions">
            <button type="button" onClick={addAndSelectPrintLayout}>
              <Plus aria-hidden="true" />
              新規
            </button>
            <button type="button" onClick={duplicateAndSelectPrintLayout}>
              <Copy aria-hidden="true" />
              複製
            </button>
            <button
              type="button"
              onClick={deleteAndSelectNextPrintLayout}
              disabled={printLayouts.length <= 1}
            >
              <Trash2 aria-hidden="true" />
              削除
            </button>
          </div>
        </div>
        <div className="print-settings-grid">
          <label className="print-select-field">
            <span>出力形式</span>
            <select
              value={layout.outputKind}
              onChange={(event) => updatePrintLayout({ outputKind: event.target.value as typeof layout.outputKind })}
            >
              <option value="pdf">PDF</option>
              <option value="svg">SVG</option>
            </select>
          </label>
          <label className="print-select-field">
            <span>表示プロファイル</span>
            <select
              value={layout.visibilityProfileId ?? activeVisibilityProfileId}
              onChange={(event) => updatePrintLayout({ visibilityProfileId: event.target.value })}
            >
              {visibilityProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          {isSvgLayout ? null : (
            <>
          <label className="print-select-field">
            <span>用紙</span>
            <select
              value={layout.paperSizeId}
              onChange={(event) => updatePrintLayout({ paperSizeId: event.target.value as typeof layout.paperSizeId })}
            >
              {PAPER_SIZES.map((paper) => (
                <option key={paper.id} value={paper.id}>{paper.label}</option>
              ))}
            </select>
          </label>
          <label className="print-select-field">
            <span>向き</span>
            <select
              value={layout.orientation}
              onChange={(event) => updatePrintLayout({ orientation: event.target.value as typeof layout.orientation })}
            >
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
          </label>
          <PrintNumberInput label="横枚数" value={layout.columns} resolvedValue={resolvedLayout.columns} defaultValue={DEFAULT_PRINT_LAYOUT.columns} elements={elements} printVariables={printVariables} evaluation={evaluation} min={1} step={1} onChange={(columns) => updatePrintLayout({ columns })} />
          <PrintNumberInput label="縦枚数" value={layout.rows} resolvedValue={resolvedLayout.rows} defaultValue={DEFAULT_PRINT_LAYOUT.rows} elements={elements} printVariables={printVariables} evaluation={evaluation} min={1} step={1} onChange={(rows) => updatePrintLayout({ rows })} />
          <PrintNumberInput label="重複 mm" value={layout.overlapMm} resolvedValue={resolvedLayout.overlapMm} defaultValue={DEFAULT_PRINT_LAYOUT.overlapMm} elements={elements} printVariables={printVariables} evaluation={evaluation} min={0} step={1} onChange={(overlapMm) => updatePrintLayout({ overlapMm })} />
            </>
          )}
          <PrintNumberInput label="拡大率" value={layout.scale} resolvedValue={resolvedLayout.scale} defaultValue={DEFAULT_PRINT_LAYOUT.scale} elements={elements} printVariables={printVariables} evaluation={evaluation} min={0.01} step={0.1} onChange={(scale) => updatePrintLayout({ scale })} />
          {isSvgLayout ? (
            <>
              <PrintNumberInput label="SVG幅 mm" value={layout.svgCanvasWidthMm} resolvedValue={resolvedLayout.svgCanvasWidthMm} defaultValue={DEFAULT_PRINT_LAYOUT.svgCanvasWidthMm} elements={elements} printVariables={printVariables} evaluation={evaluation} min={1} step={1} onChange={(svgCanvasWidthMm) => updatePrintLayout({ svgCanvasWidthMm })} />
              <PrintNumberInput label="SVG高さ mm" value={layout.svgCanvasHeightMm} resolvedValue={resolvedLayout.svgCanvasHeightMm} defaultValue={DEFAULT_PRINT_LAYOUT.svgCanvasHeightMm} elements={elements} printVariables={printVariables} evaluation={evaluation} min={1} step={1} onChange={(svgCanvasHeightMm) => updatePrintLayout({ svgCanvasHeightMm })} />
            </>
          ) : null}
        </div>
        </CollapsiblePanelSection>

        <CollapsiblePanelSection
          id="variables"
          title="印刷変数"
          subtitle="@名前で印刷設定から参照"
          collapsedSections={collapsedSections}
          onToggle={toggleSection}
          actions={<button type="button" onClick={addPrintVariable}>追加</button>}
        >
        {printVariables.length === 0 ? (
          <p className="empty-state">印刷変数はありません。</p>
        ) : (
          <div className="print-variable-list">
            {printVariables.map((variable, index) => (
              <div className="print-variable-row" key={variable.id}>
                <div className="curve-point-header">
                  <span>変数{index + 1}</span>
                  <button type="button" onClick={() => deletePrintVariable(variable.id)}>
                    削除
                  </button>
                </div>
                <label className="print-select-field">
                  <span>名前</span>
                  <input
                    type="text"
                    aria-label="印刷変数名"
                    value={variable.name}
                    onChange={(event) => updatePrintVariable(variable.id, { name: event.currentTarget.value })}
                  />
                </label>
                <PrintNumberInput
                  label="値"
                  value={variable.value}
                  resolvedValue={resolvedLayout.numericVariables.find((item) => item.id === variable.id)?.value ?? 30}
                  defaultValue={30}
                  elements={elements}
                  printVariables={printVariables}
                  evaluation={evaluation}
                  step={1}
                  onChange={(value) => updatePrintVariable(variable.id, { value })}
                />
              </div>
            ))}
          </div>
        )}
        </CollapsiblePanelSection>

        <CollapsiblePanelSection
          id="groups"
          title="印刷グループ"
          subtitle={`${groups.length}件 / 追加するグループを検索`}
          collapsedSections={collapsedSections}
          onToggle={toggleSection}
        >
        <input
          className="print-search-input"
          type="search"
          value={groupQuery}
          placeholder="グループ名で検索"
          aria-label="印刷グループを検索"
          onChange={(event) => setGroupQuery(event.currentTarget.value)}
        />
        {groups.length === 0 ? (
          <p className="empty-state">左のアウトラインで印刷するグループをONにしてください。</p>
        ) : (
          <div className="print-group-list">
            {filteredGroups.map((group) => (
              <button key={group.id} type="button" onClick={() => addPlacement(group.id)}>
                <span>{group.name}</span>
                <small>{placementCountByGroupId.get(group.id) ?? 0}</small>
                <Plus aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        </CollapsiblePanelSection>

        <CollapsiblePanelSection
          id="placements"
          title="配置"
          subtitle={`${layout.placements.length}件`}
          collapsedSections={collapsedSections}
          onToggle={toggleSection}
          className="print-placement-section"
        >
        {layout.placements.length === 0 ? (
          <p className="empty-state">印刷グループを追加してください。</p>
        ) : (
          <div className="print-placement-list">
            {layout.placements.map((placement, index) => {
              const placementGroup = allGroupsById.get(placement.groupId);
              const isPrintDisabled = !placementGroup || placementGroup.printEnabled !== true;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  ref={(element) => registerPlacementRow(placement.id, element)}
                  className={`print-placement-row ${placement.id === selectedPlacement?.id ? "selected" : ""} ${
                    isPrintDisabled ? "is-print-disabled" : ""
                  }`}
                  key={placement.id}
                  onClick={() => setSelectedPrintPlacementId(placement.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedPrintPlacementId(placement.id);
                  }}
                >
                  <span className="print-placement-index">{index + 1}</span>
                  <span className="print-placement-main">
                    <strong>{placementGroup?.name ?? placement.groupId}</strong>
                    <small>
                      x {formatNumber(resolvedLayout.placements.find((item) => item.id === placement.id)?.x ?? 0)} / y {formatNumber(resolvedLayout.placements.find((item) => item.id === placement.id)?.y ?? 0)} / {formatNumber(resolvedLayout.placements.find((item) => item.id === placement.id)?.angleDeg ?? 0)}°
                      {placement.mirrorX ? " / 反転" : ""}
                    </small>
                  </span>
                  {isPrintDisabled ? <span className="print-placement-badge">印刷OFF</span> : null}
                  <span className="print-placement-row-actions">
                    <button
                      type="button"
                      aria-label="配置を複製"
                      onClick={(event) => {
                        event.stopPropagation();
                        duplicatePlacement(placement);
                      }}
                    >
                      <Copy aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="配置を削除"
                      onClick={(event) => {
                        event.stopPropagation();
                        deletePlacement(placement.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </CollapsiblePanelSection>
      </div>
      <section className="panel-section print-placement-detail">
        <div className="section-header">
          <div>
            <h2>選択配置</h2>
            <p className="section-subtitle">
              {selectedPlacement ? allGroupsById.get(selectedPlacement.groupId)?.name ?? selectedPlacement.groupId : "未選択"}
            </p>
          </div>
        </div>
        {!selectedPlacement ? (
          <p className="empty-state">配置を選択してください。</p>
        ) : (
          <>
            <label className="print-select-field">
              <span>グループ</span>
              <select
                value={selectedPlacement.groupId}
                onChange={(event) => updatePlacement(selectedPlacement.id, { groupId: event.target.value })}
              >
                {selectedPlacementGroupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}{group.printEnabled === true ? "" : "（印刷OFF）"}
                  </option>
                ))}
              </select>
            </label>
            <div className="print-settings-grid">
              <PrintNumberInput label="x mm" value={selectedPlacement.x} resolvedValue={selectedResolvedPlacement?.x ?? 0} defaultValue={Math.round(canvas.widthMm / 2)} elements={elements} printVariables={printVariables} evaluation={evaluation} step={1} onChange={(x) => updatePlacement(selectedPlacement.id, { x })} />
              <PrintNumberInput label="y mm" value={selectedPlacement.y} resolvedValue={selectedResolvedPlacement?.y ?? 0} defaultValue={Math.round(canvas.heightMm / 2)} elements={elements} printVariables={printVariables} evaluation={evaluation} step={1} onChange={(y) => updatePlacement(selectedPlacement.id, { y })} />
              <PrintNumberInput label="角度" value={selectedPlacement.angleDeg} resolvedValue={selectedResolvedPlacement?.angleDeg ?? 0} defaultValue={0} elements={elements} printVariables={printVariables} evaluation={evaluation} step={1} onChange={(angleDeg) => updatePlacement(selectedPlacement.id, { angleDeg })} />
              <label className="print-checkbox-field">
                <input
                  type="checkbox"
                  checked={selectedPlacement.mirrorX}
                  onChange={(event) => updatePlacement(selectedPlacement.id, { mirrorX: event.target.checked })}
                />
                <span>左右反転</span>
              </label>
            </div>
          </>
        )}
      </section>
    </aside>
  );
};
