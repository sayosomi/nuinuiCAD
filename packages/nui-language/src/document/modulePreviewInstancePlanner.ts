import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { dslScopeBeforeParsedLine, parseDslSnapshot } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import { resolveModuleLexicalDeclaration } from "../dsl/moduleLexicalResolution";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type ModulePreviewInstanceArgument = {
  name: string;
  /** Source text is intentionally kept verbatim by the caller and planner. */
  expression: string;
};

export type ModulePreviewInstancePlanInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  insertionOffset: number;
  target: {
    statementId: StatementIdentity;
    statementIndex: number;
    name: string;
  };
  explicitArguments: readonly ModulePreviewInstanceArgument[];
};

export type ModulePreviewInstancePlan = {
  status: "planned";
  sourceRevision: number;
  instanceName: string;
  splice: LineSplice;
  insertedNameRange: { from: number; to: number };
  expectedPatchedSource: string;
};

export type ModulePreviewInstancePlanRejectionReason =
  | "incomplete-source"
  | "invalid-caret"
  | "target-not-exact-current"
  | "target-semantic-definition-missing"
  | "invalid-explicit-argument"
  | "illegal-statement-boundary"
  | "unknown-lexical-scope"
  | "statement-identities-missing"
  | "target-not-visible"
  | "undeclared-argument"
  | "splice-rejected"
  | "candidate-invalid";

export type ModulePreviewInstancePlanResult =
  | ModulePreviewInstancePlan
  | {
      status: "rejected";
      code:
        | "invalid-source"
        | "invalid-caret"
        | "illegal-boundary"
        | "target-unavailable"
        | "target-not-visible"
        | "invalid-argument"
        | "candidate-invalid";
      reason: ModulePreviewInstancePlanRejectionReason;
      message: string;
    };

const rejected = (
  code: Extract<ModulePreviewInstancePlanResult, { status: "rejected" }>["code"],
  reason: ModulePreviewInstancePlanRejectionReason,
  message: string
): ModulePreviewInstancePlanResult => ({ status: "rejected", code, reason, message });

const isStructuralStatement = (statement: DslStatement): boolean =>
  statement.kind === "blockEnd" || statement.kind === "blockElse";

const lineCountFor = (source: string): number => source.split("\n").length;

const lineForOffset = (source: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source[index] === "\n") line += 1;
  return line;
};

const lineStartOffset = (source: string, line: number): number => {
  if (line <= 1) return 0;
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
    currentLine += 1;
  }
  return offset;
};

const lineIndent = (sourceLines: readonly string[], line: number): string =>
  sourceLines[line - 1]?.match(/^\s*/)?.[0] ?? "";

const statementInfoFor = (compiled: CompiledDslDocument, statementIndex: number) =>
  compiled.statementMap?.statements.find((candidate) => candidate.statementIndex === statementIndex) ?? null;

const insertionBoundaryFor = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  insertionOffset: number
): { insertionLine: number; nextStatementIndex: number } | null => {
  if (!compiled.statementMap) return null;
  const caretLine = lineForOffset(source.normalizedSource, insertionOffset);
  const statements = compiled.statements
    .map((statement, statementIndex) => ({ statement, statementIndex, info: statementInfoFor(compiled, statementIndex) }))
    .filter((candidate): candidate is typeof candidate & { info: NonNullable<typeof candidate.info> } => candidate.info !== null)
    .sort((left, right) => left.info.range.startLine - right.info.range.startLine);

  const containing = statements
    .filter(({ info }) => info.range.startLine <= caretLine && caretLine <= info.range.endLine)
    .sort((left, right) =>
      (left.info.range.endLine - left.info.range.startLine) -
      (right.info.range.endLine - right.info.range.startLine)
    )[0];
  if (containing) {
    if (isStructuralStatement(containing.statement)) {
      return { insertionLine: containing.info.range.startLine, nextStatementIndex: containing.statementIndex };
    }
    const insertionLine = containing.info.range.endLine + 1;
    return {
      insertionLine,
      nextStatementIndex: statements.find((candidate) => candidate.info.range.startLine >= insertionLine)?.statementIndex ?? compiled.statements.length
    };
  }

  const next = statements.find((candidate) => candidate.info.range.startLine > caretLine);
  if (next) return { insertionLine: next.info.range.startLine, nextStatementIndex: next.statementIndex };
  const insertionLine = source.normalizedSource.endsWith("\n")
    ? lineCountFor(source.normalizedSource)
    : lineCountFor(source.normalizedSource) + 1;
  return { insertionLine, nextStatementIndex: compiled.statements.length };
};

