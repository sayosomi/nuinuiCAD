import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { placeCanvasPopup } from "../components/canvasPopupPlacement";
import { candidateWheelDeltaFor } from "../components/canvasCandidateWheel";
import { CanvasOverlapCandidateMenu } from "../components/CanvasOverlapCandidateMenu";
import type { NormalizedSourceRange } from "@nuinuicad/nui-language";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import {
  outputPreviewPlaceCandidatesAtScreen,
  outputPreviewPlaceDragReason,
  outputPreviewPlaceHandlesFor,
  outputPreviewPlacePropertyRows,
  type OutputPreviewPlaceHandle
} from "./outputPreviewPlaceInteraction";
import {
  outputPreviewPlaceDragCoordinatesFor,
  type OutputPreviewPlaceDragProof
} from "./outputPreviewPlaceDrag";
import type { OutputPreviewViewport, OutputPreviewViewportSize } from "./outputPreviewViewport";
import { useNativePointerBoundaryFallback } from "../components/nativePointerBoundaryFallback";
import type { CanvasPresentation } from "../components/canvasPresentation";
import { pointDragAxisForScreenDelta } from "../components/canvasViewport";
import "./outputPreviewPlaceOverlay.css";

type OutputPreviewPlaceCandidateSession = {
  placeIds: readonly string[];
  activeIndex: number;
};

type OutputPreviewPlaceDragSession = {
  pointerId: number;
  placeId: string;
  proof: OutputPreviewPlaceDragProof;
  startClientX: number;
  startClientY: number;
  originScreenX: number;
  originScreenY: number;
  lastClientX: number;
  lastClientY: number;
  shiftKey: boolean;
  zoom: number;
  coordinates: { x: number; y: number };
  activated: boolean;
  captureTarget: HTMLButtonElement;
};

type OutputPreviewPlaceOverlayProps = {
  projections: readonly OutputPlaceProjection[];
  sourceText: string;
  viewportSize: OutputPreviewViewportSize;
  viewport: OutputPreviewViewport;
  onNavigate: (range: NormalizedSourceRange) => void;
  onHighlightPlaceIdChange: (placeId: string | null) => void;
  spacePrimaryPanActiveRef?: RefObject<boolean>;
  clearInteractionKey?: number;
  focusViewport?: () => void;
  placeContextMenuData?: string;
  dragContextKey?: string;
  onBeginDrag?: (projection: OutputPlaceProjection) => OutputPreviewPlaceDragProof | null;
  onPreviewDrag?: (proof: OutputPreviewPlaceDragProof, coordinates: { x: number; y: number }) => boolean;
  onCommitDrag?: (proof: OutputPreviewPlaceDragProof, coordinates: { x: number; y: number }) => boolean;
  onCancelDrag?: (proof: OutputPreviewPlaceDragProof) => void;
  presentation?: CanvasPresentation;
};

const OUTPUT_PREVIEW_PLACE_DRAG_THRESHOLD_PX = 3;

