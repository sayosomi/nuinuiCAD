import { useEffect, useRef, type KeyboardEventHandler } from "react";
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
  unnamedLabel?: string;
  className?: string;
  autoFocus?: boolean;
  contextMenuData?: string;
  disclosure?: { label: string; expanded: boolean; onToggle: () => void };
  activateFocusedOptionOnEnter?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
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
  unnamedLabel = "(unnamed)",
  className = "",
  autoFocus = false,
  contextMenuData,
  disclosure,
  activateFocusedOptionOnEnter = false,
  onKeyDown,
  onFocusViewport,
  onActivate
}: CanvasOverlapCandidateMenuProps) => {
  const candidateRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const listboxRef = useRef<HTMLDivElement>(null);
  const hasDisclosure = Boolean(disclosure);

  useEffect(() => {
    const candidate = candidates[activeIndex];
    if (!candidate) return;
    candidateRowRefs.current.get(candidate.id)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, candidates]);

  useEffect(() => {
    if (hasDisclosure && autoFocus) listboxRef.current?.focus();
  }, [autoFocus, hasDisclosure]);

  const optionRows = candidates.map((candidate, index) => (
    <button
      key={candidate.id}
      id={`${idPrefix}-${candidate.id}`}
      ref={(element) => {
        if (element) candidateRowRefs.current.set(candidate.id, element);
        else candidateRowRefs.current.delete(candidate.id);
      }}
      type="button"
      role="option"
      data-reference-pick-focused-option={activateFocusedOptionOnEnter ? "true" : undefined}
      aria-selected={index === activeIndex}
      className={index === activeIndex ? "is-active" : ""}
      onKeyDown={activateFocusedOptionOnEnter ? (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onActivate(index);
      } : undefined}
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
      <strong>{candidate.name?.trim() || unnamedLabel}</strong>
      <small>{candidate.detail}</small>
    </button>
  ));

  return (
    <CanvasMeasuredPopup
      className={["canvas-overlap-candidate-menu", className].filter(Boolean).join(" ")}
      pointer={anchor}
      measurementKey={candidates.map(({ id, name, detail }) => `${id}:${name ?? ""}:${detail}`).join("|")}
      viewportSize={viewportSize}
      role={disclosure ? undefined : "listbox"}
      ariaLabel={disclosure ? undefined : ariaLabel}
      ariaActiveDescendant={disclosure ? undefined : `${idPrefix}-${candidates[activeIndex]?.id ?? ""}`}
      tabIndex={disclosure ? undefined : autoFocus ? 0 : undefined}
      autoFocus={disclosure ? false : autoFocus}
      contextMenuData={contextMenuData}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {disclosure ? (
        <div
          className="canvas-overlap-candidate-menu__contents"
          style={{
            maxHeight: Math.max(0, Math.min(418, viewportSize.height - 18)),
            overflowY: "auto"
          }}
        >
          <div
            ref={listboxRef}
            id={`${idPrefix}-listbox`}
            className="canvas-overlap-candidate-menu__listbox"
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={`${idPrefix}-${candidates[activeIndex]?.id ?? ""}`}
            tabIndex={autoFocus ? 0 : undefined}
          >
            {optionRows}
          </div>
          <button
            type="button"
            className="canvas-overlap-candidate-menu__disclosure"
            data-reference-pick-disclosure="true"
            aria-expanded={disclosure.expanded}
            aria-controls={`${idPrefix}-listbox`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => {
              onFocusViewport();
              disclosure.onToggle();
            }}
          >
            {disclosure.label}
          </button>
        </div>
      ) : optionRows}
    </CanvasMeasuredPopup>
  );
};
