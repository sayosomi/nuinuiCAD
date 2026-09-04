import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hitTestCanvasGeometryAll, type ScreenPoint } from "../components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { type ViewportSize, worldToScreen } from "../components/canvasViewport";
import { canvasThemeCssVariables, type CanvasTheme } from "../components/canvasTheme";
import { CanvasOverlapCandidateMenu } from "../components/CanvasOverlapCandidateMenu";
import { candidateWheelDeltaFor } from "../components/canvasCandidateWheel";
import { computedReferencePathValue, type NumericComputedGeometryProperty } from "../geometry/numericExpressions";
import { formatValue } from "../geometry/numericReferencePaths";
import {
  filterReferencePickGeometryHits,
  hitTestReferencePickPoints
} from "../model/referencePickHitTest";
import type { ReferencePickPointHit } from "../model/referencePickHitTest";
import {
  referencePickCandidateOptionKey,
  type ReferencePickCandidate,
  type ReferencePickNumericPropertyOption
} from "../model/referencePickCandidates";
import {
  referencePickDraftKey,
  sameReferencePickHover,
  type ReferencePickHover
} from "../model/referencePickSession";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import type { CanvasPresentation } from "../components/canvasPresentation";
import {
  referencePickHoverForCanvasOption,
  type VscodeReferencePickCanvasSessionLike
} from "./referencePickCanvasSession";
import {
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
  session: VscodeReferencePickCanvasSessionLike;
  onHover: (hover: ReferencePickHover | null) => void;
  onSelect: (selection: ReferencePickHover | null) => void;
  onSelectNumericProperty?: (property: NumericComputedGeometryProperty) => void;
  onConfirm: () => void;
  onCancel: () => void;
  presentation?: CanvasPresentation;
  /** Proof that the render evaluation is current for the current document. */
  evaluationIsCurrent?: boolean;
};

