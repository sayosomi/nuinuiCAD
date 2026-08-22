import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { hitTestCanvasGeometryAll } from "../components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { type ViewportSize, worldToScreen } from "../components/canvasViewport";
import { canvasThemeCssVariables, type CanvasTheme } from "../components/canvasTheme";
import {
  filterReferencePickGeometryHits,
  hitTestReferencePickPoints
} from "../model/referencePickHitTest";
import { referencePickDraftKey, type ReferencePickHover } from "../model/referencePickSession";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import {
  referencePickHoverForCanvasOption,
  type VscodeReferencePickCanvasSession
} from "./referencePickCanvasSession";
import { referencePickReferenceKey } from "./referencePickProtocol";

type VSCodeReferencePickOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
  canvasTheme: CanvasTheme;
  elements: CadElement[];
  evaluation: EvaluationResult;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  session: VscodeReferencePickCanvasSession;
  onHover: (hover: ReferencePickHover | null) => void;
  onSelect: (selection: ReferencePickHover | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const sameHover = (left: ReferencePickHover | null, right: ReferencePickHover | null): boolean => {
  if (!left || !right) return left === right;
  return left.candidateElementId === right.candidateElementId &&
    referencePickReferenceKey(left.reference) === referencePickReferenceKey(right.reference);
};

const pointerScreenPoint = (event: PointerEvent, viewport: HTMLDivElement) => {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const eventTargetsReferencePickUi = (event: Event): boolean =>
  event.target instanceof Element && Boolean(event.target.closest("[data-reference-pick-ui='true']"));

export const VSCodeReferencePickOverlay = ({
  canvasFocusRef,
  viewportSize,
  canvasViewport,
  canvasTheme,
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId,
  session,
  onHover,
  onSelect,
  onConfirm,
  onCancel
}: VSCodeReferencePickOverlayProps) => {
  const overlay = useCanvasOverlayData({
    evaluation,
    elements,
    selectedElementId: null,
    pointPickCandidates: [],
    viewportSize,
    canvasViewport,
    visibilityProfiles,
    activeVisibilityProfileId,
    resolveImageSourceUrl: (sourcePath) => sourcePath
  });

  const hitAt = useCallback((screen: { x: number; y: number }): ReferencePickHover | null => {
    if (session.target.expectedGeometryInterface === "point") {
      const hit = hitTestReferencePickPoints({
        screen,
        candidates: session.candidates,
        worldToScreen: (point) => worldToScreen(point, viewportSize, canvasViewport)
      })[0];
      return hit
        ? { candidateElementId: hit.candidateElementId, reference: hit.option.reference }
        : null;
    }

    const hit = filterReferencePickGeometryHits(hitTestCanvasGeometryAll({
      screen,
      lines: overlay.overlayLines,
      arcs: overlay.overlayArcs,
      curves: overlay.overlayCurves,
      offsetLines: overlay.overlayOffsetLines,
      images: overlay.overlayImages,
      texts: overlay.overlayTexts,
      points: overlay.overlayPoints
    }), session.candidates)[0];
    if (!hit) return null;
    const candidate = session.candidates.find((item) => item.elementId === hit.elementId);
    const option = candidate?.options.find((item) => item.kind === "geometry");
    return candidate && option ? referencePickHoverForCanvasOption(candidate, option) : null;
  }, [
    canvasViewport,
    overlay.overlayArcs,
    overlay.overlayCurves,
    overlay.overlayImages,
    overlay.overlayLines,
    overlay.overlayOffsetLines,
    overlay.overlayPoints,
    overlay.overlayTexts,
    session.candidates,
    session.target.expectedGeometryInterface,
    viewportSize
  ]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;

    const handlePointerMove = (event: PointerEvent) => {
      if (eventTargetsReferencePickUi(event)) return;
      const next = hitAt(pointerScreenPoint(event, viewport));
      if (!sameHover(next, session.draft.hover)) onHover(next);
    };
    const handlePointerLeave = () => {
      if (session.draft.hover) onHover(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || eventTargetsReferencePickUi(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onSelect(hitAt(pointerScreenPoint(event, viewport)));
      viewport.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (eventTargetsReferencePickUi(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        const canConfirm = session.draft.multiplicity === "multiple" || session.draft.draftReferences.length === 1;
        if (!canConfirm) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onConfirm();
      }
    };

    viewport.addEventListener("pointermove", handlePointerMove, true);
    viewport.addEventListener("pointerleave", handlePointerLeave, true);
    viewport.addEventListener("pointerdown", handlePointerDown, true);
    viewport.addEventListener("keydown", handleKeyDown, true);
    return () => {
      viewport.removeEventListener("pointermove", handlePointerMove, true);
      viewport.removeEventListener("pointerleave", handlePointerLeave, true);
      viewport.removeEventListener("pointerdown", handlePointerDown, true);
      viewport.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [canvasFocusRef, hitAt, onCancel, onConfirm, onHover, onSelect, session.draft]);

  const draftKeys = useMemo(
    () => new Set(session.draft.draftReferences.map(referencePickDraftKey)),
    [session.draft.draftReferences]
  );
  const hoverKey = session.draft.hover ? referencePickDraftKey(session.draft.hover.reference) : null;
  const geometryStateByElementId = useMemo(() => {
    const result = new Map<string, { candidate: boolean; draft: boolean; hover: boolean }>();
    for (const candidate of session.candidates) {
      const option = candidate.options.find((item) => item.kind === "geometry");
      if (!option) continue;
      const key = referencePickDraftKey(option.reference);
      result.set(candidate.elementId, {
        candidate: true,
        draft: draftKeys.has(key),
        hover: hoverKey === key
      });
    }
    return result;
  }, [draftKeys, hoverKey, session.candidates]);

  const geometryStyle = (elementId: string) => {
    const state = geometryStateByElementId.get(elementId);
    if (!state) return null;
    if (state.draft) return {
      stroke: "var(--canvas-selection)",
      strokeWidth: 5,
      opacity: 0.9,
      strokeDasharray: undefined
    };
    if (state.hover) return {
      stroke: "var(--canvas-pick-candidate)",
      strokeWidth: 4,
      opacity: 0.95,
      strokeDasharray: "8 4"
    };
    return {
      stroke: "var(--canvas-pick-candidate)",
      strokeWidth: 2,
      opacity: 0.28,
      strokeDasharray: "3 5"
    };
  };

  const renderGeometry = () => (
    <>
      {overlay.overlayLines.map(({ line, start, end }) => {
        const style = geometryStyle(line.elementId);
        return style ? (
          <line key={`reference-pick-line-${line.elementId}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...style} />
        ) : null;
      })}
      {overlay.overlayArcs.map(({ arc, points }) => {
        const style = geometryStyle(arc.elementId);
        return style ? (
          <polyline key={`reference-pick-arc-${arc.elementId}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...style} />
        ) : null;
      })}
      {overlay.overlayCurves.map(({ curve, points }) => {
        const style = geometryStyle(curve.elementId);
        return style ? (
          <polyline key={`reference-pick-curve-${curve.elementId}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...style} />
        ) : null;
      })}
      {overlay.overlayOffsetLines.map(({ line, points }) => {
        const style = geometryStyle(line.elementId);
        return style ? (
          <polyline key={`reference-pick-offset-${line.elementId}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...style} />
        ) : null;
      })}
    </>
  );

  const pointOptions = useMemo(() => session.candidates.flatMap((candidate) =>
    candidate.options.flatMap((option) => option.kind === "point"
      ? [{ candidateElementId: candidate.elementId, option }]
      : [])
  ), [session.candidates]);
  const canConfirm = session.draft.multiplicity === "multiple" || session.draft.draftReferences.length === 1;
  const selectionCount = session.draft.draftReferences.length;
  const instruction = session.draft.multiplicity === "multiple"
    ? `Select references on Canvas (${selectionCount} selected).`
    : selectionCount === 0
      ? "Select a reference on Canvas."
      : "Reference selected. Choose Done or press Enter.";

  return (
    <>
      <svg
        data-reference-pick-visuals="true"
        viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
        style={{
          ...canvasThemeCssVariables(canvasTheme),
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible"
        }}
        aria-hidden="true"
      >
        {renderGeometry()}
        {pointOptions.map(({ candidateElementId, option }) => {
          const screen = worldToScreen(option.point, viewportSize, canvasViewport);
          const key = referencePickDraftKey(option.reference);
          const isDraft = draftKeys.has(key);
          const isHover = hoverKey === key && session.draft.hover?.candidateElementId === candidateElementId;
          return (
            <circle
              key={`reference-pick-point-${candidateElementId}-${key}`}
              cx={screen.x}
              cy={screen.y}
              r={isDraft ? 7 : isHover ? 8 : 6}
              fill={isDraft ? "var(--canvas-selection)" : "var(--canvas-background)"}
              stroke={isDraft ? "var(--canvas-selection)" : "var(--canvas-pick-candidate)"}
              strokeWidth={isDraft ? 2.5 : isHover ? 3 : 1.5}
              opacity={isDraft || isHover ? 0.95 : 0.72}
            />
          );
        })}
      </svg>
      <aside
        className="pick-mode-status"
        data-reference-pick-ui="true"
        role="status"
        aria-live="polite"
        style={canvasThemeCssVariables(canvasTheme)}
      >
        <span className="pick-mode-status-title" aria-hidden="true">PICK MODE</span>
        <span className="pick-mode-status-copy">
          <strong>Pick Reference from Canvas</strong>
          <small>{instruction}</small>
        </span>
        <button
          type="button"
          disabled={!canConfirm}
          onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
          onClick={onConfirm}
        >
          Done
        </button>
        <kbd>Enter</kbd>
        <kbd>Esc</kbd>
      </aside>
    </>
  );
};
