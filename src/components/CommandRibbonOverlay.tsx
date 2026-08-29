import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand, type CommandContext, type CommandId } from "../commands/commands";
import type { CommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { saveCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { useCadUiStore } from "../state/cadUiStore";
import type { ViewportSize } from "./canvasViewport";
import type { RibbonPosition } from "./commandRibbonFloatingGeometry";
import { CommandRibbonFloatingOverlay } from "./CommandRibbonFloatingOverlay";
import { buildCommandRibbonPresentation, resolveCommandRibbonIcon } from "./commandRibbonPresentation";

type CommandRibbonOverlayProps = {
  commandContext: CommandContext;
  leftPanelDockRef: RefObject<HTMLDivElement | null>;
  viewportSize: ViewportSize;
};

const saveRibbonSettings = (settings: CommandRibbonSettings) => {
  void saveCommandRibbonSettings(settings).catch((error: unknown) => {
    console.error("failed to save command ribbon settings", error);
  });
};

export const CommandRibbonOverlay = ({
  commandContext,
  leftPanelDockRef,
  viewportSize
}: CommandRibbonOverlayProps) => {
  const settings = useCadUiStore((state) => state.commandRibbonSettings);
  const setCommandRibbonSettings = useCadUiStore((state) => state.setCommandRibbonSettings);
  const settingsRef = useRef<CommandRibbonSettings | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const ribbons = useMemo(
    () => settings?.ribbons
      .filter((ribbon) => ribbon.dock === "canvas")
      .map((ribbon) => buildCommandRibbonPresentation(ribbon)) ?? [],
    [settings]
  );

  const settingsWithPosition = (ribbonId: string, position: RibbonPosition): CommandRibbonSettings => {
    const currentSettings = settingsRef.current ?? settings;
    if (!currentSettings) return { version: 1, ribbons: [] };
    return {
      version: 1,
      ribbons: currentSettings.ribbons.map((ribbon) =>
        ribbon.id === ribbonId ? { ...ribbon, dock: "canvas", ...position } : ribbon
      )
    };
  };

  if (!settings) return null;

  return (
    <CommandRibbonFloatingOverlay
      ribbons={ribbons}
      viewportSize={viewportSize}
      dockRef={leftPanelDockRef}
      iconResolver={resolveCommandRibbonIcon}
      onPositionChange={(ribbonId, position) => {
        const nextSettings = settingsWithPosition(ribbonId, position);
        settingsRef.current = nextSettings;
        setCommandRibbonSettings(nextSettings);
      }}
      onPositionCommit={(ribbonId, position) => {
        const nextSettings = settingsWithPosition(ribbonId, position);
        settingsRef.current = nextSettings;
        setCommandRibbonSettings(nextSettings);
        saveRibbonSettings(nextSettings);
      }}
      onDropToDock={(ribbonId, position) => {
        const positioned = settingsWithPosition(ribbonId, position);
        const nextSettings: CommandRibbonSettings = {
          version: 1,
          ribbons: positioned.ribbons.map((ribbon) =>
            ribbon.id === ribbonId ? { ...ribbon, dock: "leftPanelBottom" } : ribbon
          )
        };
        settingsRef.current = nextSettings;
        setCommandRibbonSettings(nextSettings);
        saveRibbonSettings(nextSettings);
      }}
      onCommand={(item) => {
        const commandId = item.commandId as CommandId;
        dispatchCommand(commandId, commandContext);
        commandContext.focusCanvas?.();
      }}
    />
  );
};
