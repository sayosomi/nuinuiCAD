import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { ModuleDefinitionSemantic, ModuleInstanceSemantic } from "../dsl/moduleSemanticTypes";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type InlineModuleTargetIdentity = {
  /**
   * Reserved for the multi-document identity owner. Local-source v1 requires
   * null, but the public planner shape deliberately does not make a bare
   * statement id globally unique forever.
   */
  documentKey: string | null;
  statementId: StatementIdentity;
};

export type InlineModulePolicy = {
  emitOmittedBranchComments: boolean;
  includeHiddenInstances: boolean;
  includeDisabledInstances: boolean;
};

export type InlineModuleKnownSkipCode =
  | "non-local-target"
  | "not-module-instance"
  | "unresolved-callee"
  | "hidden-excluded"
  | "disabled-excluded"
  | "parameter-lowering-required"
  | "nested-module-validation-required";

export type InlineModuleRejectCode =
  | "stale-semantic-snapshot"
  | "invalid-target"
  | "unsafe-source-span"
  | "unsafe-rewrite";

export type InlineModuleSkippedTarget = {
  status: "skipped";
  target: InlineModuleTargetIdentity;
  statementIndex: number | null;
  instanceName: string | null;
  code: InlineModuleKnownSkipCode;
  reason: string;
};

export type InlineModuleInlinedTarget = {
  status: "inlined";
  target: InlineModuleTargetIdentity;
  statementIndex: number;
  instanceName: string;
  moduleDefinitionStatementId: StatementIdentity;
  activity: "visible" | "hidden" | "disabled";
  generatedGroupName: string;
  sourceRange: { startLine: number; endLine: number };
};

export type InlineModuleTargetResult = InlineModuleSkippedTarget | InlineModuleInlinedTarget;

export type InlineModulePlan = {
  status: "planned";
  sourceRevision: number;
  /** Results are deduplicated and sorted by authored source order. */
  targets: readonly InlineModuleTargetResult[];
  /** One old-source-coordinate atomic batch. Callers apply all or none. */
  splices: readonly LineSplice[];
};

export type InlineModuleRejection = {
  status: "rejected";
  code: InlineModuleRejectCode;
  message: string;
  target?: InlineModuleTargetIdentity;
};

export type InlineModulePlanResult = InlineModulePlan | InlineModuleRejection;

export type InlineModulePlanInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  targets: readonly InlineModuleTargetIdentity[];
  policy: InlineModulePolicy;
};

type AbsoluteReplacement = { from: number; to: number; text: string };

type Activity = InlineModuleInlinedTarget["activity"];

const reject = (
  code: InlineModuleRejectCode,
  message: string,
  target?: InlineModuleTargetIdentity
): InlineModuleRejection => ({ status: "rejected", code, message, ...(target ? { target } : {}) });

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const lineStarts = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const lineEndOffset = (source: string, starts: readonly number[], line: number): number =>
  line < starts.length ? starts[line]! - 1 : source.length;

const leadingWhitespace = (line: string): string => line.match(/^\s*/)?.[0] ?? "";

const singlePhysicalRange = (
  span: { sourceRevision: number; segments: readonly { from: number; to: number }[] } | null | undefined,
  sourceRevision: number
): { from: number; to: number } | null =>
  span?.sourceRevision === sourceRevision && span.segments.length === 1
    ? span.segments[0] ?? null
    : null;

const applyAbsoluteReplacements = (
  source: string,
  rangeFrom: number,
  rangeTo: number,
  replacements: readonly AbsoluteReplacement[]
): string | null => {
  const ordered = [...replacements].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = rangeFrom;
  for (const replacement of ordered) {
    if (
      replacement.from < rangeFrom ||
      replacement.to > rangeTo ||
      replacement.from > replacement.to ||
      replacement.from < previousTo
    ) return null;
    previousTo = replacement.to;
  }

  let result = source.slice(rangeFrom, rangeTo);
  for (const replacement of ordered.reverse()) {
    const from = replacement.from - rangeFrom;
    const to = replacement.to - rangeFrom;
    result = `${result.slice(0, from)}${replacement.text}${result.slice(to)}`;
  }
  return result;
};

