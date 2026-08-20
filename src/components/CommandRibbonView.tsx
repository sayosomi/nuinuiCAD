import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  calculateCommandRibbonTooltipPlacement,
  type CommandRibbonTooltipPlacement
} from "./commandRibbonTooltipGeometry";

export const RIBBON_BUTTON_PADDING = 14;
export const RIBBON_HANDLE_WIDTH = 24;

export type CommandRibbonPresentationCommandItem = {
  id: string;
  type: "command";
  commandId: string;
  icon: string;
  iconColor?: string;
  label: string;
  description: string;
  showLabel: boolean;
  available: boolean;
  nativeDisabled?: boolean;
  pressed?: boolean;
};

export type CommandRibbonPresentationValueItem = {
  id: string;
  type: "value";
  label: string;
  description: string;
  value: string;
};

export type CommandRibbonPresentationItem =
  | CommandRibbonPresentationCommandItem
  | CommandRibbonPresentationValueItem;

export type CommandRibbonPresentation = {
  id: string;
  label: string;
  x: number | null;
  y: number;
  orientation: "horizontal" | "vertical";
  iconSize: number;
  items: CommandRibbonPresentationItem[];
  docked?: boolean;
  verticalHandlePlacement?: "top" | "side";
};

export type CommandRibbonViewProps = {
  ribbon: CommandRibbonPresentation;
  className?: string;
  dragging?: boolean;
  viewportAwareTooltips?: boolean;
  tooltipBoundaryRef?: RefObject<HTMLElement | null>;
  iconResolver: (iconName: string) => LucideIcon;
  onCommand?: (item: CommandRibbonPresentationCommandItem) => void;
  onHandlePointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    ribbon: CommandRibbonPresentation
  ) => void;
  onHandlePointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

const tooltipIdFor = (ribbonId: string, itemId: string): string =>
  `command-ribbon-tooltip-${ribbonId}-${itemId}`.replace(/[^a-zA-Z0-9_-]/g, "-");

