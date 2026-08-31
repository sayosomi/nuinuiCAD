import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeCanvasPopup } from "../components/canvasPopupPlacement";
import { candidateWheelDeltaFor } from "../components/canvasCandidateWheel";
import { CanvasOverlapCandidateMenu } from "../components/CanvasOverlapCandidateMenu";
import type { AxisLockKeys } from "../components/canvasViewport";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
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
  lastClientX: number;
  lastClientY: number;
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
  clearInteractionKey?: number;
  focusViewport?: () => void;
  placeContextMenuData?: string;
  dragContextKey?: string;
  onBeginDrag?: (projection: OutputPlaceProjection) => OutputPreviewPlaceDragProof | null;
  onPreviewDrag?: (proof: OutputPreviewPlaceDragProof, coordinates: { x: number; y: number }) => boolean;
  onCommitDrag?: (proof: OutputPreviewPlaceDragProof, coordinates: { x: number; y: number }) => boolean;
  onCancelDrag?: (proof: OutputPreviewPlaceDragProof) => void;
};

const OUTPUT_PREVIEW_PLACE_DRAG_THRESHOLD_PX = 3;
const releasedAxisLocks = (): AxisLockKeys => ({ x: false, y: false });

export const OutputPreviewPlaceOverlay = ({
  projections,
  sourceText,
  viewportSize,
  viewport,
  onNavigate,
  onHighlightPlaceIdChange,
  clearInteractionKey = 0,
  focusViewport,
  placeContextMenuData,
  dragContextKey = "",
  onBeginDrag,
  onPreviewDrag,
  onCommitDrag,
  onCancelDrag
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
  const axisLockKeysRef = useRef<AxisLockKeys>(releasedAxisLocks());
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
    axisLockKeysRef.current = releasedAxisLocks();
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
      axisLockKeys: axisLockKeysRef.current
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
    const setAxisLock = (event: KeyboardEvent, pressed: boolean) => {
      const current = dragSessionRef.current;
      if (event.key === "Escape" && pressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearInteractionRef.current();
        return;
      }
      if (!current) return;
      const key = event.key.toLowerCase();
      if (key !== "x" && key !== "y") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (axisLockKeysRef.current[key] === pressed) return;
      axisLockKeysRef.current = { ...axisLockKeysRef.current, [key]: pressed };
      if (current.activated) applyDragPreview(current, current.lastClientX, current.lastClientY);
    };
    const onKeyDown = (event: KeyboardEvent) => setAxisLock(event, true);
    const onKeyUp = (event: KeyboardEvent) => setAxisLock(event, false);
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
    if (current) dragCallbacksRef.current.onCancelDrag?.(current.proof);
  }, []);

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
  const dragReason = detailProjection ? outputPreviewPlaceDragReason(detailProjection) : null;
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
    axisLockKeysRef.current = releasedAxisLocks();
    const session: OutputPreviewPlaceDragSession = {
      pointerId: event.pointerId,
      placeId: handle.placeId,
      proof,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
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
      {handles.map((handle) => {
        const isDragging = dragSession?.placeId === handle.placeId;
        return (
          <button
            key={handle.placeId}
            type="button"
            className={`output-preview-place-handle${highlightedPlaceId === handle.placeId ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
            style={{ left: handle.screen.x, top: handle.screen.y, cursor: isDragging ? "grabbing" : handle.cursor }}
            aria-label={`Place ${handle.projection.groupName}`}
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
              if (suppressClickPlaceIdRef.current === handle.placeId) {
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
            detail: `place in ${candidate.projection.layoutName}`
          }))}
          activeIndex={candidateActiveIndex}
          viewportSize={viewportSize}
          idPrefix="output-preview-place-candidate"
          ariaLabel="Overlapping place handles"
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
          aria-label={`Place details for ${detailProjection.groupName}`}
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
              placed in {detailProjection.layoutName}
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
