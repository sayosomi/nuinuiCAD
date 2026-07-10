import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import { Minus, X, ZoomIn } from "lucide-react";
import { printableItemsForLayout } from "../print/printGeometry";
import { orientedPaperSize, printCanvasSizeMm, resolvePrintLayout } from "../print/printLayout";
import {
  loadLayoutSettings,
  saveLayoutSettings
} from "../layout/layoutSettingsStorage";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { PrintPreviewWindow as PrintPreviewWindowState } from "../state/cadUiStore";
import type { EvaluationResult, PrintLayout } from "../types/geometry";

type PrintLayoutPreviewWindowProps = {
  evaluation: EvaluationResult;
  workspaceRef: RefObject<HTMLDivElement | null>;
};

const SVG_PADDING = 32;
const WHEEL_ZOOM_BASE = 1.1;
const PRINT_PREVIEW_ZOOM_STEP = 1.15;

const printLayoutCanvasForLayout = ({
  layout,
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId
}: {
  layout: ReturnType<typeof useCadDocumentStore.getState>["printLayout"];
  elements: ReturnType<typeof useCadDocumentStore.getState>["elements"];
  evaluation: EvaluationResult;
  visibilityProfiles: ReturnType<typeof useCadDocumentStore.getState>["visibilityProfiles"];
  activeVisibilityProfileId: string;
}) => {
  const resolvedLayout = resolvePrintLayout({ layout, elements, evaluation });
  const isSvgLayout = resolvedLayout.outputKind === "svg";
  const paper = orientedPaperSize(resolvedLayout);
  const printCanvas = printCanvasSizeMm(resolvedLayout);
  const canvas = isSvgLayout
    ? { widthMm: resolvedLayout.svgCanvasWidthMm, heightMm: resolvedLayout.svgCanvasHeightMm }
    : printCanvas;
  return {
    resolvedLayout,
    isSvgLayout,
    paper,
    printCanvas,
    canvas,
    items: printableItemsForLayout({
      elements,
      evaluation,
      layout,
      visibilityProfiles,
      activeVisibilityProfileId
    })
  };
};

const savePrintPreviewWindowSettings = (printPreviewWindow: PrintPreviewWindowState) => {
  void loadLayoutSettings()
    .then((settings) => saveLayoutSettings({ ...settings, printPreviewWindow }))
    .catch((error: unknown) => {
      console.error("failed to save print preview window settings", error);
    });
};

const clampedPreviewWindow = (
  windowState: PrintPreviewWindowState,
  bounds: { width: number; height: number }
) => {
  const maxX = Math.max(bounds.width - windowState.width - 8, 8);
  const maxY = Math.max(bounds.height - windowState.height - 8, 8);
  return {
    ...windowState,
    x: Math.min(Math.max(windowState.x, 8), maxX),
    y: Math.min(Math.max(windowState.y, 8), maxY)
  };
};

const interactiveTitlebarSelector = "button, select, input, textarea, [contenteditable='true']";

const isInteractiveTitlebarTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest(interactiveTitlebarSelector));

const previewLayoutSelection = ({
  layouts,
  savedLayoutId,
  activeLayoutId
}: {
  layouts: PrintLayout[];
  savedLayoutId: string | null;
  activeLayoutId: string;
}) => {
  if (layouts.length === 0) {
    return { layout: null, resolvedLayoutId: null };
  }
  const savedLayout = savedLayoutId
    ? layouts.find((layout) => layout.id === savedLayoutId) ?? null
    : null;
  const activeLayout = layouts.find((layout) => layout.id === activeLayoutId) ?? null;
  const layout = savedLayout ?? activeLayout ?? layouts[0];
  return { layout, resolvedLayoutId: layout.id };
};

type PrintPreviewDrag =
  | {
      kind: "move";
      pointerId: number;
      startX: number;
      startY: number;
      windowState: PrintPreviewWindowState;
    }
  | {
      kind: "resize";
      pointerId: number;
      startX: number;
      startY: number;
      windowState: PrintPreviewWindowState;
    };

