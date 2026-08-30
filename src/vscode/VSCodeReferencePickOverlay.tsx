import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hitTestCanvasGeometryAll, type ScreenPoint } from "../components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { type ViewportSize, worldToScreen } from "../components/canvasViewport";
import { canvasThemeCssVariables, type CanvasTheme } from "../components/canvasTheme";
import { CanvasOverlapCandidateMenu } from "../components/CanvasOverlapCandidateMenu";
import {
  filterReferencePickGeometryHits,
  hitTestReferencePickPoints
} from "../model/referencePickHitTest";
import type { ReferencePickPointHit } from "../model/referencePickHitTest";
import { referencePickDraftKey, type ReferencePickHover } from "../model/referencePickSession";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import {
  referencePickHoverForCanvasOption,
  type VscodeReferencePickCanvasSession
} from "./referencePickCanvasSession";
import {
  referencePickReferenceKey,
  referencePickSourceForReference
} from "./referencePickProtocol";

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

type ReferencePickPointCandidateMenu = {
  anchor: ScreenPoint;
  hits: readonly ReferencePickPointHit[];
  activeIndex: number;
  requestId: number;
};

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
  const [pointCandidateMenu, setPointCandidateMenuState] = useState<ReferencePickPointCandidateMenu | null>(null);
  const pointCandidateMenuRef = useRef<ReferencePickPointCandidateMenu | null>(null);
  const setPointCandidateMenu = useCallback((next: ReferencePickPointCandidateMenu | null) => {
    pointCandidateMenuRef.current = next;
    setPointCandidateMenuState(next);
  }, []);
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

  const pointHitsAt = useCallback((screen: ScreenPoint): ReferencePickPointHit[] => hitTestReferencePickPoints({
    screen,
    candidates: session.candidates,
    worldToScreen: (point) => worldToScreen(point, viewportSize, canvasViewport)
  }), [canvasViewport, session.candidates, viewportSize]);

  const hitAt = useCallback((screen: { x: number; y: number }): ReferencePickHover | null => {
    if (session.target.expectedGeometryInterface === "point") {
      const hit = pointHitsAt(screen)[0];
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
      polylines: overlay.overlayPolylines,
      images: overlay.overlayImages,
      texts: overlay.overlayTexts,
      points: overlay.overlayPoints
    }), session.candidates)[0];
    if (!hit) return null;
    const candidate = session.candidates.find((item) => item.elementId === hit.elementId);
    const option = candidate?.options.find((item) => item.kind === "geometry");
    return candidate && option ? referencePickHoverForCanvasOption(candidate, option) : null;
  }, [
    overlay.overlayArcs,
    overlay.overlayCurves,
    overlay.overlayImages,
    overlay.overlayLines,
    overlay.overlayOffsetLines,
    overlay.overlayPolylines,
    overlay.overlayPoints,
    overlay.overlayTexts,
    session.candidates,
    session.target.expectedGeometryInterface,
    pointHitsAt
  ]);

  const activatePointCandidate = useCallback((index: number) => {
    const menu = pointCandidateMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId || menu.hits.length === 0) return;
    const wrappedIndex = ((index % menu.hits.length) + menu.hits.length) % menu.hits.length;
    const hit = menu.hits[wrappedIndex];
    if (!hit) return;
    onSelect({ candidateElementId: hit.candidateElementId, reference: hit.option.reference });
    setPointCandidateMenu(null);
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [canvasFocusRef, onSelect, session.request.requestId, setPointCandidateMenu]);

  const cyclePointCandidate = useCallback((offset: number) => {
    const menu = pointCandidateMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId) return;
    const next = ((menu.activeIndex + offset) % menu.hits.length + menu.hits.length) % menu.hits.length;
    setPointCandidateMenu({ ...menu, activeIndex: next });
  }, [session.request.requestId, setPointCandidateMenu]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;
    viewport.focus({ preventScroll: true });
  }, [canvasFocusRef, session.request.requestId, session.draft.status]);

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
      if (event.button !== 0) return;
      const pointMenu = pointCandidateMenuRef.current;
      if (pointMenu && pointMenu.requestId === session.request.requestId) {
        if (eventTargetsReferencePickUi(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setPointCandidateMenu(null);
        viewport.focus();
        return;
      }
      if (eventTargetsReferencePickUi(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const screen = pointerScreenPoint(event, viewport);
      if (session.target.expectedGeometryInterface === "point") {
        const hits = pointHitsAt(screen);
        if (hits.length > 1) {
          setPointCandidateMenu({ anchor: screen, hits, activeIndex: 0, requestId: session.request.requestId });
        } else {
          const hit = hits[0];
          onSelect(hit ? { candidateElementId: hit.candidateElementId, reference: hit.option.reference } : null);
        }
      } else {
        onSelect(hitAt(screen));
      }
      viewport.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const pointMenu = pointCandidateMenuRef.current;
      if (pointMenu && pointMenu.requestId === session.request.requestId) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cyclePointCandidate(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          activatePointCandidate(pointMenu.activeIndex);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setPointCandidateMenu(null);
          viewport.focus();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (eventTargetsReferencePickUi(event)) return;
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
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      viewport.removeEventListener("pointermove", handlePointerMove, true);
      viewport.removeEventListener("pointerleave", handlePointerLeave, true);
      viewport.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activatePointCandidate, canvasFocusRef, cyclePointCandidate, hitAt, onCancel, onConfirm, onHover, onSelect, pointHitsAt, session.draft, session.request.requestId, session.target.expectedGeometryInterface, setPointCandidateMenu]);

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
      {overlay.overlayPolylines.map(({ polyline, points }) => {
        const style = geometryStyle(polyline.elementId);
        return style ? (
          <polyline key={`reference-pick-polyline-${polyline.elementId}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...style} />
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
  const targetLabel = session.target.role === "endpoint"
    ? "Endpoint"
    : session.target.role === "numericPropertyBase"
      ? "Geometry base"
      : session.target.expectedGeometryInterface === "point"
        ? "Point"
        : session.target.expectedGeometryInterface === "line"
          ? "Line"
          : "Path";
  const instruction = session.draft.multiplicity === "multiple"
    ? `${selectionCount} selected`
    : selectionCount === 0
      ? "Select a candidate"
      : "Reference selected";
  const currentPointCandidateMenu = pointCandidateMenu?.requestId === session.request.requestId
    ? pointCandidateMenu
    : null;
  const pointMenuCandidates = currentPointCandidateMenu?.hits.map((hit, index) => ({
    id: `${index}-${hit.candidateElementId}-${referencePickReferenceKey(hit.option.reference)}`,
    name: referencePickSourceForReference(hit.option.reference),
    detail: `${hit.option.label} · ${hit.candidateElementId}`
  })) ?? [];

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
      {session.draft.status === "active" ? (
        <>
          <div
            data-reference-pick-frame="true"
            aria-hidden="true"
            style={{
              ...canvasThemeCssVariables(canvasTheme),
              position: "absolute",
              inset: 0,
              boxSizing: "border-box",
              border: "4px solid var(--canvas-accent)",
              pointerEvents: "none",
              zIndex: 4
            }}
          />
          <div
            data-reference-pick-badge="true"
            data-reference-pick-ui="true"
            style={{
              ...canvasThemeCssVariables(canvasTheme),
              position: "absolute",
              top: 8,
              left: 8,
              boxSizing: "border-box",
              border: "1px solid var(--canvas-accent)",
              borderRadius: 4,
              background: "color-mix(in srgb, var(--canvas-background) 88%, transparent)",
              color: "var(--canvas-foreground)",
              padding: "4px 7px",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 5
            }}
          >
            Pick · {targetLabel}
          </div>
        </>
      ) : null}
      {currentPointCandidateMenu ? (
        <div data-reference-pick-ui="true">
          <CanvasOverlapCandidateMenu
            anchor={currentPointCandidateMenu.anchor}
            candidates={pointMenuCandidates}
            activeIndex={currentPointCandidateMenu.activeIndex}
            viewportSize={viewportSize}
            idPrefix="reference-pick-point-candidate"
            ariaLabel="Reference Pick point candidates"
            onFocusViewport={() => canvasFocusRef.current?.focus()}
            onActivate={activatePointCandidate}
          />
        </div>
      ) : null}
      <aside
        className="point-drag-axis-lock-hint"
        data-reference-pick-ui="true"
        data-reference-pick-hint-position="bottom-right"
        role="status"
        aria-live="polite"
        style={{
          ...canvasThemeCssVariables(canvasTheme),
          right: 0,
          bottom: 0,
          maxWidth: "min(720px, calc(100% - 16px))",
          gap: 8,
          pointerEvents: "auto"
        }}
      >
        <strong>{targetLabel} target</strong>
        <small style={{ color: canvasTheme.muted }}>{instruction}</small>
        <span className="point-drag-axis-lock-action">Enter Done</span>
        <span className="point-drag-axis-lock-action">Esc Cancel</span>
        <button
          type="button"
          disabled={!canConfirm}
          onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
          onClick={onConfirm}
          style={{
            marginLeft: "auto",
            borderColor: canvasTheme.accent,
            background: canvasTheme.background,
            color: canvasTheme.accent,
            padding: "4px 8px",
            whiteSpace: "nowrap"
          }}
        >
          Done
        </button>
      </aside>
    </>
  );
};
