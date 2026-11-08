import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasIdentityCandidate } from "../components/DrawingCanvasTypes";
import { hitTestCanvasGeometryAll, type ScreenPoint } from "../components/DrawingCanvasHitTest";
import { useCanvasOverlayData } from "../components/useCanvasOverlayData";
import { type ViewportSize, worldToScreen } from "../components/canvasViewport";
import { canvasThemeCssVariables, type CanvasTheme } from "../components/canvasTheme";
import { CanvasOverlapCandidateMenu } from "../components/CanvasOverlapCandidateMenu";
import { candidateWheelDeltaFor } from "../components/canvasCandidateWheel";
import type { NumericComputedGeometryProperty } from "../geometry/numericExpressions";
import {
  filterReferencePickGeometryHits,
  hitTestReferencePickPoints
} from "../model/referencePickHitTest";
import type { ReferencePickPointHit } from "../model/referencePickHitTest";
import {
  referencePickCandidateOptionKey,
  type ReferencePickCandidate,
  type ReferencePickCandidateOption,
  type ReferencePickNumericPropertyOption
} from "../model/referencePickCandidates";
import {
  referencePickCandidatePresentationForHits,
  type ReferencePickCandidateExplanation,
  type PresentedReferencePickGeometryOption
} from "./referencePickCandidatePresentation";
import {
  referencePickDraftKey,
  sameReferencePickHover,
  type ReferencePickHover
} from "../model/referencePickSession";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";
import type { CanvasPresentation } from "../components/canvasPresentation";
import {
  referencePickCanvasEvaluationFor,
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
  showCanvasGeometryNames?: boolean;
  onHover: (hover: ReferencePickHover | null) => void;
  onSelect: (selection: ReferencePickHover | null) => void;
  onSelectNumericProperty?: (property: NumericComputedGeometryProperty) => void;
  onConfirm: () => void;
  onCancel: () => void;
  presentation?: CanvasPresentation;
};