export const PrintLayoutPreviewWindow = ({
  evaluation,
  workspaceRef
}: PrintLayoutPreviewWindowProps) => {
  const elements = useCadDocumentStore(effectiveElements);
  const printLayouts = useCadDocumentStore((state) => state.printLayouts);
  const activePrintLayoutId = useCadDocumentStore((state) => state.activePrintLayoutId);
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const printPreviewWindow = useCadUiStore((state) => state.printPreviewWindow);
  const updatePrintPreviewWindow = useCadUiStore((state) => state.updatePrintPreviewWindow);
  const setShowPrintPreviewWindow = useCadUiStore((state) => state.setShowPrintPreviewWindow);
  const [drag, setDrag] = useState<PrintPreviewDrag | null>(null);
  const { layout: selectedLayout, resolvedLayoutId } = previewLayoutSelection({
    layouts: printLayouts,
    savedLayoutId: printPreviewWindow.layoutId,
    activeLayoutId: activePrintLayoutId
  });
  const layoutName = selectedLayout?.name.trim() || "印刷レイアウト";
  const model = useMemo(
    () =>
      selectedLayout
        ? printLayoutCanvasForLayout({
            layout: selectedLayout,
            elements,
            evaluation,
            visibilityProfiles,
            activeVisibilityProfileId
          })
        : null,
    [activeVisibilityProfileId, elements, evaluation, selectedLayout, visibilityProfiles]
  );
  const pageStepX = model ? Math.max(model.paper.widthMm - model.resolvedLayout.overlapMm, 1) : 1;
  const pageStepY = model ? Math.max(model.paper.heightMm - model.resolvedLayout.overlapMm, 1) : 1;
  const toSvg = (point: { x: number; y: number }) => ({
    x: SVG_PADDING + point.x,
    y: SVG_PADDING + (model?.canvas.heightMm ?? 0) - point.y
  });
  const saveWindow = useCallback((patch: Partial<PrintPreviewWindowState>) => {
    const nextWindow = {
      ...useCadUiStore.getState().printPreviewWindow,
      ...patch
    };
    useCadUiStore.getState().setPrintPreviewWindow(nextWindow);
    savePrintPreviewWindowSettings(useCadUiStore.getState().printPreviewWindow);
  }, []);
  const workspaceBounds = () => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    savePrintPreviewWindowSettings(useCadUiStore.getState().printPreviewWindow);
    setDrag(null);
  };

  useEffect(() => {
    if (printPreviewWindow.layoutId === resolvedLayoutId) return;
    const hadStaleSavedLayout = Boolean(printPreviewWindow.layoutId);
    if (!hadStaleSavedLayout && resolvedLayoutId !== null) return;
    saveWindow({ layoutId: resolvedLayoutId });
  }, [printPreviewWindow.layoutId, resolvedLayoutId, saveWindow]);

  return (
    <section
      className="print-preview-window"
      aria-label="印刷プレビュー"
      style={{
        left: `${printPreviewWindow.x}px`,
        top: `${printPreviewWindow.y}px`,
        width: `${printPreviewWindow.width}px`,
        height: `${printPreviewWindow.height}px`
      }}
    >
      <div
        className="print-preview-titlebar"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (isInteractiveTitlebarTarget(event.target)) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag({
            kind: "move",
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            windowState: printPreviewWindow
          });
        }}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId || drag.kind !== "move") return;
          event.preventDefault();
          updatePrintPreviewWindow(
            clampedPreviewWindow(
              {
                ...drag.windowState,
                x: drag.windowState.x + event.clientX - drag.startX,
                y: drag.windowState.y + event.clientY - drag.startY
              },
              workspaceBounds()
            )
          );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <select
          aria-label="プレビューする印刷レイアウト"
          value={resolvedLayoutId ?? ""}
          disabled={printLayouts.length === 0}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => saveWindow({ layoutId: event.currentTarget.value })}
        >
          {printLayouts.map((layout, index) => (
            <option key={layout.id} value={layout.id}>
              {layout.name.trim() || `レイアウト${index + 1}`}
            </option>
          ))}
        </select>
        <span>{layoutName}</span>
        <div className="print-preview-actions">
          <button
            type="button"
            aria-label="印刷プレビューを縮小"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => saveWindow({ zoom: printPreviewWindow.zoom / PRINT_PREVIEW_ZOOM_STEP })}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="印刷プレビューを拡大"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => saveWindow({ zoom: printPreviewWindow.zoom * PRINT_PREVIEW_ZOOM_STEP })}
          >
            <ZoomIn aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="印刷プレビューを閉じる"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setShowPrintPreviewWindow(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className="print-preview-body"
        onWheel={(event) => {
          event.preventDefault();
          saveWindow({
            zoom: printPreviewWindow.zoom * Math.pow(WHEEL_ZOOM_BASE, -event.deltaY / 100)
          });
        }}
      >
        {model ? (
          <svg
            className="print-preview-svg"
            role="img"
            aria-label={`${layoutName}の印刷プレビュー`}
            viewBox={`0 0 ${model.canvas.widthMm + SVG_PADDING * 2} ${model.canvas.heightMm + SVG_PADDING * 2}`}
            style={{
              width: `${(model.canvas.widthMm + SVG_PADDING * 2) * printPreviewWindow.zoom}px`,
              height: `${(model.canvas.heightMm + SVG_PADDING * 2) * printPreviewWindow.zoom}px`
            }}
          >
            <rect
              x={SVG_PADDING}
              y={SVG_PADDING}
              width={model.canvas.widthMm}
              height={model.canvas.heightMm}
              className="print-canvas-background"
            />
            {!model.isSvgLayout ? Array.from({ length: model.resolvedLayout.rows }).flatMap((_, row) =>
              Array.from({ length: model.resolvedLayout.columns }).map((__, column) => {
                const x = column * pageStepX;
                const y = model.printCanvas.heightMm - model.paper.heightMm - row * pageStepY;
                const topLeft = toSvg({ x, y: y + model.paper.heightMm });
                return (
                  <g key={`${column}-${row}`} className="print-page-tile">
                    <rect
                      x={topLeft.x}
                      y={topLeft.y}
                      width={model.paper.widthMm}
                      height={model.paper.heightMm}
                    />
                    {model.resolvedLayout.overlapMm > 0 ? (
                      <>
                        <line x1={topLeft.x + model.resolvedLayout.overlapMm} y1={topLeft.y} x2={topLeft.x + model.resolvedLayout.overlapMm} y2={topLeft.y + model.paper.heightMm} />
                        <line x1={topLeft.x + model.paper.widthMm - model.resolvedLayout.overlapMm} y1={topLeft.y} x2={topLeft.x + model.paper.widthMm - model.resolvedLayout.overlapMm} y2={topLeft.y + model.paper.heightMm} />
                        <line x1={topLeft.x} y1={topLeft.y + model.resolvedLayout.overlapMm} x2={topLeft.x + model.paper.widthMm} y2={topLeft.y + model.resolvedLayout.overlapMm} />
                        <line x1={topLeft.x} y1={topLeft.y + model.paper.heightMm - model.resolvedLayout.overlapMm} x2={topLeft.x + model.paper.widthMm} y2={topLeft.y + model.paper.heightMm - model.resolvedLayout.overlapMm} />
                      </>
                    ) : null}
                  </g>
                );
              })
            ) : null}
            <g className="print-paths">
              {model.items.paths.map((path, index) => {
                if (path.kind === "line") {
                  const start = toSvg(path.start);
                  const end = toSvg(path.end);
                  return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
                }
                if (path.kind === "bezier") {
                  const start = toSvg(path.start);
                  const c1 = toSvg(path.control1);
                  const c2 = toSvg(path.control2);
                  const end = toSvg(path.end);
                  return <path key={index} d={`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`} />;
                }
                return (
                  <polyline
                    key={index}
                    points={path.points.map((point) => {
                      const svgPoint = toSvg(point);
                      return `${svgPoint.x},${svgPoint.y}`;
                    }).join(" ")}
                  />
                );
              })}
              {model.items.texts.map((text, index) => {
                const anchor = toSvg(text.anchor);
                return (
                  <text
                    key={`text-${index}`}
                    x={anchor.x}
                    y={anchor.y}
                    fontSize={text.fontSize}
                    dominantBaseline="text-before-edge"
                  >
                    {text.text.split(/\r?\n/).map((line, lineIndex) => (
                      <tspan
                        key={lineIndex}
                        x={anchor.x}
                        dy={lineIndex === 0 ? 0 : text.fontSize * 1.2}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                );
              })}
            </g>
          </svg>
        ) : (
          <p className="empty-state">印刷レイアウトはありません。</p>
        )}
      </div>
      <div
        className="print-preview-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="印刷プレビューのサイズを変更"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag({
            kind: "resize",
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            windowState: printPreviewWindow
          });
        }}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId || drag.kind !== "resize") return;
          event.preventDefault();
          updatePrintPreviewWindow(
            clampedPreviewWindow(
              {
                ...drag.windowState,
                width: drag.windowState.width + event.clientX - drag.startX,
                height: drag.windowState.height + event.clientY - drag.startY
              },
              workspaceBounds()
            )
          );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </section>
  );
};