const lexicalScopeIdFor = (
  parsed: ReturnType<typeof parseDslSnapshot>,
  compiled: CompiledDslDocument,
  insertionLine: number
): string | null => {
  const frame = dslScopeBeforeParsedLine(parsed, insertionLine);
  const namespace = compiled.sourceLexicalNamespace;
  const statementIds = compiled.statementMap?.statementIdByStatementIndex;
  if (!namespace || !statementIds) return null;
  if (!frame) return namespace.scopeIndex.rootScopeId;
  const opener = parsed.statements[frame.statementIndex];
  const statementId = statementIds.get(frame.statementIndex);
  if (!opener || !statementId) return null;
  const scopeId = opener.kind === "moduleDefinition"
    ? `module:${statementId}`
    : opener.kind === "group"
      ? `group:${statementId}`
      : opener.kind === "layout"
        ? `layout:${statementId}`
        : opener.kind === "element" && opener.type === "forGroup"
          ? `for:${statementId}`
          : opener.kind === "element" && opener.type === "conditionalGroup"
            ? `if:${statementId}:${frame.branch}`
            : namespace.scopeIndex.scopeOfStatement.get(frame.statementIndex) ?? null;
  if (!scopeId) return null;
  return namespace.scopeIndex.scopes.has(scopeId) ? scopeId : null;
};

const indentationFor = (
  sourceLines: readonly string[],
  compiled: CompiledDslDocument,
  scopeId: string
): string => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return "";
  const candidates = compiled.statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter(({ statement, statementIndex }) =>
      !isStructuralStatement(statement) && namespace.scopeIndex.scopeOfStatement.get(statementIndex) === scopeId
    );
  const nearest = candidates.at(-1);
  if (nearest) return lineIndent(sourceLines, nearest.statement.line);
  const openingStatementIndex = namespace.scopeIndex.scopes.get(scopeId)?.openingStatementIndex;
  if (openingStatementIndex === null || openingStatementIndex === undefined) return "";
  return lineIndent(sourceLines, compiled.statements[openingStatementIndex]?.line ?? 1) + DSL_INDENT;
};

const uniqueInstanceNameFor = (
  compiled: CompiledDslDocument,
  scopeId: string,
  targetName: string,
  sourceOrderIndex: number
): string => {
  const namespace = compiled.sourceLexicalNamespace!;
  const statementIds = compiled.statementMap?.statementIdByStatementIndex;
  const owner = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.bodyScopeId === scopeId);
  const parameterOverlays = owner ? [{
    bodyScopeId: owner.bodyScopeId,
    value: owner,
    parameters: owner.parameters.map((parameter) => ({
      index: parameter.parameterIndex,
      name: parameter.name,
      value: parameter
    }))
  }] : undefined;
  const nameIsTaken = (name: string): boolean => {
    if (namespace.declarationsByScopeAndName.get(scopeId)?.has(name)) return true;
    if (!statementIds) return false;
    const lookup = resolveModuleLexicalDeclaration(
      { sourceNamespace: namespace, stableStatementIdByIndex: statementIds, parameterOverlays },
      sourceOrderIndex,
      name,
      { scopeId, sourceOrderIndex }
    );
    return lookup.kind === "parameter" || lookup.kind === "iteration";
  };
  const base = `${targetName}Instance`;
  if (!nameIsTaken(base)) return base;
  let suffix = 2;
  while (nameIsTaken(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
};

const candidateDiagnosticOnLine = (compiled: CompiledDslDocument, line: number): boolean =>
  compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === line) ||
  Boolean(compiled.moduleSemanticAnalysis?.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === line));

const validateCandidate = (
  input: ModulePreviewInstancePlanInput,
  insertionLine: number,
  instanceName: string,
  expectedPatchedSource: string,
  targetDefinitionParameters: readonly { name: string }[]
): boolean => {
  const parsed = parseDslSnapshot({
    normalizedSource: expectedPatchedSource,
    sourceRevision: input.source.sourceRevision + 1
  });
  const statementMap = input.compiled.statementMap;
  if (!statementMap) return false;
  const reconciliation = reconcileStatements({
    oldStatements: input.compiled.statements,
    oldLines: input.compiled.sourceLines,
    oldElementIds: statementMap.elementIdByStatementIndex,
    oldStatementIds: statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: expectedPatchedSource.split("\n")
  });
  const candidate = compileDslDocument(expectedPatchedSource, {
    preparsed: parsed,
    sourceRevision: input.source.sourceRevision + 1,
    assignedStatementIds: reconciliation.assignedIds
  });
  if (candidateDiagnosticOnLine(candidate, insertionLine)) return false;
  const candidateTarget = candidate.moduleSemanticAnalysis?.definitionsByStatementId.get(input.target.statementId);
  if (!candidateTarget || candidateTarget.name !== input.target.name) return false;
  const insertedIndex = candidate.statements.findIndex((statement) =>
    statement.kind === "moduleInstance" && statement.name === instanceName && statement.line === insertionLine
  );
  if (insertedIndex < 0) return false;
  const insertedId = reconciliation.createdIds.get(insertedIndex);
  if (!insertedId) return false;
  const inserted = candidate.moduleSemanticAnalysis?.instancesByStatementId.get(insertedId);
  if (!inserted || inserted.calleeResolution !== "resolved" || inserted.callee?.definitionStatementId !== input.target.statementId) return false;
  if (inserted.parameterBindings.some((binding) => binding.state === "supplied" && binding.value === null)) return false;
  const expectedNames = new Set(targetDefinitionParameters.map((parameter) => parameter.name));
  return input.explicitArguments.every((argument) => expectedNames.has(argument.name));
};

