import type { PointerEvent as ReactPointerEvent } from "react";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandContext } from "../commands/commands";
import type {
  CommandRibbon,
  CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import {
  saveCommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import { useCadUiStore } from "../state/cadUiStore";
import type { ViewportSize } from "./canvasViewport";
import {
  CommandRibbonView,
  RIBBON_BUTTON_PADDING,
  RIBBON_HANDLE_WIDTH
} from "./CommandRibbonView";

type CommandRibbonOverlayProps = {
  commandContext: CommandContext;
  leftPanelDockRef: RefObject<HTMLDivElement | null>;
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

const isClientPointInRect = (clientX: number, clientY: number, rect: DOMRect | null) =>
  Boolean(
    rect &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
  );

export const CommandRibbonOverlay = ({
  commandContext,
  leftPanelDockRef,
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
    return settings.ribbons.filter((ribbon) => ribbon.dock === "canvas").map((ribbon) => {
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
        item.id === drag.ribbonId ? { ...item, dock: "canvas", ...nextPosition } : item
      )
    } satisfies CommandRibbonSettings;
  };

  const settingsWithDockedRibbon = (drag: RibbonDrag, clientX: number, clientY: number) => {
    const positionedSettings = settingsWithRibbonPosition(drag, clientX, clientY);
    return {
      version: 1,
      ribbons: positionedSettings.ribbons.map((item) =>
        item.id === drag.ribbonId ? { ...item, dock: "leftPanelBottom" } : item
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
    const dockRect = leftPanelDockRef.current?.getBoundingClientRect() ?? null;
    const nextSettings = isClientPointInRect(event.clientX, event.clientY, dockRect)
      ? settingsWithDockedRibbon(drag, event.clientX, event.clientY)
      : settingsWithRibbonPosition(drag, event.clientX, event.clientY);
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
          style={{ position: "absolute", left: ribbon.x, top: ribbon.y }}
        >
          <CommandRibbonView
            ribbon={ribbon}
            commandContext={commandContext}
            dragging={draggingRibbonId === ribbon.id}
            onHandlePointerDown={startDrag}
            onHandlePointerMove={moveDrag}
            onHandlePointerUp={stopDrag}
            onHandlePointerCancel={cancelDrag}
          />
        </div>
      ))}
    </div>
  );
};
