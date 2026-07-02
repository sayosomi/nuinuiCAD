import { useMemo, useState } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import { Copy, FileText, Plus, Trash2 } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { formatNumber } from "./geometryDisplay";
import { defaultPlacementForGroup, printableGroups, printablePathsForLayout } from "../print/printGeometry";
import {
  PAPER_SIZES,
  orientedPaperSize,
  printCanvasSizeMm
} from "../print/printLayout";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId, EvaluationResult, PrintLayoutPlacement } from "../types/geometry";
import { numericDragStepsForDelta } from "./numericDrag";

type PrintLayoutCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

const SVG_PADDING = 32;

type PrintNumberDragState = {
  pointerId: number;
  previousClientX: number;
  remainderX: number;
};

const printNumberValue = (value: number, min: number | undefined) =>
  min === undefined ? value : Math.max(value, min);

const PrintNumberInput = ({
  label,
  value,
  step,
  min,
  onChange
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  onChange: (value: number) => void;
}) => {
  const [drag, setDrag] = useState<PrintNumberDragState | null>(null);
  const commitValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    onChange(Number(printNumberValue(nextValue, min).toFixed(4)));
  };
  const finishDrag = (event: PointerEvent<HTMLInputElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDrag(null);
  };
  return (
    <label className="print-number-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={formatNumber(value)}
        onChange={(event) => commitValue(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        onPointerDown={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag({
            pointerId: event.pointerId,
            previousClientX: event.clientX,
            remainderX: 0
          });
        }}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          const deltaX = drag.remainderX + event.clientX - drag.previousClientX;
          const { steps, remainderX } = numericDragStepsForDelta(deltaX);
          setDrag({ ...drag, previousClientX: event.clientX, remainderX });
          if (steps === 0) return;
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          commitValue(value + steps * step * multiplier);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={(event) => {
          if (drag?.pointerId === event.pointerId) setDrag(null);
        }}
        onAuxClick={(event: MouseEvent<HTMLInputElement>) => {
          if (event.button === 1) event.preventDefault();
        }}
      />
    </label>
  );
};

const placementName = (
  placement: PrintLayoutPlacement,
  groupNames: Map<ElementId, string>
) => groupNames.get(placement.groupId) ?? placement.groupId;

