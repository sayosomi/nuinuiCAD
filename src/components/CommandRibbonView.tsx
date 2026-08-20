import type { PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";

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
};

export type CommandRibbonViewProps = {
  ribbon: CommandRibbonPresentation;
  className?: string;
  dragging?: boolean;
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
  iconResolver,
  onCommand,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel
}: CommandRibbonViewProps) => (
  <div
    className={[
      "command-ribbon",
      ribbon.docked ? "is-docked" : `is-${ribbon.orientation}`,
      dragging ? "is-dragging" : "",
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
              className="command-ribbon-value"
              role="status"
              aria-label={`${item.label}: ${item.value}`}
              aria-describedby={tooltipId}
            >
              <span className="command-ribbon-value-label">{item.label}</span>
              <output>{item.value}</output>
              <span id={tooltipId} className="command-ribbon-tooltip" role="tooltip">
                {item.label}: {item.description}
              </span>
            </span>
          );
        }

        const Icon = iconResolver(item.icon);
        const title = `${item.label}: ${item.description}`;
        return (
          <span key={item.id} className="command-ribbon-item-shell">
            <button
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
            <span id={tooltipId} className="command-ribbon-tooltip" role="tooltip">
              {title}
            </span>
          </span>
        );
      })}
    </div>
  </div>
);