const nearestEnclosingModuleIndex = (
  statements: readonly DslStatement[],
  statementIndex: number
): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const instanceActivity = (statement: Extract<DslStatement, { kind: "moduleInstance" }>): Activity => {
  const state = statement.options.find((option) => option.name === "state")?.value.trim();
  return state === "hidden" || state === "disabled" ? state : "visible";
};

const semanticAnalysisFor = (compiled: CompiledDslDocument) =>
  compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;

const skip = (
  target: InlineModuleTargetIdentity,
  statementIndex: number | null,
  instanceName: string | null,
  code: InlineModuleKnownSkipCode,
  reason: string
): InlineModuleSkippedTarget => ({ status: "skipped", target, statementIndex, instanceName, code, reason });

const bodyRangeForDefinition = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): { from: number; to: number; bodyLines: readonly string[]; definitionIndent: string } | null => {
  const info = compiled.statementMap?.statements[definition.statementIndex];
  if (!info?.openBraceLine || !info.closeBraceLine || info.closeBraceLine <= info.openBraceLine) return null;
  const bodyStartLine = info.openBraceLine + 1;
  const bodyEndLine = info.closeBraceLine - 1;
  const definitionLine = compiled.sourceLines[info.line - 1] ?? "";
  const definitionIndent = leadingWhitespace(definitionLine);
  if (bodyStartLine > bodyEndLine) {
    const insertion = starts[info.closeBraceLine - 1];
    return insertion === undefined
      ? null
      : { from: insertion, to: insertion, bodyLines: [], definitionIndent };
  }
  const from = starts[bodyStartLine - 1];
  const to = lineEndOffset(source, starts, bodyEndLine);
  if (from === undefined || from > to) return null;
  return {
    from,
    to,
    bodyLines: compiled.sourceLines.slice(bodyStartLine - 1, bodyEndLine),
    definitionIndent
  };
};

const exportedTokenReplacements = (
  source: string,
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic,
  bodyFrom: number,
  bodyTo: number
): AbsoluteReplacement[] | null => {
  const replacements: AbsoluteReplacement[] = [];
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (nearestEnclosingModuleIndex(compiled.statements, statementIndex) !== definition.statementIndex) continue;
    if (statement.kind !== "typedDeclaration" && statement.kind !== "element") continue;
    if (!statement.exported) continue;
    const range = singlePhysicalRange(statement.exportPhysicalSpan, compiled.spans.sourceMap.sourceRevision);
    if (!range || range.from < bodyFrom || range.to > bodyTo) return null;
    let to = range.to;
    while (to < bodyTo && (source[to] === " " || source[to] === "\t")) to += 1;
    replacements.push({ from: range.from, to, text: "" });
  }
  return replacements;
};

const hasDirectNestedModuleConstruct = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): boolean => compiled.statements.some((statement, statementIndex) =>
  nearestEnclosingModuleIndex(compiled.statements, statementIndex) === definition.statementIndex &&
  (statement.kind === "moduleDefinition" || statement.kind === "moduleInstance")
);

const rebaseBodyLines = (
  lines: readonly string[],
  definitionIndent: string,
  instanceIndent: string
): string[] => lines.map((line) =>
  line.startsWith(definitionIndent)
    ? `${instanceIndent}${line.slice(definitionIndent.length)}`
    : `${instanceIndent}${DSL_INDENT}${line}`
);

