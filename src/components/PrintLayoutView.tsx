import { useMemo, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { defaultPlacementForGroup, printableGroups, printablePathsForLayout } from "../print/printGeometry";
import {
  PAPER_SIZES,
  orientedPaperSize,
  printCanvasSizeMm
} from "../print/printLayout";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { ElementId, EvaluationResult, PrintLayoutPlacement } from "../types/geometry";

type PrintLayoutCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

const SVG_PADDING = 32;

const placementName = (
  placement: PrintLayoutPlacement,
  groupNames: Map<ElementId, string>
) => groupNames.get(placement.groupId) ?? placement.groupId;

export const PrintLayoutCanvas = ({ evaluation, canvasFocusRef }: PrintLayoutCanvasProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const layout = useCadDocumentStore((state) => state.printLayout);
  const updatePrintLayout = useCadDocumentStore((state) => state.updatePrintLayout);
  const [drag, setDrag] = useState<{
    placementId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const paper = orientedPaperSize(layout);
  const canvas = printCanvasSizeMm(layout);
  const paths = useMemo(
    () => printablePathsForLayout({ elements, evaluation, layout }),
    [elements, evaluation, layout]
  );
  const groupNames = useMemo(
    () => new Map(elements.filter((element) => element.type === "group").map((element) => [element.id, element.name])),
    [elements]
  );
  const viewportWidth = canvas.widthMm + SVG_PADDING * 2;
  const viewportHeight = canvas.heightMm + SVG_PADDING * 2;
  const toSvg = (point: { x: number; y: number }) => ({
    x: SVG_PADDING + point.x,
    y: SVG_PADDING + canvas.heightMm - point.y
  });
  const screenToPrint = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * viewportWidth - SVG_PADDING;
    const y = canvas.heightMm - (((event.clientY - rect.top) / rect.height) * viewportHeight - SVG_PADDING);
    return { x, y };
  };
  const updatePlacement = (placementId: string, patch: Partial<PrintLayoutPlacement>) => {
    updatePrintLayout({
      placements: layout.placements.map((placement) =>
        placement.id === placementId ? { ...placement, ...patch } : placement
      )
    });
  };
  const hitPlacement = (point: { x: number; y: number }) => {
    for (let index = layout.placements.length - 1; index >= 0; index -= 1) {
      const placement = layout.placements[index];
      if (Math.hypot(point.x - placement.x, point.y - placement.y) <= 8) return placement;
    }
    return null;
  };
  const pageStepX = Math.max(paper.widthMm - layout.overlapMm, 1);
  const pageStepY = Math.max(paper.heightMm - layout.overlapMm, 1);

  return (
    <section className="canvas-panel print-layout-panel">
      <div
        className="canvas-viewport print-layout-viewport"
        ref={canvasFocusRef}
        tabIndex={-1}
      >
        <svg
          className="print-layout-svg"
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          role="img"
          aria-label="印刷レイアウト"
          onPointerDown={(event) => {
            const point = screenToPrint(event);
            const placement = hitPlacement(point);
            if (!placement) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              placementId: placement.id,
              pointerId: event.pointerId,
              offsetX: point.x - placement.x,
              offsetY: point.y - placement.y
            });
          }}
          onPointerMove={(event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const point = screenToPrint(event);
            updatePlacement(drag.placementId, {
              x: Number((point.x - drag.offsetX).toFixed(2)),
              y: Number((point.y - drag.offsetY).toFixed(2))
            });
          }}
          onPointerUp={(event) => {
            if (drag?.pointerId === event.pointerId) setDrag(null);
          }}
          onPointerCancel={(event) => {
            if (drag?.pointerId === event.pointerId) setDrag(null);
          }}
        >
          <rect
            x={SVG_PADDING}
            y={SVG_PADDING}
            width={canvas.widthMm}
            height={canvas.heightMm}
            className="print-canvas-background"
          />
          {Array.from({ length: layout.rows }).flatMap((_, row) =>
            Array.from({ length: layout.columns }).map((__, column) => {
              const x = column * pageStepX;
              const y = canvas.heightMm - paper.heightMm - row * pageStepY;
              const topLeft = toSvg({ x, y: y + paper.heightMm });
              return (
                <g key={`${column}-${row}`} className="print-page-tile">
                  <rect
                    x={topLeft.x}
                    y={topLeft.y}
                    width={paper.widthMm}
                    height={paper.heightMm}
                  />
                  {layout.overlapMm > 0 ? (
                    <>
                      <line x1={topLeft.x + layout.overlapMm} y1={topLeft.y} x2={topLeft.x + layout.overlapMm} y2={topLeft.y + paper.heightMm} />
                      <line x1={topLeft.x + paper.widthMm - layout.overlapMm} y1={topLeft.y} x2={topLeft.x + paper.widthMm - layout.overlapMm} y2={topLeft.y + paper.heightMm} />
                      <line x1={topLeft.x} y1={topLeft.y + layout.overlapMm} x2={topLeft.x + paper.widthMm} y2={topLeft.y + layout.overlapMm} />
                      <line x1={topLeft.x} y1={topLeft.y + paper.heightMm - layout.overlapMm} x2={topLeft.x + paper.widthMm} y2={topLeft.y + paper.heightMm - layout.overlapMm} />
                    </>
                  ) : null}
                </g>
              );
            })
          )}
          <g className="print-paths">
            {paths.map((path, index) => {
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
                return (
                  <path
                    key={index}
                    d={`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`}
                  />
                );
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
          </g>
          {layout.placements.map((placement) => {
            const center = toSvg(placement);
            return (
              <g key={placement.id} className="print-placement-anchor">
                <circle cx={center.x} cy={center.y} r={4} />
                <text x={center.x + 6} y={center.y - 6}>
                  {placementName(placement, groupNames)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="canvas-display-controls" aria-label="印刷レイアウト操作">
          <button type="button" onClick={() => dispatchCommand("closePrintLayout")}>
            CAD編集
          </button>
          <button type="button" onClick={() => dispatchCommand("exportPrintPdf", { evaluation })}>
            PDF
          </button>
        </div>
      </div>
    </section>
  );
};

export const PrintLayoutPanel = ({ evaluation }: { evaluation: EvaluationResult }) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const layout = useCadDocumentStore((state) => state.printLayout);
  const updatePrintLayout = useCadDocumentStore((state) => state.updatePrintLayout);
  const groups = printableGroups(elements);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const addPlacement = (groupId: ElementId) => {
    updatePrintLayout({
      placements: [...layout.placements, defaultPlacementForGroup(groupId, layout)]
    });
  };
  const updatePlacement = (placementId: string, patch: Partial<PrintLayoutPlacement>) => {
    updatePrintLayout({
      placements: layout.placements.map((placement) =>
        placement.id === placementId ? { ...placement, ...patch } : placement
      )
    });
  };
  const deletePlacement = (placementId: string) => {
    updatePrintLayout({
      placements: layout.placements.filter((placement) => placement.id !== placementId)
    });
  };
  const duplicatePlacement = (placement: PrintLayoutPlacement) => {
    let nextIndex = layout.placements.length + 1;
    const existingIds = new Set(layout.placements.map((item) => item.id));
    while (existingIds.has(`placement-${nextIndex}`)) {
      nextIndex += 1;
    }
    updatePrintLayout({
      placements: [
        ...layout.placements,
        {
          ...placement,
          id: `placement-${nextIndex}`,
          x: placement.x + 20
        }
      ]
    });
  };

  return (
    <aside className="right-panel print-settings-panel">
      <section className="panel-section">
        <div className="section-header">
          <div>
            <h2>印刷設定</h2>
            <p className="section-subtitle">用紙と全体倍率</p>
          </div>
          <button type="button" onClick={() => dispatchCommand("exportPrintPdf", { evaluation })}>
            PDF
          </button>
        </div>
        <label className="parameter-field">
          <span className="parameter-name">用紙</span>
          <select
            value={layout.paperSizeId}
            onChange={(event) => updatePrintLayout({ paperSizeId: event.target.value as typeof layout.paperSizeId })}
          >
            {PAPER_SIZES.map((paper) => (
              <option key={paper.id} value={paper.id}>{paper.label}</option>
            ))}
          </select>
        </label>
        <label className="parameter-field">
          <span className="parameter-name">向き</span>
          <select
            value={layout.orientation}
            onChange={(event) => updatePrintLayout({ orientation: event.target.value as typeof layout.orientation })}
          >
            <option value="portrait">縦</option>
            <option value="landscape">横</option>
          </select>
        </label>
        {[
          ["columns", "横枚数", 1],
          ["rows", "縦枚数", 1],
          ["overlapMm", "重複 mm", 0],
          ["scale", "拡大率", 0.01]
        ].map(([key, label, min]) => (
          <label className="parameter-field" key={key}>
            <span className="parameter-name">{label}</span>
            <input
              type="number"
              min={min}
              step={key === "scale" ? 0.1 : 1}
              value={layout[key as keyof typeof layout] as number}
              onChange={(event) => updatePrintLayout({ [key]: Number(event.target.value) } as Partial<typeof layout>)}
            />
          </label>
        ))}
      </section>

      <section className="panel-section">
        <div className="section-header">
          <div>
            <h2>印刷グループ</h2>
            <p className="section-subtitle">グループ名で配置を追加</p>
          </div>
        </div>
        {groups.length === 0 ? (
          <p className="empty-state">印刷するグループがありません。</p>
        ) : (
          <div className="print-group-list">
            {groups.map((group) => (
              <button key={group.id} type="button" onClick={() => addPlacement(group.id)}>
                {group.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="section-header">
          <h2>配置</h2>
        </div>
        {layout.placements.length === 0 ? (
          <p className="empty-state">印刷グループを追加してください。</p>
        ) : (
          <div className="print-placement-list">
            {layout.placements.map((placement, index) => (
              <div className="print-placement-card" key={placement.id}>
                <div className="curve-point-header">
                  <span>{index + 1}. {groupsById.get(placement.groupId)?.name ?? placement.groupId}</span>
                  <div>
                    <button type="button" onClick={() => duplicatePlacement(placement)}>複製</button>
                    <button type="button" onClick={() => deletePlacement(placement.id)}>削除</button>
                  </div>
                </div>
                <label className="parameter-field">
                  <span className="parameter-name">グループ</span>
                  <select
                    value={placement.groupId}
                    onChange={(event) => updatePlacement(placement.id, { groupId: event.target.value })}
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                </label>
                {[
                  ["x", "x mm", 1],
                  ["y", "y mm", 1],
                  ["angleDeg", "角度", 1]
                ].map(([key, label, step]) => (
                  <label className="parameter-field" key={key}>
                    <span className="parameter-name">{label}</span>
                    <input
                      type="number"
                      step={step}
                      value={placement[key as keyof PrintLayoutPlacement] as number}
                      onChange={(event) =>
                        updatePlacement(placement.id, { [key]: Number(event.target.value) } as Partial<PrintLayoutPlacement>)
                      }
                    />
                  </label>
                ))}
                <label className="parameter-field checkbox-field">
                  <span className="parameter-name">左右反転</span>
                  <input
                    type="checkbox"
                    checked={placement.mirrorX}
                    onChange={(event) => updatePlacement(placement.id, { mirrorX: event.target.checked })}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
};