const pointerScreenPoint = (event: PointerEvent, viewport: HTMLDivElement) => {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const eventTargetsReferencePickUi = (event: Event): boolean =>
  event.target instanceof Element && Boolean(event.target.closest(
    "[data-reference-pick-ui='true'], [data-canvas-mode-chrome='true']"
  ));

const referencePickPopupForWheel = (event: WheelEvent): HTMLElement | null =>
  event.target instanceof Element
    ? event.target.closest<HTMLElement>(".canvas-overlap-candidate-menu")
    : null;

const referencePickPopupCanScroll = (popup: HTMLElement, event: WheelEvent): boolean => {
  const eventTarget = event.target instanceof HTMLElement ? event.target : popup;
  for (let current: HTMLElement | null = eventTarget; current; current = current.parentElement) {
    if (
      (current.classList.contains("canvas-overlap-candidate-menu") ||
        current.classList.contains("canvas-overlap-candidate-menu__contents")) &&
      current.scrollHeight > current.clientHeight
    ) return true;
    if (current === popup) break;
  }
  return false;
};

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

type ReferencePickCandidateMenu = {
  anchor: ScreenPoint;
  hits: readonly ReferencePickCandidateMenuHit[];
  detailHits: readonly ReferencePickCandidateMenuHit[];
  detailsExpanded: boolean;
  activeIndex: number;
  requestId: number;
};

type ReferencePickCandidateMenuHit = {
  candidateElementId: string;
  option: ReferencePickCandidateOption;
  explanation?: ReferencePickCandidateExplanation;
};

const visibleReferencePickCandidateHits = (
  menu: ReferencePickCandidateMenu
): readonly ReferencePickCandidateMenuHit[] => menu.detailsExpanded
  ? [...menu.hits, ...menu.detailHits]
  : menu.hits;

const referencePickMenuKey = (menu: ReferencePickCandidateMenu): string => JSON.stringify([
  menu.requestId,
  menu.anchor,
  menu.hits.map((hit) => [hit.candidateElementId, referencePickCandidateOptionKey(hit.option)]),
  menu.detailHits.map((hit) => [hit.candidateElementId, referencePickCandidateOptionKey(hit.option)]),
  menu.detailsExpanded
]);

const referencePickCandidateExplanationText = (
  explanation: ReferencePickCandidateExplanation,
  presentation: CanvasPresentation | undefined
): string => {
  const key = `canvas.referencePick.option.${explanation}`;
  const fallbacks: Record<ReferencePickCandidateExplanation, string> = {
    individualOccurrence: "This generated occurrence",
    allOccurrences: "All generated occurrences",
    sourceGeometry: "Source geometry"
  };
  return presentation?.text(key, fallbacks[explanation]) ?? fallbacks[explanation];
};

const presentedHit = (
  item: PresentedReferencePickGeometryOption
): ReferencePickCandidateMenuHit => ({
  candidateElementId: item.candidateElementId,
  option: item.option,
  explanation: item.explanation
});

const referencePickPropertyHelp = (
  property: NumericComputedGeometryProperty,
  presentation: CanvasPresentation | undefined
): string => {
  const intermediatePoint = property.match(/^intermediatePoints\[(\d+)\]\.(x|y|incomingHandleAngleDeg|incomingHandleLength|outgoingHandleAngleDeg|outgoingHandleLength)$/);
  if (intermediatePoint) {
    const index = Number(intermediatePoint[1]);
    const propertyName = intermediatePoint[2];
    return presentation?.text(
      `canvas.referencePick.propertyHelp.intermediatePoint.${propertyName}`,
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
  showCanvasGeometryNames = false,
  onHover,
  onSelect,
  onSelectNumericProperty,
  onConfirm,
  onCancel,
  presentation
}: VSCodeReferencePickOverlayProps) => {
  const [candidateMenu, setCandidateMenuState] = useState<ReferencePickCandidateMenu | null>(null);
  const candidateMenuRef = useRef<ReferencePickCandidateMenu | null>(null);
  const candidateWheelRemainderRef = useRef(0);
  const setCandidateMenu = useCallback((next: ReferencePickCandidateMenu | null) => {
    const previous = candidateMenuRef.current;
    if (!previous || !next || referencePickMenuKey(previous) !== referencePickMenuKey(next)) {
      candidateWheelRemainderRef.current = 0;
    }
    candidateMenuRef.current = next;
    setCandidateMenuState(next);
  }, []);
  const toggleCandidateDetails = useCallback(() => {
    const menu = candidateMenuRef.current;
    if (!menu || menu.requestId !== session.request.requestId || menu.detailHits.length === 0) return;
    const detailsExpanded = !menu.detailsExpanded;
    setCandidateMenu({
      ...menu,
      detailsExpanded,
      activeIndex: detailsExpanded || menu.activeIndex < menu.hits.length ? menu.activeIndex : 0
    });
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [canvasFocusRef, session.request.requestId, setCandidateMenu]);
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
  const candidateEvaluation = useMemo(() => referencePickCanvasEvaluationFor({
    target: session.target, candidates: session.candidates
  }, evaluation), [evaluation, session.candidates, session.target]);
  const overlay = useCanvasOverlayData({
    evaluation: candidateEvaluation,
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

  const geometryHitsAt = useCallback((screen: ScreenPoint) => {
    return filterReferencePickGeometryHits(hitTestCanvasGeometryAll({
      screen,
      lines: overlay.overlayLines,
      arcs: overlay.overlayArcs,
      curves: overlay.overlayCurves,
      offsetLines: overlay.overlayOffsetLines,
      joinedPaths: overlay.overlayJoinedPaths,
      polylines: overlay.overlayPolylines,
      images: overlay.overlayImages,
      texts: overlay.overlayTexts,
      points: overlay.overlayPoints
    }), session.candidates);
  }, [overlay, session.candidates]);

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

    const hit = geometryHitsAt(screen)[0];
    if (!hit) return null;
    const candidate = session.candidates.find((item) => item.elementId === hit.elementId);
    const option = candidate ? geometryOptionFor(candidate) : undefined;
    return candidate && option ? referencePickHoverForCanvasOption(candidate, option) : null;
  }, [geometryHitsAt, pointHitsAt, session.candidates, session.target.expectedGeometryInterface, session.target.role]);

  const numericPropertyForHit = useCallback((hover: ReferencePickHover | null) => {
    if (!hover) return null;
    const candidate = session.candidates.find((item) => item.elementId === hover.candidateElementId);
    return candidate ? numericPropertyOptionForHover(candidate, hover) : null;
  }, [session.candidates]);

  const activateCandidate = useCallback((index: number) => {
    const menu = candidateMenuRef.current;
    const visibleHits = menu ? visibleReferencePickCandidateHits(menu) : [];
    if (!menu || menu.requestId !== session.request.requestId || visibleHits.length === 0) return;
    const wrappedIndex = ((index % visibleHits.length) + visibleHits.length) % visibleHits.length;
    const hit = visibleHits[wrappedIndex];
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
    setCandidateMenu(null);
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [
    canvasFocusRef,
    onSelect,
    session.candidates,
    session.request.requestId,
    session.target.numericProperty,
    session.target.role,
    setNumericPropertyMenu,
    setCandidateMenu
  ]);

  const cycleCandidate = useCallback((offset: number) => {
    const menu = candidateMenuRef.current;
    const visibleHits = menu ? visibleReferencePickCandidateHits(menu) : [];
    if (!menu || menu.requestId !== session.request.requestId || visibleHits.length === 0) return;
    const next = ((menu.activeIndex + offset) % visibleHits.length + visibleHits.length) % visibleHits.length;
    setCandidateMenu({ ...menu, activeIndex: next });
  }, [session.request.requestId, setCandidateMenu]);

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
    const popup = referencePickPopupForWheel(event);
    const numericMenu = numericPropertyMenuRef.current;
    if (numericMenu && numericMenu.requestId === requestId) {
      if (!popup) return;
      event.stopImmediatePropagation();
      if (referencePickPopupCanScroll(popup, event)) return;
      event.preventDefault();
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
    const pointMenu = candidateMenuRef.current;
    if (!pointMenu || pointMenu.requestId !== requestId || !popup) return;
    event.stopImmediatePropagation();
    if (referencePickPopupCanScroll(popup, event)) return;
    event.preventDefault();
    const next = candidateWheelDeltaFor({
      remainder: candidateWheelRemainderRef.current,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      viewportHeight: viewportSize.height
    });
    candidateWheelRemainderRef.current = next.remainder;
    if (next.cycles !== 0) cycleCandidate(next.cycles);
  }, [cycleNumericProperty, cycleCandidate, session.draft.status, session.request.requestId, viewportSize.height]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active") return;
    viewport.addEventListener("wheel", handleReferencePickWheel, { capture: true, passive: false });
    return () => viewport.removeEventListener("wheel", handleReferencePickWheel, { capture: true });
  }, [canvasFocusRef, handleReferencePickWheel, session.draft.status]);

  useEffect(() => {
    candidateWheelRemainderRef.current = 0;
    numericPropertyWheelRemainderRef.current = 0;
    if (candidateMenuRef.current?.requestId !== session.request.requestId) {
      candidateMenuRef.current = null;
    }
    if (numericPropertyMenuRef.current?.requestId !== session.request.requestId) {
      numericPropertyMenuRef.current = null;
    }
  }, [session.draft.status, session.request.requestId]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport || session.draft.status !== "active" || session.request.preserveSourceFocus) return;
    viewport.focus({ preventScroll: true });
  }, [canvasFocusRef, session.request.preserveSourceFocus, session.request.requestId, session.draft.status]);

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
      const pointMenu = candidateMenuRef.current;
      if (pointMenu && pointMenu.requestId === session.request.requestId) {
        if (eventTargetsReferencePickUi(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setCandidateMenu(null);
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
          setCandidateMenu({
            anchor: screen, hits, detailHits: [], detailsExpanded: false,
            activeIndex: 0, requestId: session.request.requestId
          });
        } else {
          const hit = hits[0];
          const candidate = hit && session.candidates.find((item) => item.elementId === hit.candidateElementId);
          onSelect(candidate && hit ? referencePickHoverForCanvasOption(candidate, hit.option) : null);
        }
      } else {
        if (session.target.role !== "numericPropertyBase") {
          if (session.target.syntax === "transformationTarget" && session.target.role === "geometry") {
            const hitCandidates = geometryHitsAt(screen).flatMap((hit) => {
              const candidate = session.candidates.find((item) => item.elementId === hit.elementId);
              return candidate ? [candidate] : [];
            });
            const candidatePresentation = referencePickCandidatePresentationForHits(hitCandidates);
            const hits = candidatePresentation.primary.map(presentedHit);
            const detailHits = candidatePresentation.details.map(presentedHit);
            if (hits.length + detailHits.length > 1) {
              setCandidateMenu({
                anchor: screen,
                hits,
                detailHits,
                detailsExpanded: false,
                activeIndex: 0,
                requestId: session.request.requestId
              });
            } else {
              const hit = hits[0] ?? detailHits[0];
              const candidate = hit && session.candidates.find((item) => item.elementId === hit.candidateElementId);
              onSelect(candidate && hit ? referencePickHoverForCanvasOption(candidate, hit.option) : null);
            }
            viewport.focus();
            return;
          }
          const seen = new Set<string>();
          const hits = geometryHitsAt(screen).flatMap(hit => {
            const candidate = session.candidates.find(item => item.elementId === hit.elementId);
            return candidate?.options.flatMap(option => {
              if (option.kind !== "geometry") return [];
              const key = referencePickDraftKey(option.reference);
              if (seen.has(key)) return [];
              seen.add(key);
              return [{ candidateElementId: candidate.elementId, option }];
            }) ?? [];
          });
          if (hits.length > 1) {
            setCandidateMenu({
              anchor: screen, hits, detailHits: [], detailsExpanded: false,
              activeIndex: 0, requestId: session.request.requestId
            });
          } else {
            const hit = hits[0];
            const candidate = hit && session.candidates.find(item => item.elementId === hit.candidateElementId);
            onSelect(candidate && hit ? referencePickHoverForCanvasOption(candidate, hit.option) : null);
          }
          viewport.focus();
          return;
        }
        const semanticHits = pointHitsAt(screen);
        if (semanticHits.length > 1) {
          setCandidateMenu({
            anchor: screen,
            hits: semanticHits,
            detailHits: [],
            detailsExpanded: false,
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
      const pointMenu = candidateMenuRef.current;
      if (pointMenu && pointMenu.requestId === session.request.requestId) {
        const disclosureFocused = event.target instanceof Element && Boolean(
          event.target.closest("[data-reference-pick-disclosure='true']")
        );
        if (
          pointMenu.detailHits.length > 0 && disclosureFocused &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          toggleCandidateDetails();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cycleCandidate(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter") {
          const focusedOptionOwnsEnter = event.target instanceof Element && Boolean(
            event.target.closest("[data-reference-pick-focused-option='true']")
          );
          if (focusedOptionOwnsEnter) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          activateCandidate(pointMenu.activeIndex);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setCandidateMenu(null);
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
    activateCandidate,
    canvasFocusRef,
    cycleNumericProperty,
    cycleCandidate,
    hitAt,
    geometryHitsAt,
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
    session.target.syntax,
    setNumericPropertyMenu,
    setPointerCandidateCursor,
    setCandidateMenu,
    toggleCandidateDetails
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
      result.set(candidate.elementId, {
        candidate: true,
        draft: candidate.options.some(item => draftKeys.has(referencePickDraftKey(item.reference))),
        hover: candidate.options.some(item => hoverKey === `${candidate.elementId}:${referencePickDraftKey(item.reference)}`)
      });
    }
    return result;
  }, [draftKeys, hoverKey, session.candidates]);
  const generatedGeometryIdentityCandidates = useMemo(() => {
    if (!showCanvasGeometryNames) return [];
    const authoredElementIds = new Set(elements.map((element) => element.id));
    const seenElementIds = new Set<string>();
    return overlay.overlayIdentityCandidates.filter((candidate: CanvasIdentityCandidate) => {
      if (
        candidate.kind === "point" ||
        !candidate.name?.trim() ||
        authoredElementIds.has(candidate.elementId) ||
        !geometryStateByElementId.has(candidate.elementId) ||
        seenElementIds.has(candidate.elementId)
      ) return false;
      seenElementIds.add(candidate.elementId);
      return true;
    });
  }, [elements, geometryStateByElementId, overlay.overlayIdentityCandidates, showCanvasGeometryNames]);

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
      strokeWidth: 2.5,
      opacity: 1,
      strokeDasharray: undefined
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
      {overlay.overlayJoinedPaths.map(({ line, points }) => {
        const style = geometryStyle(line.elementId);
        return style ? (
          <polyline key={`reference-pick-joined-path-${line.elementId}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...style} />
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
  const currentCandidateMenu = session.draft.status === "active" && candidateMenu?.requestId === session.request.requestId
    ? candidateMenu
    : null;
  const visibleCandidateMenuHits = currentCandidateMenu
    ? visibleReferencePickCandidateHits(currentCandidateMenu)
    : [];
  const candidateOwnersByOptionKey = new Map<string, Set<string>>();
  for (const hit of [
    ...(currentCandidateMenu?.hits ?? []),
    ...(currentCandidateMenu?.detailHits ?? [])
  ]) {
    const key = referencePickCandidateOptionKey(hit.option);
    const owners = candidateOwnersByOptionKey.get(key) ?? new Set<string>();
    owners.add(hit.candidateElementId);
    candidateOwnersByOptionKey.set(key, owners);
  }
  const pointMenuCandidates = visibleCandidateMenuHits.map((hit, index) => ({
    id: `${index}-${hit.candidateElementId}-${referencePickCandidateOptionKey(hit.option)}`,
    name: referencePickSourceForReference(hit.option.reference),
    detail: hit.explanation
      ? [
          referencePickCandidateExplanationText(hit.explanation, presentation),
          (candidateOwnersByOptionKey.get(referencePickCandidateOptionKey(hit.option))?.size ?? 0) > 1
            ? hit.candidateElementId
            : ""
        ].filter(Boolean).join(" · ")
      : `${hit.option.label} · ${hit.candidateElementId}`
  }));
  const currentNumericPropertyMenu = session.draft.status === "active" && numericPropertyMenu?.requestId === session.request.requestId
    ? numericPropertyMenu
    : null;
  const numericPropertyMenuCandidates = currentNumericPropertyMenu?.properties.map((property, index) => ({
    id: `${index}-${property}`,
    name: [property, referencePickPropertyHelp(property, presentation)].filter(Boolean).join(" — "),
    detail: referencePickSourceForReference(currentNumericPropertyMenu.reference)
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
        {generatedGeometryIdentityCandidates.map((candidate) => (
          <text
            key={`reference-pick-geometry-identity-${candidate.elementId}`}
            data-reference-pick-geometry-identity={candidate.elementId}
            x={candidate.representativeScreen.x + 8}
            y={candidate.representativeScreen.y - 8}
            fill="var(--canvas-foreground)"
            style={{ fontSize: 12, pointerEvents: "none" }}
          >
            {candidate.name}
          </text>
        ))}
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
        </>
      ) : null}
      {currentCandidateMenu ? (
        <div data-reference-pick-ui="true">
          <CanvasOverlapCandidateMenu
            anchor={currentCandidateMenu.anchor}
            candidates={pointMenuCandidates}
            activeIndex={currentCandidateMenu.activeIndex}
            viewportSize={viewportSize}
            idPrefix="reference-pick-point-candidate"
            ariaLabel={session.target.expectedGeometryInterface === "point" || session.target.role === "numericPropertyBase"
              ? presentation?.text("canvas.referencePick.menu.pointCandidates", "Reference Pick point candidates") ?? "Reference Pick point candidates"
              : presentation?.text("canvas.referencePick.menu.geometryCandidates", "Reference Pick geometry candidates") ?? "Reference Pick geometry candidates"}
            disclosure={currentCandidateMenu.detailHits.length > 0 ? {
              label: presentation?.text(
                "canvas.referencePick.menu.otherCandidates",
                "Other candidates / Details"
              ) ?? "Other candidates / Details",
              expanded: currentCandidateMenu.detailsExpanded,
              onToggle: toggleCandidateDetails
            } : undefined}
            activateFocusedOptionOnEnter={currentCandidateMenu.detailHits.length > 0}
            onFocusViewport={() => canvasFocusRef.current?.focus()}
            onActivate={activateCandidate}
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
    </>
  );
};
