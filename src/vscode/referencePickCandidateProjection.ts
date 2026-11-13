import {
  compileDslDocument,
  parseDslSnapshot,
  parseDslSourceReference,
  queryDslReferencePickTarget,
  type CompiledDslDocument,
  type SourceSnapshot
} from "@nuinuicad/nui-language";
import { isLastGoodDslDocument, reconcileStatements, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { EvaluationResult } from "../types/geometry";
import { isEmptyExtractRightBoundary, proveTemporarilyCompletedExtract } from "./referencePickExtractProjectionProof";
import { reanchorInsertedReferencePickTargetToCanvasSnapshot } from "./referencePickCanvasSession";
import { referencePickTargetMatchesProof, type VscodeReferencePickStartRequest } from "./referencePickProtocol";

/** A Pick-only execution artifact. The current Source remains target and edit
 * authority; neither the canonical document nor its history is changed here. */
export const projectIncompleteReferencePickCandidate = ({
  source, compiled, request
}: {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  request: VscodeReferencePickStartRequest;
}): LastGoodDslDocument | null => {
  if (
    !request.targetProof ||
    compiled.document || !compiled.statementMap ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    compiled.statementMap.sourceRevision !== source.sourceRevision
  ) return null;
  const target = queryDslReferencePickTarget({
    source, position: request.normalizedSourceOffset,
    semantic: { sourceRevision: source.sourceRevision, sourceText: source.normalizedSource, compiled }
  });
  if (!target ||
    !referencePickTargetMatchesProof(source.normalizedSource, target, request.targetProof)) return null;
  const statement = compiled.statements[target.sourceAnchor.statementIndex];
  if (!statement || (statement.kind !== "transformation" && statement.kind !== "extract")) return null;
  if (statement.kind === "transformation" && target.syntax !== "transformationTarget") return null;
  const targetDiagnostic = (diagnostic: CompiledDslDocument["diagnostics"][number]) => {
    if (statement.kind === "extract") {
      if (diagnostic.code !== "extract-point-boundary-required") return false;
      const span = diagnostic.physicalSpan;
      return span?.sourceRevision === source.sourceRevision && span.segments.every(segment =>
        segment.from >= target.range.from && segment.to <= target.range.to);
    }
    if (diagnostic.code === "missing-construction-argument" || diagnostic.code === "missing-attribute-value") return true;
    if (diagnostic.code !== "malformed-transformation-target" &&
      diagnostic.code !== "transformation-target-kind-incompatible") return false;
    if (!diagnostic.physicalSpan) return diagnostic.code === "transformation-target-kind-incompatible" ||
      (diagnostic.statementIndex === target.sourceAnchor.statementIndex && diagnostic.logicalSpan !== undefined &&
        diagnostic.logicalSpan.start >= statement.targetSpan.start && diagnostic.logicalSpan.end <= statement.targetSpan.end);
    if (diagnostic.physicalSpan.sourceRevision !== source.sourceRevision) return false;
    return diagnostic.physicalSpan.segments.every(segment =>
      (segment.from >= target.range.from && segment.to <= target.range.to) ||
      ((target.range.from === target.range.to || diagnostic.code === "transformation-target-kind-incompatible") &&
        statement.keywordPhysicalSpan?.segments.some(keyword =>
          segment.from >= keyword.from && segment.to <= keyword.to))
    );
  };
  if ([...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])].some(diagnostic =>
    diagnostic.severity === "error" && diagnostic.line >= statement.line &&
    diagnostic.line <= statement.endLine && !targetDiagnostic(diagnostic)
  )) return null;
  // Use parser-owned target syntax and the canonical reference parser. A valid
  // unresolved/completed selector is not an incomplete authoring hole.
  if (statement.kind === "transformation" && statement.targets.some(item => !item.source.startsWith("@"))) return null;
  const incomplete = statement.kind === "extract"
    ? target.range.from === target.range.to || parseDslSourceReference(source.normalizedSource.slice(target.range.from, target.range.to)).kind !== "valid"
    : statement.targets.length === 0 ||
    statement.targets.some(item => parseDslSourceReference(item.source).kind !== "valid") ||
    compiled.diagnostics.some(item => item.code === "malformed-transformation-target" &&
      item.line >= statement.line && item.line <= statement.endLine);
  if (!incomplete) return null;
  const { from, to, sourceRevision } = statement.documentRange;
  if (sourceRevision !== source.sourceRevision || from < 0 || to <= from || to > source.normalizedSource.length) return null;
  const temporaryEnd = isEmptyExtractRightBoundary(compiled, target);
  const candidateText = temporaryEnd
    ? source.normalizedSource.slice(0, target.range.from) + "end" + source.normalizedSource.slice(target.range.to)
    : source.normalizedSource.slice(0, from) + source.normalizedSource.slice(to);
  const candidateSource = { normalizedSource: candidateText, sourceRevision: source.sourceRevision + 1 };
  const parsed = parseDslSnapshot(candidateSource);
  const reconciled = reconcileStatements({
    oldStatements: compiled.statements,
    oldLines: compiled.sourceLines,
    oldElementIds: compiled.statementMap.elementIdByStatementIndex,
    oldStatementIds: compiled.statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: candidateText.split("\n")
  });
  const candidate = compileDslDocument(candidateText, {
    preparsed: parsed,
    sourceRevision: candidateSource.sourceRevision,
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds
  });
  if (!isLastGoodDslDocument(candidate) ||
    [...candidate.diagnostics, ...(candidate.bindingIssueDiagnostics ?? [])].some(item => item.severity === "error") ||
    !(temporaryEnd ? proveTemporarilyCompletedExtract : reanchorInsertedReferencePickTargetToCanvasSnapshot)({
      target, currentCompiled: compiled,
      canvasSnapshot: { source: candidateSource, compiled: candidate }
    })) return null;
  return candidate;
};

