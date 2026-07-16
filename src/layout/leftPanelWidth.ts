import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";

export const DEFAULT_LEFT_PANEL_WIDTH = 420;
export const MIN_LEFT_PANEL_WIDTH = 360;
export const MAX_LEFT_PANEL_WIDTH = 4096;
export const RIGHT_PANEL_WIDTH = 360;
export const MIN_CANVAS_WIDTH = 320;

export const clampStoredLeftPanelWidth = (width: number) =>
  Math.min(Math.max(Math.round(width), MIN_LEFT_PANEL_WIDTH), MAX_LEFT_PANEL_WIDTH);

export const maximumVisibleLeftPanelWidth = (viewportWidth: number) =>
  Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(viewportWidth) - RIGHT_PANEL_WIDTH - MIN_CANVAS_WIDTH);

export const clampVisibleLeftPanelWidth = (width: number, viewportWidth: number) =>
  Math.min(clampStoredLeftPanelWidth(width), maximumVisibleLeftPanelWidth(viewportWidth));

const currentViewportWidth = () => window.innerWidth;

type UseLeftPanelResizeOptions = {
  onWidthCommitted: (width: number) => void;
};

/** Keeps the saved width as a preference while constraining its rendered width to the current viewport. */
export const useLeftPanelResize = ({ onWidthCommitted }: UseLeftPanelResizeOptions) => {
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_LEFT_PANEL_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(currentViewportWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const visibleWidth = useMemo(
    () => clampVisibleLeftPanelWidth(preferredWidth, viewportWidth),
    [preferredWidth, viewportWidth]
  );
  const visibleMaximum = useMemo(() => maximumVisibleLeftPanelWidth(viewportWidth), [viewportWidth]);

  useEffect(() => {
    const onResize = () => setViewportWidth(currentViewportWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const cancelResize = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      event.preventDefault();
      setPreferredWidth(clampVisibleLeftPanelWidth(start.width + event.clientX - start.clientX, currentViewportWidth()));
    };
    const stopResize = (event: globalThis.PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      event.preventDefault();
      const nextWidth = clampVisibleLeftPanelWidth(start.width + event.clientX - start.clientX, currentViewportWidth());
      setPreferredWidth(nextWidth);
      onWidthCommitted(nextWidth);
      cancelResize();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelResize();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", cancelResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelResize);
    };
  }, [isResizing, onWidthCommitted]);

  const setSavedWidth = useCallback((width: number) => setPreferredWidth(clampStoredLeftPanelWidth(width)), []);
  const commitWidth = useCallback((width: number) => {
    const nextWidth = clampVisibleLeftPanelWidth(width, currentViewportWidth());
    setPreferredWidth(nextWidth);
    onWidthCommitted(nextWidth);
  }, [onWidthCommitted]);
  const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStartRef.current = { clientX: event.clientX, width: visibleWidth };
    setIsResizing(true);
  }, [visibleWidth]);

  return {
    isResizing,
    leftPanelWidth: visibleWidth,
    maximumLeftPanelWidth: visibleMaximum,
    setSavedWidth,
    startResize,
    decreaseWidth: (step: number) => commitWidth(visibleWidth - step),
    increaseWidth: (step: number) => commitWidth(visibleWidth + step),
    resetWidth: () => commitWidth(DEFAULT_LEFT_PANEL_WIDTH)
  };
};
