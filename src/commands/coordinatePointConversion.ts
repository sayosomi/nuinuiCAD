import {
  commitLineSplicePatch,
  type CanonicalDocumentValue,
  type LastGoodDslDocument
} from "../document/canonicalDocument";
import { mergeStatementComments } from "../document/statementCommentMerge";
import type { LineSplice } from "../document/textPatch";
import { matchingDslDelimiter } from "../dsl/dslArgScanner";
import type { DslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { StatementInfo } from "../dsl/dslDocument";
import { parseDslCallStatement } from "../dsl/dslCallParser";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import { referencePickCandidates, type ReferencePickPointOption } from "../model/referencePickCandidates";
import { anchorReferenceElementId } from "../model/pointAnchors";
import { sourceReferenceText, type CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import { normalizeDegrees360 } from "../scalars/angleMath";
import { getBuiltinFunctionDefinition } from "../scalars/builtinFunctions";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { parseScalarExpression } from "../scalars/expressionParser";
import { typecheckScalarExpression } from "../scalars/expressionTypecheck";
import { formatDslName } from "../dsl/dslTokens";
import type { ComputedPoint, ElementId, EvaluationResult, PointAnchor } from "../types/geometry";

/** Host-neutral input for a conversion query or source transformation. */
export type CoordinatePointConversionSnapshot = {
  document: CanonicalDocumentValue;
  evaluation: EvaluationResult;
};

export type CoordinatePointConversionMode = "xy" | "angle-distance";

export type CoordinatePointConversionSkipCode =
  | "stale-source"
  | "target-not-found"
  | "target-not-eligible"
  | "target-not-evaluated"
  | "base-not-candidate"
  | "base-is-target"
  | "base-not-evaluated"
  | "source-rewrite-failed"
  | "revalidation-failed";

export type CoordinatePointConversionSkip = {
  targetId: ElementId;
  reason: {
    code: CoordinatePointConversionSkipCode;
    message: string;
  };
};

export type CoordinatePointConversionTarget = {
  targetId: ElementId;
  sourceStatementId: string;
  sourceStatementIndex: number;
  statement: StatementInfo;
  sourceElement: Extract<LastGoodDslDocument["document"]["elements"][number], { type: "freePoint" }>;
  currentPoint: ComputedPoint;
  x: number;
  y: number;
};

export type CoordinatePointConversionTargetEligibility =
  | { eligible: true; target: CoordinatePointConversionTarget }
  | { eligible: false; targetId: ElementId; reason: CoordinatePointConversionSkip["reason"] };

export type CoordinatePointConversionBaseCandidate = {
  /** Stable source identity for an ordinary point or derived point accessor. */
  key: string;
  sourceElementId: ElementId;
  anchor: PointAnchor;
  point: ComputedPoint;
  /** The legal source spelling can differ by target scope. */
  referencesByTargetId: ReadonlyMap<ElementId, CanonicalGeometrySourceReference>;
};

export type CoordinatePointConversionPlan = {
  mode: CoordinatePointConversionMode;
  sourceText: string;
  sourceRevision: number;
  targetIds: readonly ElementId[];
  base: CoordinatePointConversionBaseCandidate;
  classification: "all-success" | "partial-success" | "all-skipped";
  splices: readonly LineSplice[];
  successfulTargetIds: readonly ElementId[];
  successfulTargetCount: number;
  skippedTargets: readonly CoordinatePointConversionSkip[];
  skippedTargetCount: number;
};

export type CoordinatePointConversionApplyResult =
  | {
      status: "applied";
      plan: CoordinatePointConversionPlan;
      document: CanonicalDocumentValue;
    }
  | {
      status: "noop";
      plan: CoordinatePointConversionPlan;
    }
  | {
      status: "rejected";
      reason: CoordinatePointConversionSkip["reason"];
      plan: CoordinatePointConversionPlan;
    };

const numberType = { kind: "number" } as const;

const staleReason = (): CoordinatePointConversionSkip["reason"] => ({
  code: "stale-source",
  message: "変換対象のソースが現在のコンパイル済みソースと一致しません。"
});

const exactCurrentDocument = (snapshot: CoordinatePointConversionSnapshot): LastGoodDslDocument | null => {
  const { document } = snapshot;
  const compiled = document.doc;
  const sourceMap = compiled.spans.sourceMap;
  if (document.docText !== document.sourceText) return null;
  if (document.sourceText.includes("\r")) return null;
  if (sourceMap.source !== document.sourceText) return null;
  if (sourceMap.sourceRevision !== compiled.statementMap.sourceRevision) return null;
  if (compiled.statementMap.sourceRevision !== sourceMap.sourceRevision) return null;
  if (!compiled.document || !compiled.statementMap) return null;
  return compiled;
};

const sourceElementFor = (
  compiled: LastGoodDslDocument,
  targetId: ElementId,
  statement: StatementInfo
) => {
  const sourceElement = compiled.sourceElementsByStatementIndex.get(statement.statementIndex);
  const documentElement = compiled.document.elements.find((element) => element.id === targetId);
  if (!sourceElement || !documentElement || sourceElement.id !== targetId || documentElement.id !== targetId) return null;
  if (sourceElement !== documentElement && (sourceElement.name !== documentElement.name || sourceElement.type !== documentElement.type)) return null;
  return documentElement;
};

const evaluatedPointFor = (
  evaluation: EvaluationResult,
  targetId: ElementId
): ComputedPoint | null => {
  if (evaluation.evaluatedElementIds && !evaluation.evaluatedElementIds.has(targetId)) return null;
  const geometry = evaluation.computedGeometry.get(targetId);
  if (!geometry || geometry.kind !== "point") return null;
  if (!Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) return null;
  return geometry;
};

const logicalSourceFor = (compiled: LastGoodDslDocument, statement: StatementInfo) => {
  const sourceStatement = compiled.statements[statement.statementIndex];
  if (!sourceStatement) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(sourceStatement.documentRange.from);
  if (!logical || logical.range.sourceRevision !== compiled.statementMap.sourceRevision) return null;
  if (logical.range.from !== sourceStatement.documentRange.from || logical.range.to !== sourceStatement.documentRange.to) return null;
  return logical;
};

const constantNumericAst = (ast: ScalarExpressionAst): boolean => {
  switch (ast.kind) {
    case "numberLiteral":
      return true;
    case "unary":
      return (ast.operator === "+" || ast.operator === "-") && constantNumericAst(ast.operand);
    case "binary":
      return ["+", "-", "*", "/", "%", "^"].includes(ast.operator) &&
        constantNumericAst(ast.left) && constantNumericAst(ast.right);
    case "group":
      return constantNumericAst(ast.expression);
    case "call": {
      const definition = getBuiltinFunctionDefinition(ast.name);
      if (!definition || !definition.signatures.every((signature) =>
        signature.returnType.kind === "number" &&
        signature.parameters.every((parameter) => typeof parameter.type !== "string" && parameter.type.kind === "number")
      )) return false;
      return ast.args.every((argument) => argument.kind === "positional" || argument.kind === "named") &&
        ast.args.every((argument) => constantNumericAst(argument.expression));
    }
    case "stringLiteral":
    case "booleanLiteral":
    case "unresolvedChoiceLiteral":
    case "reference":
    case "geometryProperty":
      return false;
  }
};

const evaluateConstantNumber = (
  logicalText: string,
  span: { start: number; end: number }
): { ok: true; value: number } | { ok: false } => {
  const parsed = parseScalarExpression(logicalText, span);
  if (!parsed.ast || parsed.diagnostics.length > 0 || !constantNumericAst(parsed.ast)) return { ok: false };

  let checked;
  try {
    checked = typecheckScalarExpression(parsed.ast, { expectedType: numberType, references: [] });
  } catch {
    return { ok: false };
  }
  if (checked.type?.kind !== "number" || checked.diagnostics.length > 0) return { ok: false };

  const evaluated = evaluateTypedExpression(checked.typed, {
    lookupBinding: () => {
      throw new Error("coordinate point conversion reached an unexpected scalar reference");
    }
  });
  return evaluated.status === "ok" && evaluated.value.kind === "number" && Number.isFinite(evaluated.value.value)
    ? { ok: true, value: evaluated.value.value }
    : { ok: false };
};

const targetEligibility = (
  snapshot: CoordinatePointConversionSnapshot,
  targetId: ElementId
): CoordinatePointConversionTargetEligibility => {
  const compiled = exactCurrentDocument(snapshot);
  if (!compiled) return { eligible: false, targetId, reason: staleReason() };

  const statement = compiled.statementMap.byElementId.get(targetId);
  const statementIndex = statement?.statementIndex;
  const sourceStatementId = statementIndex === undefined
    ? undefined
    : compiled.statementMap.statementIdByStatementIndex?.get(statementIndex) ?? targetId;
  const owner = sourceOwnerForRuntimeElementId(compiled, targetId);
  if (!statement || statementIndex === undefined || !sourceStatementId || !owner ||
      owner.kind !== "ordinary" || owner.sourceStatementIndex !== statementIndex || owner.sourceStatementId !== sourceStatementId) {
    return {
      eligible: false,
      targetId,
      reason: { code: "target-not-found", message: "変換対象が現在の通常のソース要素として解決できません。" }
    };
  }

  const compiledStatement = compiled.statements[statementIndex];
  const sourceElement = sourceElementFor(compiled, targetId, statement);
  const logical = logicalSourceFor(compiled, statement);
  const point = evaluatedPointFor(snapshot.evaluation, targetId);
  if (!compiledStatement || compiledStatement.kind !== "element" || compiledStatement.type !== "freePoint" ||
      compiledStatement.construction !== "coordinate" || !sourceElement || sourceElement.type !== "freePoint" || !logical) {
    return {
      eligible: false,
      targetId,
      reason: { code: "target-not-eligible", message: "座標変換できる独立した coordinate point ではありません。" }
    };
  }
  if (!point) {
    return {
      eligible: false,
      targetId,
      reason: { code: "target-not-evaluated", message: "変換対象の現在の評価座標がありません。" }
    };
  }

  const parsedCall = parseDslCallStatement(logical.logicalText);
  const xSpan = parsedCall.statement?.payloadSpans.x;
  const ySpan = parsedCall.statement?.payloadSpans.y;
  if (!parsedCall.statement || parsedCall.diagnostics.length > 0 || parsedCall.statement.construction !== "coordinate" || !xSpan || !ySpan) {
    return {
      eligible: false,
      targetId,
      reason: { code: "target-not-eligible", message: "coordinate の x / y 引数を正確に解析できません。" }
    };
  }
  const x = evaluateConstantNumber(logical.logicalText, xSpan);
  const y = evaluateConstantNumber(logical.logicalText, ySpan);
  if (!x.ok || !y.ok) {
    return {
      eligible: false,
      targetId,
      reason: { code: "target-not-eligible", message: "x / y はリテラルまたは依存関係のない定数式である必要があります。" }
    };
  }

  return {
    eligible: true,
    target: {
      targetId,
      sourceStatementId,
      sourceStatementIndex: statementIndex,
      statement,
      sourceElement,
      currentPoint: point,
      x: x.value,
      y: y.value
    }
  };
};

export const coordinatePointConversionTargetEligibility = targetEligibility;

const pointCandidateKey = (option: ReferencePickPointOption): string => {
  if (option.anchor.mode === "reference") return `reference:${option.anchor.pointId}`;
  if (option.anchor.mode === "derived") return `derived:${option.anchor.elementId}:${option.anchor.pointKey}`;
  return `coordinate:${option.point.x}:${option.point.y}`;
};

const pickTargetFor = (target: CoordinatePointConversionTarget, compiled: LastGoodDslDocument): DslReferencePickTarget | null => {
  const scopeId = compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(target.sourceStatementIndex);
  const sourceStatement = compiled.statements[target.sourceStatementIndex];
  if (!scopeId) return null;
  if (!sourceStatement) return null;
  return {
    sourceAnchor: {
      sourceRevision: compiled.statementMap.sourceRevision,
      statementId: target.sourceStatementId,
      statementIndex: target.sourceStatementIndex,
      sourceOrderIndex: target.sourceStatementIndex,
      scopeId,
      statementRange: {
        from: sourceStatement.documentRange.from,
        to: sourceStatement.documentRange.to,
        startLine: target.statement.range.startLine,
        endLine: target.statement.range.endLine
      }
    },
    expectedGeometryInterface: "point",
    role: "geometry",
    multiplicity: "single",
    range: { from: sourceStatement.documentRange.from, to: sourceStatement.documentRange.to }
  };
};

const legalCandidatesFor = (
  snapshot: CoordinatePointConversionSnapshot,
  target: CoordinatePointConversionTarget,
  targetIds: ReadonlySet<ElementId>
): Map<string, { option: ReferencePickPointOption; sourceElementId: ElementId }> => {
  const compiled = exactCurrentDocument(snapshot);
  if (!compiled) return new Map();
  const pickTarget = pickTargetFor(target, compiled);
  if (!pickTarget) return new Map();
  return new Map(
    referencePickCandidates({ compiled, evaluation: snapshot.evaluation, target: pickTarget, includeHidden: true })
      .flatMap((candidate) => candidate.options
        .filter((option): option is ReferencePickPointOption => option.kind === "point")
        .map((option) => [pointCandidateKey(option), { option, sourceElementId: candidate.elementId }] as const))
      .filter(([key, candidate]) => {
        const owner = sourceOwnerForRuntimeElementId(compiled, candidate.sourceElementId);
        const anchorElementId = anchorReferenceElementId(candidate.option.anchor);
        return owner?.kind === "ordinary" &&
          owner.sourceStatementIndex < target.sourceStatementIndex &&
          anchorElementId !== target.targetId &&
          (anchorElementId === null || !targetIds.has(anchorElementId)) &&
          Number.isFinite(candidate.option.point.x) && Number.isFinite(candidate.option.point.y) &&
          key.length > 0;
      })
  );
};

/** Returns only point references legal for every selected target. */
export const coordinatePointConversionBaseCandidates = ({
  snapshot,
  targetIds
}: {
  snapshot: CoordinatePointConversionSnapshot;
  targetIds: readonly ElementId[];
}): CoordinatePointConversionBaseCandidate[] => {
  const compiled = exactCurrentDocument(snapshot);
  if (!compiled) return [];
  const uniqueTargetIds = [...new Set(targetIds)];
  const targets = uniqueTargetIds
    .map((targetId) => targetEligibility(snapshot, targetId))
    .flatMap((result) => result.eligible ? [result.target] : []);
  if (targets.length === 0) return [];

  const targetSet = new Set(uniqueTargetIds);
  const candidateMaps = targets.map((target) => legalCandidatesFor(snapshot, target, targetSet));
  const first = candidateMaps[0]!;
  return [...first.entries()]
    .filter(([key]) => candidateMaps.every((candidateMap) => candidateMap.has(key)))
    .map(([key, firstCandidate]) => ({
      key,
      sourceElementId: firstCandidate.sourceElementId,
      anchor: firstCandidate.option.anchor,
      point: firstCandidate.option.point,
      referencesByTargetId: new Map(targets.map((target, index) => [
        target.targetId,
        candidateMaps[index]!.get(key)!.option.reference
      ]))
    }));
};

const formatNumber = (value: number): string => Object.is(value, -0) ? "0" : String(value);

const baseHasNoCurrentCoordinate = (
  snapshot: CoordinatePointConversionSnapshot,
  base: CoordinatePointConversionBaseCandidate
) => {
  const geometry = snapshot.evaluation.computedGeometry.get(base.sourceElementId);
  return !geometry ||
    (snapshot.evaluation.evaluatedElementIds !== undefined && !snapshot.evaluation.evaluatedElementIds.has(base.sourceElementId));
};

const rawArgumentText = (logicalText: string, arg: { key: string | null; keySpan: { start: number; end: number } | null; valueSpan: { start: number; end: number } }): string | null =>
  arg.key && arg.keySpan ? logicalText.slice(arg.keySpan.start, arg.valueSpan.end).trim() : null;

const lineNumberAtOffset = (source: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source[index] === "\n") line += 1;
  return line;
};

const rewriteStatement = (
  snapshot: CoordinatePointConversionSnapshot,
  target: CoordinatePointConversionTarget,
  basePoint: ComputedPoint,
  baseReference: CanonicalGeometrySourceReference,
  mode: CoordinatePointConversionMode
): LineSplice | null => {
  const compiled = exactCurrentDocument(snapshot);
  if (!compiled) return null;
  const logical = logicalSourceFor(compiled, target.statement);
  const sourceStatement = compiled.statements[target.sourceStatementIndex];
  if (!logical) return null;
  if (!sourceStatement) return null;
  const parsed = parseDslCallStatement(logical.logicalText);
  const constructionSpan = parsed.statement?.constructionSpan;
  if (!parsed.statement || parsed.diagnostics.length > 0 || parsed.statement.construction !== "coordinate" || !constructionSpan) return null;

  let open = constructionSpan.end;
  while (/\s/.test(logical.logicalText[open] ?? "")) open += 1;
  if (logical.logicalText[open] !== "(") return null;
  const close = matchingDslDelimiter(logical.logicalText, open);
  if (close < 0) return null;

  const preservedArgs = parsed.statement.args
    .filter((arg) => arg.key !== null && arg.key !== "x" && arg.key !== "y")
    .map((arg) => ({ key: arg.key!, text: rawArgumentText(logical.logicalText, arg)! }))
    .filter((arg): arg is { key: string; text: string } => Boolean(arg.text));
  if (!preservedArgs.some((arg) => arg.key === "id")) {
    preservedArgs.push({ key: "id", text: `id: ${formatDslName(target.targetId)}` });
  }
  const reference = sourceReferenceText(baseReference);
  if (!reference) return null;
  const dx = target.currentPoint.x - basePoint.x;
  const dy = target.currentPoint.y - basePoint.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const replacementArgs = mode === "xy"
    ? [
        { key: "from", text: `from: ${reference}` },
        { key: "dx", text: `dx: ${formatNumber(dx)}` },
        { key: "dy", text: `dy: ${formatNumber(dy)}` }
      ]
    : [
        { key: "from", text: `from: ${reference}` },
        { key: "angle", text: `angle: ${formatNumber(dx === 0 && dy === 0 ? 0 : normalizeDegrees360(Math.atan2(dy, dx) * 180 / Math.PI))}` },
        { key: "distance", text: `distance: ${formatNumber(Math.hypot(dx, dy))}` }
      ];
  const next = {
    header: `${logical.logicalText.slice(0, constructionSpan.start)}${mode === "xy" ? "offset" : "polar"}(`,
    args: [...replacementArgs, ...preservedArgs],
    close: ")" as const,
    argumentSeparator: "comma" as const
  };

  const startLine = target.statement.line;
  const endLine = Math.max(target.statement.endLine, target.statement.range.endLine);
  const oldLines = compiled.sourceLines.slice(startLine - 1, endLine);
  if (oldLines.length === 0) return null;
  const oldArgLineByKey = new Map<string, number>();
  for (const attr of sourceStatement.attrs) {
    const physical = attr.physicalSpan?.segments[0];
    if (physical) oldArgLineByKey.set(attr.key, lineNumberAtOffset(compiled.spans.sourceMap.source, physical.from) - startLine);
  }
  const indent = oldLines[0]!.match(/^\s*/)?.[0] ?? "";
  const replacementLines = mergeStatementComments({
    oldLines,
    oldArgLineByKey,
    next,
    indent,
    lexicalLines: compiled.spans.sourceMap.lexicalLines.slice(startLine - 1, endLine)
  });
  return { startLine, endLine, replacementLines };
};

const sameSplices = (left: readonly LineSplice[], right: readonly LineSplice[]) =>
  left.length === right.length && left.every((splice, index) => {
    const other = right[index];
    return other && splice.startLine === other.startLine && splice.endLine === other.endLine &&
      splice.replacementLines.length === other.replacementLines.length &&
      splice.replacementLines.every((line, lineIndex) => line === other.replacementLines[lineIndex]);
  });

const classificationFor = (successful: readonly ElementId[], skipped: readonly CoordinatePointConversionSkip[]) =>
  successful.length === 0 ? "all-skipped" as const : skipped.length === 0 ? "all-success" as const : "partial-success" as const;

export const planCoordinatePointConversion = ({
  snapshot,
  targetIds,
  base,
  mode
}: {
  snapshot: CoordinatePointConversionSnapshot;
  targetIds: readonly ElementId[];
  base: CoordinatePointConversionBaseCandidate;
  mode: CoordinatePointConversionMode;
}): CoordinatePointConversionPlan => {
  const compiled = exactCurrentDocument(snapshot);
  const sourceRevision = compiled?.statementMap.sourceRevision ?? -1;
  const uniqueTargetIds = [...new Set(targetIds)];
  const skippedTargets: CoordinatePointConversionSkip[] = [];
  const successfulTargetIds: ElementId[] = [];
  const splices: LineSplice[] = [];
  const candidates = coordinatePointConversionBaseCandidates({ snapshot, targetIds: uniqueTargetIds });
  const currentBase = candidates.find((candidate) => candidate.key === base.key);
  const selectedBaseElementId = anchorReferenceElementId(base.anchor);

  for (const targetId of uniqueTargetIds) {
    const eligibility = targetEligibility(snapshot, targetId);
    if (!eligibility.eligible) {
      skippedTargets.push({ targetId, reason: eligibility.reason });
      continue;
    }
    if (selectedBaseElementId === targetId) {
      skippedTargets.push({ targetId, reason: { code: "base-is-target", message: "対象点自身を基準点にはできません。" } });
      continue;
    }
    if (!currentBase) {
      skippedTargets.push({
        targetId,
        reason: baseHasNoCurrentCoordinate(snapshot, base)
          ? { code: "base-not-evaluated", message: "基準点の現在の評価座標がありません。" }
          : { code: "base-not-candidate", message: "選択した基準点は全対象に共通する合法な候補ではありません。" }
      });
      continue;
    }
    const anchorElementId = anchorReferenceElementId(currentBase.anchor);
    if (anchorElementId === targetId) {
      skippedTargets.push({ targetId, reason: { code: "base-is-target", message: "対象点自身を基準点にはできません。" } });
      continue;
    }
    const reference = currentBase.referencesByTargetId.get(targetId);
    if (!reference || !Number.isFinite(currentBase.point.x) || !Number.isFinite(currentBase.point.y)) {
      skippedTargets.push({ targetId, reason: { code: "base-not-evaluated", message: "基準点の現在の評価座標がありません。" } });
      continue;
    }
    const splice = rewriteStatement(snapshot, eligibility.target, currentBase.point, reference, mode);
    if (!splice) {
      skippedTargets.push({ targetId, reason: { code: "source-rewrite-failed", message: "対象 statement を安全に書き換えられません。" } });
      continue;
    }
    successfulTargetIds.push(targetId);
    splices.push(splice);
  }

  splices.sort((left, right) => left.startLine - right.startLine);
  const planBase = currentBase ?? base;
  return {
    mode,
    sourceText: snapshot.document.sourceText,
    sourceRevision,
    targetIds: uniqueTargetIds,
    base: planBase,
    classification: classificationFor(successfulTargetIds, skippedTargets),
    splices,
    successfulTargetIds,
    successfulTargetCount: successfulTargetIds.length,
    skippedTargets,
    skippedTargetCount: skippedTargets.length
  };
};

/** Revalidates source identity, target legality, base legality, and evaluation before committing. */
export const applyCoordinatePointConversionPlan = (
  plan: CoordinatePointConversionPlan,
  snapshot: CoordinatePointConversionSnapshot
): CoordinatePointConversionApplyResult => {
  const compiled = exactCurrentDocument(snapshot);
  if (!compiled || snapshot.document.sourceText !== plan.sourceText || compiled.statementMap.sourceRevision !== plan.sourceRevision) {
    return { status: "rejected", reason: staleReason(), plan };
  }
  const revalidated = planCoordinatePointConversion({
    snapshot,
    targetIds: plan.targetIds,
    base: plan.base,
    mode: plan.mode
  });
  if (!sameSplices(plan.splices, revalidated.splices) ||
      plan.successfulTargetIds.length !== revalidated.successfulTargetIds.length ||
      plan.successfulTargetIds.some((id, index) => id !== revalidated.successfulTargetIds[index])) {
    return {
      status: "rejected",
      reason: { code: "revalidation-failed", message: "再検証時に対象、基準点、評価結果、または source span が変化しました。" },
      plan: revalidated
    };
  }
  if (revalidated.splices.length === 0) return { status: "noop", plan: revalidated };
  const committed = commitLineSplicePatch(snapshot.document, revalidated.splices);
  if (committed.status !== "committed") {
    return {
      status: "rejected",
      reason: { code: "revalidation-failed", message: committed.status === "failed" ? committed.reason : "変換対象に変更がありません。" },
      plan: revalidated
    };
  }
  return { status: "applied", plan: revalidated, document: committed.value };
};