/** Browse may use an independently compiled, unchanged top-level prefix when
 * there has never been a last-good Canvas. No hole is completed and no prefix
 * candidate grants automatic replacement authority. */
export const projectIndependentReferencePickBrowseCandidate = ({ source, compiled, evaluation, evaluationIsCurrent }: {
  source: SourceSnapshot; compiled: CompiledDslDocument; evaluation?: EvaluationResult; evaluationIsCurrent?: boolean;
}): LastGoodDslDocument | null => {
  if (!compiled.statementMap || !compiled.sourceLexicalNamespace ||
    compiled.spans.sourceMap.source !== source.normalizedSource || compiled.spans.sourceMap.sourceRevision !== source.sourceRevision) return null;
  const errors = [...compiled.diagnostics, ...compiled.bindingIssueDiagnostics ?? []].filter(d => d.severity === "error");
  const runtimeErrorLines = evaluationIsCurrent ? (evaluation?.errors ?? []).flatMap(error => {
    const index = compiled.statementMap!.byElementId.get(error.elementId)?.statementIndex;
    const statement = index === undefined ? undefined : compiled.statements[index];
    return statement ? [statement.line] : [];
  }) : [];
  if (!errors.length && !runtimeErrorLines.length) return null;
  const firstErrorLine = Math.min(...errors.map(d => d.line), ...runtimeErrorLines);
  const root = compiled.sourceLexicalNamespace.scopeIndex.rootScopeId;
  const boundary = compiled.statements.find(s => s.endLine >= firstErrorLine);
  if (!boundary) return null;
  // A parser-owned root statement boundary avoids inventing closing braces for
  // an incomplete group/Module. Open scopes belong to the omitted suffix.
  const rootBoundary = compiled.statements.filter((s, i) => s.documentRange.from <= boundary.documentRange.from &&
    s.kind !== "version" && compiled.sourceLexicalNamespace!.scopeIndex.scopeOfStatement.get(i) === root).at(-1);
  if (!rootBoundary) return null;
  const text = source.normalizedSource.slice(0, rootBoundary.documentRange.from);
  const candidateSource = { normalizedSource: text, sourceRevision: source.sourceRevision + 1 };
  const parsed = parseDslSnapshot(candidateSource);
  const reconciled = reconcileStatements({ oldStatements: compiled.statements, oldLines: compiled.sourceLines,
    oldElementIds: compiled.statementMap.elementIdByStatementIndex, oldStatementIds: compiled.statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements, newLines: text.split("\n") });
  const candidate = compileDslDocument(text, { preparsed: parsed, sourceRevision: candidateSource.sourceRevision,
    assignedElementIds: reconciled.assignedIds, assignedStatementIds: reconciled.assignedIds });
  if (!isLastGoodDslDocument(candidate)) return null;
  for (const [index, statement] of candidate.statements.entries()) {
    const original = compiled.statements[index];
    const id = candidate.statementMap.statementIdByStatementIndex?.get(index);
    if (!original || statement.kind !== original.kind || statement.documentRange.from !== original.documentRange.from ||
      statement.documentRange.to !== original.documentRange.to || (statement.kind !== "version" && (!id ||
        id !== compiled.statementMap.statementIdByStatementIndex?.get(index) ||
        compiled.statementMap.statementIndexByStatementId?.get(id) !== index || candidate.statementMap.statementIndexByStatementId?.get(id) !== index)) ||
      candidate.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(index) !== compiled.sourceLexicalNamespace.scopeIndex.scopeOfStatement.get(index)) return null;
  }
  return candidate;
};