const pointerScreenPoint = (event: PointerEvent, viewport: HTMLDivElement) => {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const eventTargetsReferencePickUi = (event: Event): boolean =>
  event.target instanceof Element && Boolean(event.target.closest("[data-reference-pick-ui='true']"));

const geometryOptionFor = (candidate: ReferencePickCandidate) => candidate.options.find((option) =>
  option.kind === "geometry" ||
  (option.kind === "numericProperty" && option.subgeometry.kind === "body")
) ?? candidate.options.find((option) => option.kind === "geometry" || option.kind === "numericProperty");

const numericPropertyOptionForHover = (
  candidate: ReferencePickCandidate,
  hover: ReferencePickHover
): ReferencePickNumericPropertyOption | null => {
  const option = candidate.options.find((candidateOption) =>
    candidateOption.kind === "numericProperty" &&
    candidateOption.reference.base === hover.reference.base &&
    (candidateOption.reference.pointKey ?? null) === (hover.reference.pointKey ?? null) &&
    candidateOption.subgeometry.kind === hover.numericSubgeometry?.kind &&
    (candidateOption.subgeometry.kind !== "point" ||
      (hover.numericSubgeometry?.kind === "point" &&
        candidateOption.subgeometry.anchor.elementId === hover.numericSubgeometry.anchor.elementId &&
        candidateOption.subgeometry.anchor.pointKey === hover.numericSubgeometry.anchor.pointKey))
  );
  return option?.kind === "numericProperty" ? option : null;
};

type ReferencePickPointCandidateMenu = {
  anchor: ScreenPoint;
  hits: readonly ReferencePickPointHit[];
  activeIndex: number;
  requestId: number;
};

const referencePickPointMenuKey = (menu: ReferencePickPointCandidateMenu): string => JSON.stringify([
  menu.requestId,
  menu.anchor,
  menu.hits.map((hit) => [hit.candidateElementId, referencePickCandidateOptionKey(hit.option)])
]);

const referencePickPropertyHelp = (
  property: NumericComputedGeometryProperty,
  presentation: CanvasPresentation | undefined
): string => {
  const intermediatePoint = property.match(/^intermediatePoints\[(\d+)\]\.(x|y)$/);
  if (intermediatePoint) {
    const index = Number(intermediatePoint[1]);
    const axis = intermediatePoint[2];
    return presentation?.text(
      `canvas.referencePick.propertyHelp.intermediatePoint.${axis}`,
      "",
      { index }
    ) ?? "";
  }
  return presentation?.text(`canvas.referencePick.propertyHelp.${property}`, "") ?? "";
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
  onSelectNumericProperty,
  onConfirm,
  onCancel,
  presentation,
  evaluationIsCurrent = false
}: VSCodeReferencePickOverlayProps) => {
  const [pointCandidateMenu, setPointCandidateMenuState] = useState<ReferencePickPointCandidateMenu | null>(null);
  const pointCandidateMenuRef = useRef<ReferencePickPointCandidateMenu | null>(null);
  const pointWheelRemainderRef = useRef(0);
  const setPointCandidateMenu = useCallback((next: ReferencePickPointCandidateMenu | null) => {
    const previous = pointCandidateMenuRef.current;
    if (!previous || !next || referencePickPointMenuKey(previous) !== referencePickPointMenuKey(next)) {
      pointWheelRemainderRef.current = 0;
    }
    pointCandidateMenuRef.current = next;
    setPointCandidateMenuState(next);
  }, []);
  type ReferencePickNumericPropertyMenu = {
    anchor: ScreenPoint;
    candidateElementId: string;
    reference: ReferencePickHover["reference"];
    properties: readonly NumericComputedGeometryProperty[];
    activeIndex: number;
    requestId: number;
  };
  const [numericPropertyMenu, setNumericPropertyMenuState] = useState<ReferencePickNumericPropertyMenu | null>(null);
  const numericPropertyMenuRef = useRef<ReferencePickNumericPropertyMenu | null>(null);
  const numericPropertyWheelRemainderRef = useRef(0);
  const setNumericPropertyMenu = useCallback((next: ReferencePickNumericPropertyMenu | null) => {
    const previous = numericPropertyMenuRef.current;
    const sameMenu = previous && next &&
      previous.requestId === next.requestId &&
      previous.anchor.x === next.anchor.x &&
      previous.anchor.y === next.anchor.y &&
      previous.candidateElementId === next.candidateElementId &&
      referencePickDraftKey(previous.reference) === referencePickDraftKey(next.reference) &&
      previous.properties.length === next.properties.length &&
      previous.properties.every((property, index) => property === next.properties[index]);
    if (!sameMenu) numericPropertyWheelRemainderRef.current = 0;
    numericPropertyMenuRef.current = next;
    setNumericPropertyMenuState(next);
  }, []);
  const pointerCursorOriginalRef = useRef<string | null>(null);
  const setPointerCandidateCursor = useCallback((selectable: boolean) => {
    const viewport = canvasFocusRef.current;
    if (!viewport) return;
    if (selectable) {
      if (pointerCursorOriginalRef.current === null) pointerCursorOriginalRef.current = viewport.style.cursor;
      viewport.style.cursor = "pointer";
      return;
    }
    if (pointerCursorOriginalRef.current !== null) {
      viewport.style.cursor = pointerCursorOriginalRef.current;
      pointerCursorOriginalRef.current = null;
    }
  }, [canvasFocusRef]);
  useEffect(() => () => setPointerCandidateCursor(false), [setPointerCandidateCursor, session.request.requestId, session.draft.status]);
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
      const candidate = hit && session.candidates.find((item) => item.elementId === hit.candidateElementId);
      return candidate && hit ? referencePickHoverForCanvasOption(candidate, hit.option) : null;
    }
    if (session.target.role === "numericPropertyBase") {
      const hit = pointHitsAt(screen)[0];
      const candidate = hit && session.candidates.find((item) => item.elementId === hit.candidateElementId);
      if (candidate && hit) return referencePickHoverForCanvasOption(candidate, hit.option);
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
    const option = candidate ? geometryOptionFor(candidate) : undefined;
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
    session.target.role,
    pointHitsAt
  ]);

  const numericPropertyForHit = useCallback((hover: ReferencePickHover | null) => {
    if (!hover) return null;
    const candidate = session.candidates.find((item) => item.elementId === hover.candidateElementId);
    return candidate ? numericPropertyOptionForHover(candidate, hover) : null;
  }, [session.candidates]);

  const activatePointCandidate = useCallback((index: number) => {
    const menu = pointCandidateMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId || menu.hits.length === 0) return;
    const wrappedIndex = ((index % menu.hits.length) + menu.hits.length) % menu.hits.length;
    const hit = menu.hits[wrappedIndex];
    if (!hit) return;
    const candidate = session.candidates.find((item) => item.elementId === hit.candidateElementId);
    if (!candidate) return;
    const hover = referencePickHoverForCanvasOption(candidate, hit.option);
    onSelect(hover);
    if (
      session.target.role === "numericPropertyBase" &&
      session.target.numericProperty?.kind === "propertySelectionRequired" &&
      hit.option.kind === "numericProperty"
    ) {
      setNumericPropertyMenu({
        anchor: menu.anchor,
        candidateElementId: hit.candidateElementId,
        reference: hit.option.reference,
        properties: hit.option.properties,
        activeIndex: 0,
        requestId: session.request.requestId
      });
    }
    setPointCandidateMenu(null);
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [
    canvasFocusRef,
    onSelect,
    session.candidates,
    session.request.requestId,
    session.target.numericProperty,
    session.target.role,
    setNumericPropertyMenu,
    setPointCandidateMenu
  ]);

  const cyclePointCandidate = useCallback((offset: number) => {
    const menu = pointCandidateMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId) return;
    const next = ((menu.activeIndex + offset) % menu.hits.length + menu.hits.length) % menu.hits.length;
    setPointCandidateMenu({ ...menu, activeIndex: next });
  }, [session.request.requestId, setPointCandidateMenu]);

  const activateNumericProperty = useCallback((index: number) => {
    const menu = numericPropertyMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId || menu.properties.length === 0) return;
    const wrappedIndex = ((index % menu.properties.length) + menu.properties.length) % menu.properties.length;
    const property = menu.properties[wrappedIndex];
    if (!property) return;
    onSelectNumericProperty?.(property);
    setNumericPropertyMenu(null);
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [canvasFocusRef, onSelectNumericProperty, session.request.requestId, setNumericPropertyMenu]);

  const cycleNumericProperty = useCallback((offset: number) => {
    const menu = numericPropertyMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId) return;
    const next = ((menu.activeIndex + offset) % menu.properties.length + menu.properties.length) % menu.properties.length;
    setNumericPropertyMenu({ ...menu, activeIndex: next });
  }, [session.request.requestId, setNumericPropertyMenu]);

  const handleReferencePickWheel = useCallback((event: WheelEvent) => {
    if (session.draft.status !== "active") return;
    const requestId = session.request.requestId;
    const numericMenu = numericPropertyMenuRef.current;
    if (numericMenu && numericMenu.requestId === requestId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = candidateWheelDeltaFor({
        remainder: numericPropertyWheelRemainderRef.current,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        viewportHeight: viewportSize.height
      });
      numericPropertyWheelRemainderRef.current = next.remainder;
      if (next.cycles !== 0) cycleNumericProperty(next.cycles);
      return;
    }
    const pointMenu = pointCandidateMenuRef.current;
    if (!pointMenu || pointMenu.requestId !== requestId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = candidateWheelDeltaFor({
      remainder: pointWheelRemainderRef.current,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      viewportHeight: viewportSize.height
    });
    pointWheelRemainderRef.current = next.remainder;
    if (next.cycles !== 0) cyclePointCandidate(next.cycles);
  }, [cycleNumericProperty, cyclePointCandidate, session.draft.status, session.request.requestId, viewportSize.height]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;
    viewport.addEventListener("wheel", handleReferencePickWheel, { capture: true, passive: false });
    return () => viewport.removeEventListener("wheel", handleReferencePickWheel, { capture: true });
  }, [canvasFocusRef, handleReferencePickWheel, session.draft.status]);

  useEffect(() => {
    pointWheelRemainderRef.current = 0;
    numericPropertyWheelRemainderRef.current = 0;
    if (pointCandidateMenuRef.current?.requestId !== session.request.requestId) {
      pointCandidateMenuRef.current = null;
    }
    if (numericPropertyMenuRef.current?.requestId !== session.request.requestId) {
      numericPropertyMenuRef.current = null;
    }
  }, [session.draft.status, session.request.requestId]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;
    viewport.focus({ preventScroll: true });
  }, [canvasFocusRef, session.request.requestId, session.draft.status]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;

    const handlePointerMove = (event: PointerEvent) => {
      if (eventTargetsReferencePickUi(event)) {
        setPointerCandidateCursor(false);
        return;
      }
      const next = hitAt(pointerScreenPoint(event, viewport));
      setPointerCandidateCursor(next !== null);
      if (!sameReferencePickHover(next, session.draft.hover)) onHover(next);
    };
    const handlePointerLeave = () => {
      setPointerCandidateCursor(false);
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
      const numericMenu = numericPropertyMenuRef.current;
      if (numericMenu && numericMenu.requestId === session.request.requestId && eventTargetsReferencePickUi(event)) return;
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
          const candidate = hit && session.candidates.find((item) => item.elementId === hit.candidateElementId);
          onSelect(candidate && hit ? referencePickHoverForCanvasOption(candidate, hit.option) : null);
        }
      } else {
        const semanticHits = session.target.role === "numericPropertyBase" ? pointHitsAt(screen) : [];
        if (semanticHits.length > 1) {
          setPointCandidateMenu({
            anchor: screen,
            hits: semanticHits,
            activeIndex: 0,
            requestId: session.request.requestId
          });
          viewport.focus();
          return;
        }
        const semanticHit = semanticHits[0];
        const semanticCandidate = semanticHit && session.candidates.find((item) => item.elementId === semanticHit.candidateElementId);
        const hit = semanticCandidate && semanticHit
          ? referencePickHoverForCanvasOption(semanticCandidate, semanticHit.option)
          : hitAt(screen);
        const option = numericPropertyForHit(hit);
        setNumericPropertyMenu(
          session.target.role === "numericPropertyBase" &&
          session.target.numericProperty?.kind === "propertySelectionRequired" &&
          hit &&
          option
            ? {
                anchor: screen,
                candidateElementId: hit.candidateElementId,
                reference: hit.reference,
                properties: option.properties,
                activeIndex: 0,
                requestId: session.request.requestId
              }
            : null
        );
        onSelect(hit);
      }
      viewport.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const numericMenu = numericPropertyMenuRef.current;
      if (numericMenu && numericMenu.requestId === session.request.requestId) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cycleNumericProperty(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          activateNumericProperty(numericMenu.activeIndex);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setNumericPropertyMenu(null);
          onSelect(null);
          viewport.focus();
          return;
        }
      }
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
        const canConfirm = session.target.role === "numericPropertyBase"
          ? Boolean(session.draft.numericProperty?.draft)
          : session.draft.multiplicity === "multiple" || session.draft.draftReferences.length === 1;
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
  }, [
    activateNumericProperty,
    activatePointCandidate,
    canvasFocusRef,
    cycleNumericProperty,
    cyclePointCandidate,
    hitAt,
    numericPropertyForHit,
    onCancel,
    onConfirm,
    onHover,
    onSelect,
    pointHitsAt,
    session.candidates,
    session.draft,
    session.request.requestId,
    session.target.expectedGeometryInterface,
    session.target.numericProperty,
    session.target.role,
    setNumericPropertyMenu,
    setPointerCandidateCursor,
    setPointCandidateMenu
  ]);

  const draftKeys = useMemo(
    () => new Set([
      ...session.draft.draftReferences.map(referencePickDraftKey),
      ...(session.draft.numericProperty?.draft ? [referencePickDraftKey(session.draft.numericProperty.draft.reference)] : [])
    ]),
    [session.draft.draftReferences, session.draft.numericProperty]
  );
  const hoverKey = session.draft.hover
    ? `${session.draft.hover.candidateElementId}:${referencePickDraftKey(session.draft.hover.reference)}`
    : null;
  const geometryStateByElementId = useMemo(() => {
    const result = new Map<string, { candidate: boolean; draft: boolean; hover: boolean }>();
    for (const candidate of session.candidates) {
      const option = geometryOptionFor(candidate);
      if (!option) continue;
      const key = referencePickDraftKey(option.reference);
      result.set(candidate.elementId, {
        candidate: true,
        draft: draftKeys.has(key),
        hover: hoverKey === `${candidate.elementId}:${key}`
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

  type ReferencePickOverlayPoint = {
    candidateElementId: string;
    option: ReferencePickPointHit["option"];
  };
  const pointOptions = useMemo<ReferencePickOverlayPoint[]>(() => session.candidates.flatMap((candidate) =>
    candidate.options.flatMap<ReferencePickOverlayPoint>((option): ReferencePickOverlayPoint[] => {
      if (option.kind === "point") return [{ candidateElementId: candidate.elementId, option }];
      if (option.kind === "numericProperty" && option.point) {
        return [{ candidateElementId: candidate.elementId, option: { ...option, point: option.point } }];
      }
      return [];
    })
  ), [session.candidates]);
  const numericPropertyState = session.draft.numericProperty;
  const canConfirm = session.target.role === "numericPropertyBase"
    ? Boolean(numericPropertyState?.draft)
    : session.draft.multiplicity === "multiple" || session.draft.draftReferences.length === 1;
  const selectionCount = session.target.role === "numericPropertyBase"
    ? numericPropertyState?.draft ? 1 : 0
    : session.draft.draftReferences.length;
  const targetLabel = session.target.role === "endpoint"
    ? presentation?.text("canvas.referencePick.target.endpoint", "Endpoint") ?? "Endpoint"
    : session.target.role === "numericPropertyBase"
      ? presentation?.text("canvas.referencePick.target.geometryBase", "Geometry base") ?? "Geometry base"
      : session.target.expectedGeometryInterface === "point"
        ? presentation?.text("canvas.referencePick.target.point", "Point") ?? "Point"
        : session.target.expectedGeometryInterface === "line"
          ? presentation?.text("canvas.referencePick.target.line", "Line") ?? "Line"
          : presentation?.text("canvas.referencePick.target.path", "Path") ?? "Path";
  const instruction = session.target.role === "numericPropertyBase" &&
    numericPropertyState?.stage === "propertySelection"
    ? presentation?.text("canvas.referencePick.instruction.selectProperty", "Select a property") ?? "Select a property"
    : session.draft.multiplicity === "multiple"
    ? presentation?.text("canvas.referencePick.instruction.selectedCount", "{count} selected", { count: selectionCount }) ?? `${selectionCount} selected`
    : selectionCount === 0
      ? presentation?.text("canvas.referencePick.instruction.selectCandidate", "Select a candidate") ?? "Select a candidate"
      : presentation?.text("canvas.referencePick.instruction.referenceSelected", "Reference selected") ?? "Reference selected";
  const currentPointCandidateMenu = session.draft.status === "active" && pointCandidateMenu?.requestId === session.request.requestId
    ? pointCandidateMenu
    : null;
  const pointMenuCandidates = currentPointCandidateMenu?.hits.map((hit, index) => ({
    id: `${index}-${hit.candidateElementId}-${referencePickCandidateOptionKey(hit.option)}`,
    name: referencePickSourceForReference(hit.option.reference),
    detail: `${hit.option.label} · ${hit.candidateElementId}`
  })) ?? [];
  const currentNumericPropertyMenu = session.draft.status === "active" && numericPropertyMenu?.requestId === session.request.requestId
    ? numericPropertyMenu
    : null;
  const numericPropertyMenuCandidates = currentNumericPropertyMenu?.properties.map((property, index) => ({
    id: `${index}-${property}`,
    name: [property, referencePickPropertyHelp(property, presentation)].filter(Boolean).join(" — "),
    detail: referencePickSourceForReference(currentNumericPropertyMenu.reference)
  })) ?? [];
  const numericDraft = numericPropertyState?.stage === "draft" ? numericPropertyState.draft : null;
  const numericDraftFeedback = numericDraft
    ? (() => {
        const expression = `${referencePickSourceForReference(numericDraft.reference)}.${numericDraft.property}`;
        const geometry = evaluationIsCurrent
          ? evaluation.computedGeometry.get(numericDraft.candidateElementId)
          : undefined;
        const value = computedReferencePathValue(geometry, numericDraft.property);
        return typeof value === "number" && Number.isFinite(value)
          ? `${expression} = ${formatValue(value, numericDraft.property)}`
          : expression;
      })()
    : null;

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
          const candidate = session.candidates.find((item) => item.elementId === candidateElementId);
          if (!candidate) return null;
          const screen = worldToScreen(option.point, viewportSize, canvasViewport);
          const key = referencePickDraftKey(option.reference);
          const isDraft = draftKeys.has(key);
          const isHover = sameReferencePickHover(
            session.draft.hover,
            referencePickHoverForCanvasOption(candidate, option)
          );
          return (
            <circle
              key={`reference-pick-point-${candidateElementId}-${referencePickCandidateOptionKey(option)}`}
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
            {presentation?.text("canvas.referencePick.badge", "Pick · {target}", { target: targetLabel }) ?? `Pick · ${targetLabel}`}
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
            ariaLabel={presentation?.text(
              "canvas.referencePick.menu.pointCandidates",
              "Reference Pick point candidates"
            ) ?? "Reference Pick point candidates"}
            onFocusViewport={() => canvasFocusRef.current?.focus()}
            onActivate={activatePointCandidate}
          />
        </div>
      ) : null}
      {currentNumericPropertyMenu ? (
        <div data-reference-pick-ui="true">
          <CanvasOverlapCandidateMenu
            anchor={currentNumericPropertyMenu.anchor}
            candidates={numericPropertyMenuCandidates}
            activeIndex={currentNumericPropertyMenu.activeIndex}
            viewportSize={viewportSize}
            idPrefix="reference-pick-numeric-property"
            ariaLabel={presentation?.text(
              "canvas.referencePick.menu.numericProperties",
              "Reference Pick numeric properties"
            ) ?? "Reference Pick numeric properties"}
            onFocusViewport={() => canvasFocusRef.current?.focus()}
            onActivate={activateNumericProperty}
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
        <strong>{presentation?.text("canvas.referencePick.targetStatus", "{target} target", { target: targetLabel }) ?? `${targetLabel} target`}</strong>
        <small style={{ color: canvasTheme.muted }}>{numericDraftFeedback ?? instruction}</small>
        <span className="point-drag-axis-lock-action">
          {presentation?.text("canvas.referencePick.enterDone", "Enter Done") ?? "Enter Done"}
        </span>
        <span className="point-drag-axis-lock-action">
          {presentation?.text("canvas.referencePick.escCancel", "Esc Cancel") ?? "Esc Cancel"}
        </span>
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
          {presentation?.text("canvas.referencePick.done", "Done") ?? "Done"}
        </button>
      </aside>
    </>
  );
};
