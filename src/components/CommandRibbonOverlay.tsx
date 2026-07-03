import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleDot,
  Copy,
  CornerDownRight,
  FlipHorizontal,
  GripVertical,
  MoveRight,
  Scissors,
  Slash,
  Spline
} from "lucide-react";
import {
  dispatchCommand,
  type CommandContext
} from "../commands/commands";
import type {
  CommandRibbon,
  CommandRibbonIconId,
  CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import {
  loadCommandRibbonSettings,
  saveCommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import type { ViewportSize } from "./canvasViewport";

type CommandRibbonOverlayProps = {
  commandContext: CommandContext;
  viewportSize: ViewportSize;
};

type RibbonDrag = {
  pointerId: number;
  ribbonId: string;
  orientation: CommandRibbon["orientation"];
  settings: CommandRibbonSettings;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const RIBBON_ESTIMATED_WIDTH = 490;
const RIBBON_ESTIMATED_HEIGHT = 36;
const RIBBON_MARGIN = 8;

const iconComponents = {
  "circle-dot": CircleDot,
  "move-right": MoveRight,
  slash: Slash,
  "corner-down-right": CornerDownRight,
  spline: Spline,
  copy: Copy,
  "flip-horizontal": FlipHorizontal,
  scissors: Scissors
} satisfies Record<CommandRibbonIconId, typeof CircleDot>;

const defaultRibbonX = (viewportSize: ViewportSize) =>
  Math.max(RIBBON_MARGIN, Math.round((viewportSize.width - RIBBON_ESTIMATED_WIDTH) / 2));

const clampRibbonPosition = (
  x: number,
  y: number,
  viewportSize: ViewportSize,
  orientation: CommandRibbon["orientation"]
) => {
  const estimatedWidth = orientation === "vertical" ? RIBBON_ESTIMATED_HEIGHT : RIBBON_ESTIMATED_WIDTH;
  const estimatedHeight = orientation === "vertical" ? RIBBON_ESTIMATED_WIDTH : RIBBON_ESTIMATED_HEIGHT;
  return {
    x: Math.min(Math.max(Math.round(x), RIBBON_MARGIN), Math.max(RIBBON_MARGIN, viewportSize.width - estimatedWidth - RIBBON_MARGIN)),
    y: Math.min(Math.max(Math.round(y), RIBBON_MARGIN), Math.max(RIBBON_MARGIN, viewportSize.height - estimatedHeight - RIBBON_MARGIN))
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
  const [settings, setSettings] = useState<CommandRibbonSettings | null>(null);
  const settingsRef = useRef<CommandRibbonSettings | null>(null);
  const dragRef = useRef<RibbonDrag | null>(null);
  const [draggingRibbonId, setDraggingRibbonId] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void loadCommandRibbonSettings()
      .then((loadedSettings) => {
        if (!cancelled) {
          settingsRef.current = loadedSettings;
          setSettings(loadedSettings);
        }
      })
      .catch((error: unknown) => {
        console.error("failed to load command ribbon settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedRibbons = useMemo(() => {
    if (!settings) return [];
    return settings.ribbons.map((ribbon) => {
      const position = clampRibbonPosition(
        ribbon.x ?? defaultRibbonX(viewportSize),
        ribbon.y,
        viewportSize,
        ribbon.orientation
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
      orientation: ribbon.orientation,
      settings,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: resolved.x ?? defaultRibbonX(viewportSize),
      startY: resolved.y
    };
    setDraggingRibbonId(ribbon.id);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const nextPosition = clampRibbonPosition(
      drag.startX + event.clientX - drag.startClientX,
      drag.startY + event.clientY - drag.startClientY,
      viewportSize,
      drag.orientation
    );
    setSettings((current) => {
      if (!current) return current;
      return {
        version: 1,
        ribbons: current.ribbons.map((item) =>
          item.id === drag.ribbonId ? { ...item, ...nextPosition } : item
        )
      };
    });
  };

  const stopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const nextPosition = clampRibbonPosition(
      drag.startX + event.clientX - drag.startClientX,
      drag.startY + event.clientY - drag.startClientY,
      viewportSize,
      drag.orientation
    );
    const currentSettings = settingsRef.current ?? drag.settings;
    const nextSettings: CommandRibbonSettings = {
      version: 1,
      ribbons: currentSettings.ribbons.map((item) =>
        item.id === drag.ribbonId ? { ...item, ...nextPosition } : item
      )
    };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
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
            <GripVertical size={16} strokeWidth={2} />
          </button>
          <div className="command-ribbon-buttons">
            {ribbon.buttons.map((button) => {
              const Icon = iconComponents[button.icon];
              return (
                <button
                  key={button.id}
                  type="button"
                  className={button.showLabel ? "command-ribbon-button has-label" : "command-ribbon-button"}
                  aria-label={button.label}
                  title={button.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand(button.commandId, commandContext);
                    commandContext.focusCanvas?.();
                  }}
                >
                  <Icon size={16} strokeWidth={2} />
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
