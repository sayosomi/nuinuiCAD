import type {
  CadElement,
  EvaluationResult,
  ElementId,
  NumericValue,
  PaperSizeId,
  PrintLayout,
  PrintLayoutPlacement,
  VisibilityProfile
} from "../types/geometry";
import { evaluateNumericValue, isNumericExpression, makeNumericExpression } from "../geometry/numericExpressions";
import {
  materializePrintLayoutNumericBinding,
  printLayoutCompiledNumericBinding,
  printLayoutPlacementStatementKey,
  printLayoutStatementKey,
  type PrintLayoutNumericBindingLookup
} from "./printLayoutNumericBindingRuntime";

export type { PrintLayoutNumericBindingLookup } from "./printLayoutNumericBindingRuntime";

export type PaperSize = {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
};

export type ResolvedPrintLayoutPlacement = Omit<PrintLayoutPlacement, "x" | "y" | "angleDeg"> & {
  x: number;
  y: number;
  angleDeg: number;
};

export type ResolvedPrintLayout = Omit<
  PrintLayout,
  | "columns"
  | "rows"
  | "overlapMm"
  | "scale"
  | "svgCanvasWidthMm"
  | "svgCanvasHeightMm"
  | "placements"
> & {
  columns: number;
  rows: number;
  overlapMm: number;
  scale: number;
  svgCanvasWidthMm: number;
  svgCanvasHeightMm: number;
  placements: ResolvedPrintLayoutPlacement[];
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
  id: "print-layout-1",
  name: "",
  outputKind: "pdf",
  visibilityProfileId: undefined,
  paperSizeId: "a4",
  orientation: "portrait",
  columns: 2,
  rows: 2,
  overlapMm: 10,
  scale: 1,
  svgCanvasWidthMm: 410,
  svgCanvasHeightMm: 584,
  placements: []
};

/** Resolves the active layout, falling back to the first current layout. */
export const activePrintLayout = (
  printLayouts: readonly PrintLayout[],
  activePrintLayoutId: string
): PrintLayout =>
  printLayouts.find((layout) => layout.id === activePrintLayoutId) ??
  printLayouts[0] ??
  DEFAULT_PRINT_LAYOUT;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNumericValue = (value: unknown): value is NumericValue => {
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "expression" &&
    "expression" in value &&
    typeof value.expression === "string"
  );
};

const normalizeNumericValue = (value: unknown, fallback: NumericValue): NumericValue => {
  if (isNumericValue(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) return makeNumericExpression(value);
  return fallback;
};

const normalizePlacement = (
  value: unknown,
  groupIds: Set<ElementId>,
  preserveDanglingReferences: boolean
): PrintLayoutPlacement | null => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.groupId !== "string") {
    return null;
  }
  if (!preserveDanglingReferences && !groupIds.has(value.groupId)) return null;
  return {
    id: value.id,
    groupId: value.groupId,
    x: normalizeNumericValue(value.x, 0),
    y: normalizeNumericValue(value.y, 0),
    angleDeg: normalizeNumericValue(value.angleDeg, 0),
    mirrorX: value.mirrorX === true
  };
};

export const nextPrintLayoutId = (layouts: Pick<PrintLayout, "id">[]) => {
  let index = layouts.length + 1;
  const existingIds = new Set(layouts.map((layout) => layout.id));
  while (existingIds.has(`print-layout-${index}`)) {
    index += 1;
  }
  return `print-layout-${index}`;
};

export const createDefaultPrintLayout = (
  layouts: Pick<PrintLayout, "id">[] = []
): PrintLayout => ({
  ...DEFAULT_PRINT_LAYOUT,
  id: nextPrintLayoutId(layouts),
  name: ""
});

