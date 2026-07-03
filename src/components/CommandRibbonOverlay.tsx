import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dispatchCommand,
  type CommandContext
} from "../commands/commands";
import type {
  CommandRibbon,
  CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import { saveCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import {
  CommandRibbonGripIcon,
  commandRibbonIconComponents
} from "../commandRibbons/commandRibbonIcons";
import { useCadUiStore } from "../state/cadUiStore";
import type { ViewportSize } from "./canvasViewport";

type CommandRibbonOverlayProps = {
  commandContext: CommandContext;
  viewportSize: ViewportSize;
};

type RibbonDrag = {
  pointerId: number;
  ribbonId: string;
  ribbon: CommandRibbon;
  settings: CommandRibbonSettings;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const RIBBON_MARGIN = 8;
const RIBBON_BUTTON_PADDING = 14;
const RIBBON_HANDLE_WIDTH = 24;

const estimatedRibbonLength = (ribbon: CommandRibbon) =>
  RIBBON_HANDLE_WIDTH + ribbon.buttons.length * (ribbon.iconSize + RIBBON_BUTTON_PADDING);

const estimatedRibbonThickness = (ribbon: CommandRibbon) =>
  ribbon.iconSize + RIBBON_BUTTON_PADDING;

const defaultRibbonX = (viewportSize: ViewportSize, ribbon: CommandRibbon) =>
  Math.max(RIBBON_MARGIN, Math.round((viewportSize.width - estimatedRibbonLength(ribbon)) / 2));

const clampRibbonPosition = (
  x: number,
  y: number,
  viewportSize: ViewportSize,
  ribbon: CommandRibbon
) => {
  const length = estimatedRibbonLength(ribbon);
  const thickness = estimatedRibbonThickness(ribbon);
  const estimatedWidth = ribbon.orientation === "vertical" ? thickness : length;
  const estimatedHeight = ribbon.orientation === "vertical" ? length : thickness;
  return {
    x: Math.min(
      Math.max(Math.round(x), RIBBON_MARGIN),
      Math.max(RIBBON_MARGIN, viewportSize.width - estimatedWidth - RIBBON_MARGIN)
    ),
    y: Math.min(
      Math.max(Math.round(y), RIBBON_MARGIN),
      Math.max(RIBBON_MARGIN, viewportSize.height - estimatedHeight - RIBBON_MARGIN)
    )
  };
};

const saveRibbonSettings = (settings: CommandRibbonSettings) => {
  void saveCommandRibbonSettings(settings).catch((error: unknown) => {
    console.error("failed to save command ribbon settings", error);
  });
};

export const CommandRibbonOverlay = ({
  commandContext,
  viewportSize
}: CommandRibbonOverlayProps) => {
  const settings = useCadUiStore((state) => state.commandRibbonSettings);
  const setCommandRibbonSettings = useCadUiStore((state) => state.setCommandRibbonSettings);
  const settingsRef = useRef<CommandRibbonSettings | null>(null);
  const dragRef = useRef<RibbonDrag | null>(null);
  const [draggingRibbonId, setDraggingRibbonId] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const resolvedRibbons = useMemo(() => {
    if (!settings) return [];
    return settings.ribbons.map((ribbon) => {
      const position = clampRibbonPosition(
        ribbon.x ?? defaultRibbonX(viewportSize, ribbon),
        ribbon.y,
        viewportSize,
        ribbon
      );
      return { ...ribbon, ...position };
    });
  }, [settings, viewportSize]);

  if (!settings || viewportSize.width <= 0 || viewportSize.height <= 0) return null;

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, ribbon: CommandRibbon) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const resolved = resolvedRibbons.find((item) => item.id === ribbon.id) ?? ribbon;
    dragRef.current = {
      pointerId: event.pointerId,
      ribbonId: ribbon.id,
      ribbon,
      settings,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: resolved.x ?? defaultRibbonX(viewportSize, ribbon),
      startY: resolved.y
    };
    setDraggingRibbonId(ribbon.id);
  };

  const settingsWithRibbonPosition = (drag: RibbonDrag, clientX: number, clientY: number) => {
    const currentSettings = settingsRef.current ?? drag.settings;
    const currentRibbon =
      currentSettings.ribbons.find((item) => item.id === drag.ribbonId) ?? drag.ribbon;
    const nextPosition = clampRibbonPosition(
      drag.startX + clientX - drag.startClientX,
      drag.startY + clientY - drag.startClientY,
      viewportSize,
      currentRibbon
    );
    return {
      version: 1,
      ribbons: currentSettings.ribbons.map((item) =>
        item.id === drag.ribbonId ? { ...item, ...nextPosition } : item
      )
    } satisfies CommandRibbonSettings;
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    setCommandRibbonSettings(settingsWithRibbonPosition(drag, event.clientX, event.clientY));
  };

  const stopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const nextSettings = settingsWithRibbonPosition(drag, event.clientX, event.clientY);
    settingsRef.current = nextSettings;
    setCommandRibbonSettings(nextSettings);
    saveRibbonSettings(nextSettings);
    dragRef.current = null;
    setDraggingRibbonId(null);
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      setDraggingRibbonId(null);
    }
  };

  return (
    <div className="command-ribbon-layer" aria-label="コマンドリボン">
      {resolvedRibbons.map((ribbon) => (
        <div
          key={ribbon.id}
          className={`command-ribbon is-${ribbon.orientation} ${draggingRibbonId === ribbon.id ? "is-dragging" : ""}`}
          style={{ left: ribbon.x, top: ribbon.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="command-ribbon-handle"
            aria-label={`${ribbon.label}を移動`}
            title="ドラッグで移動"
            onPointerDown={(event) => startDrag(event, ribbon)}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={cancelDrag}
          >
            <CommandRibbonGripIcon size={Math.max(14, ribbon.iconSize)} strokeWidth={2} />
          </button>
          <div className="command-ribbon-buttons">
            {ribbon.buttons.map((button) => {
              const Icon = commandRibbonIconComponents[button.icon];
              return (
                <button
                  key={button.id}
                  type="button"
                  className={button.showLabel ? "command-ribbon-button has-label" : "command-ribbon-button"}
                  aria-label={button.label}
                  title={button.label}
                  style={{
                    minWidth: ribbon.iconSize + RIBBON_BUTTON_PADDING,
                    minHeight: ribbon.iconSize + RIBBON_BUTTON_PADDING
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand(button.commandId, commandContext);
                    commandContext.focusCanvas?.();
                  }}
                >
                  <Icon size={ribbon.iconSize} strokeWidth={2} />
                  {button.showLabel ? <span>{button.label}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
