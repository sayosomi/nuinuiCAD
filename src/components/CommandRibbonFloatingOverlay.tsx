import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewportSize } from "./canvasViewport";
import type { RibbonPosition, RibbonRenderedSize } from "./commandRibbonFloatingGeometry";
import { clampRibbonPosition, defaultRibbonX, estimatedRibbonSize, FLOATING_RIBBON_MARGIN } from "./commandRibbonFloatingGeometry";
import {
  CommandRibbonView,
  type CommandRibbonPresentation,
  type CommandRibbonPresentationActionItem
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
  /** Presentation-only top space reserved by the shared Pick Mode chrome. */
  topInset?: number;
  /** Use a measured, top-left vertical stack for missing positions. */
  defaultStackGap?: number;
  iconResolver: (iconName: string) => import("lucide-react").LucideIcon;
  viewportAwareTooltips?: boolean;
  contextMenuData?: string;
  handlePresentation?: (ribbon: CommandRibbonPresentation) => {
    ariaLabel: string;
    title: string;
  };
  onCommand?: (item: CommandRibbonPresentationActionItem) => void;
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
  topInset = 0,
  defaultStackGap,
  iconResolver,
  viewportAwareTooltips = false,
  contextMenuData,
  handlePresentation,
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const configuredCoordinatesRef = useRef<Record<string, { x: number | null; y: number }>>({});
  const [draggingRibbonId, setDraggingRibbonId] = useState<string | null>(null);

  const ribbonConfigurationKey = useMemo(() => JSON.stringify(ribbons), [ribbons]);

  const sizeFor = useCallback((ribbon: CommandRibbonPresentation): RibbonRenderedSize =>
    renderedSizes[ribbon.id] ?? estimatedRibbonSize(ribbon), [renderedSizes]);

  const clampBaseFor = (ribbon: CommandRibbonPresentation, position: RibbonPosition): RibbonPosition =>
    clampRibbonPosition(position.x, position.y, viewportSize, sizeFor(ribbon));

  const clampDisplayedFor = (ribbon: CommandRibbonPresentation, position: RibbonPosition): RibbonPosition =>
    clampRibbonPosition(position.x, position.y, viewportSize, sizeFor(ribbon), undefined, topInset);

  const defaultStackPositions = useMemo(() => {
    if (defaultStackGap === undefined) return null;
    const requestedStackTop = FLOATING_RIBBON_MARGIN + topInset;
    let nextTop = requestedStackTop;
    return ribbons.map((ribbon) => {
      const position = { x: FLOATING_RIBBON_MARGIN, y: nextTop };
      nextTop += sizeFor(ribbon).height + defaultStackGap;
      return position;
    });
  }, [defaultStackGap, ribbons, sizeFor, topInset]);

  const positionFor = (ribbon: CommandRibbonPresentation, index: number): RibbonPosition => {
    const defaultStackPosition = defaultStackPositions?.[index];
    const usesDefaultStackPosition = defaultStackGap !== undefined &&
      positions[ribbon.id] === undefined && ribbon.x === null && defaultStackPosition !== undefined;
    const persistedPosition = defaultStackGap !== undefined && ribbon.x !== null
      ? { x: ribbon.x, y: ribbon.y }
      : null;
    const localPosition = positions[ribbon.id];
    const activeDragPosition = draggingRibbonId === ribbon.id
      ? localPosition
      : undefined;
    const pendingPersistedPosition = defaultStackGap !== undefined && persistedPosition && localPosition &&
      (localPosition.x !== persistedPosition.x || localPosition.y !== persistedPosition.y)
      ? localPosition
      : undefined;
    const configured = activeDragPosition ?? pendingPersistedPosition ?? persistedPosition ?? localPosition ?? (
      usesDefaultStackPosition && defaultStackPosition
        ? defaultStackPosition
        : { x: ribbon.x ?? defaultRibbonX(viewportSize, ribbon, sizeFor(ribbon)), y: ribbon.y }
    );
    const clamped = clampDisplayedFor(ribbon, configured);
    return usesDefaultStackPosition && defaultStackPosition
      ? { x: clamped.x, y: defaultStackPosition.y }
      : clamped;
  };

  useEffect(() => {
    if (defaultStackGap !== undefined) return;
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
        const position = clampBaseFor(ribbon, configuredCoordinatesChanged
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
    // The underlying position is intentionally reclamped locally on
    // config/viewport/size changes. Pick Mode topInset is applied only by
    // positionFor, so its automatic displacement never replaces this value.
    // This effect never invokes onPositionCommit, so resize alone cannot persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStackGap, ribbonConfigurationKey, viewportSize.width, viewportSize.height, sizeFor]);

  useEffect(() => {
    if (defaultStackGap === undefined) return;
    // Drop the transient entry when the host publishes the committed coordinates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPositions((current) => {
      let changed = false;
      const next = { ...current };
      for (const ribbon of ribbons) {
        if (draggingRibbonId === ribbon.id || ribbon.x === null) continue;
        const position = current[ribbon.id];
        if (!position || position.x !== ribbon.x || position.y !== ribbon.y) continue;
        delete next[ribbon.id];
        changed = true;
      }
      return changed ? next : current;
    });
    // ribbonConfigurationKey tracks the Ribbon props used by this acknowledgement pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStackGap, draggingRibbonId, ribbonConfigurationKey]);

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
    const position = positionFor(ribbon, ribbons.indexOf(ribbon));
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
    return clampDisplayedFor(ribbon, {
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
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPositions((current) => {
      const settledPosition = { x: drag.startX, y: drag.startY };
      if (current[drag.ribbonId]?.x === settledPosition.x && current[drag.ribbonId]?.y === settledPosition.y) {
        return current;
      }
      return { ...current, [drag.ribbonId]: settledPosition };
    });
    dragRef.current = null;
    setDraggingRibbonId(null);
  };

  return (
    <div ref={overlayRef} className="command-ribbon-layer" aria-label="コマンドリボン">
      {ribbons.map((ribbon, index) => {
        const position = positionFor(ribbon, index);
        return (
          <div
            key={ribbon.id}
            ref={(node) => setRibbonNode(ribbon.id, node)}
            style={{ position: "absolute", left: position.x, top: position.y }}
          >
            <CommandRibbonView
              ribbon={ribbon}
              contextMenuData={contextMenuData}
              iconResolver={iconResolver}
              viewportAwareTooltips={viewportAwareTooltips}
              tooltipBoundaryRef={viewportAwareTooltips ? overlayRef : undefined}
              handleAriaLabel={handlePresentation?.(ribbon).ariaLabel}
              handleTitle={handlePresentation?.(ribbon).title}
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
