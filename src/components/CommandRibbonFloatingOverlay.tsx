import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewportSize } from "./canvasViewport";
import type { RibbonPosition, RibbonRenderedSize } from "./commandRibbonFloatingGeometry";
import { clampRibbonPosition, defaultRibbonX, estimatedRibbonSize } from "./commandRibbonFloatingGeometry";
import {
  CommandRibbonView,
  type CommandRibbonPresentation,
  type CommandRibbonPresentationCommandItem
} from "./CommandRibbonView";

type RibbonDrag = {
  pointerId: number;
  ribbonId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

export type CommandRibbonFloatingOverlayProps = {
  ribbons: CommandRibbonPresentation[];
  viewportSize: ViewportSize;
  iconResolver: (iconName: string) => import("lucide-react").LucideIcon;
  onCommand?: (item: CommandRibbonPresentationCommandItem) => void;
  onPositionChange?: (ribbonId: string, position: RibbonPosition) => void;
  onPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  onDropToDock?: (ribbonId: string, position: RibbonPosition) => void;
  dockRef?: RefObject<HTMLDivElement | null>;
};

const isClientPointInRect = (clientX: number, clientY: number, rect: DOMRect | null) =>
  Boolean(
    rect &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
  );

export const CommandRibbonFloatingOverlay = ({
  ribbons,
  viewportSize,
  iconResolver,
  onCommand,
  onPositionChange,
  onPositionCommit,
  onDropToDock,
  dockRef
}: CommandRibbonFloatingOverlayProps) => {
  const [positions, setPositions] = useState<Record<string, RibbonPosition>>({});
  const [renderedSizes, setRenderedSizes] = useState<Record<string, RibbonRenderedSize>>({});
  const dragRef = useRef<RibbonDrag | null>(null);
  const ribbonNodesRef = useRef(new Map<string, HTMLDivElement>());
  const configuredCoordinatesRef = useRef<Record<string, { x: number | null; y: number }>>({});
  const [draggingRibbonId, setDraggingRibbonId] = useState<string | null>(null);

  const ribbonConfigurationKey = useMemo(() => JSON.stringify(ribbons), [ribbons]);

  const sizeFor = (ribbon: CommandRibbonPresentation): RibbonRenderedSize =>
    renderedSizes[ribbon.id] ?? estimatedRibbonSize(ribbon);

  const clampFor = (ribbon: CommandRibbonPresentation, position: RibbonPosition): RibbonPosition =>
    clampRibbonPosition(position.x, position.y, viewportSize, sizeFor(ribbon));

  const positionFor = (ribbon: CommandRibbonPresentation): RibbonPosition => {
    const configured = positions[ribbon.id] ?? {
      x: ribbon.x ?? defaultRibbonX(viewportSize, ribbon, sizeFor(ribbon)),
      y: ribbon.y
    };
    return clampFor(ribbon, configured);
  };

  useEffect(() => {
    if (dragRef.current) return;
    setPositions((current) => {
      const next: Record<string, RibbonPosition> = {};
      let changed = Object.keys(current).length !== ribbons.length;
      for (const ribbon of ribbons) {
        const configuredPosition = {
          x: ribbon.x ?? defaultRibbonX(viewportSize, ribbon, sizeFor(ribbon)),
          y: ribbon.y
        };
        const previousConfigured = configuredCoordinatesRef.current[ribbon.id];
        const configuredCoordinatesChanged = previousConfigured === undefined
          || previousConfigured.x !== ribbon.x
          || previousConfigured.y !== ribbon.y;
        const position = clampFor(ribbon, configuredCoordinatesChanged
          ? configuredPosition
          : current[ribbon.id] ?? configuredPosition);
        next[ribbon.id] = position;
        if (current[ribbon.id]?.x !== position.x || current[ribbon.id]?.y !== position.y) changed = true;
        configuredCoordinatesRef.current[ribbon.id] = { x: ribbon.x, y: ribbon.y };
      }
      for (const ribbonId of Object.keys(configuredCoordinatesRef.current)) {
        if (!ribbons.some((ribbon) => ribbon.id === ribbonId)) delete configuredCoordinatesRef.current[ribbonId];
      }
      return changed ? next : current;
    });
    // The position is intentionally reclamped locally on config/viewport/size changes.
    // This effect never invokes onPositionCommit, so resize alone cannot persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ribbonConfigurationKey, viewportSize.width, viewportSize.height, renderedSizes]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observers: ResizeObserver[] = [];
    for (const ribbon of ribbons) {
      const node = ribbonNodesRef.current.get(ribbon.id);
      if (!node) continue;
      const observer = new ResizeObserver(([entry]) => {
        const width = entry?.contentRect?.width ?? node.getBoundingClientRect().width;
        const height = entry?.contentRect?.height ?? node.getBoundingClientRect().height;
        if (!(Number.isFinite(width) && Number.isFinite(height)) || width <= 0 || height <= 0) return;
        setRenderedSizes((current) => {
          const previous = current[ribbon.id];
          if (previous?.width === width && previous.height === height) return current;
          return { ...current, [ribbon.id]: { width, height } };
        });
      });
      observer.observe(node);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [ribbonConfigurationKey, ribbons]);

  if (viewportSize.width <= 0 || viewportSize.height <= 0 || ribbons.length === 0) return null;

  const setRibbonNode = (ribbonId: string, node: HTMLDivElement | null) => {
    if (node) {
      ribbonNodesRef.current.set(ribbonId, node);
    } else {
      ribbonNodesRef.current.delete(ribbonId);
    }
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    ribbon: CommandRibbonPresentation
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const position = positionFor(ribbon);
    dragRef.current = {
      pointerId: event.pointerId,
      ribbonId: ribbon.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y
    };
    setDraggingRibbonId(ribbon.id);
  };

  const dragPositionFor = (drag: RibbonDrag, clientX: number, clientY: number): RibbonPosition => {
    const ribbon = ribbons.find((candidate) => candidate.id === drag.ribbonId);
    if (!ribbon) return { x: drag.startX, y: drag.startY };
    return clampFor(ribbon, {
      x: drag.startX + clientX - drag.startClientX,
      y: drag.startY + clientY - drag.startClientY
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const position = dragPositionFor(drag, event.clientX, event.clientY);
    setPositions((current) => ({ ...current, [drag.ribbonId]: position }));
    onPositionChange?.(drag.ribbonId, position);
  };

  const stopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const position = dragPositionFor(drag, event.clientX, event.clientY);
    setPositions((current) => ({ ...current, [drag.ribbonId]: position }));
    const dockRect = dockRef?.current?.getBoundingClientRect() ?? null;
    if (onDropToDock && isClientPointInRect(event.clientX, event.clientY, dockRect)) {
      onDropToDock(drag.ribbonId, position);
    } else {
      onPositionCommit?.(drag.ribbonId, position);
    }
    dragRef.current = null;
    setDraggingRibbonId(null);
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDraggingRibbonId(null);
  };

  return (
    <div className="command-ribbon-layer" aria-label="コマンドリボン">
      {ribbons.map((ribbon) => {
        const position = positionFor(ribbon);
        return (
          <div
            key={ribbon.id}
            ref={(node) => setRibbonNode(ribbon.id, node)}
            style={{ position: "absolute", left: position.x, top: position.y }}
          >
            <CommandRibbonView
              ribbon={ribbon}
              iconResolver={iconResolver}
              onCommand={onCommand}
              dragging={draggingRibbonId === ribbon.id}
              onHandlePointerDown={startDrag}
              onHandlePointerMove={moveDrag}
              onHandlePointerUp={stopDrag}
              onHandlePointerCancel={cancelDrag}
            />
          </div>
        );
      })}
    </div>
  );
};
