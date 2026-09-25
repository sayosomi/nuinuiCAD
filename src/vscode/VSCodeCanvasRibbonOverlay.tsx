import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import type { CanvasViewport } from "../state/cadUiStore";
import type { ViewportSize } from "../components/canvasViewport";
import { screenToWorld } from "../components/canvasViewport";
import { CommandRibbonFloatingOverlay } from "../components/CommandRibbonFloatingOverlay";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type {
  CommandRibbonPresentation,
  CommandRibbonPresentationActionItem
} from "../components/CommandRibbonView";
import type { CanvasPresentation } from "../components/canvasPresentation";
import { DEFAULT_CANVAS_GRID_SETTINGS } from "../components/canvasGrid";
import {
  VSCODE_CANVAS_RIBBON_GAP,
  VSCODE_CANVAS_RIBBON_ICON_SIZE,
  vscodeCanvasRibbonDefinitions,
  type VscodeCanvasRibbonCommandItem
} from "./vscodeCanvasRibbonConfig";
import type { VscodeCanvasRibbonPositions } from "./vscodeCanvasRibbonConfig";
import {
  vscodeCanvasRibbonCommandFor,
  type VscodeCanvasRibbonCommandContext
} from "./vscodeCanvasRibbonCatalog";
import { resolveVscodeLucideIcon, vscodeLucideIconName } from "./vscodeCanvasRibbonIcons";
import {
  type VscodeCanvasWorldPoint,
  vscodeCanvasStatusPresentationFor
} from "./vscodeCanvasRibbonStatus";

export type VSCodeCanvasRibbonOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  canvasViewport: CanvasViewport;
  canvasRibbonPositions: VscodeCanvasRibbonPositions;
  viewportSize: ViewportSize;
  canvasModeChromeHeight?: number;
  ribbonCommandContext: VscodeCanvasRibbonCommandContext;
  onCommand?: (item: CommandRibbonPresentationActionItem) => void;
  onPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  presentation?: CanvasPresentation;
};

type PointerClientPosition = { clientX: number; clientY: number };

const ribbonItemPresentationFor = (
  item: VscodeCanvasRibbonCommandItem,
  ribbonCommandContext: VscodeCanvasRibbonCommandContext,
  presentation?: CanvasPresentation
): CommandRibbonPresentationActionItem => {
  const definition = vscodeCanvasRibbonCommandFor(item.commandId);
  const productLabels: Partial<Record<VscodeCanvasRibbonCommandItem["commandId"], string>> = {
    toggleCanvasPoints: presentation?.text("canvas.ribbon.points", "Points") ?? "Points",
    toggleCanvasPointNames: presentation?.text("canvas.ribbon.pointNames", "Point Names") ?? "Point Names",
    toggleCanvasGeometryNames: presentation?.text("canvas.ribbon.geometryNames", "Geometry Names") ?? "Geometry Names"
  };
  const label = productLabels[item.commandId] ?? presentation?.text(
    `canvas.ribbon.command.${item.commandId}.label`,
    definition?.label ?? item.commandId
  ) ?? definition?.label ?? item.commandId;
  const description = presentation?.text(
    `canvas.ribbon.command.${item.commandId}.description`,
    definition?.description ?? "This command is unavailable."
  ) ?? definition?.description ?? "This command is unavailable.";
  return {
    id: item.id,
    type: "command",
    commandId: item.commandId,
    icon: item.icon,
    label,
    description,
    showLabel: item.showLabel,
    available: definition?.isAvailable(ribbonCommandContext) ?? false,
    ...(definition?.isPressed ? { pressed: definition.isPressed(ribbonCommandContext) } : {})
  };
};