export const PrintLayoutCanvas = ({ evaluation, canvasFocusRef }: PrintLayoutCanvasProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const layout = useCadDocumentStore((state) => state.printLayout);
  const updatePrintLayout = useCadDocumentStore((state) => state.updatePrintLayout);
  const selectedPrintPlacementId = useCadUiStore((state) => state.selectedPrintPlacementId);
  const setSelectedPrintPlacementId = useCadUiStore((state) => state.setSelectedPrintPlacementId);
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
            setSelectedPrintPlacementId(placement.id);
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
            const isSelected = placement.id === selectedPrintPlacementId;
            return (
              <g
                key={placement.id}
                className={`print-placement-anchor ${isSelected ? "selected" : ""}`}
              >
                <circle cx={center.x} cy={center.y} r={isSelected ? 5.5 : 4} />
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
  const selectedPrintPlacementId = useCadUiStore((state) => state.selectedPrintPlacementId);
  const setSelectedPrintPlacementId = useCadUiStore((state) => state.setSelectedPrintPlacementId);
  const [groupQuery, setGroupQuery] = useState("");
  const groups = printableGroups(elements);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const selectedPlacement =
    layout.placements.find((placement) => placement.id === selectedPrintPlacementId) ??
    layout.placements[0] ??
    null;
  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(groupQuery.trim().toLowerCase())
  );
  const placementCountByGroupId = new Map<ElementId, number>();
  for (const placement of layout.placements) {
    placementCountByGroupId.set(
      placement.groupId,
      (placementCountByGroupId.get(placement.groupId) ?? 0) + 1
    );
  }
  const addPlacement = (groupId: ElementId) => {
    const placement = defaultPlacementForGroup(groupId, layout);
    updatePrintLayout({
      placements: [...layout.placements, placement]
    });
    setSelectedPrintPlacementId(placement.id);
  };
  const updatePlacement = (placementId: string, patch: Partial<PrintLayoutPlacement>) => {
    updatePrintLayout({
      placements: layout.placements.map((placement) =>
        placement.id === placementId ? { ...placement, ...patch } : placement
      )
    });
  };
  const deletePlacement = (placementId: string) => {
    const nextPlacements = layout.placements.filter((placement) => placement.id !== placementId);
    updatePrintLayout({
      placements: nextPlacements
    });
    if (selectedPrintPlacementId === placementId) {
      setSelectedPrintPlacementId(nextPlacements[0]?.id ?? null);
    }
  };
  const duplicatePlacement = (placement: PrintLayoutPlacement) => {
    let nextIndex = layout.placements.length + 1;
    const existingIds = new Set(layout.placements.map((item) => item.id));
    while (existingIds.has(`placement-${nextIndex}`)) {
      nextIndex += 1;
    }
    const copy = {
      ...placement,
      id: `placement-${nextIndex}`,
      x: placement.x + 20
    };
    updatePrintLayout({
      placements: [...layout.placements, copy]
    });
    setSelectedPrintPlacementId(copy.id);
  };

  return (
    <aside className="right-panel print-settings-panel">
      <section className="panel-section print-settings-hero">
        <div className="section-header print-settings-title">
          <div>
            <h2>印刷設定</h2>
            <p className="section-subtitle">
              {PAPER_SIZES.find((paper) => paper.id === layout.paperSizeId)?.label ?? "用紙"} / {layout.columns}x{layout.rows} / 倍率 {formatNumber(layout.scale)}
            </p>
          </div>
          <div className="print-settings-actions">
            <button type="button" onClick={() => dispatchCommand("closePrintLayout")}>
              CAD編集
            </button>
            <button type="button" onClick={() => dispatchCommand("exportPrintPdf", { evaluation })}>
              <FileText aria-hidden="true" />
              PDF
            </button>
          </div>
        </div>
        <div className="print-settings-grid">
          <label className="print-select-field">
            <span>用紙</span>
            <select
              value={layout.paperSizeId}
              onChange={(event) => updatePrintLayout({ paperSizeId: event.target.value as typeof layout.paperSizeId })}
            >
              {PAPER_SIZES.map((paper) => (
                <option key={paper.id} value={paper.id}>{paper.label}</option>
              ))}
            </select>
          </label>
          <label className="print-select-field">
            <span>向き</span>
            <select
              value={layout.orientation}
              onChange={(event) => updatePrintLayout({ orientation: event.target.value as typeof layout.orientation })}
            >
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
          </label>
          <PrintNumberInput label="横枚数" value={layout.columns} min={1} step={1} onChange={(columns) => updatePrintLayout({ columns })} />
          <PrintNumberInput label="縦枚数" value={layout.rows} min={1} step={1} onChange={(rows) => updatePrintLayout({ rows })} />
          <PrintNumberInput label="重複 mm" value={layout.overlapMm} min={0} step={1} onChange={(overlapMm) => updatePrintLayout({ overlapMm })} />
          <PrintNumberInput label="拡大率" value={layout.scale} min={0.01} step={0.1} onChange={(scale) => updatePrintLayout({ scale })} />
        </div>
      </section>

      <section className="panel-section">
        <div className="section-header">
          <div>
            <h2>印刷グループ</h2>
            <p className="section-subtitle">{groups.length}件 / 追加するグループを検索</p>
          </div>
        </div>
        <input
          className="print-search-input"
          type="search"
          value={groupQuery}
          placeholder="グループ名で検索"
          aria-label="印刷グループを検索"
          onChange={(event) => setGroupQuery(event.currentTarget.value)}
        />
        {groups.length === 0 ? (
          <p className="empty-state">印刷するグループがありません。</p>
        ) : (
          <div className="print-group-list">
            {filteredGroups.map((group) => (
              <button key={group.id} type="button" onClick={() => addPlacement(group.id)}>
                <span>{group.name}</span>
                <small>{placementCountByGroupId.get(group.id) ?? 0}</small>
                <Plus aria-hidden="true" />
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
              <div
                role="button"
                tabIndex={0}
                className={`print-placement-row ${placement.id === selectedPlacement?.id ? "selected" : ""}`}
                key={placement.id}
                onClick={() => setSelectedPrintPlacementId(placement.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedPrintPlacementId(placement.id);
                }}
              >
                <span className="print-placement-index">{index + 1}</span>
                <span className="print-placement-main">
                  <strong>{groupsById.get(placement.groupId)?.name ?? placement.groupId}</strong>
                  <small>
                    x {formatNumber(placement.x)} / y {formatNumber(placement.y)} / {formatNumber(placement.angleDeg)}°
                    {placement.mirrorX ? " / 反転" : ""}
                  </small>
                </span>
                <span className="print-placement-row-actions">
                  <button
                    type="button"
                    aria-label="配置を複製"
                    onClick={(event) => {
                      event.stopPropagation();
                      duplicatePlacement(placement);
                    }}
                  >
                    <Copy aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="配置を削除"
                    onClick={(event) => {
                      event.stopPropagation();
                      deletePlacement(placement.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel-section print-placement-detail">
        <div className="section-header">
          <div>
            <h2>選択配置</h2>
            <p className="section-subtitle">
              {selectedPlacement ? groupsById.get(selectedPlacement.groupId)?.name ?? selectedPlacement.groupId : "未選択"}
            </p>
          </div>
        </div>
        {!selectedPlacement ? (
          <p className="empty-state">配置を選択してください。</p>
        ) : (
          <>
            <label className="print-select-field">
              <span>グループ</span>
              <select
                value={selectedPlacement.groupId}
                onChange={(event) => updatePlacement(selectedPlacement.id, { groupId: event.target.value })}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <div className="print-settings-grid">
              <PrintNumberInput label="x mm" value={selectedPlacement.x} step={1} onChange={(x) => updatePlacement(selectedPlacement.id, { x })} />
              <PrintNumberInput label="y mm" value={selectedPlacement.y} step={1} onChange={(y) => updatePlacement(selectedPlacement.id, { y })} />
              <PrintNumberInput label="角度" value={selectedPlacement.angleDeg} step={1} onChange={(angleDeg) => updatePlacement(selectedPlacement.id, { angleDeg })} />
              <label className="print-toggle-field">
                <span>左右反転</span>
                <input
                  type="checkbox"
                  checked={selectedPlacement.mirrorX}
                  onChange={(event) => updatePlacement(selectedPlacement.id, { mirrorX: event.target.checked })}
                />
              </label>
            </div>
          </>
        )}
      </section>
    </aside>
  );
};