export const planModulePreviewInstance = (
  input: ModulePreviewInstancePlanInput
): ModulePreviewInstancePlanResult => {
  const { source, compiled } = input;
  if (
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    !compiled.statementMap ||
    !compiled.sourceLexicalNamespace ||
    !compiled.moduleSemanticAnalysis
  ) return rejected("invalid-source", "incomplete-source", "The current source has no complete Module semantic snapshot.");
  if (!Number.isInteger(input.insertionOffset) || input.insertionOffset < 0 || input.insertionOffset > source.normalizedSource.length) {
    return rejected("invalid-caret", "invalid-caret", "The current Source editor caret is outside the current source.");
  }
  const target = compiled.statements[input.target.statementIndex];
  if (!target || target.kind !== "moduleDefinition" || target.name !== input.target.name ||
      compiled.statementMap.statementIdByStatementIndex?.get(input.target.statementIndex) !== input.target.statementId) {
    return rejected("target-unavailable", "target-not-exact-current", "The Module Preview target is no longer the exact current Module definition.");
  }
  if (!compiled.moduleSemanticAnalysis.definitionsByStatementId.has(input.target.statementId)) {
    return rejected("target-unavailable", "target-semantic-definition-missing", "The Module Preview target has no current Module semantic definition.");
  }
  const duplicateArguments = new Set<string>();
  for (const argument of input.explicitArguments) {
    if (!argument.name || duplicateArguments.has(argument.name) || argument.expression.length === 0 || /[\r\n]/.test(argument.expression)) {
      return rejected("invalid-argument", "invalid-explicit-argument", "Module Preview contains an invalid or multiline explicit argument.");
    }
    duplicateArguments.add(argument.name);
  }
  const boundary = insertionBoundaryFor(source, compiled, input.insertionOffset);
  if (!boundary) return rejected("illegal-boundary", "illegal-statement-boundary", "The current caret is not at a legal whole-statement insertion boundary.");
  const parsed = parseDslSnapshot(source);
  const scopeId = lexicalScopeIdFor(parsed, compiled, boundary.insertionLine);
  if (!scopeId) return rejected("illegal-boundary", "unknown-lexical-scope", "The current caret is not inside a known lexical scope.");
  const statementIds = compiled.statementMap.statementIdByStatementIndex;
  if (!statementIds) return rejected("invalid-source", "statement-identities-missing", "The current source has no stable statement identities.");
  const lookup = resolveModuleLexicalDeclaration(
    {
      sourceNamespace: compiled.sourceLexicalNamespace,
      stableStatementIdByIndex: statementIds
    },
    boundary.nextStatementIndex,
    input.target.name,
    { scopeId, sourceOrderIndex: boundary.nextStatementIndex }
  );
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "moduleDefinition" || lookup.declaration.statementId !== input.target.statementId) {
    return rejected("target-not-visible", "target-not-visible", "The target Module is not visible at the current source insertion position.");
  }
  const sourceLines = source.normalizedSource.split("\n");
  const indent = indentationFor(sourceLines, compiled, scopeId);
  const instanceName = uniqueInstanceNameFor(compiled, scopeId, input.target.name, boundary.nextStatementIndex);
  const targetParameters = target.parameters.map((parameter) => ({ name: parameter.name }));
  if (input.explicitArguments.some((argument) => !targetParameters.some((parameter) => parameter.name === argument.name))) {
    return rejected("invalid-argument", "undeclared-argument", "Module Preview contains an argument that is not declared by the target Module.");
  }
  const callArguments = input.explicitArguments
    .map((argument) => `${formatDslName(argument.name)}: ${argument.expression}`)
    .join(", ");
  const statement = `instance ${formatDslName(instanceName)} = ${formatDslName(input.target.name)}(${callArguments})`;
  const splice: LineSplice = {
    startLine: boundary.insertionLine,
    endLine: boundary.insertionLine - 1,
    replacementLines: [`${indent}${statement}`]
  };
  let expectedPatchedSource: string;
  try {
    expectedPatchedSource = applyLineSplices(source.normalizedSource, [splice]);
  } catch {
    return rejected("illegal-boundary", "splice-rejected", "The current source cannot accept the planned Module instance insertion.");
  }
  if (!validateCandidate(input, boundary.insertionLine, instanceName, expectedPatchedSource, targetParameters)) {
    return rejected("candidate-invalid", "candidate-invalid", "The generated Module instance did not pass current semantic validation.");
  }
  const nameStart = lineStartOffset(expectedPatchedSource, boundary.insertionLine) + indent.length + "instance ".length;
  return {
    status: "planned",
    sourceRevision: source.sourceRevision,
    instanceName,
    splice,
    insertedNameRange: { from: nameStart, to: nameStart + instanceName.length },
    expectedPatchedSource
  };
};
