import type { LineMeasurementCandidate } from "./DrawingCanvasHitTest";
import type {
  LinePickCandidate,
  LinePickCandidateMenu,
  MeasurementCandidateMenu,
  PointPickCandidate,
  PointPickCandidateMenu
} from "./DrawingCanvasTypes";
import { numericReferenceLabel, numericReferenceValue } from "./geometryDisplay";

type CanvasCandidateMenusProps = {
  measurementCandidateMenu: MeasurementCandidateMenu | null;
  pointPickCandidateMenu: PointPickCandidateMenu | null;
  linePickCandidateMenu: LinePickCandidateMenu | null;
  onApplyMeasurementCandidate: (candidate: LineMeasurementCandidate) => void;
  onApplyPointPickCandidate: (candidate: PointPickCandidate) => void;
  onApplyLinePickCandidate: (candidate: LinePickCandidate) => void;
};

export const CanvasCandidateMenus = ({
  measurementCandidateMenu,
  pointPickCandidateMenu,
  linePickCandidateMenu,
  onApplyMeasurementCandidate,
  onApplyPointPickCandidate,
  onApplyLinePickCandidate
}: CanvasCandidateMenusProps) => (
  <>
    {measurementCandidateMenu ? (
      <div
        className="numeric-reference-candidate-menu"
        style={{
          left: measurementCandidateMenu.screen.x,
          top: measurementCandidateMenu.screen.y
        }}
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
        style={{
          left: pointPickCandidateMenu.screen.x,
          top: pointPickCandidateMenu.screen.y
        }}
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
        style={{
          left: linePickCandidateMenu.screen.x,
          top: linePickCandidateMenu.screen.y
        }}
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
  </>
);
