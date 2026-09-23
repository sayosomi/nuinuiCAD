import type { CanvasViewport } from "../state/cadUiStore";
import {
  CommandRibbonView,
  type CommandRibbonPresentation,
  type CommandRibbonPresentationCommandItem
} from "../components/CommandRibbonView";
import type { CanvasPresentation } from "../components/canvasPresentation";
import { pickModeCanvasCommandAllowedForActive } from "./pickModeCanvasPolicy";
import { resolveVscodeLucideIcon } from "./vscodeCanvasRibbonIcons";
import { VSCODE_CANVAS_RIBBON_ICON_SIZE } from "./vscodeCanvasRibbonConfig";
import { vscodeViewportZoomPresentationFor } from "./vscodeViewportStatus";
import { viewModeCommandDefinitions } from "../commands/viewModeCommandDefinitions";
import { vscodeCanvasViewportCommands } from "./vscodeCanvasViewportCommandModel";

type VSCodeCanvasViewportControlsProps = {
  canvasViewport: CanvasViewport;
  pickModeChromeHeight: number;
  pickModeActive: boolean;
  presentation?: CanvasPresentation;
  onCommand?: (item: CommandRibbonPresentationCommandItem) => void;
};

const commandPresentationFor = (
  command: (typeof vscodeCanvasViewportCommands)[number],
  pickModeActive: boolean,
  presentation?: CanvasPresentation
): CommandRibbonPresentationCommandItem => {
  const definition = viewModeCommandDefinitions[command.commandId];
  return {
    id: `canvas-viewport-${command.commandId}`,
    type: "command",
    commandId: command.commandId,
    icon: command.icon,
    label: presentation?.text(
      `canvas.ribbon.command.${command.commandId}.label`,
      definition.label
    ) ?? definition.label,
    description: presentation?.text(
      `canvas.ribbon.command.${command.commandId}.description`,
      "Canvas viewport command."
    ) ?? "Canvas viewport command.",
    showLabel: false,
    available: pickModeCanvasCommandAllowedForActive(command.commandId, pickModeActive)
  };
};

export const VSCodeCanvasViewportControls = ({
  canvasViewport,
  pickModeChromeHeight,
  pickModeActive,
  presentation,
  onCommand
}: VSCodeCanvasViewportControlsProps) => {
  const ribbon: CommandRibbonPresentation = {
    id: "canvas-viewport-controls",
    label: presentation?.text("canvas.viewportControls.title", "Canvas viewport controls")
      ?? "Canvas viewport controls",
    x: null,
    y: 0,
    orientation: "horizontal",
    iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
    items: [
      commandPresentationFor(vscodeCanvasViewportCommands[0], pickModeActive, presentation),
      vscodeViewportZoomPresentationFor(
        "canvas-viewport-zoom-percent",
        canvasViewport,
        presentation?.text("canvas.zoomPercent.label", "Canvas zoom") ?? "Canvas zoom",
        presentation?.text("canvas.zoomPercent.description", "Current Canvas zoom.") ?? "Current Canvas zoom."
      ),
      commandPresentationFor(vscodeCanvasViewportCommands[1], pickModeActive, presentation),
      commandPresentationFor(vscodeCanvasViewportCommands[2], pickModeActive, presentation),
      commandPresentationFor(vscodeCanvasViewportCommands[3], pickModeActive, presentation)
    ]
  };

  return (
    <div
      className="canvas-viewport-controls"
      data-canvas-viewport-controls="true"
      style={{ top: Math.max(8, pickModeChromeHeight + 8), right: 8 }}
    >
      <CommandRibbonView
        ribbon={ribbon}
        className="canvas-viewport-controls-ribbon"
        showHandle={false}
        iconResolver={resolveVscodeLucideIcon}
        onCommand={onCommand}
      />
    </div>
  );
};
