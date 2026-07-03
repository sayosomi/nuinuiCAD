import type {
  CadElement,
  EvaluationResult,
  ElementId,
  NumericVariable,
  NumericValue,
  PaperSizeId,
  PrintLayout,
  PrintLayoutPlacement
} from "../types/geometry";
import { evaluateNumericValue, isNumericExpression, makeNumericExpression } from "../geometry/numericExpressions";

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
  "columns" | "rows" | "overlapMm" | "scale" | "numericVariables" | "placements"
> & {
  columns: number;
  rows: number;
  overlapMm: number;
  scale: number;
  numericVariables: Array<Omit<NumericVariable, "value"> & { value: number }>;
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
  paperSizeId: "a4",
  orientation: "portrait",
  columns: 2,
  rows: 2,
  overlapMm: 10,
  scale: 1,
  numericVariables: [],
  placements: []
};

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
  groupIds: Set<ElementId>
): PrintLayoutPlacement | null => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.groupId !== "string") {
    return null;
  }
  if (!groupIds.has(value.groupId)) return null;
  return {
    id: value.id,
    groupId: value.groupId,
    x: normalizeNumericValue(value.x, 0),
    y: normalizeNumericValue(value.y, 0),
    angleDeg: normalizeNumericValue(value.angleDeg, 0),
    mirrorX: value.mirrorX === true
  };
};

const normalizeNumericVariable = (value: unknown): NumericVariable | null => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    value: normalizeNumericValue(value.value, 30)
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
  const numericVariables = Array.isArray(value.numericVariables)
    ? value.numericVariables
        .map(normalizeNumericVariable)
        .filter((variable): variable is NumericVariable => Boolean(variable))
    : [];

  return {
    paperSizeId,
    orientation,
    columns: normalizeNumericValue(value.columns, DEFAULT_PRINT_LAYOUT.columns),
    rows: normalizeNumericValue(value.rows, DEFAULT_PRINT_LAYOUT.rows),
    overlapMm: normalizeNumericValue(value.overlapMm, DEFAULT_PRINT_LAYOUT.overlapMm),
    scale: normalizeNumericValue(value.scale, DEFAULT_PRINT_LAYOUT.scale),
    numericVariables,
    placements
  };
};

const clampInteger = (value: number, fallback: number, max: number) =>
  Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : fallback), 1), max);

const clampMin = (value: number, fallback: number, min: number) =>
  Math.max(Number.isFinite(value) ? value : fallback, min);

const globalVariableValues = (elements: CadElement[], evaluation: EvaluationResult) => {
  const values = new Map<string, number>();
  for (const element of elements) {
    if (element.type !== "variable" || element.scope !== "global") continue;
    const computed = evaluation.computedVariables.get(element.id);
    if (!computed) continue;
    values.set(element.id, computed.value);
    values.set(element.name, computed.value);
  }
  return values;
};

const printVariableValues = ({
  variables,
  elements,
  evaluation
}: {
  variables: NumericVariable[];
  elements: CadElement[];
  evaluation: EvaluationResult;
}) => {
  const values = globalVariableValues(elements, evaluation);
  const resolvedVariables: Array<Omit<NumericVariable, "value"> & { value: number }> = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  for (const variable of variables) {
    const result = evaluateNumericValue({
      value: variable.value,
      computedGeometry: evaluation.computedGeometry,
      elementsById,
      computedVariables: evaluation.computedVariables,
      elements,
      localVariables: values
    });
    if (result.value === undefined) continue;
    resolvedVariables.push({
      id: variable.id,
      name: variable.name,
      value: result.value
    });
    values.set(variable.id, result.value);
    values.set(variable.name, result.value);
  }
  return { values, resolvedVariables };
};

const resolveNumericValue = ({
  value,
  fallback,
  elements,
  evaluation,
  localVariables
}: {
  value: NumericValue;
  fallback: number;
  elements: CadElement[];
  evaluation: EvaluationResult;
  localVariables: Map<string, number>;
}) => {
  if (!isNumericExpression(value)) return value;
  const result = evaluateNumericValue({
    value,
    computedGeometry: evaluation.computedGeometry,
    elementsById: new Map(elements.map((element) => [element.id, element])),
    computedVariables: evaluation.computedVariables,
    elements,
    localVariables
  });
  return result.value ?? fallback;
};

export const resolvePrintLayout = ({
  layout,
  elements,
  evaluation
}: {
  layout: PrintLayout;
  elements: CadElement[];
  evaluation: EvaluationResult;
}): ResolvedPrintLayout => {
  const { values: localVariables, resolvedVariables } = printVariableValues({
    variables: layout.numericVariables ?? [],
    elements,
    evaluation
  });
  const columns = clampInteger(
    resolveNumericValue({ value: layout.columns, fallback: DEFAULT_PRINT_LAYOUT.columns as number, elements, evaluation, localVariables }),
    DEFAULT_PRINT_LAYOUT.columns as number,
    20
  );
  const rows = clampInteger(
    resolveNumericValue({ value: layout.rows, fallback: DEFAULT_PRINT_LAYOUT.rows as number, elements, evaluation, localVariables }),
    DEFAULT_PRINT_LAYOUT.rows as number,
    20
  );
  const overlapMm = clampMin(
    resolveNumericValue({ value: layout.overlapMm, fallback: DEFAULT_PRINT_LAYOUT.overlapMm as number, elements, evaluation, localVariables }),
    DEFAULT_PRINT_LAYOUT.overlapMm as number,
    0
  );
  const scale = clampMin(
    resolveNumericValue({ value: layout.scale, fallback: DEFAULT_PRINT_LAYOUT.scale as number, elements, evaluation, localVariables }),
    DEFAULT_PRINT_LAYOUT.scale as number,
    0.01
  );

  return {
    paperSizeId: layout.paperSizeId,
    orientation: layout.orientation,
    columns,
    rows,
    overlapMm,
    scale,
    numericVariables: resolvedVariables,
    placements: layout.placements.map((placement) => ({
      ...placement,
      x: resolveNumericValue({ value: placement.x, fallback: 0, elements, evaluation, localVariables }),
      y: resolveNumericValue({ value: placement.y, fallback: 0, elements, evaluation, localVariables }),
      angleDeg: resolveNumericValue({ value: placement.angleDeg, fallback: 0, elements, evaluation, localVariables })
    }))
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
