import { useEffect, useRef } from "react";
import type { LineMeasurementCandidate } from "./DrawingCanvasHitTest";
import type {
  CanvasOverlapCandidateSession,
  LinePickCandidate,
  LinePickCandidateMenu,
  MeasurementCandidateMenu,
  PointPickCandidate,
  PointPickCandidateMenu
} from "./DrawingCanvasTypes";
import type { ViewportSize } from "./canvasViewport";
import { placeCanvasPopup } from "./canvasPopupPlacement";
import { numericReferenceLabel, numericReferenceValue } from "./geometryDisplay";

type CanvasCandidateMenusProps = {
  measurementCandidateMenu: MeasurementCandidateMenu | null;
  pointPickCandidateMenu: PointPickCandidateMenu | null;
  linePickCandidateMenu: LinePickCandidateMenu | null;
  overlapCandidateSession: CanvasOverlapCandidateSession | null;
  viewportSize: ViewportSize;
  onApplyMeasurementCandidate: (candidate: LineMeasurementCandidate) => void;
  onApplyPointPickCandidate: (candidate: PointPickCandidate) => void;
  onApplyLinePickCandidate: (candidate: LinePickCandidate) => void;
  onActivateOverlapCandidate: (index: number) => void;
  onFocusCanvas: () => void;
};

export const CanvasCandidateMenus = ({
  measurementCandidateMenu,
  pointPickCandidateMenu,
  linePickCandidateMenu,
  overlapCandidateSession,
  viewportSize,
  onApplyMeasurementCandidate,
  onApplyPointPickCandidate,
  onApplyLinePickCandidate,
  onActivateOverlapCandidate,
  onFocusCanvas
}: CanvasCandidateMenusProps) => {
  const candidateRowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!overlapCandidateSession) return;
    const candidate = overlapCandidateSession.candidates[overlapCandidateSession.activeIndex];
    if (!candidate) return;
    candidateRowRefs.current.get(candidate.elementId)?.scrollIntoView?.({ block: "nearest" });
  }, [overlapCandidateSession]);

  const popupStyle = (screen: { x: number; y: number }, size: { width: number; height: number }) => {
    const placement = placeCanvasPopup(screen, size, viewportSize);
    return { left: placement.left, top: placement.top };
  };
  const overlapPopupSize = {
    width: 300,
    height: Math.min(420, 16 + (overlapCandidateSession?.candidates.length ?? 0) * 36)
  };

  return (
  <>
    {measurementCandidateMenu ? (
      <div
        className="numeric-reference-candidate-menu"
        style={popupStyle(measurementCandidateMenu.screen, { width: 250, height: 280 })}
        role="menu"
        aria-label="数値参照候補"
      >
        {measurementCandidateMenu.candidates.map((candidate) => (
          <button
            key={`${candidate.line.elementId}-${candidate.property}`}
            type="button"
            role="menuitem"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onApplyMeasurementCandidate(candidate)}
          >
            <span className="numeric-reference-candidate-main">
              <strong>{candidate.line.name}</strong>
              <span>{numericReferenceLabel(candidate.line, candidate.property)}</span>
            </span>
            <small>{numericReferenceValue(candidate.line, candidate.property)}</small>
          </button>
        ))}
      </div>
    ) : null}
    {pointPickCandidateMenu ? (
      <div
        className="measurement-candidate-menu"
        style={popupStyle(pointPickCandidateMenu.screen, { width: 180, height: 220 })}
        role="menu"
        aria-label="点選択候補"
      >
        {pointPickCandidateMenu.candidates.map((candidate) => (
          <button
            key={candidate.label}
            type="button"
            role="menuitem"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onApplyPointPickCandidate(candidate)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
    ) : null}
    {linePickCandidateMenu ? (
      <div
        className="line-pick-candidate-menu"
        style={popupStyle(linePickCandidateMenu.screen, { width: 180, height: 220 })}
        role="menu"
        aria-label="線選択候補"
      >
        {linePickCandidateMenu.candidates.map((candidate) => (
          <button
            key={candidate.line.elementId}
            type="button"
            role="menuitem"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onApplyLinePickCandidate(candidate)}
          >
            {candidate.line.name}
          </button>
        ))}
      </div>
    ) : null}
    {overlapCandidateSession ? (
      <div
        className="canvas-overlap-candidate-menu"
        style={popupStyle(overlapCandidateSession.screen, overlapPopupSize)}
        role="listbox"
        aria-label="重なった要素の選択候補"
        aria-activedescendant={`canvas-overlap-candidate-${overlapCandidateSession.candidates[overlapCandidateSession.activeIndex]?.elementId ?? ""}`}
      >
        {overlapCandidateSession.candidates.map((candidate, index) => (
          <button
            key={candidate.elementId}
            id={`canvas-overlap-candidate-${candidate.elementId}`}
            ref={(element) => {
              if (element) candidateRowRefs.current.set(candidate.elementId, element);
              else candidateRowRefs.current.delete(candidate.elementId);
            }}
            type="button"
            role="option"
            aria-selected={index === overlapCandidateSession.activeIndex}
            className={index === overlapCandidateSession.activeIndex ? "is-active" : ""}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onFocusCanvas();
            }}
            onClick={() => {
              onFocusCanvas();
              onActivateOverlapCandidate(index);
            }}
          >
            <strong>{candidate.name.trim() || "(unnamed)"}</strong>
            <small>{candidate.kind}</small>
          </button>
        ))}
      </div>
    ) : null}
  </>
  );
};
