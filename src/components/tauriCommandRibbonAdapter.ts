import { Circle } from "lucide-react";
import { commands, type CommandId } from "../commands/commands";
import {
  commandRibbonIconColorValues,
  type CommandRibbon,
  type CommandRibbonIconColor
} from "../commandRibbons/commandRibbonSettings";
import {
  commandRibbonIconComponents,
  type CommandRibbonIconId
} from "../commandRibbons/commandRibbonIcons";
import type {
  CommandRibbonPresentation,
  CommandRibbonPresentationCommandItem
} from "./CommandRibbonView";

export const resolveTauriCommandRibbonIcon = (iconName: string) =>
  commandRibbonIconComponents[iconName as CommandRibbonIconId] ?? Circle;

export const tauriCommandRibbonPresentation = (
  ribbon: CommandRibbon,
  disabledCommandIds: ReadonlySet<CommandId> = new Set(),
  docked = false
): CommandRibbonPresentation => ({
  id: ribbon.id,
  label: ribbon.label,
  x: ribbon.x,
  y: ribbon.y,
  orientation: ribbon.orientation,
  iconSize: ribbon.iconSize,
  docked,
  items: ribbon.buttons.map((button): CommandRibbonPresentationCommandItem => ({
    id: button.id,
    type: "command",
    commandId: button.commandId,
    icon: button.icon,
    iconColor: button.iconColor === "default"
      ? undefined
      : commandRibbonIconColorValues[button.iconColor as CommandRibbonIconColor],
    label: button.label,
    description: commands[button.commandId].label,
    showLabel: button.showLabel,
    available: !disabledCommandIds.has(button.commandId),
    nativeDisabled: disabledCommandIds.has(button.commandId)
  }))
});