const gridSettingsPresentationFor = (
  ribbonCommandContext: VscodeCanvasRibbonCommandContext,
  presentation?: CanvasPresentation
): CommandRibbonPresentationActionItem => {
  const definition = vscodeCanvasRibbonCommandFor("configureCanvasGrid");
  const label = presentation?.text(
    "canvas.ribbon.command.configureCanvasGrid.label",
    definition?.label ?? "Grid Settings"
  ) ?? definition?.label ?? "Grid Settings";
  const description = presentation?.text(
    "canvas.ribbon.command.configureCanvasGrid.description",
    definition?.description ?? "Configure Canvas grid visibility, spacing, and major interval."
  ) ?? definition?.description ?? "Configure Canvas grid visibility, spacing, and major interval.";
  const spacingMm = ribbonCommandContext.canvasGridSpacingMm ?? DEFAULT_CANVAS_GRID_SETTINGS.spacingMm;
  const majorEvery = ribbonCommandContext.canvasGridMajorEvery ?? DEFAULT_CANVAS_GRID_SETTINGS.majorEvery;
  return {
    id: "grid-settings",
    type: "interactive-value",
    commandId: "configureCanvasGrid",
    icon: vscodeLucideIconName("ruler"),
    label,
    description,
    valueText: `${spacingMm} mm · ×${majorEvery}`,
    available: definition?.isAvailable(ribbonCommandContext) ?? false
  };
};

const vscodeCanvasRibbonPresentationsFor = (
  positions: VscodeCanvasRibbonPositions,
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null,
  ribbonCommandContext: VscodeCanvasRibbonCommandContext,
  presentation?: CanvasPresentation
): CommandRibbonPresentation[] => vscodeCanvasRibbonDefinitions.map((ribbon) => {
  const position = positions[ribbon.id];
  return {
    id: ribbon.id,
    label: presentation?.text(ribbon.labelKey, ribbon.label) ?? ribbon.label,
    x: position?.x ?? null,
    y: position?.y ?? 0,
    orientation: ribbon.orientation,
    iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
    items: ribbon.items.map((item) => {
      if (item.type === "command") return ribbonItemPresentationFor(item, ribbonCommandContext, presentation);
      if (item.valueId === "canvasGridSettings") return gridSettingsPresentationFor(ribbonCommandContext, presentation);
      return vscodeCanvasStatusPresentationFor(
        item.id,
        canvasViewport,
        pointerWorldPoint,
        presentation?.text("canvas.status.label", "Canvas status"),
        presentation?.text("canvas.status.description", "Current Canvas zoom and pointer position."),
        presentation?.statusFields
      );
    })
  };
});

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
  canvasRibbonPositions,
  viewportSize,
  canvasModeChromeHeight = 0,
  ribbonCommandContext,
  onCommand,
  onPositionCommit,
  presentation
}: VSCodeCanvasRibbonOverlayProps) => {
  const [pointerPosition, setPointerPosition] = useState<PointerClientPosition | null>(null);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<VscodeCanvasWorldPoint | null>(null);
  const ribbonPresentations = useMemo(
    () => vscodeCanvasRibbonPresentationsFor(
      canvasRibbonPositions,
      canvasViewport,
      pointerWorldPoint,
      ribbonCommandContext,
      presentation
    ),
    [canvasRibbonPositions, canvasViewport, pointerWorldPoint, ribbonCommandContext, presentation]
  );

  useEffect(() => {
    const viewportElement = canvasFocusRef.current;
    if (!viewportElement) {
      setPointerWorldPoint(null);
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const nextPointerPosition = { clientX: event.clientX, clientY: event.clientY };
      setPointerPosition(nextPointerPosition);
      setPointerWorldPoint(pointerWorldPointFor(nextPointerPosition, viewportElement, viewportSize, canvasViewport));
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
  }, [canvasFocusRef, canvasViewport, viewportSize]);

  useEffect(() => {
    if (!pointerPosition) return;
    const viewportElement = canvasFocusRef.current;
    if (!viewportElement) return;
    setPointerWorldPoint(pointerWorldPointFor(pointerPosition, viewportElement, viewportSize, canvasViewport));
  }, [canvasFocusRef, canvasViewport, pointerPosition, viewportSize]);

  return (
    <CommandRibbonFloatingOverlay
      ribbons={ribbonPresentations}
      viewportSize={viewportSize}
      topInset={canvasModeChromeHeight}
      defaultStackGap={VSCODE_CANVAS_RIBBON_GAP}
      iconResolver={resolveVscodeLucideIcon}
      viewportAwareTooltips
      handlePresentation={(ribbon) => ({
        ariaLabel: presentation?.text("canvas.ribbon.move", "Move {label}", { label: ribbon.label })
          ?? `Move ${ribbon.label}`,
        title: presentation?.text("canvas.ribbon.drag", "Drag to move") ?? "Drag to move"
      })}
      onCommand={onCommand}
      onPositionCommit={onPositionCommit}
    />
  );
};
