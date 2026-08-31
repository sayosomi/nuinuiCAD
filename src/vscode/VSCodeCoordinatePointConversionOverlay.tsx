import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { hitTestPointPickCandidates } from "../components/canvasInteractionHitTest";
import type { ScreenPoint } from "../components/DrawingCanvasHitTest";
import { type ViewportSize, worldToScreen } from "../components/canvasViewport";
import { canvasThemeCssVariables, type CanvasTheme } from "../components/canvasTheme";
import type { CanvasViewport } from "../state/cadUiStore";
import {
  coordinatePointConversionBaseForInput,
  coordinatePointConversionBaseSuggestions,
  type CoordinatePointConversionSession
} from "../commands/coordinatePointConversionSession";

type VSCodeCoordinatePointConversionOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
  canvasTheme: CanvasTheme;
  session: CoordinatePointConversionSession;
  onQuery: (query: string) => void;
  onSelectBase: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const pointerScreenPoint = (event: PointerEvent, viewport: HTMLDivElement): ScreenPoint => {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const pointHitRadius = 14;

export const VSCodeCoordinatePointConversionOverlay = ({
  canvasFocusRef,
  viewportSize,
  canvasViewport,
  canvasTheme,
  session,
  onQuery,
  onSelectBase,
  onConfirm,
  onCancel
}: VSCodeCoordinatePointConversionOverlayProps) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(() => session.baseCandidates.map((candidate) => ({
    id: candidate.key,
    screen: worldToScreen(candidate.point, viewportSize, canvasViewport),
    candidate
  })), [canvasViewport, session.baseCandidates, viewportSize]);
  const suggestions = useMemo(
    () => coordinatePointConversionBaseSuggestions(session, session.query),
    [session]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, [session.requestId]);

  const hitAt = useCallback((screen: ScreenPoint) => hitTestPointPickCandidates(
    screen,
    candidates,
    pointHitRadius
  )[0]?.candidate ?? null, [candidates]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport) return;
    const isUiEvent = (event: Event) => event.target instanceof Element &&
      Boolean(event.target.closest("[data-coordinate-point-conversion-ui='true']"));
    const onPointerMove = (event: PointerEvent) => {
      if (isUiEvent(event)) return;
      setHoveredKey(hitAt(pointerScreenPoint(event, viewport))?.key ?? null);
    };
    const onPointerLeave = () => setHoveredKey(null);
    const onPointerDown = (event: PointerEvent) => {
      if (isUiEvent(event)) return;
      const candidate = hitAt(pointerScreenPoint(event, viewport));
      if (!candidate) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onSelectBase(candidate.key);
      inputRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1));
        return;
      }
      if (event.key === "ArrowUp" && suggestions.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        const directBase = coordinatePointConversionBaseForInput(session, session.query);
        const base = directBase ?? suggestions[activeSuggestionIndex] ?? null;
        if (base && !session.selectedBaseKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          onSelectBase(base.key);
          onConfirm();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        onConfirm();
      }
    };
    viewport.addEventListener("pointermove", onPointerMove, true);
    viewport.addEventListener("pointerleave", onPointerLeave, true);
    viewport.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      viewport.removeEventListener("pointermove", onPointerMove, true);
      viewport.removeEventListener("pointerleave", onPointerLeave, true);
      viewport.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [activeSuggestionIndex, canvasFocusRef, hitAt, onCancel, onConfirm, onSelectBase, session, session.selectedBaseKey, suggestions]);

  return (
    <>
      <svg
        data-coordinate-point-conversion-visuals="true"
        viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
        style={{
          ...canvasThemeCssVariables(canvasTheme),
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
          zIndex: 4
        }}
        aria-hidden="true"
      >
        {candidates.map(({ id, screen }) => {
          const selected = id === session.selectedBaseKey;
          const hovered = id === hoveredKey;
          return (
            <circle
              key={`coordinate-point-conversion-${id}`}
              cx={screen.x}
              cy={screen.y}
              r={selected ? 9 : hovered ? 8 : 6}
              fill={selected ? "var(--canvas-selection)" : "var(--canvas-background)"}
              stroke={selected ? "var(--canvas-selection)" : "var(--canvas-pick-candidate)"}
              strokeWidth={selected || hovered ? 3 : 1.5}
              opacity={selected || hovered ? 1 : 0.72}
            />
          );
        })}
      </svg>
      <div
        data-coordinate-point-conversion-ui="true"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          ...canvasThemeCssVariables(canvasTheme),
          position: "absolute",
          top: 12,
          left: 12,
          width: "min(380px, calc(100% - 24px))",
          boxSizing: "border-box",
          padding: 10,
          border: "1px solid var(--canvas-accent)",
          borderRadius: 5,
          background: "color-mix(in srgb, var(--canvas-background) 94%, transparent)",
          color: "var(--canvas-foreground)",
          zIndex: 6,
          pointerEvents: "auto",
          fontSize: 12
        }}
      >
        <strong>{session.mode === "xy" ? "Convert Point to XY Offset" : "Convert Point to Angle-Distance Offset"}</strong>
        <div style={{ marginTop: 5, color: canvasTheme.muted }}>
          {session.targets.length} target{session.targets.length === 1 ? "" : "s"} · choose one shared base point
        </div>
        <input
          ref={inputRef}
          value={session.query}
          onChange={(event) => {
            setActiveSuggestionIndex(0);
            onQuery(event.target.value);
          }}
          placeholder="Base reference, e.g. @Base"
          aria-label="Coordinate conversion base reference"
          data-coordinate-point-conversion-ui="true"
          style={{
            marginTop: 8,
            width: "100%",
            boxSizing: "border-box",
            padding: "5px 6px",
            color: "var(--canvas-foreground)",
            background: "var(--canvas-background)",
            border: "1px solid var(--canvas-muted)"
          }}
        />
        {suggestions.length > 0 ? (
          <div role="listbox" aria-label="Coordinate conversion base suggestions" style={{ marginTop: 5 }}>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
                type="button"
                role="option"
                aria-selected={suggestion.key === session.selectedBaseKey}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  onSelectBase(suggestion.key);
                  inputRef.current?.focus();
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "space-between",
                  textAlign: "left",
                  border: 0,
                  padding: "4px 5px",
                  color: "var(--canvas-foreground)",
                  background: index === activeSuggestionIndex ? "var(--canvas-hover)" : "transparent"
                }}
              >
                <span>{suggestion.displayLabel}</span>
                <small style={{ color: canvasTheme.muted }}>{suggestion.detail}</small>
              </button>
            ))}
          </div>
        ) : null}
        {session.error ? <div role="alert" style={{ marginTop: 6, color: canvasTheme.error }}>{session.error.message}</div> : null}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <small style={{ color: canvasTheme.muted, flex: 1 }}>Click a point · Enter apply · Esc cancel</small>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={!session.selectedBaseKey && suggestions.length !== 1} onClick={onConfirm}>Apply</button>
        </div>
      </div>
    </>
  );
};
