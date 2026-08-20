import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommand, type CommandContext, type CommandId } from "../commands/commands";
import type {
  CommandRibbon,
  CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import { saveCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { useCadUiStore } from "../state/cadUiStore";
import {
  CommandRibbonView,
  type CommandRibbonPresentation
} from "./CommandRibbonView";
import { resolveTauriCommandRibbonIcon, tauriCommandRibbonPresentation } from "./tauriCommandRibbonAdapter";

type SourceRibbonDockProps = {
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

export const SourceRibbonDock = ({
  canvasFocusRef,
  commandContext,
  dockRef,
  isSearchActive
}: SourceRibbonDockProps) => {
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

  // "leftPanelBottom" is a persisted settings value; renaming it would orphan saved
  // ribbon layouts, so the legacy name stays until a deliberate settings migration.
  const dockedRibbons = settings?.ribbons.filter((ribbon) => ribbon.dock === "leftPanelBottom") ?? [];

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, presentation: CommandRibbonPresentation) => {
    const ribbon = settings?.ribbons.find((candidate) => candidate.id === presentation.id);
    if (!settings || !ribbon || event.button !== 0) return;
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
    <div className="source-ribbon-dock" aria-label="Source Editorのコマンドリボン" ref={dockRef}>
      {dockedRibbons.map((ribbon) => (
        <CommandRibbonView
          key={ribbon.id}
          ribbon={tauriCommandRibbonPresentation(ribbon, disabledCommandIds, true)}
          iconResolver={resolveTauriCommandRibbonIcon}
          dragging={draggingRibbonId === ribbon.id}
          onCommand={(item) => {
            dispatchCommand(item.commandId as CommandId, commandContext);
            commandContext.focusCanvas?.();
          }}
          onHandlePointerDown={startDrag}
          onHandlePointerMove={moveDrag}
          onHandlePointerUp={stopDrag}
          onHandlePointerCancel={cancelDrag}
        />
      ))}
    </div>
  );
};