const replacementFor = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  target: InlineModuleTargetIdentity,
  statementIndex: number,
  statement: Extract<DslStatement, { kind: "moduleInstance" }>,
  instance: ModuleInstanceSemantic,
  definition: ModuleDefinitionSemantic,
  activity: Activity
): { splice: LineSplice; result: InlineModuleInlinedTarget } | InlineModuleRejection => {
  const statementInfo = compiled.statementMap?.statements[statementIndex];
  if (!statementInfo || statementInfo.sourceRevision !== compiled.spans.sourceMap.sourceRevision) {
    return reject("unsafe-source-span", "Inline target の exact-current statement range を解決できません。", target);
  }
  const body = bodyRangeForDefinition(source, starts, compiled, definition);
  if (!body) {
    return reject("unsafe-source-span", "Module body の exact-current source range を解決できません。", target);
  }
  const exportReplacements = exportedTokenReplacements(source, compiled, definition, body.from, body.to);
  if (!exportReplacements) {
    return reject("unsafe-source-span", "Module export marker の exact-current source span を解決できません。", target);
  }
  const bodyText = body.bodyLines.length === 0
    ? ""
    : applyAbsoluteReplacements(source, body.from, body.to, exportReplacements);
  if (bodyText === null) {
    return reject("unsafe-rewrite", "Module body の export rewrite が重複しています。", target);
  }

  const instanceLine = compiled.sourceLines[statementInfo.line - 1] ?? "";
  const instanceIndent = leadingWhitespace(instanceLine);
  const rewrittenBodyLines = bodyText.length === 0
    ? []
    : rebaseBodyLines(bodyText.split("\n"), body.definitionIndent, instanceIndent);
  const activityText = activity === "visible" ? "" : `(state: ${activity})`;
  const replacementLines = [
    `${instanceIndent}group ${formatDslName(statement.name)}${activityText} {`,
    ...rewrittenBodyLines,
    `${instanceIndent}}`
  ];

  return {
    splice: {
      startLine: statementInfo.range.startLine,
      endLine: statementInfo.range.endLine,
      replacementLines
    },
    result: {
      status: "inlined",
      target,
      statementIndex,
      instanceName: statement.name,
      moduleDefinitionStatementId: instance.callee!.definitionStatementId,
      activity,
      generatedGroupName: statement.name,
      sourceRange: {
        startLine: statementInfo.range.startLine,
        endLine: statementInfo.range.endLine
      }
    }
  };
};

/**
 * Host-neutral Inline Module planner.
 *
 * The first implementation slice intentionally handles the closed, parameterless
 * case only. Parameter lowering and optional specialization are separate semantic
 * steps and therefore return structured known-ineligible skips here rather than
 * guessing from source order or evaluated values.
 */
