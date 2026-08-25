import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode
} from "react";
import { placeCanvasPopup } from "./canvasPopupPlacement";
import type { ViewportSize } from "./canvasViewport";

type CanvasMeasuredPopupProps = {
  pointer: { x: number; y: number };
  viewportSize: ViewportSize;
  className: string;
  measurementKey: string;
  role?: string;
  ariaLabel?: string;
  ariaActiveDescendant?: string;
  tabIndex?: number;
  autoFocus?: boolean;
  contextMenuData?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  children: ReactNode;
};

export const CanvasMeasuredPopup = ({
  pointer,
  viewportSize,
  className,
  measurementKey,
  role,
  ariaLabel,
  ariaActiveDescendant,
  tabIndex,
  autoFocus,
  contextMenuData,
  onKeyDown,
  onPointerDown,
  children
}: CanvasMeasuredPopupProps) => {
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
      tabIndex={tabIndex}
      autoFocus={autoFocus}
      data-vscode-context={contextMenuData}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
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
