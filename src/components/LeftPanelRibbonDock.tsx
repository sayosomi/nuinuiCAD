import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandContext, CommandId } from "../commands/commands";
import type {
  CommandRibbon,
  CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import { saveCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandRibbonView } from "./CommandRibbonView";

type LeftPanelRibbonDockProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  commandContext: CommandContext;
  dockRef: RefObject<HTMLDivElement | null>;
  isSearchActive: boolean;
};

type DockRibbonDrag = {
  pointerId: number;
  ribbonId: string;
  ribbon: CommandRibbon;
  settings: CommandRibbonSettings;
};

const FLOATING_RIBBON_MARGIN = 8;

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

const floatingPositionForClientPoint = (
  clientX: number,
  clientY: number,
  canvasRect: DOMRect
) => ({
  x: Math.max(FLOATING_RIBBON_MARGIN, Math.round(clientX - canvasRect.left)),
  y: Math.max(FLOATING_RIBBON_MARGIN, Math.round(clientY - canvasRect.top))
});

export const LeftPanelRibbonDock = ({
  canvasFocusRef,
  commandContext,
  dockRef,
  isSearchActive
}: LeftPanelRibbonDockProps) => {
  const settings = useCadUiStore((state) => state.commandRibbonSettings);
  const setCommandRibbonSettings = useCadUiStore((state) => state.setCommandRibbonSettings);
  const settingsRef = useRef<CommandRibbonSettings | null>(null);
  const dragRef = useRef<DockRibbonDrag | null>(null);
  const [draggingRibbonId, setDraggingRibbonId] = useState<string | null>(null);
  const disabledCommandIds = useMemo<ReadonlySet<CommandId>>(
    () =>
      isSearchActive
        ? new Set(["moveSelectedElementUp", "moveSelectedElementDown"] satisfies CommandId[])
        : new Set<CommandId>(),
    [isSearchActive]
  );

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const dockedRibbons = settings?.ribbons.filter((ribbon) => ribbon.dock === "leftPanelBottom") ?? [];

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, ribbon: CommandRibbon) => {
    if (!settings || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      ribbonId: ribbon.id,
      ribbon,
      settings
    };
    setDraggingRibbonId(ribbon.id);
  };

  const settingsWithFloatingRibbon = (
    drag: DockRibbonDrag,
    clientX: number,
    clientY: number
  ): CommandRibbonSettings => {
    const currentSettings = settingsRef.current ?? drag.settings;
    const canvasRect = canvasFocusRef.current?.getBoundingClientRect() ?? null;
    if (!canvasRect || !isClientPointInRect(clientX, clientY, canvasRect)) {
      return currentSettings;
    }
    const position = floatingPositionForClientPoint(clientX, clientY, canvasRect);
    return {
      version: 1,
      ribbons: currentSettings.ribbons.map((ribbon) =>
        ribbon.id === drag.ribbonId ? { ...ribbon, dock: "canvas", ...position } : ribbon
      )
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const stopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const currentSettings = settingsRef.current ?? drag.settings;
    const nextSettings = settingsWithFloatingRibbon(drag, event.clientX, event.clientY);
    settingsRef.current = nextSettings;
    setCommandRibbonSettings(nextSettings);
    if (nextSettings !== currentSettings) saveRibbonSettings(nextSettings);
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
    <div className="left-panel-ribbon-dock" aria-label="左ペインのコマンドリボン" ref={dockRef}>
      {dockedRibbons.map((ribbon) => (
        <CommandRibbonView
          key={ribbon.id}
          ribbon={ribbon}
          commandContext={commandContext}
          disabledCommandIds={disabledCommandIds}
          docked
          dragging={draggingRibbonId === ribbon.id}
          onHandlePointerDown={startDrag}
          onHandlePointerMove={moveDrag}
          onHandlePointerUp={stopDrag}
          onHandlePointerCancel={cancelDrag}
        />
      ))}
    </div>
  );
};
