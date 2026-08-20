import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import type { CanvasViewport } from "../state/cadUiStore";
import type { ViewportSize } from "../components/canvasViewport";
import { screenToWorld } from "../components/canvasViewport";
import { CommandRibbonFloatingOverlay } from "../components/CommandRibbonFloatingOverlay";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type {
  CommandRibbonPresentation,
  CommandRibbonPresentationCommandItem
} from "../components/CommandRibbonView";
import {
  VSCODE_CANVAS_RIBBON_ICON_SIZE,
  type VscodeCanvasRibbon,
  type VscodeCanvasRibbonCommandItem
} from "./vscodeCanvasRibbonConfig";
import {
  vscodeCanvasRibbonCommandFor,
  type VscodeCanvasRibbonCommandContext
} from "./vscodeCanvasRibbonCatalog";
import { resolveVscodeLucideIcon } from "./vscodeCanvasRibbonIcons";
import {
  type VscodeCanvasWorldPoint,
  vscodeCanvasStatusFields
} from "./vscodeCanvasRibbonStatus";

export type VSCodeCanvasRibbonOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  canvasViewport: CanvasViewport;
  canvasRibbonRibbons: VscodeCanvasRibbon[];
  viewportSize: ViewportSize;
  ribbonCommandContext: VscodeCanvasRibbonCommandContext;
  onCommand?: (item: CommandRibbonPresentationCommandItem) => void;
  onPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
};

const commandItemPresentationFor = (
  item: VscodeCanvasRibbonCommandItem,
  ribbonCommandContext: VscodeCanvasRibbonCommandContext
): CommandRibbonPresentationCommandItem => {
  const definition = vscodeCanvasRibbonCommandFor(item.commandId);
  return {
    id: item.id,
    type: "command",
    commandId: item.commandId,
    icon: item.icon || definition?.icon || "circle",
    label: definition?.label ?? item.commandId,
    description: definition?.description ?? "This command is unavailable.",
    showLabel: item.showLabel,
    available: definition?.isAvailable(ribbonCommandContext) ?? false,
    ...(definition?.isPressed
      ? { pressed: definition.isPressed(ribbonCommandContext) }
      : {})
  };
};

const vscodeCanvasRibbonPresentationsFor = (
  ribbons: VscodeCanvasRibbon[],
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null,
  ribbonCommandContext: VscodeCanvasRibbonCommandContext
): CommandRibbonPresentation[] => ribbons.map((ribbon) => ({
  id: ribbon.id,
  label: ribbon.label,
  x: ribbon.x,
  y: ribbon.y,
  orientation: ribbon.orientation,
  iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
  verticalHandlePlacement: ribbon.orientation === "vertical" ? "side" : undefined,
  items: ribbon.items.map((item) => item.type === "value"
    ? {
        id: item.id,
        type: "value" as const,
        label: "Canvas status",
        description: "Current Canvas zoom and pointer position.",
        fields: vscodeCanvasStatusFields(canvasViewport, pointerWorldPoint)
      }
    : commandItemPresentationFor(item, ribbonCommandContext))
}));

const pointerWorldPointFor = (
  event: PointerEvent,
  viewportElement: HTMLDivElement,
  viewportSize: ViewportSize,
  canvasViewport: CanvasViewport
): VscodeCanvasWorldPoint => {
  const rect = viewportElement.getBoundingClientRect();
  return screenToWorld(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    viewportSize,
    canvasViewport
  );
};

export const VSCodeCanvasRibbonOverlay = ({
  canvasFocusRef,
  canvasViewport,
  canvasRibbonRibbons,
  viewportSize,
  ribbonCommandContext,
  onCommand,
  onPositionCommit
}: VSCodeCanvasRibbonOverlayProps) => {
  const [pointerWorldPoint, setPointerWorldPoint] = useState<VscodeCanvasWorldPoint | null>(null);
  const ribbonPresentations = useMemo(
    () => vscodeCanvasRibbonPresentationsFor(
      canvasRibbonRibbons,
      canvasViewport,
      pointerWorldPoint,
      ribbonCommandContext
    ),
    [canvasRibbonRibbons, canvasViewport, pointerWorldPoint, ribbonCommandContext]
  );
  const tracksPointer = canvasRibbonRibbons.some((ribbon) =>
    ribbon.items.some((item) => item.type === "value")
  );

  useEffect(() => {
    const viewportElement = canvasFocusRef.current;
    if (!viewportElement || !tracksPointer) {
      setPointerWorldPoint(null);
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      setPointerWorldPoint(pointerWorldPointFor(event, viewportElement, viewportSize, canvasViewport));
    };
    const handlePointerLeave = () => setPointerWorldPoint(null);
    viewportElement.addEventListener("pointermove", handlePointerMove);
    viewportElement.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      viewportElement.removeEventListener("pointermove", handlePointerMove);
      viewportElement.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [canvasFocusRef, canvasViewport, tracksPointer, viewportSize]);

  return (
    <CommandRibbonFloatingOverlay
      ribbons={ribbonPresentations}
      viewportSize={viewportSize}
      iconResolver={resolveVscodeLucideIcon}
      viewportAwareTooltips
      onCommand={onCommand}
      onPositionCommit={onPositionCommit}
    />
  );
};