export const planInlineModule = (input: InlineModulePlanInput): InlineModulePlanResult => {
  const { source: snapshot, compiled, policy } = input;
  const statementMap = compiled.statementMap;
  const analysis = semanticAnalysisFor(compiled);
  const source = snapshot.normalizedSource;
  if (
    !statementMap ||
    !analysis ||
    !compiled.sourceLexicalNamespace ||
    snapshot.sourceRevision !== statementMap.sourceRevision ||
    snapshot.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    source !== compiled.spans.sourceMap.source ||
    !cleanCompile(compiled)
  ) {
    return reject(
      "stale-semantic-snapshot",
      "Inline Module には error-free な exact-current source/semantic snapshot が必要です。"
    );
  }

  const deduplicated = new Map<string, InlineModuleTargetIdentity>();
  for (const target of input.targets) {
    const key = `${target.documentKey ?? "<local>"}\u0000${target.statementId}`;
    if (!deduplicated.has(key)) deduplicated.set(key, target);
  }

  const resolved = [...deduplicated.values()].map((target) => {
    if (target.documentKey !== null) return { target, statementIndex: null };
    const statementIndex = statementMap.statementIndexByStatementId?.get(target.statementId) ?? null;
    return { target, statementIndex };
  });
  const missingLocal = resolved.find((entry) => entry.target.documentKey === null && entry.statementIndex === null);
  if (missingLocal) {
    return reject("invalid-target", "Inline target が current authored source statement として解決できません。", missingLocal.target);
  }
  resolved.sort((left, right) => {
    if (left.statementIndex === null && right.statementIndex === null) return left.target.statementId.localeCompare(right.target.statementId);
    if (left.statementIndex === null) return 1;
    if (right.statementIndex === null) return -1;
    return left.statementIndex - right.statementIndex;
  });

  const starts = lineStarts(source);
  const results: InlineModuleTargetResult[] = [];
  const splices: LineSplice[] = [];

  for (const entry of resolved) {
    const { target, statementIndex } = entry;
    if (target.documentKey !== null) {
      results.push(skip(target, statementIndex, null, "non-local-target", "Imported / multi-document Inline は v1 の対象外です。"));
      continue;
    }
    if (statementIndex === null) {
      return reject("invalid-target", "Inline target が current authored source statement として解決できません。", target);
    }
    const statement = compiled.statements[statementIndex];
    if (!statement || statement.kind !== "moduleInstance") {
      results.push(skip(target, statementIndex, statement?.name ?? null, "not-module-instance", "対象 statement は Module instance ではありません。"));
      continue;
    }
    const instance = analysis.instancesByStatementId.get(target.statementId);
    if (!instance?.callee || instance.calleeResolution !== "resolved") {
      results.push(skip(target, statementIndex, statement.name, "unresolved-callee", "local Module definition を一意に解決できません。"));
      continue;
    }
    const definition = analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) {
      return reject("unsafe-rewrite", "Resolved Module definition の semantic owner が見つかりません。", target);
    }
    const activity = instanceActivity(statement);
    if (activity === "hidden" && !policy.includeHiddenInstances) {
      results.push(skip(target, statementIndex, statement.name, "hidden-excluded", "hidden instance は現在の policy で除外されています。"));
      continue;
    }
    if (activity === "disabled" && !policy.includeDisabledInstances) {
      results.push(skip(target, statementIndex, statement.name, "disabled-excluded", "disabled instance は現在の policy で除外されています。"));
      continue;
    }
    if (definition.parameters.length > 0 || instance.parameterBindings.length > 0) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "parameter-lowering-required",
        "この初期 slice では parameter lowering を未実装のため parameterized Module を安全側で除外します。"
      ));
      continue;
    }
    if (hasDirectNestedModuleConstruct(compiled, definition)) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "nested-module-validation-required",
        "この初期 slice では nested Module の resolution-preservation 検証を未実装のため安全側で除外します。"
      ));
      continue;
    }

    const replacement = replacementFor(
      source,
      starts,
      compiled,
      target,
      statementIndex,
      statement,
      instance,
      definition,
      activity
    );
    if ("status" in replacement && replacement.status === "rejected") return replacement;
    splices.push(replacement.splice);
    results.push(replacement.result);
  }

  splices.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }

  if (splices.length > 0) {
    const nextRevision = snapshot.sourceRevision + 1;
    const parsed = parseDslSnapshot({ normalizedSource: candidateSource, sourceRevision: nextRevision });
    const reconciled = reconcileStatements({
      oldStatements: compiled.statements,
      oldLines: compiled.sourceLines,
      oldElementIds: statementMap.elementIdByStatementIndex,
      oldStatementIds: statementMap.statementIdByStatementIndex,
      newStatements: parsed.statements,
      newLines: candidateSource.split("\n")
    });
    const nextCompiled = compileDslDocument(candidateSource, {
      preparsed: parsed,
      sourceRevision: nextRevision,
      assignedElementIds: reconciled.assignedIds,
      assignedStatementIds: reconciled.assignedIds
    });
    if (!nextCompiled.statementMap || !nextCompiled.sourceLexicalNamespace || !cleanCompile(nextCompiled)) {
      const diagnostic = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
        .find((candidate) => candidate.severity === "error");
      return reject("unsafe-rewrite", diagnostic?.message ?? "Inline 後の source semantics を安全に再コンパイルできません。");
    }
  }

  return {
    status: "planned",
    sourceRevision: snapshot.sourceRevision,
    targets: results,
    splices
  };
};
