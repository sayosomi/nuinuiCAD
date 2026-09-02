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
import type { CanvasPresentation } from "../components/canvasPresentation";
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
  vscodeCanvasStatusPresentationFor
} from "./vscodeCanvasRibbonStatus";
import { vscodeCanvasRibbonContextData } from "./protocol";

export type VSCodeCanvasRibbonOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  canvasViewport: CanvasViewport;
  canvasRibbonRibbons: VscodeCanvasRibbon[];
  viewportSize: ViewportSize;
  ribbonCommandContext: VscodeCanvasRibbonCommandContext;
  onCommand?: (item: CommandRibbonPresentationCommandItem) => void;
  onPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  presentation?: CanvasPresentation;
};

type PointerClientPosition = {
  clientX: number;
  clientY: number;
};

const commandItemPresentationFor = (
  item: VscodeCanvasRibbonCommandItem,
  ribbonCommandContext: VscodeCanvasRibbonCommandContext,
  presentation?: CanvasPresentation
): CommandRibbonPresentationCommandItem => {
  const definition = vscodeCanvasRibbonCommandFor(item.commandId);
  return {
    id: item.id,
    type: "command",
    commandId: item.commandId,
    icon: item.icon || definition?.icon || "circle",
    label: presentation?.text(
      `canvas.ribbon.command.${item.commandId}.label`,
      definition?.label ?? item.commandId
    ) ?? definition?.label ?? item.commandId,
    description: presentation?.text(
      `canvas.ribbon.command.${item.commandId}.description`,
      definition?.description ?? "This command is unavailable."
    ) ?? definition?.description ?? "This command is unavailable.",
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
  ribbonCommandContext: VscodeCanvasRibbonCommandContext,
  presentation?: CanvasPresentation
): CommandRibbonPresentation[] => ribbons.map((ribbon) => ({
  id: ribbon.id,
  label: ribbon.label === "Canvas Ribbon"
    ? presentation?.text("canvas.ribbon.title", ribbon.label) ?? ribbon.label
    : ribbon.label,
  x: ribbon.x,
  y: ribbon.y,
  orientation: ribbon.orientation,
  iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
  verticalHandlePlacement: ribbon.orientation === "vertical" ? "side" : undefined,
    items: ribbon.items.map((item) => item.type === "value"
      ? vscodeCanvasStatusPresentationFor(
          item.id,
          canvasViewport,
          pointerWorldPoint,
          presentation?.text("canvas.status.label", "Canvas status"),
          presentation?.text("canvas.status.description", "Current Canvas zoom and pointer position."),
          presentation?.statusFields
        )
      : commandItemPresentationFor(item, ribbonCommandContext, presentation))
}));

const pointerWorldPointFor = (
  pointerPosition: PointerClientPosition,
  viewportElement: HTMLDivElement,
  viewportSize: ViewportSize,
  canvasViewport: CanvasViewport
): VscodeCanvasWorldPoint => {
  const rect = viewportElement.getBoundingClientRect();
  return screenToWorld(
    { x: pointerPosition.clientX - rect.left, y: pointerPosition.clientY - rect.top },
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
  onPositionCommit,
  presentation
}: VSCodeCanvasRibbonOverlayProps) => {
  const [pointerPosition, setPointerPosition] = useState<PointerClientPosition | null>(null);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<VscodeCanvasWorldPoint | null>(null);
  const ribbonPresentations = useMemo(
    () => vscodeCanvasRibbonPresentationsFor(
      canvasRibbonRibbons,
      canvasViewport,
      pointerWorldPoint,
      ribbonCommandContext,
      presentation
    ),
    [canvasRibbonRibbons, canvasViewport, pointerWorldPoint, ribbonCommandContext, presentation]
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
      const nextPointerPosition = { clientX: event.clientX, clientY: event.clientY };
      setPointerPosition(nextPointerPosition);
      setPointerWorldPoint(pointerWorldPointFor(
        nextPointerPosition,
        viewportElement,
        viewportSize,
        canvasViewport
      ));
    };
    const handlePointerLeave = () => {
      setPointerPosition(null);
      setPointerWorldPoint(null);
    };
    viewportElement.addEventListener("pointermove", handlePointerMove);
    viewportElement.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      viewportElement.removeEventListener("pointermove", handlePointerMove);
      viewportElement.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [canvasFocusRef, canvasViewport, tracksPointer, viewportSize]);

  useEffect(() => {
    if (!pointerPosition) return;
    const viewportElement = canvasFocusRef.current;
    if (!viewportElement) return;
    setPointerWorldPoint(pointerWorldPointFor(
      pointerPosition,
      viewportElement,
      viewportSize,
      canvasViewport
    ));
  }, [canvasFocusRef, canvasViewport, pointerPosition, viewportSize]);

  return (
    <CommandRibbonFloatingOverlay
      ribbons={ribbonPresentations}
      viewportSize={viewportSize}
      iconResolver={resolveVscodeLucideIcon}
      viewportAwareTooltips
      contextMenuData={vscodeCanvasRibbonContextData}
      handlePresentation={(ribbon) => ({
        ariaLabel: presentation?.text("canvas.ribbon.move", "{label}を移動", { label: ribbon.label })
          ?? `${ribbon.label}を移動`,
        title: presentation?.text("canvas.ribbon.drag", "ドラッグで移動") ?? "ドラッグで移動"
      })}
      onCommand={onCommand}
      onPositionCommit={onPositionCommit}
    />
  );
};
