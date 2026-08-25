import { useEffect, useRef, type KeyboardEventHandler, type WheelEventHandler } from "react";
import { CanvasMeasuredPopup } from "./CanvasMeasuredPopup";
import type { ViewportSize } from "./canvasViewport";

export type CanvasOverlapCandidatePresentation = {
  id: string;
  name: string | null;
  detail: string;
};

type CanvasOverlapCandidateMenuProps = {
  anchor: { x: number; y: number };
  candidates: readonly CanvasOverlapCandidatePresentation[];
  activeIndex: number;
  viewportSize: ViewportSize;
  idPrefix: string;
  ariaLabel: string;
  className?: string;
  autoFocus?: boolean;
  contextMenuData?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onWheel?: WheelEventHandler<HTMLDivElement>;
  onFocusViewport: () => void;
  onActivate: (index: number) => void;
};

export const CanvasOverlapCandidateMenu = ({
  anchor,
  candidates,
  activeIndex,
  viewportSize,
  idPrefix,
  ariaLabel,
  className = "",
  autoFocus = false,
  contextMenuData,
  onKeyDown,
  onWheel,
  onFocusViewport,
  onActivate
}: CanvasOverlapCandidateMenuProps) => {
  const candidateRowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const candidate = candidates[activeIndex];
    if (!candidate) return;
    candidateRowRefs.current.get(candidate.id)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, candidates]);

  return (
    <CanvasMeasuredPopup
      className={["canvas-overlap-candidate-menu", className].filter(Boolean).join(" ")}
      pointer={anchor}
      measurementKey={candidates.map(({ id, name, detail }) => `${id}:${name ?? ""}:${detail}`).join("|")}
      viewportSize={viewportSize}
      role="listbox"
      ariaLabel={ariaLabel}
      ariaActiveDescendant={`${idPrefix}-${candidates[activeIndex]?.id ?? ""}`}
      tabIndex={autoFocus ? 0 : undefined}
      autoFocus={autoFocus}
      contextMenuData={contextMenuData}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          id={`${idPrefix}-${candidate.id}`}
          ref={(element) => {
            if (element) candidateRowRefs.current.set(candidate.id, element);
            else candidateRowRefs.current.delete(candidate.id);
          }}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? "is-active" : ""}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFocusViewport();
          }}
          onClick={() => {
            onFocusViewport();
            onActivate(index);
          }}
        >
          <strong>{candidate.name?.trim() || "(unnamed)"}</strong>
          <small>{candidate.detail}</small>
        </button>
      ))}
    </CanvasMeasuredPopup>
  );
};