export const OutputPreviewPlaceOverlay = ({
  projections,
  sourceText,
  viewportSize,
  viewport,
  onNavigate,
  onHighlightPlaceIdChange,
  spacePrimaryPanActiveRef,
  clearInteractionKey = 0,
  focusViewport,
  placeContextMenuData,
  dragContextKey = "",
  onBeginDrag,
  onPreviewDrag,
  onCommitDrag,
  onCancelDrag,
  presentation
}: OutputPreviewPlaceOverlayProps) => {
  const handles = useMemo(
    () => outputPreviewPlaceHandlesFor(projections, viewportSize, viewport),
    [projections, viewport, viewportSize]
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  const [candidateSession, setCandidateSession] = useState<OutputPreviewPlaceCandidateSession | null>(null);
  const [dragSession, setDragSession] = useState<OutputPreviewPlaceDragSession | null>(null);
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<OutputPreviewPlaceDragSession | null>(null);
  const [reactHandledPointerEvents] = useState(() => new WeakSet<Event>());
  const shiftKeyRef = useRef(false);
  const suppressClickPlaceIdRef = useRef<string | null>(null);
  const candidateWheelDeltaRef = useRef(0);
  const clearInteractionRef = useRef<() => void>(() => {});
  const previousClearInteractionKeyRef = useRef(clearInteractionKey);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCallbacksRef = useRef({ onPreviewDrag, onCommitDrag, onCancelDrag });

  useEffect(() => {
    dragCallbacksRef.current = { onPreviewDrag, onCommitDrag, onCancelDrag };
  }, [onPreviewDrag, onCommitDrag, onCancelDrag]);

  const cancelHoverClear = () => {
    if (hoverLeaveTimerRef.current !== null) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  };

  const scheduleHoverClear = (placeId: string) => {
    cancelHoverClear();
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHoveredPlaceId((current) => current === placeId ? null : current);
      hoverLeaveTimerRef.current = null;
    }, 120);
  };

  useEffect(() => () => {
    if (hoverLeaveTimerRef.current !== null) clearTimeout(hoverLeaveTimerRef.current);
  }, []);

  const finishDragSession = useCallback((cancel: boolean) => {
    const current = dragSessionRef.current;
    if (!current) return;
    dragSessionRef.current = null;
    setDragSession(null);
    shiftKeyRef.current = false;
    try {
      if (current.captureTarget.hasPointerCapture?.(current.pointerId)) {
        current.captureTarget.releasePointerCapture?.(current.pointerId);
      }
    } catch {
      // Pointer capture can already be gone after pointercancel/lostpointercapture.
    }
    if (cancel) dragCallbacksRef.current.onCancelDrag?.(current.proof);
  }, []);

  const clearPlaceInteraction = useCallback(() => {
    cancelHoverClear();
    candidateWheelDeltaRef.current = 0;
    if (dragSessionRef.current) finishDragSession(true);
    setHoveredPlaceId(null);
    setActivePlaceId(null);
    setCandidateSession(null);
    focusViewport?.();
  }, [finishDragSession, focusViewport]);

  useEffect(() => {
    clearInteractionRef.current = clearPlaceInteraction;
  }, [clearPlaceInteraction]);

  useEffect(() => {
    if (previousClearInteractionKeyRef.current === clearInteractionKey) return;
    previousClearInteractionKeyRef.current = clearInteractionKey;
    clearInteractionRef.current();
  }, [clearInteractionKey]);

  const applyDragPreview = useCallback((
    current: OutputPreviewPlaceDragSession,
    clientX: number,
    clientY: number
  ): boolean => {
    const screenDx = clientX - current.startClientX;
    const screenDy = clientY - current.startClientY;
    const activated = current.activated || Math.hypot(screenDx, screenDy) >= OUTPUT_PREVIEW_PLACE_DRAG_THRESHOLD_PX;
    const moved = { ...current, lastClientX: clientX, lastClientY: clientY, activated };
    if (!activated) {
      dragSessionRef.current = moved;
      setDragSession(moved);
      return true;
    }
    const coordinates = outputPreviewPlaceDragCoordinatesFor({
      proof: current.proof,
      screenDx,
      screenDy,
      zoom: current.zoom,
      shiftKey: shiftKeyRef.current
    });
    if (!coordinates || dragCallbacksRef.current.onPreviewDrag?.(current.proof, coordinates) === false) {
      finishDragSession(true);
      return false;
    }
    const next = { ...moved, coordinates };
    dragSessionRef.current = next;
    setDragSession(next);
    return true;
  }, [finishDragSession]);

  useEffect(() => {
    const setShiftKey = (event: KeyboardEvent, pressed: boolean) => {
      const current = dragSessionRef.current;
      if (event.key === "Escape" && pressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearInteractionRef.current();
        return;
      }
      if (!current) return;
      if (event.key.toLowerCase() !== "shift") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shiftKeyRef.current === pressed) return;
      shiftKeyRef.current = pressed;
      const shifted = { ...current, shiftKey: pressed };
      if (current.activated) {
        applyDragPreview(shifted, current.lastClientX, current.lastClientY);
      } else {
        dragSessionRef.current = shifted;
        setDragSession(shifted);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => setShiftKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setShiftKey(event, false);
    const onBlur = () => finishDragSession(true);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, [applyDragPreview, finishDragSession]);

  useEffect(() => {
    if (dragSessionRef.current) finishDragSession(true);
  }, [dragContextKey, finishDragSession]);

  useEffect(() => () => {
    const current = dragSessionRef.current;
    dragSessionRef.current = null;
    shiftKeyRef.current = false;
    if (current) dragCallbacksRef.current.onCancelDrag?.(current.proof);
  }, []);

  const activeDragSession = dragSession?.activated ? dragSession : null;
  const activeDragAxis = activeDragSession
    ? pointDragAxisForScreenDelta({
        screenDx: activeDragSession.lastClientX - activeDragSession.startClientX,
        screenDy: activeDragSession.lastClientY - activeDragSession.startClientY,
        shiftKey: activeDragSession.shiftKey
      })
    : null;

  const candidateHandles = candidateSession
    ? candidateSession.placeIds.flatMap((placeId) => {
        const handle = handles.find((candidate) => candidate.placeId === placeId);
        return handle ? [handle] : [];
      })
    : [];
  const candidateSessionIsCurrent = Boolean(
    candidateSession &&
    candidateHandles.length > 0 &&
    candidateHandles.length === candidateSession.placeIds.length
  );
  const candidateActiveIndex = candidateSessionIsCurrent && candidateSession
    ? Math.min(candidateSession.activeIndex, candidateHandles.length - 1)
    : 0;
  const candidatePlaceId = candidateSessionIsCurrent
    ? candidateHandles[candidateActiveIndex]?.placeId ?? null
    : null;
  const highlightedPlaceId = dragSession?.placeId ?? candidatePlaceId ?? hoveredPlaceId ?? activePlaceId;
  useEffect(() => {
    onHighlightPlaceIdChange(highlightedPlaceId);
    return () => onHighlightPlaceIdChange(null);
  }, [highlightedPlaceId, onHighlightPlaceIdChange]);

  const detailPlaceId = dragSession ? null : candidateSession ? null : hoveredPlaceId ?? activePlaceId;
  const detailHandle = detailPlaceId ? handles.find(({ placeId }) => placeId === detailPlaceId) ?? null : null;
  const detailProjection = detailHandle?.projection ?? null;
  const detailRows = detailProjection ? outputPreviewPlacePropertyRows(detailProjection, sourceText) : [];
  const dragReason = detailProjection ? outputPreviewPlaceDragReason(detailProjection, presentation) : null;
  const detailPlacement = detailHandle
    ? placeCanvasPopup(detailHandle.screen, { width: 320, height: 260 }, viewportSize)
    : null;
  const candidateAnchor = candidateSessionIsCurrent ? candidateHandles[candidateActiveIndex]?.screen ?? null : null;
  const activateHandle = (handle: OutputPreviewPlaceHandle) => {
    const candidates = outputPreviewPlaceCandidatesAtScreen(handles, handle.screen);
    if (candidates.length <= 1) {
      setCandidateSession(null);
      setHoveredPlaceId(handle.placeId);
      setActivePlaceId(handle.placeId);
      return;
    }
    cancelHoverClear();
    setHoveredPlaceId(null);
    candidateWheelDeltaRef.current = 0;
    const activeIndex = Math.max(0, candidates.findIndex(({ placeId }) => placeId === handle.placeId));
    setActivePlaceId(null);
    setCandidateSession({
      placeIds: candidates.map(({ placeId }) => placeId),
      activeIndex
    });
  };

  const activateCandidate = (index: number) => {
    const candidate = candidateHandles[index];
    if (!candidate) return;
    setCandidateSession(null);
    candidateWheelDeltaRef.current = 0;
    setHoveredPlaceId(null);
    setActivePlaceId(candidate.placeId);
  };

  const handleCandidateKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!candidateSessionIsCurrent || !candidateSession) return;
    if (event.key === "Escape") {
      event.preventDefault();
      clearPlaceInteraction();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateCandidate(candidateActiveIndex);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const activeIndex = (candidateActiveIndex + direction + candidateHandles.length) % candidateHandles.length;
    setCandidateSession({ ...candidateSession, activeIndex });
  };

  const handleCandidateWheel = useCallback((event: WheelEvent) => {
    if (!candidateSessionIsCurrent) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = candidateWheelDeltaFor({
      remainder: candidateWheelDeltaRef.current,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      viewportHeight: viewportSize.height
    });
    candidateWheelDeltaRef.current = next.remainder;
    if (next.cycles === 0) return;
    setCandidateSession((current) => {
      if (!current || current.placeIds.length === 0) return current;
      const activeIndex = (current.activeIndex + next.cycles + current.placeIds.length) % current.placeIds.length;
      return { ...current, activeIndex };
    });
  }, [candidateSessionIsCurrent, viewportSize.height]);

  useEffect(() => {
    if (!candidateSessionIsCurrent) return;
    const viewportElement = overlayRootRef.current?.parentElement;
    if (!viewportElement) return;
    viewportElement.addEventListener("wheel", handleCandidateWheel, { capture: true, passive: false });
    return () => viewportElement.removeEventListener("wheel", handleCandidateWheel, { capture: true });
  }, [candidateSessionIsCurrent, handleCandidateWheel]);

  const handleForPointerEvent = (event: React.PointerEvent<HTMLElement>): OutputPreviewPlaceHandle | null => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>("button[data-place-id]");
    if (!button || !overlayRootRef.current?.contains(button)) return null;
    return handles.find((handle) => handle.placeId === button.dataset.placeId) ?? null;
  };

  const beginHandleDrag = (event: React.PointerEvent<HTMLElement>, handle: OutputPreviewPlaceHandle) => {
    if (event.button === 0 && spacePrimaryPanActiveRef?.current) {
      suppressClickPlaceIdRef.current = handle.placeId;
      return;
    }
    if (event.button === 0) suppressClickPlaceIdRef.current = null;
    if (event.button !== 0 || !handle.projection.dragability.draggable || !onBeginDrag) return;
    reactHandledPointerEvents.add(event.nativeEvent ?? event as unknown as Event);
    event.stopPropagation();
    const candidates = outputPreviewPlaceCandidatesAtScreen(handles, handle.screen);
    if (candidates.length > 1 && activePlaceId !== handle.placeId) return;
    const proof = onBeginDrag(handle.projection);
    if (!proof) return;
    const captureTarget = event.currentTarget instanceof HTMLButtonElement
      ? event.currentTarget
      : event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-place-id]")
        : null;
    if (!captureTarget) return;
    cancelHoverClear();
    setHoveredPlaceId(null);
    setCandidateSession(null);
    setActivePlaceId(handle.placeId);
    shiftKeyRef.current = event.shiftKey;
    const session: OutputPreviewPlaceDragSession = {
      pointerId: event.pointerId,
      placeId: handle.placeId,
      proof,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originScreenX: handle.screen.x,
      originScreenY: handle.screen.y,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      shiftKey: event.shiftKey,
      zoom: viewport.zoom,
      coordinates: { x: proof.x.literal, y: proof.y.literal },
      activated: false,
      captureTarget
    };
    dragSessionRef.current = session;
    setDragSession(session);
    try {
      session.captureTarget.setPointerCapture?.(event.pointerId);
    } catch {
      finishDragSession(true);
    }
  };

  const moveHandleDrag = (event: React.PointerEvent<HTMLElement>) => {
    reactHandledPointerEvents.add(event.nativeEvent ?? event as unknown as Event);
    const current = dragSessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if ((event.buttons & 1) === 0) {
      finishDragSession(true);
      return;
    }
    applyDragPreview(current, event.clientX, event.clientY);
  };

  const commitHandleDrag = (event: React.PointerEvent<HTMLElement>) => {
    reactHandledPointerEvents.add(event.nativeEvent ?? event as unknown as Event);
    const current = dragSessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!current.activated) {
      finishDragSession(true);
      return;
    }
    suppressClickPlaceIdRef.current = current.placeId;
    const committed = dragCallbacksRef.current.onCommitDrag?.(current.proof, current.coordinates) === true;
    finishDragSession(!committed);
  };

  const cancelHandleDrag = (event: React.PointerEvent<HTMLElement>) => {
    reactHandledPointerEvents.add(event.nativeEvent ?? event as unknown as Event);
    if (dragSessionRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishDragSession(true);
  };

  const handleNativePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = handleForPointerEvent(event);
    if (handle) beginHandleDrag(event, handle);
  };

  useNativePointerBoundaryFallback({
    targetRef: overlayRootRef,
    handlers: {
      pointerdown: handleNativePointerDown,
      pointermove: moveHandleDrag,
      pointerup: commitHandleDrag,
      pointercancel: cancelHandleDrag,
      lostpointercapture: cancelHandleDrag
    },
    reactHandledEvents: reactHandledPointerEvents
  });

  return (
    <div ref={overlayRootRef} className="output-preview-place-overlay" data-output-preview-layer="place-overlay">
      {activeDragSession && activeDragAxis ? (
        <svg
          className="output-preview-place-axis-guides"
          width={viewportSize.width}
          height={viewportSize.height}
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          aria-hidden="true"
          style={{ pointerEvents: "none" }}
        >
          {activeDragAxis === "horizontal" ? (
            <line
              data-output-preview-place-axis-guide="horizontal"
              x1={0}
              y1={activeDragSession.originScreenY}
              x2={viewportSize.width}
              y2={activeDragSession.originScreenY}
            />
          ) : (
            <line
              data-output-preview-place-axis-guide="vertical"
              x1={activeDragSession.originScreenX}
              y1={0}
              x2={activeDragSession.originScreenX}
              y2={viewportSize.height}
            />
          )}
        </svg>
      ) : null}

      {handles.map((handle) => {
        const isDragging = dragSession?.placeId === handle.placeId;
        return (
          <button
            key={handle.placeId}
            type="button"
            className={`output-preview-place-handle${highlightedPlaceId === handle.placeId ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
            style={{ left: handle.screen.x, top: handle.screen.y, cursor: isDragging ? "grabbing" : handle.cursor }}
            aria-label={presentation?.text(
              "output.place.ariaLabel",
              "Place {name}",
              { name: handle.projection.groupName }
            ) ?? `Place ${handle.projection.groupName}`}
            data-place-id={handle.placeId}
            data-draggable={handle.projection.dragability.draggable ? "true" : "false"}
            data-dragging={isDragging ? "true" : "false"}
            data-vscode-context={placeContextMenuData}
            onPointerEnter={() => {
              cancelHoverClear();
              if (!candidateSession && !dragSessionRef.current) setHoveredPlaceId(handle.placeId);
            }}
            onPointerLeave={() => {
              if (!dragSessionRef.current) scheduleHoverClear(handle.placeId);
            }}
            onPointerDown={(event) => beginHandleDrag(event, handle)}
            onPointerMove={moveHandleDrag}
            onPointerUp={commitHandleDrag}
            onPointerCancel={cancelHandleDrag}
            onLostPointerCapture={cancelHandleDrag}
            onClick={(event) => {
              event.stopPropagation();
              if (spacePrimaryPanActiveRef?.current || suppressClickPlaceIdRef.current === handle.placeId) {
                event.preventDefault();
                suppressClickPlaceIdRef.current = null;
                return;
              }
              activateHandle(handle);
            }}
          />
        );
      })}

      {candidateSessionIsCurrent && candidateSession && candidateAnchor ? (
        <CanvasOverlapCandidateMenu
          anchor={candidateAnchor}
          candidates={candidateHandles.map((candidate) => ({
            id: candidate.placeId,
            name: candidate.projection.groupName,
            detail: presentation?.text(
              "output.place.placeIn",
              "place in {name}",
              { name: candidate.projection.layoutName }
            ) ?? `place in ${candidate.projection.layoutName}`
          }))}
          activeIndex={candidateActiveIndex}
          viewportSize={viewportSize}
          idPrefix="output-preview-place-candidate"
          ariaLabel={presentation?.text(
            "output.place.candidateMenu",
            "Overlapping place handles"
          ) ?? "Overlapping place handles"}
          className="output-preview-place-candidate-menu"
          autoFocus
          contextMenuData={placeContextMenuData}
          onKeyDown={handleCandidateKeyDown}
          onFocusViewport={() => focusViewport?.()}
          onActivate={activateCandidate}
        />
      ) : null}

      {detailProjection && detailPlacement ? (
        <aside
          className="output-preview-place-popover"
          style={{ left: detailPlacement.left, top: detailPlacement.top }}
          aria-label={presentation?.text(
            "output.place.detailsAriaLabel",
            "Place details for {name}",
            { name: detailProjection.groupName }
          ) ?? `Place details for ${detailProjection.groupName}`}
          data-vscode-context={placeContextMenuData}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => {
            cancelHoverClear();
            setHoveredPlaceId(detailProjection.placeId);
          }}
          onPointerLeave={() => scheduleHoverClear(detailProjection.placeId)}
        >
          <div className="output-preview-place-popover-header">
            {detailProjection.authored.group.targetRange ? (
              <button
                type="button"
                className="output-preview-place-popover-title"
                onClick={() => onNavigate(detailProjection.authored.group.targetRange!)}
              >
                {detailProjection.groupName}
              </button>
            ) : <strong className="output-preview-place-popover-title">{detailProjection.groupName}</strong>}
            <button
              type="button"
              className="output-preview-place-popover-context"
              onClick={() => onNavigate(detailProjection.statementRange)}
            >
              {presentation?.text(
                "output.place.placedIn",
                "placed in {name}",
                { name: detailProjection.layoutName }
              ) ?? `placed in ${detailProjection.layoutName}`}
            </button>
          </div>

          <dl className="output-preview-place-property-list">
            {detailRows.map((row) => (
              <div key={row.key} className="output-preview-place-property-row">
                <dt>{row.label}</dt>
                <dd>
                  {row.sourceRange ? (
                    <button
                      type="button"
                      className="output-preview-place-property-value"
                      title={row.value}
                      onClick={() => onNavigate(row.sourceRange!)}
                    >
                      {row.value}
                    </button>
                  ) : <span className="output-preview-place-property-value" title={row.value}>{row.value}</span>}
                  {row.referenceTargets.length > 0 ? (
                    <span className="output-preview-place-reference-targets">
                      {row.referenceTargets.map((reference, index) => (
                        <button
                          key={`${row.key}-${reference.range.from}-${reference.range.to}-${index}`}
                          type="button"
                          onClick={() => onNavigate(reference.range)}
                        >
                          {reference.label}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          {dragReason ? <p className="output-preview-place-drag-reason">{dragReason}</p> : null}
        </aside>
      ) : null}
    </div>
  );
};
