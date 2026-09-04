import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { NumericReferenceOption } from "../geometry/numericReferenceOptions";
import type { CanvasPresentation } from "./canvasPresentation";

type ViewportPlacement = {
  bottom: number | "auto";
  left: number;
  maxHeight: number;
  top: number | "auto";
  width: number;
};

const viewportPlacementFor = (anchor: HTMLElement): ViewportPlacement => {
  const rect = anchor.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const margin = 8;
  const gap = 4;
  const spaceAbove = Math.max(0, rect.top - margin);
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin);
  const opensUpward = spaceAbove >= spaceBelow;
  const width = Math.min(rect.width, Math.max(0, viewportWidth - margin * 2));

  // Always set both top && bottom explicitly (never leave one unset): the
  // base .numeric-variable-suggest-popover class still carries a
  // `top: calc(100% - 2px)` rule for the older parent-relative layout, && an
  // unset inline `top` lets that stale rule fight the inline `bottom` here,
  // collapsing the box height. Pinning the unused side to "auto" overrides it.
  return {
    left: Math.max(margin, Math.min(rect.left, viewportWidth - margin - width)),
    width,
    maxHeight: opensUpward ? spaceAbove : spaceBelow,
    top: opensUpward ? "auto" : rect.bottom + gap,
    bottom: opensUpward ? viewportHeight - rect.top + gap : "auto"
  };
};

export const NumericVariableSuggestPopover = ({
  options,
  activeIndex,
  onApply,
  onHover,
  anchorRef,
  className,
  presentation
}: {
  options: NumericReferenceOption[];
  activeIndex: number;
  onApply: (option: NumericReferenceOption) => void;
  onHover: (index: number) => void;
  /** When supplied, escape an overflow-clipped command bar through a viewport portal. */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
  presentation?: CanvasPresentation;
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ViewportPlacement | null>(null);

  useLayoutEffect(() => {
    if (!anchorRef?.current || options.length === 0) {
      setPlacement(null);
      return;
    }
    const updatePlacement = () => setPlacement(viewportPlacementFor(anchorRef.current!));
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePlacement);
    observer?.observe(anchorRef.current);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
      observer?.disconnect();
    };
  }, [anchorRef, options.length]);

  useLayoutEffect(() => {
    const activeOption = listRef.current?.querySelector<HTMLElement>(`[data-suggestion-index="${activeIndex}"]`);
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, options.length]);

  if (options.length === 0) return null;
  const popover = <div
    ref={listRef}
    className={[
      "numeric-variable-suggest-popover",
      placement ? "numeric-variable-suggest-popover--viewport" : "",
      className ?? ""
    ].filter(Boolean).join(" ")}
    role="listbox"
    aria-label={presentation?.text("canvas.creationAssist.numericCandidates", "変数候補") ?? "変数候補"}
    style={placement ? { ...placement, overflowY: "auto" } : undefined}
  >
    {options.map((option, index) => <button data-suggestion-index={index} key={option.expression} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active-suggestion" : ""} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onApply(option)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}
  </div>;
  return placement ? createPortal(popover, document.body) : popover;
};