export const normalizePrintLayout = (
  value: unknown,
  elements: CadElement[],
  visibilityProfiles: VisibilityProfile[] = [],
  options: { preserveDanglingReferences?: boolean } = {}
): PrintLayout => {
  const groupIds = new Set(
    elements.filter((element) => element.type === "group").map((element) => element.id)
  );
  if (!isRecord(value)) return createDefaultPrintLayout();

  const id = typeof value.id === "string" && value.id.trim().length > 0
    ? value.id
    : DEFAULT_PRINT_LAYOUT.id;
  const name = typeof value.name === "string" ? value.name : "";
  const outputKind = value.outputKind === "svg" ? "svg" : "pdf";
  const visibilityProfileId =
    typeof value.visibilityProfileId === "string" &&
    (options.preserveDanglingReferences ||
      visibilityProfiles.some((profile) => profile.id === value.visibilityProfileId))
      ? value.visibilityProfileId
      : undefined;
  const paperSizeId = PAPER_SIZES.some((paperSize) => paperSize.id === value.paperSizeId)
    ? value.paperSizeId as PaperSizeId
    : DEFAULT_PRINT_LAYOUT.paperSizeId;
  const orientation = value.orientation === "landscape" ? "landscape" : "portrait";
  const placements = Array.isArray(value.placements)
    ? value.placements
        .map((placement) =>
          normalizePlacement(placement, groupIds, options.preserveDanglingReferences === true)
        )
        .filter((placement): placement is PrintLayoutPlacement => Boolean(placement))
    : [];

  return {
    id,
    name,
    outputKind,
    visibilityProfileId,
    paperSizeId,
    orientation,
    columns: normalizeNumericValue(value.columns, DEFAULT_PRINT_LAYOUT.columns),
    rows: normalizeNumericValue(value.rows, DEFAULT_PRINT_LAYOUT.rows),
    overlapMm: normalizeNumericValue(value.overlapMm, DEFAULT_PRINT_LAYOUT.overlapMm),
    scale: normalizeNumericValue(value.scale, DEFAULT_PRINT_LAYOUT.scale),
    svgCanvasWidthMm: normalizeNumericValue(value.svgCanvasWidthMm, DEFAULT_PRINT_LAYOUT.svgCanvasWidthMm),
    svgCanvasHeightMm: normalizeNumericValue(value.svgCanvasHeightMm, DEFAULT_PRINT_LAYOUT.svgCanvasHeightMm),
    placements
  };
};

const uniquePrintLayoutName = (baseName: string, layouts: PrintLayout[]) => {
  const existingNames = new Set(layouts.map((layout) => layout.name.trim()).filter(Boolean));
  const trimmedBase = baseName.trim();
  if (!trimmedBase || !existingNames.has(trimmedBase)) return baseName;
  let index = 2;
  while (existingNames.has(`${trimmedBase} ${index}`)) {
    index += 1;
  }
  return `${trimmedBase} ${index}`;
};

export const normalizePrintLayouts = ({
  printLayouts,
  elements,
  visibilityProfiles = [],
  preserveDanglingReferences = false
}: {
  printLayouts: unknown;
  elements: CadElement[];
  visibilityProfiles?: VisibilityProfile[];
  preserveDanglingReferences?: boolean;
}) => {
  const source = Array.isArray(printLayouts) && printLayouts.length > 0 ? printLayouts : [];
  const normalized: PrintLayout[] = [];
  const usedIds = new Set<string>();

  for (const item of source) {
    const layout = normalizePrintLayout(item, elements, visibilityProfiles, {
      preserveDanglingReferences
    });
    const id = layout.id.trim().length > 0 && !usedIds.has(layout.id)
      ? layout.id
      : nextPrintLayoutId(normalized);
    usedIds.add(id);
    normalized.push({
      ...layout,
      id,
      name: uniquePrintLayoutName(layout.name, normalized)
    });
  }

  return normalized.length > 0 ? normalized : [createDefaultPrintLayout()];
};

const clampInteger = (value: number, fallback: number, max: number) =>
  Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : fallback), 1), max);

const clampMin = (value: number, fallback: number, min: number) =>
  Math.max(Number.isFinite(value) ? value : fallback, min);

const resolveNumericValue = ({
  value,
  fallback,
  elements,
  evaluation,
  statementKey,
  parameterKey,
  numericBindingLookup
}: {
  value: NumericValue;
  fallback: number;
  elements: CadElement[];
  evaluation: EvaluationResult;
  /** `printLayout:<id>` / `place:<id>:<placementIndex>` - identifies the
   * compiled site for typed `@name` materialization. Absent for fields with
   * no compiled-site concept (none today; kept optional for callers that
   * don't have a lookup at all). */
  statementKey?: string;
  parameterKey?: string | readonly string[];
  numericBindingLookup?: PrintLayoutNumericBindingLookup;
}) => {
  if (!isNumericExpression(value)) return value;
  const binding = statementKey && parameterKey
    ? (Array.isArray(parameterKey)
      ? parameterKey.map((key) => printLayoutCompiledNumericBinding(numericBindingLookup, statementKey, key)).find(Boolean)
      : printLayoutCompiledNumericBinding(numericBindingLookup, statementKey, parameterKey as string))
    : undefined;
  const materialized = binding && binding.expression === value.expression
    ? materializePrintLayoutNumericBinding(binding, evaluation.computedScalarBindings)
    : null;
  const effectiveValue: NumericValue = materialized !== null ? { kind: "expression", expression: materialized } : value;
  const result = evaluateNumericValue({
    value: effectiveValue,
    computedGeometry: evaluation.computedGeometry,
    elementsById: new Map(elements.map((element) => [element.id, element])),
    elements
  });
  return result.value ?? fallback;
};

