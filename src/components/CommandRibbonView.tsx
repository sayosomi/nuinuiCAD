import type { PointerEvent as ReactPointerEvent } from "react";
import {
  dispatchCommand,
  type CommandContext,
  type CommandId
} from "../commands/commands";
import type { CommandRibbon } from "../commandRibbons/commandRibbonSettings";
import {
  commandRibbonIconColorValues
} from "../commandRibbons/commandRibbonSettings";
import {
  CommandRibbonGripIcon,
  commandRibbonIconComponents
} from "../commandRibbons/commandRibbonIcons";

export const RIBBON_BUTTON_PADDING = 14;
export const RIBBON_HANDLE_WIDTH = 24;

type CommandRibbonViewProps = {
  ribbon: CommandRibbon;
  className?: string;
  commandContext?: CommandContext;
  disabledCommandIds?: ReadonlySet<CommandId>;
  docked?: boolean;
  dragging?: boolean;
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, ribbon: CommandRibbon) => void;
  onHandlePointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export const CommandRibbonView = ({
  ribbon,
  className = "",
  commandContext = {},
  disabledCommandIds,
  docked = false,
  dragging = false,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel
}: CommandRibbonViewProps) => (
  <div
    className={[
      "command-ribbon",
      docked ? "is-docked" : `is-${ribbon.orientation}`,
      dragging ? "is-dragging" : "",
      className
    ].filter(Boolean).join(" ")}
    onPointerDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
  >
    <button
      type="button"
      className="command-ribbon-handle"
      aria-label={`${ribbon.label}を移動`}
      title="ドラッグで移動"
      onPointerDown={(event) => onHandlePointerDown(event, ribbon)}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerCancel}
    >
      <CommandRibbonGripIcon size={Math.max(14, ribbon.iconSize)} strokeWidth={2} />
    </button>
    <div className="command-ribbon-buttons">
      {ribbon.buttons.map((button) => {
        const Icon = commandRibbonIconComponents[button.icon];
        const disabled = disabledCommandIds?.has(button.commandId) ?? false;
        return (
          <button
            key={button.id}
            type="button"
            className={button.showLabel ? "command-ribbon-button has-label" : "command-ribbon-button"}
            aria-label={button.label}
            title={button.label}
            disabled={disabled}
            style={{
              minWidth: ribbon.iconSize + RIBBON_BUTTON_PADDING,
              minHeight: ribbon.iconSize + RIBBON_BUTTON_PADDING
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (disabled) return;
              dispatchCommand(button.commandId, commandContext);
              commandContext.focusCanvas?.();
            }}
          >
            <Icon
              size={ribbon.iconSize}
              strokeWidth={2}
              style={{ color: commandRibbonIconColorValues[button.iconColor] }}
            />
            {button.showLabel ? <span>{button.label}</span> : null}
          </button>
        );
      })}
    </div>
  </div>
);
