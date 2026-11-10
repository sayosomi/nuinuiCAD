import {
  compileDslDocument,
  parseDslSnapshot,
  parseDslSourceReference,
  queryDslReferencePickTarget,
  type CompiledDslDocument,
  type SourceSnapshot
} from "@nuinuicad/nui-language";
import { isLastGoodDslDocument, reconcileStatements, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
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
  const candidateText = source.normalizedSource.slice(0, from) + source.normalizedSource.slice(to);
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
    !reanchorInsertedReferencePickTargetToCanvasSnapshot({
      target, currentCompiled: compiled,
      canvasSnapshot: { source: candidateSource, compiled: candidate }
    })) return null;
  return candidate;
};