export const resolvePrintLayout = ({
  layout,
  elements,
  evaluation,
  numericBindingLookup
}: {
  layout: PrintLayout;
  elements: CadElement[];
  evaluation: EvaluationResult;
  numericBindingLookup?: PrintLayoutNumericBindingLookup;
}): ResolvedPrintLayout => {
  const statementKey = printLayoutStatementKey(layout.id);
  const columns = clampInteger(
    resolveNumericValue({ value: layout.columns, fallback: DEFAULT_PRINT_LAYOUT.columns as number, elements, evaluation, statementKey, parameterKey: "columns", numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.columns as number,
    20
  );
  const rows = clampInteger(
    resolveNumericValue({ value: layout.rows, fallback: DEFAULT_PRINT_LAYOUT.rows as number, elements, evaluation, statementKey, parameterKey: "rows", numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.rows as number,
    20
  );
  const overlapMm = clampMin(
    resolveNumericValue({ value: layout.overlapMm, fallback: DEFAULT_PRINT_LAYOUT.overlapMm as number, elements, evaluation, statementKey, parameterKey: "overlap", numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.overlapMm as number,
    0
  );
  const scale = clampMin(
    resolveNumericValue({ value: layout.scale, fallback: DEFAULT_PRINT_LAYOUT.scale as number, elements, evaluation, statementKey, parameterKey: "scale", numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.scale as number,
    0.01
  );
  const svgCanvasWidthMm = clampMin(
    resolveNumericValue({ value: layout.svgCanvasWidthMm, fallback: DEFAULT_PRINT_LAYOUT.svgCanvasWidthMm as number, elements, evaluation, statementKey, parameterKey: ["width", "canvas:x"], numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.svgCanvasWidthMm as number,
    1
  );
  const svgCanvasHeightMm = clampMin(
    resolveNumericValue({ value: layout.svgCanvasHeightMm, fallback: DEFAULT_PRINT_LAYOUT.svgCanvasHeightMm as number, elements, evaluation, statementKey, parameterKey: ["height", "canvas:y"], numericBindingLookup }),
    DEFAULT_PRINT_LAYOUT.svgCanvasHeightMm as number,
    1
  );

  return {
    id: layout.id,
    name: layout.name,
    outputKind: layout.outputKind,
    paperSizeId: layout.paperSizeId,
    orientation: layout.orientation,
    columns,
    rows,
    overlapMm,
    scale,
    svgCanvasWidthMm,
    svgCanvasHeightMm,
    placements: layout.placements.map((placement, placementIndex) => {
      const placementStatementKey = printLayoutPlacementStatementKey(layout.id, placementIndex);
      return {
        ...placement,
        x: resolveNumericValue({ value: placement.x, fallback: 0, elements, evaluation, statementKey: placementStatementKey, parameterKey: ["x", "at:x"], numericBindingLookup }),
        y: resolveNumericValue({ value: placement.y, fallback: 0, elements, evaluation, statementKey: placementStatementKey, parameterKey: ["y", "at:y"], numericBindingLookup }),
        angleDeg: resolveNumericValue({ value: placement.angleDeg, fallback: 0, elements, evaluation, statementKey: placementStatementKey, parameterKey: "angle", numericBindingLookup })
      };
    })
  };
};

export const printCanvasSizeMm = (
  layout: Pick<ResolvedPrintLayout, "paperSizeId" | "orientation" | "columns" | "rows" | "overlapMm">
) => {
  const paper = orientedPaperSize(layout);
  const stepX = Math.max(paper.widthMm - layout.overlapMm, 1);
  const stepY = Math.max(paper.heightMm - layout.overlapMm, 1);
  return {
    widthMm: paper.widthMm + (layout.columns - 1) * stepX,
    heightMm: paper.heightMm + (layout.rows - 1) * stepY
  };
};
