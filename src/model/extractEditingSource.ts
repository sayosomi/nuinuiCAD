import { geometryValueOccurrenceKey, type CompiledDslDocument, type GeometryValueProgramTarget } from "@nuinuicad/nui-language";
import type { CadElement, ComputedGeometry, ComputedGeometryValue, EvaluationResult } from "../types/geometry";
import { resolveDocumentGeometryTarget } from "../geometry/scalarProgramEvaluation";

export type ExtractEditingSource = {
  geometry: ComputedGeometry | ComputedGeometryValue;
  /** Only a real editable Bezier owner receives handles. */
  bezierOwner?: Extract<CadElement, { type: "bezierCurve" }>;
};

/** Presentation projection of compiler-owned part → captured-prefix targets.
 * No source names or generated-id spelling participate in this link. */
export const extractEditingSourceFor = (
  compiled: CompiledDslDocument | undefined, evaluation: EvaluationResult,
  elements: readonly CadElement[], selectedId: string | null
): ExtractEditingSource | null => {
  if (!compiled?.statementMap || !selectedId) return null;
  const selectedRow = evaluation.forGroupGeneratedRows?.find(row => row.generatedElementId === selectedId);
  const templateId = selectedRow?.templateElementId ?? selectedId;
  const origin = compiled.moduleMaterialization?.originByRuntimeElementId.get(templateId);
  const index = origin?.sourceStatementIndex ?? compiled.statementMap.byElementId.get(templateId)?.statementIndex ??
    compiled.statementMap.statementIndexByStatementId?.get(templateId);
  if (index === undefined) return null;
  const statement = compiled.statements[index];
  if (statement?.kind !== "element" || !statement.extractPart) return null;
  const input = compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId.get(templateId)?.get("source") ??
    compiled.geometryInputTargetsByElementId?.get(templateId)?.get("source");
  if (!input || Array.isArray(input) || !("kind" in input) || input.kind !== "geometryValue") return null;
  const entries = compiled.geometryValueProgram ?? [];
  const part = entries.find(entry => geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(input.occurrence));
  if (part?.construction.kind !== "extractInterval") return null;
  const elementsById = new Map(elements.map(element => [element.id, element]));
  for (const row of evaluation.forGroupGeneratedRows ?? []) {
    const template = elementsById.get(row.templateElementId);
    if (template) elementsById.set(row.generatedElementId, { ...template, id: row.generatedElementId });
  }
  const runtime = {
    computedGeometry: evaluation.computedGeometry,
    baseTransformationGeometry: evaluation.preMutationGeometry,
    transformationStageGeometry: evaluation.transformationStageGeometry,
    computedGeometryValues: evaluation.computedGeometryValues,
    elementsById,
    activities: new Map(), forGroupGeneratedRows: evaluation.forGroupGeneratedRows
  };
  const seen = new Set<string>();
  const project = (target: GeometryValueProgramTarget): ExtractEditingSource | null => {
    if (target.kind === "geometryInputTarget" || target.kind === "geometryCarry" || target.kind === "geometryValueForBinder") return null;
    if (target.kind === "geometryValue") {
      const key = geometryValueOccurrenceKey(target.occurrence);
      if (seen.has(key)) return null;
      seen.add(key);
      const entry = entries.find(value => geometryValueOccurrenceKey(value.occurrence) === key);
      if (entry?.construction.kind === "reference") return project(entry.construction.target);
    }
    let resolved = target;
    if (selectedRow && (target.kind === "forGroupOccurrence" && target.index === null || target.kind === undefined || target.kind === "drawable")) {
      const sourceTemplate = target.kind === "forGroupOccurrence" ? target.templateElementId : target.statementId;
      const rows = evaluation.forGroupGeneratedRows?.filter(row => row.templateElementId === sourceTemplate &&
        row.occurrencePath.every((step, i) => selectedRow.occurrencePath[i]?.templateForGroupId === step.templateForGroupId && selectedRow.occurrencePath[i]?.iterationIndex === step.iterationIndex)) ?? [];
      if (rows.length === 1) resolved = { kind: "drawable", statementId: rows[0].generatedElementId, statementIndex: -1, geometryType: target.geometryType, ...(target.stagePath ? { stagePath: target.stagePath } : {}) };
    }
    const geometry = resolveDocumentGeometryTarget(runtime, resolved, part.executionPosition);
    if (!geometry || geometry.kind === "unavailable" || geometry.kind === "point") return null;
    const ownerId = resolved.kind === undefined || resolved.kind === "drawable" ? resolved.statementId : undefined;
    const sourceElement = elements.find(element => element.id === ownerId);
    return { geometry: geometry as ComputedGeometry | ComputedGeometryValue,
      ...(sourceElement?.type === "bezierCurve" && geometry.kind === "bezierCurve" ? { bezierOwner: sourceElement } : {}) };
  };
  return project(part.construction.source.target);
};
