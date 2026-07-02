import type {
  CadElement,
  ElementId,
  PaperSizeId,
  PrintLayout,
  PrintLayoutPlacement
} from "../types/geometry";

export type PaperSize = {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
};

export const PAPER_SIZES: PaperSize[] = [
  { id: "a4", label: "A4", widthMm: 210, heightMm: 297 },
  { id: "a3", label: "A3", widthMm: 297, heightMm: 420 },
  { id: "b5", label: "B5", widthMm: 182, heightMm: 257 },
  { id: "b4", label: "B4", widthMm: 257, heightMm: 364 },
  { id: "letter", label: "Letter", widthMm: 215.9, heightMm: 279.4 },
  { id: "legal", label: "Legal", widthMm: 215.9, heightMm: 355.6 }
];

export const paperSizeById = (id: PaperSizeId) =>
  PAPER_SIZES.find((paperSize) => paperSize.id === id) ?? PAPER_SIZES[0];

export const orientedPaperSize = ({
  paperSizeId,
  orientation
}: Pick<PrintLayout, "paperSizeId" | "orientation">) => {
  const size = paperSizeById(paperSizeId);
  return orientation === "landscape"
    ? { widthMm: size.heightMm, heightMm: size.widthMm }
    : { widthMm: size.widthMm, heightMm: size.heightMm };
};

export const DEFAULT_PRINT_LAYOUT: PrintLayout = {
  paperSizeId: "a4",
  orientation: "portrait",
  columns: 2,
  rows: 2,
  overlapMm: 10,
  scale: 1,
  placements: []
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positiveInteger = (value: unknown, fallback: number, max: number) => {
  const number = finiteNumber(value, fallback);
  return Math.min(Math.max(Math.trunc(number), 1), max);
};

const normalizePlacement = (
  value: unknown,
  groupIds: Set<ElementId>
): PrintLayoutPlacement | null => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.groupId !== "string") {
    return null;
  }
  if (!groupIds.has(value.groupId)) return null;
  return {
    id: value.id,
    groupId: value.groupId,
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    angleDeg: finiteNumber(value.angleDeg, 0),
    mirrorX: value.mirrorX === true
  };
};

export const normalizePrintLayout = (
  value: unknown,
  elements: CadElement[]
): PrintLayout => {
  const groupIds = new Set(
    elements.filter((element) => element.type === "group").map((element) => element.id)
  );
  if (!isRecord(value)) return DEFAULT_PRINT_LAYOUT;

  const paperSizeId = PAPER_SIZES.some((paperSize) => paperSize.id === value.paperSizeId)
    ? value.paperSizeId as PaperSizeId
    : DEFAULT_PRINT_LAYOUT.paperSizeId;
  const orientation = value.orientation === "landscape" ? "landscape" : "portrait";
  const placements = Array.isArray(value.placements)
    ? value.placements
        .map((placement) => normalizePlacement(placement, groupIds))
        .filter((placement): placement is PrintLayoutPlacement => Boolean(placement))
    : [];

  return {
    paperSizeId,
    orientation,
    columns: positiveInteger(value.columns, DEFAULT_PRINT_LAYOUT.columns, 20),
    rows: positiveInteger(value.rows, DEFAULT_PRINT_LAYOUT.rows, 20),
    overlapMm: Math.max(finiteNumber(value.overlapMm, DEFAULT_PRINT_LAYOUT.overlapMm), 0),
    scale: Math.max(finiteNumber(value.scale, DEFAULT_PRINT_LAYOUT.scale), 0.01),
    placements
  };
};

export const printCanvasSizeMm = (layout: PrintLayout) => {
  const paper = orientedPaperSize(layout);
  const stepX = Math.max(paper.widthMm - layout.overlapMm, 1);
  const stepY = Math.max(paper.heightMm - layout.overlapMm, 1);
  return {
    widthMm: paper.widthMm + (layout.columns - 1) * stepX,
    heightMm: paper.heightMm + (layout.rows - 1) * stepY
  };
};
