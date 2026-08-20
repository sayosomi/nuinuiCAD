import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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

type MeasuredCanvasPopupProps = {
  pointer: { x: number; y: number };
  viewportSize: ViewportSize;
  className: string;
  measurementKey: string;
  role?: string;
  ariaLabel?: string;
  ariaActiveDescendant?: string;
  children: ReactNode;
};

const MeasuredCanvasPopup = ({
  pointer,
  viewportSize,
  className,
  measurementKey,
  role,
  ariaLabel,
  ariaActiveDescendant,
  children
}: MeasuredCanvasPopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const measure = () => {
      const rect = popup.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      setMeasuredSize((previous) =>
        previous?.width === next.width && previous.height === next.height ? previous : next
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(popup);
    return () => observer.disconnect();
  }, [measurementKey, pointer.x, pointer.y, viewportSize.height, viewportSize.width]);

  const placement = measuredSize
    ? placeCanvasPopup(pointer, measuredSize, viewportSize)
    : { left: 0, top: 0 };
  return (
    <div
      ref={popupRef}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-activedescendant={ariaActiveDescendant}
      style={{
        left: placement.left,
        top: placement.top,
        ...(measuredSize ? {} : { visibility: "hidden" as const })
      }}
    >
      {children}
    </div>
  );
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
      <MeasuredCanvasPopup
        className="canvas-overlap-candidate-menu"
        pointer={overlapCandidateSession.anchor}
        measurementKey={overlapCandidateSession.candidates.map(({ elementId, name, kind }) =>
          `${elementId}:${name ?? ""}:${kind}`).join("|")}
        viewportSize={viewportSize}
        role="listbox"
        ariaLabel="重なった要素の選択候補"
        ariaActiveDescendant={`canvas-overlap-candidate-${overlapCandidateSession.candidates[overlapCandidateSession.activeIndex]?.elementId ?? ""}`}
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
            <strong>{candidate.name?.trim() || "(unnamed)"}</strong>
            <small>{candidate.kind}</small>
          </button>
        ))}
      </MeasuredCanvasPopup>
    ) : null}
    {hoverIdentityCandidatePopup ? (
      <MeasuredCanvasPopup
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
      </MeasuredCanvasPopup>
    ) : null}
  </>
  );
};
