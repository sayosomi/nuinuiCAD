import { useEffect, useMemo, useRef, useState } from "react";
import { placeCanvasPopup } from "../components/canvasPopupPlacement";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import {
  outputPreviewPlaceCandidatesAtScreen,
  outputPreviewPlaceDragReason,
  outputPreviewPlaceHandlesFor,
  outputPreviewPlacePropertyRows,
  type OutputPreviewPlaceHandle
} from "./outputPreviewPlaceInteraction";
import type { OutputPreviewViewport, OutputPreviewViewportSize } from "./outputPreviewViewport";
import "./outputPreviewPlaceOverlay.css";

type OutputPreviewPlaceCandidateSession = {
  anchor: { x: number; y: number };
  candidates: readonly OutputPreviewPlaceHandle[];
  activeIndex: number;
};

type OutputPreviewPlaceOverlayProps = {
  projections: readonly OutputPlaceProjection[];
  sourceText: string;
  viewportSize: OutputPreviewViewportSize;
  viewport: OutputPreviewViewport;
  onNavigate: (range: NormalizedSourceRange) => void;
  onHighlightPlaceIdChange: (placeId: string | null) => void;
};

const placeExists = (projections: readonly OutputPlaceProjection[], placeId: string | null): boolean =>
  placeId !== null && projections.some((projection) => projection.placeId === placeId);

export const OutputPreviewPlaceOverlay = ({
  projections,
  sourceText,
  viewportSize,
  viewport,
  onNavigate,
  onHighlightPlaceIdChange
}: OutputPreviewPlaceOverlayProps) => {
  const handles = useMemo(
    () => outputPreviewPlaceHandlesFor(projections, viewportSize, viewport),
    [projections, viewport, viewportSize]
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  const [candidateSession, setCandidateSession] = useState<OutputPreviewPlaceCandidateSession | null>(null);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => () => cancelHoverClear(), []);

  useEffect(() => {
    if (hoveredPlaceId && !placeExists(projections, hoveredPlaceId)) setHoveredPlaceId(null);
    if (activePlaceId && !placeExists(projections, activePlaceId)) setActivePlaceId(null);
    if (candidateSession && candidateSession.candidates.some(({ placeId }) => !placeExists(projections, placeId))) {
      setCandidateSession(null);
    }
  }, [activePlaceId, candidateSession, hoveredPlaceId, projections]);

  const candidatePlaceId = candidateSession?.candidates[candidateSession.activeIndex]?.placeId ?? null;
  const highlightedPlaceId = candidatePlaceId ?? hoveredPlaceId ?? activePlaceId;
  useEffect(() => {
    onHighlightPlaceIdChange(highlightedPlaceId);
    return () => onHighlightPlaceIdChange(null);
  }, [highlightedPlaceId, onHighlightPlaceIdChange]);

  const detailPlaceId = candidateSession ? null : hoveredPlaceId ?? activePlaceId;
  const detailHandle = detailPlaceId ? handles.find(({ placeId }) => placeId === detailPlaceId) ?? null : null;
  const detailProjection = detailHandle?.projection ?? null;
  const detailRows = detailProjection ? outputPreviewPlacePropertyRows(detailProjection, sourceText) : [];
  const dragReason = detailProjection ? outputPreviewPlaceDragReason(detailProjection) : null;
  const detailPlacement = detailHandle
    ? placeCanvasPopup(detailHandle.screen, { width: 320, height: 260 }, viewportSize)
    : null;
  const candidatePlacement = candidateSession
    ? placeCanvasPopup(
        candidateSession.anchor,
        { width: 240, height: Math.min(420, Math.max(72, candidateSession.candidates.length * 46 + 8)) },
        viewportSize
      )
    : null;

  const activateHandle = (handle: OutputPreviewPlaceHandle) => {
    const candidates = outputPreviewPlaceCandidatesAtScreen(handles, handle.screen);
    if (candidates.length <= 1) {
      setCandidateSession(null);
      setActivePlaceId(handle.placeId);
      return;
    }
    cancelHoverClear();
    setHoveredPlaceId(null);
    const activeIndex = Math.max(0, candidates.findIndex(({ placeId }) => placeId === handle.placeId));
    setActivePlaceId(null);
    setCandidateSession({ anchor: handle.screen, candidates, activeIndex });
  };

  const activateCandidate = (index: number) => {
    const candidate = candidateSession?.candidates[index];
    if (!candidate) return;
    setCandidateSession(null);
    setHoveredPlaceId(null);
    setActivePlaceId(candidate.placeId);
  };

  const handleCandidateKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const session = candidateSession;
    if (!session) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setCandidateSession(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateCandidate(session.activeIndex);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const activeIndex = (session.activeIndex + direction + session.candidates.length) % session.candidates.length;
    setCandidateSession({ ...session, activeIndex });
  };

  return (
    <div className="output-preview-place-overlay" data-output-preview-layer="place-overlay">
      {handles.map((handle) => (
        <button
          key={handle.placeId}
          type="button"
          className={`output-preview-place-handle${highlightedPlaceId === handle.placeId ? " is-active" : ""}`}
          style={{ left: handle.screen.x, top: handle.screen.y, cursor: handle.cursor }}
          aria-label={`Place ${handle.projection.groupName}`}
          data-place-id={handle.placeId}
          data-draggable={handle.projection.dragability.draggable ? "true" : "false"}
          onPointerEnter={() => {
            cancelHoverClear();
            if (!candidateSession) setHoveredPlaceId(handle.placeId);
          }}
          onPointerLeave={() => scheduleHoverClear(handle.placeId)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            activateHandle(handle);
          }}
        />
      ))}

      {candidateSession && candidatePlacement ? (
        <div
          className="canvas-overlap-candidate-menu output-preview-place-candidate-menu"
          style={{ left: candidatePlacement.left, top: candidatePlacement.top }}
          role="listbox"
          aria-label="Overlapping place handles"
          aria-activedescendant={`output-preview-place-candidate-${candidateSession.candidates[candidateSession.activeIndex]?.placeId ?? ""}`}
          tabIndex={0}
          autoFocus
          onKeyDown={handleCandidateKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {candidateSession.candidates.map((candidate, index) => (
            <button
              key={candidate.placeId}
              id={`output-preview-place-candidate-${candidate.placeId}`}
              type="button"
              role="option"
              aria-selected={index === candidateSession.activeIndex}
              className={index === candidateSession.activeIndex ? "is-active" : ""}
              onPointerEnter={() => setCandidateSession({ ...candidateSession, activeIndex: index })}
              onClick={() => activateCandidate(index)}
            >
              <strong>{candidate.projection.groupName.trim() || "(unnamed)"}</strong>
              <small>place in {candidate.projection.layoutName}</small>
            </button>
          ))}
        </div>
      ) : null}

      {detailProjection && detailPlacement ? (
        <aside
          className="output-preview-place-popover"
          style={{ left: detailPlacement.left, top: detailPlacement.top }}
          aria-label={`Place details for ${detailProjection.groupName}`}
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
