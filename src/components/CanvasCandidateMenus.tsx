import type { LineMeasurementCandidate } from "./DrawingCanvasHitTest";
import type {
  CanvasOverlapCandidateSession,
  CanvasHoverIdentityPopup,
  LinePickCandidate,
  LinePickCandidateMenu,
  MeasurementCandidateMenu,
  PointPickCandidate,
  PointPickCandidateMenu
} from "./DrawingCanvasTypes";
import type { ViewportSize } from "./canvasViewport";
import { placeCanvasPopup } from "./canvasPopupPlacement";
import { numericReferenceLabel, numericReferenceValue } from "./geometryDisplay";
import { CanvasMeasuredPopup } from "./CanvasMeasuredPopup";
import { CanvasOverlapCandidateMenu } from "./CanvasOverlapCandidateMenu";

type CanvasCandidateMenusProps = {
  measurementCandidateMenu: MeasurementCandidateMenu | null;
  pointPickCandidateMenu: PointPickCandidateMenu | null;
  linePickCandidateMenu: LinePickCandidateMenu | null;
  overlapCandidateSession: CanvasOverlapCandidateSession | null;
  hoverIdentityCandidatePopup: CanvasHoverIdentityPopup | null;
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
  hoverIdentityCandidatePopup,
  viewportSize,
  onApplyMeasurementCandidate,
  onApplyPointPickCandidate,
  onApplyLinePickCandidate,
  onActivateOverlapCandidate,
  onFocusCanvas
}: CanvasCandidateMenusProps) => {
  const popupStyle = (screen: { x: number; y: number }, size: { width: number; height: number }) => {
    const placement = placeCanvasPopup(screen, size, viewportSize);
    return { left: placement.left, top: placement.top };
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
      <CanvasOverlapCandidateMenu
        anchor={overlapCandidateSession.anchor}
        candidates={overlapCandidateSession.candidates.map(({ elementId, name, kind }) => ({
          id: elementId,
          name,
          detail: kind
        }))}
        activeIndex={overlapCandidateSession.activeIndex}
        viewportSize={viewportSize}
        idPrefix="canvas-overlap-candidate"
        ariaLabel="重なった要素の選択候補"
        onFocusViewport={onFocusCanvas}
        onActivate={onActivateOverlapCandidate}
      />
    ) : null}
    {hoverIdentityCandidatePopup ? (
      <CanvasMeasuredPopup
        className="canvas-hover-identity-candidate-menu"
        pointer={hoverIdentityCandidatePopup.pointer}
        measurementKey={hoverIdentityCandidatePopup.candidates.map(({ elementId, name, kind }) =>
          `${elementId}:${name ?? ""}:${kind}`).join("|")}
        viewportSize={viewportSize}
        role="listbox"
        ariaLabel="重なった要素の名前"
      >
        {hoverIdentityCandidatePopup.candidates.map((candidate) => (
          <div key={candidate.elementId} role="option">
            <strong>{candidate.name}</strong>
            <small>{candidate.kind}</small>
          </div>
        ))}
      </CanvasMeasuredPopup>
    ) : null}
  </>
  );
};