export const CommandRibbonView = ({
  ribbon,
  className = "",
  dragging = false,
  viewportAwareTooltips = false,
  tooltipBoundaryRef,
  iconResolver,
  onCommand,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel
}: CommandRibbonViewProps) => {
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<
    (CommandRibbonTooltipPlacement & { tooltipId: string }) | null
  >(null);
  const tooltipSourcesRef = useRef(new Map<string, { hover: boolean; focus: boolean }>());
  const triggerNodesRef = useRef(new Map<string, HTMLElement>());
  const tooltipNodesRef = useRef(new Map<string, HTMLSpanElement>());

  const setTriggerNode = useCallback((tooltipId: string, node: HTMLElement | null) => {
    if (node) {
      triggerNodesRef.current.set(tooltipId, node);
    } else {
      triggerNodesRef.current.delete(tooltipId);
    }
  }, []);

  const setTooltipNode = useCallback((tooltipId: string, node: HTMLSpanElement | null) => {
    if (node) {
      tooltipNodesRef.current.set(tooltipId, node);
    } else {
      tooltipNodesRef.current.delete(tooltipId);
    }
  }, []);

  const repositionTooltip = useCallback((tooltipId = activeTooltipId) => {
    if (!viewportAwareTooltips || !tooltipId) {
      setTooltipPlacement(null);
      return;
    }
    const trigger = triggerNodesRef.current.get(tooltipId);
    const tooltip = tooltipNodesRef.current.get(tooltipId);
    const boundary = tooltipBoundaryRef?.current;
    if (!trigger || !tooltip || !boundary) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const placement = calculateCommandRibbonTooltipPlacement(
      triggerRect,
      { width: tooltipRect.width, height: tooltipRect.height },
      boundaryRect
    );
    setTooltipPlacement({ tooltipId, ...placement });
  }, [activeTooltipId, tooltipBoundaryRef, viewportAwareTooltips]);

  useEffect(() => {
    if (!viewportAwareTooltips || !activeTooltipId) return;
    const onResize = () => repositionTooltip();
    window.addEventListener("resize", onResize);
    const boundary = tooltipBoundaryRef?.current;
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && boundary) {
      observer = new ResizeObserver(onResize);
      observer.observe(boundary);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [activeTooltipId, repositionTooltip, tooltipBoundaryRef, viewportAwareTooltips]);

  const setTooltipSource = useCallback(
    (tooltipId: string, source: "hover" | "focus", active: boolean) => {
      if (!viewportAwareTooltips) return;
      const sources = tooltipSourcesRef.current.get(tooltipId) ?? { hover: false, focus: false };
      sources[source] = active;
      tooltipSourcesRef.current.set(tooltipId, sources);
      const shouldClear = !active && !sources.hover && !sources.focus;
      if (shouldClear) setTooltipPlacement(null);
      if (active && viewportAwareTooltips) repositionTooltip(tooltipId);
      setActiveTooltipId((current) => {
        if (active) return tooltipId;
        return current === tooltipId && shouldClear ? null : current;
      });
    },
    [repositionTooltip, viewportAwareTooltips]
  );

  const tooltipStyleFor = (tooltipId: string) => {
    if (!viewportAwareTooltips || tooltipPlacement?.tooltipId !== tooltipId) return undefined;
    return {
      position: "fixed" as const,
      left: tooltipPlacement.left,
      top: tooltipPlacement.top,
      transform: "none"
    };
  };

  return (
    <div
      className={[
        "command-ribbon",
        ribbon.docked ? "is-docked" : `is-${ribbon.orientation}`,
        ribbon.verticalHandlePlacement === "side" ? "has-side-handle" : "",
        dragging ? "is-dragging" : "",
        viewportAwareTooltips ? "has-viewport-aware-tooltips" : "",
        className
      ].filter(Boolean).join(" ")}
      data-ribbon-id={ribbon.id}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="command-ribbon-handle"
        aria-label={`${ribbon.label}を移動`}
        title="ドラッグで移動"
        onPointerDown={(event) => onHandlePointerDown?.(event, ribbon)}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerCancel}
      >
        <span className="command-ribbon-grip" aria-hidden="true">⋮⋮</span>
      </button>
      <div className="command-ribbon-buttons">
        {ribbon.items.map((item) => {
          const tooltipId = tooltipIdFor(ribbon.id, item.id);
          if (item.type === "value") {
            return (
              <span
                key={item.id}
                ref={(node) => setTriggerNode(tooltipId, node)}
                className="command-ribbon-value"
                role="status"
                aria-label={`${item.label}: ${item.value}`}
                aria-describedby={tooltipId}
                onPointerEnter={() => setTooltipSource(tooltipId, "hover", true)}
                onPointerLeave={() => setTooltipSource(tooltipId, "hover", false)}
              >
                <span className="command-ribbon-value-label">{item.label}</span>
                <output>{item.value}</output>
                <span
                  ref={(node) => setTooltipNode(tooltipId, node)}
                  id={tooltipId}
                  className="command-ribbon-tooltip"
                  role="tooltip"
                  style={tooltipStyleFor(tooltipId)}
                >
                  {item.label}: {item.description}
                </span>
              </span>
            );
          }

          const Icon = iconResolver(item.icon);
          const title = `${item.label}: ${item.description}`;
          return (
            <span
              key={item.id}
              className="command-ribbon-item-shell"
              onPointerEnter={() => setTooltipSource(tooltipId, "hover", true)}
              onPointerLeave={() => setTooltipSource(tooltipId, "hover", false)}
            >
              <button
                ref={(node) => setTriggerNode(tooltipId, node)}
                type="button"
                className={[
                  "command-ribbon-button",
                  item.showLabel ? "has-label" : "",
                  item.pressed ? "is-active" : ""
                ].filter(Boolean).join(" ")}
                aria-label={item.label}
                aria-describedby={tooltipId}
                aria-disabled={item.available ? undefined : "true"}
                aria-pressed={item.pressed === undefined ? undefined : item.pressed}
                disabled={item.nativeDisabled}
                title={title}
                data-command-id={item.commandId}
                style={{
                  minWidth: ribbon.iconSize + RIBBON_BUTTON_PADDING,
                  minHeight: ribbon.iconSize + RIBBON_BUTTON_PADDING
                }}
                onFocus={() => setTooltipSource(tooltipId, "focus", true)}
                onBlur={() => setTooltipSource(tooltipId, "focus", false)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (item.available) onCommand?.(item);
                }}
              >
                <Icon
                  size={ribbon.iconSize}
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ color: item.iconColor || "currentColor" }}
                />
                {item.showLabel ? <span>{item.label}</span> : null}
              </button>
              <span
                ref={(node) => setTooltipNode(tooltipId, node)}
                id={tooltipId}
                className="command-ribbon-tooltip"
                role="tooltip"
                style={tooltipStyleFor(tooltipId)}
              >
                {title}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
