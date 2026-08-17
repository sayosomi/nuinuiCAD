import { dslModuleParameterTypeNames, dslTypedDeclarationTypeNames } from "./dslDeclarationParser";
import { argumentCompletionCandidates, constructionCompletionCandidates } from "./dslCallCompletionCandidates";
import { dslCompletionContextAt, type DslCompletionContext } from "./dslCompletionContext";
import { dslStatementElementType } from "./dslCompletionMetadata";
import {
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type SourceRevision,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { parseDslReferenceToken, type DslReferencePath } from "./dslReferenceTokens";
import {
  resolveSourceLexicalPath,
  resolveSourceLexicalDeclaration,
  sourceNamespaceScopeIdForDeclaration
} from "./sourceLexicalNamespaceIndex";
import { moduleCompletionCandidates, type ModuleCompletionCandidate } from "./moduleCompletionCandidates";
import type { CompiledDslDocument } from "./dslDocument";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import {
  scalarExpressionCandidates,
  scalarFunctionCandidates,
  scalarLiteralCandidates,
  scalarPrefixOperatorCandidates,
  templateHoleScalarCandidates,
  typedBindingReferenceCandidates,
  type ScalarCompletionCandidate
} from "../scalars/typedValueCandidates";
import { formatBuiltinFunctionSignatures, getBuiltinFunctionDefinition } from "../scalars/builtinFunctions";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import type { ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";
import { setRhsScalarCandidates, setTargetCandidates, type SetCompletionSiteDeps } from "../scalars/setCompletionCandidates";
import { NUMERIC_COMPUTED_GEOMETRY_PROPERTIES } from "../geometry/numericExpressions";
import { isLineLikeElement, isPointElement } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";

export type DslCompletionCandidateKind =
  | "keyword"
  | "type"
  | "construction"
  | "argumentName"
  | "binding"
  | "geometry"
  | "module"
  | "property"
  | "builtin"
  | "literal"
  | "operator";

/** Host-neutral semantic completion data. `label` is a semantic name or
 * spelling; adapters decide whether to add `@`, `: `, `(`, or any other host
 * insertion behavior. */
export type DslCompletionCandidate = {
  kind: DslCompletionCandidateKind;
  label: string;
  detail?: string;
  identity?: string;
};

export type DslCompletionRange = { from: number; to: number };

export type DslCompletionSemanticSnapshot = {
  /** Source revision that produced this source-semantic snapshot. */
  sourceRevision: SourceRevision;
  /** Optional exact source proof. When omitted, compiled.spans.sourceMap.source
   * is used when a compiled snapshot is supplied. */
  sourceText?: string;
  /** Source semantics only. Runtime evaluation fields are neither required nor
   * read by this query. */
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslCompletionQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslCompletionSemanticSnapshot;
};

export type DslCompletionQueryResult = {
  /** Full production context classifier result, kept as plain domain data. */
  context: Exclude<DslCompletionContext, null>;
  category: Exclude<DslCompletionContext, null>["kind"];
  replacementRange: DslCompletionRange;
  candidates: readonly DslCompletionCandidate[];
};

type LogicalInput = {
  lineText: string;
  localPosition: number;
  lineStart: number;
  lineNumber: number;
  map: ReturnType<typeof createLogicalStatementSourceMap>;
  statement: ReturnType<typeof createLogicalStatementSourceMap>["statements"][number] | null;
};

const lineNumberAt = (source: string, position: number) => {
  let line = 1;
  for (let index = 0; index < Math.min(position, source.length); index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
};

const logicalInputAt = (snapshot: SourceSnapshot, position: number): LogicalInput => {
  const map = createLogicalStatementSourceMap(snapshot);
  const lineNumber = lineNumberAt(snapshot.normalizedSource, position);
  const lineStart = snapshot.normalizedSource.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEnd = snapshot.normalizedSource.indexOf("\n", position);
  const physicalLine = snapshot.normalizedSource.slice(lineStart, lineEnd < 0 ? snapshot.normalizedSource.length : lineEnd);
  const statement = map.statements.find((candidate) => position >= candidate.range.from && position <= candidate.range.to) ?? null;
  const localPosition = statement ? physicalToLogicalOffset(map, statement, position) : null;
  return statement && localPosition !== null
    ? { lineText: statement.logicalText, localPosition, lineStart, lineNumber, map, statement }
    : { lineText: physicalLine, localPosition: position - lineStart, lineStart, lineNumber, map, statement: null };
};

const semanticSourceText = (semantic: DslCompletionSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslCompletionSemanticSnapshot | undefined) =>
  Boolean(
    semantic &&
    semantic.sourceRevision === source.sourceRevision &&
    semanticSourceText(semantic) === source.normalizedSource
  );

const currentStatementIndex = (compiled: CompiledDslDocument, position: number): number =>
  compiled.statements.findIndex((statement) =>
    position >= statement.documentRange.from && position <= statement.documentRange.to
  );

const statementIndexFor = (
  compiled: CompiledDslDocument | undefined,
  position: number,
  exact: boolean
) => {
  if (compiled && exact) {
    const index = currentStatementIndex(compiled, position);
    if (index >= 0) return index;
  }
  return -1;
};

const exactScopeIdFor = (analysis: BindingAnalysis | undefined, statementIndex: number) =>
  analysis?.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? analysis?.catalog.scopeIndex.rootScopeId;

const bindingAnalysisFor = (
  semantic: DslCompletionSemanticSnapshot | undefined,
  compiled: CompiledDslDocument | undefined,
  exact: boolean,
  statementIndex: number
) => {
  const analysis = semantic?.bindingAnalysis ?? compiled?.bindingAnalysis;
  if (!analysis || !semantic || !exact) return null;
  const scopeId = exactScopeIdFor(analysis, statementIndex);
  return scopeId ? { analysis, site: { scopeId, statementIndex } } : { analysis, site: undefined };
};

const scalarCandidate = (candidate: ScalarCompletionCandidate): DslCompletionCandidate => {
  if (candidate.kind === "argumentName") return { kind: "argumentName", label: candidate.label };
  if (candidate.kind === "literal") return { kind: "literal", label: candidate.label };
  if (candidate.kind === "operator") return { kind: "operator", label: candidate.label };
  if (candidate.kind === "reference") return { kind: "binding", label: candidate.name, identity: candidate.bindingId };
  const definition = getBuiltinFunctionDefinition(candidate.name);
  return {
    kind: "builtin",
    label: candidate.name,
    identity: candidate.name,
    ...(definition ? { detail: formatBuiltinFunctionSignatures(definition) } : {})
  };
};

const moduleCandidate = (candidate: ModuleCompletionCandidate): DslCompletionCandidate => ({
  kind: candidate.kind,
  label: candidate.label,
  ...(candidate.detail ? { detail: candidate.detail } : {}),
  ...(candidate.identity ? { identity: candidate.identity } : {})
});

const uniqueCandidates = (candidates: readonly DslCompletionCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}\u0000${candidate.identity ?? candidate.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const scalarFallbackCandidates = (context: ScalarExpressionCompletionContext): DslCompletionCandidate[] => {
  if (context.kind === "argumentName") return context.names.map((label) => ({ kind: "argumentName", label }));
  if (context.kind !== "operand" || !context.expectedType) return [];
  if (context.referenceOnly) return [];
  return [
    ...scalarFunctionCandidates(context.expectedType).map(scalarCandidate),
    ...(context.expectedType.kind === "number"
      ? [{ kind: "literal" as const, label: "0" }, { kind: "literal" as const, label: "1" }]
      : context.expectedType.kind === "string"
        ? [{ kind: "literal" as const, label: '""' }]
        : []),
    ...scalarLiteralCandidates(context.expectedType).map((candidate) => ({ kind: "literal" as const, label: candidate.label })),
    ...(!context.literalOnly
      ? scalarPrefixOperatorCandidates(context.expectedType).map((candidate) => ({ kind: "operator" as const, label: candidate.label }))
      : [])
  ];
};

const sourceGeometryDeclarations = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  kind: "point" | "line" | "lineEndpointReference" | "lineReference" | "lineReferenceList"
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || statementIndex < 0) return [];
  const candidates: DslCompletionCandidate[] = [];
  for (const declaration of namespace.allDeclarations) {
    if (declaration.kind !== "geometry" || declaration.statementIndex >= statementIndex) continue;
    const lookup = resolveSourceLexicalDeclaration(namespace, statementIndex, declaration.name);
    if (lookup.kind !== "resolved" || lookup.declaration.statementId !== declaration.statementId) continue;
    const elementType = dslStatementElementType(declaration.statement);
    if (!elementType) continue;
    const element = { type: elementType } as CadElement;
    if (kind === "lineReference" || kind === "lineReferenceList") {
      if (isLineLikeElement(element)) candidates.push({ kind: "geometry", label: declaration.name, identity: declaration.statementId });
      continue;
    }
    if (kind === "point" && isPointElement(element)) {
      candidates.push({ kind: "geometry", label: declaration.name, identity: declaration.statementId });
      continue;
    }
    if (kind === "line" && isLineLikeElement(element)) {
      candidates.push({ kind: "geometry", label: declaration.name, identity: declaration.statementId });
      continue;
    }
    if (kind === "lineEndpointReference" && isLineLikeElement(element)) {
      candidates.push(
        { kind: "geometry", label: `${declaration.name}.start`, identity: `${declaration.statementId}:start` },
        { kind: "geometry", label: `${declaration.name}.end`, identity: `${declaration.statementId}:end` }
      );
    }
  }
  return candidates;
};

const sourceGeometryQualifiedMembers = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  qualifier: string
): DslCompletionCandidate[] | null => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || statementIndex < 0) return null;
  const qualifierPath = parseDslReferenceToken(qualifier);
  const container = resolveSourceLexicalPath(namespace, statementIndex, qualifierPath);
  if (container.kind !== "resolved") return null;
  const scopeId = sourceNamespaceScopeIdForDeclaration(container.declaration);
  if (!scopeId) return null;
  const members = namespace.declarationsByScope.get(scopeId) ?? [];
  return members
    .filter((declaration) => declaration.kind === "geometry" && declaration.statementIndex < statementIndex)
    .filter((declaration) => {
      const memberPath: DslReferencePath = {
        absolute: qualifierPath.absolute,
        segments: [...qualifierPath.segments, declaration.name]
      };
      const lookup = resolveSourceLexicalPath(namespace, statementIndex, memberPath);
      return lookup.kind === "resolved" && lookup.declaration.statementId === declaration.statementId;
    })
    .map((declaration) => ({ kind: "geometry" as const, label: declaration.name, identity: declaration.statementId }));
};

const sourceGeometryPropertyCandidates = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  elementToken: string
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || statementIndex < 0) return [];
  const lookup = resolveSourceLexicalPath(namespace, statementIndex, parseDslReferenceToken(elementToken));
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "geometry") return [];
  const elementType = dslStatementElementType(lookup.declaration.statement);
  if (!elementType) return [];
  return NUMERIC_COMPUTED_GEOMETRY_PROPERTIES.map((label) => ({
    kind: "property" as const,
    label,
    identity: `${lookup.declaration.statementId}:${label}`
  }));
};

const scalarCandidatesAt = (
  context: Exclude<DslCompletionContext, null>,
  input: LogicalInput,
  semantic: DslCompletionSemanticSnapshot | undefined,
  compiled: CompiledDslDocument | undefined,
  exact: boolean,
  statementIndex: number
) => {
  const analysisInfo = bindingAnalysisFor(semantic, compiled, exact, statementIndex);
  const deps = analysisInfo?.analysis;
  const bindingDeps = deps
    ? {
        catalog: deps.catalog,
        entriesById: deps.entriesById,
        ...(analysisInfo.site ? { site: analysisInfo.site } : {}),
        includeOperators: true
      }
    : null;

  const candidatesForPosition = (positionContext: ScalarExpressionCompletionContext) => {
    const candidates = bindingDeps
      ? scalarExpressionCandidates(positionContext, bindingDeps).map(scalarCandidate)
      : scalarFallbackCandidates(positionContext);
    if (
      positionContext.kind !== "operand" ||
      positionContext.referenceOnly ||
      positionContext.literalOnly ||
      !positionContext.expectedType
    ) return candidates;
    const literalLabels = new Set(candidates.filter((candidate) => candidate.kind === "literal").map((candidate) => candidate.label));
    const standardLiterals = positionContext.expectedType.kind === "number"
      ? ["0", "1"]
      : positionContext.expectedType.kind === "string"
        ? ['""']
        : [];
    return [
      ...candidates,
      ...standardLiterals
        .filter((label) => !literalLabels.has(label))
        .map((label) => ({ kind: "literal" as const, label }))
    ];
  };

  if (context.kind === "typedInitializer" || context.kind === "conditionExpression") {
    return candidatesForPosition(context.positionContext);
  }
  if (context.kind === "propertyScalarValue") {
    if (context.propertyContext.kind === "expression") return candidatesForPosition(context.propertyContext.positionContext);
    if (context.propertyContext.kind === "booleanLiteral") {
      return [
        ...scalarFunctionCandidates({ kind: "boolean" }).map(scalarCandidate),
        ...scalarLiteralCandidates({ kind: "boolean" }).map((candidate) => ({ kind: "literal" as const, label: candidate.label }))
      ];
    }
    if (!bindingDeps) return [];
    if (context.propertyContext.kind !== "reference") return [];
    const expectedType = context.propertyContext.expectedType;
    return typedBindingReferenceCandidates({
      ...bindingDeps,
      accepts: (type) => type !== null && isScalarTypeAssignable(type, expectedType)
    }).map((candidate) => ({ kind: "binding" as const, label: candidate.name, identity: candidate.bindingId }));
  }
  if (context.kind === "templateHole") {
    if (!bindingDeps) return [];
    return templateHoleScalarCandidates(input.lineText, context.contentSpan, input.localPosition, bindingDeps).map(scalarCandidate);
  }
  return [];
};

const setSiteDeps = (
  analysis: BindingAnalysis,
  position: number,
  statementIndex: number,
  exact: boolean,
  compiled: CompiledDslDocument | undefined
): SetCompletionSiteDeps | null => {
  if (!exact) return null;
  const containingScopeId = exactScopeIdFor(analysis, statementIndex);
  if (!containingScopeId) return null;
  return {
    catalog: analysis.catalog,
    entriesById: analysis.entriesById,
    containingScopeId,
    cursorPosition: position,
    livePositionOf: (bindingId) => {
      if (!compiled) return undefined;
      const binding = analysis.catalog.bindingsById.get(bindingId);
      const statement = binding ? compiled.statements[binding.statementIndex] : undefined;
      return statement?.namePhysicalSpan?.segments.length === 1
        ? statement.namePhysicalSpan.segments[0].from
        : undefined;
    }
  };
};

const moduleCandidatesAt = (
  context: Exclude<DslCompletionContext, null>,
  input: LogicalInput,
  position: number,
  semantic: DslCompletionSemanticSnapshot | undefined,
  compiled: CompiledDslDocument | undefined,
  exact: boolean,
  statementIndex: number
) => {
  if (context.kind === "moduleQualifiedMember" && compiled && exact) {
    const sourceCandidates = sourceGeometryQualifiedMembers(compiled, statementIndex, context.qualifiedInstanceName);
    if (sourceCandidates !== null) return sourceCandidates;
  }
  if (!compiled || !semantic || !exact || (context.kind !== "moduleCallee" && !compiled.moduleSemanticAnalysis)) return [];
  const moduleKind = context.kind === "moduleCallee"
    ? "callee"
    : context.kind === "moduleArgumentLabel"
      ? "label"
      : context.kind === "moduleArgumentValue"
        ? "value"
        : context.kind === "moduleQualifiedMember"
          ? "qualifiedMember"
          : "reference";
  return moduleCompletionCandidates({
    compiled,
    cursorPosition: position,
    kind: moduleKind,
    sourceText: sourceTextForLogicalInput(input),
    logicalCursorPosition: input.localPosition,
    liveStatementText: input.lineText,
    ...(statementIndex >= 0 ? { statementIndex } : {}),
    ...(context.kind === "moduleArgumentLabel" || context.kind === "moduleArgumentValue" || context.kind === "moduleQualifiedMember"
      ? { argumentIndex: context.argumentIndex }
      : {}),
    ...(context.kind === "moduleArgumentValue" ? { argumentValueSpan: { start: context.from, end: context.to } } : {}),
    ...(context.kind === "moduleQualifiedMember" ? {
      qualifiedInstanceName: context.qualifiedInstanceName,
      ...(context.expectedScalarType ? { expectedScalarType: context.expectedScalarType } : {})
    } : {})
  }).map(moduleCandidate);
};

const sourceTextForLogicalInput = (
  input: LogicalInput
) => input.map.source;

const moduleBodyReferenceCandidates = (
  input: LogicalInput,
  position: number,
  semantic: DslCompletionSemanticSnapshot | undefined,
  compiled: CompiledDslDocument | undefined,
  exact: boolean,
  statementIndex: number,
  expectedType: ScalarType | null
) => {
  if (!compiled || !semantic || !exact || !compiled.moduleSemanticAnalysis) return [];
  return moduleCompletionCandidates({
    compiled,
    cursorPosition: position,
    kind: "reference",
    sourceText: sourceTextForLogicalInput(input),
    logicalCursorPosition: input.localPosition,
    liveStatementText: input.lineText,
    expectedScalarType: expectedType,
    ...(statementIndex >= 0 ? { statementIndex } : {}),
  }).map(moduleCandidate);
};

const replacementRangeInLogicalText = (
  text: string,
  context: Exclude<DslCompletionContext, null>
): DslCompletionRange => {
  let from = context.from;
  const to = context.to;
  // Source references keep their marker/separator outside the editable member
  // range. Existing classifiers already return the member-only range for
  // `.`/`::`; this handles the `@`-prefixed scalar/reference lanes.
  if (text[from] === "@" && (
    context.kind === "parameter" ||
    context.kind === "moduleReference" ||
    context.kind === "typedInitializer" ||
    context.kind === "conditionExpression" ||
    context.kind === "propertyScalarValue" ||
    context.kind === "templateHole"
  )) from += 1;
  return { from, to };
};

const projectReplacementRange = (
  input: LogicalInput,
  range: DslCompletionRange
): DslCompletionRange | null => {
  if (!input.statement) {
    return { from: input.lineStart + range.from, to: input.lineStart + range.to };
  }
  if (range.from === range.to) {
    const point = logicalOffsetToPhysical(input.map, input.statement, range.from);
    return point === null ? null : { from: point, to: point };
  }
  const span = physicalSpanForLogicalRange(input.map, input.statement, { start: range.from, end: range.to });
  if (!span || span.segments.length !== 1) return null;
  return span.segments[0];
};

const statementElementReferenceCandidates = (
  context: Extract<Exclude<DslCompletionContext, null>, { kind: "parameter" }>,
  compiled: CompiledDslDocument | undefined,
  statementIndex: number
) => {
  if (!compiled || context.parameter.definition.kind === "number") return [];
  const kind = context.parameter.definition.kind === "lineEndpointReference"
    ? "lineEndpointReference"
    : context.parameter.definition.kind === "lineReference" || context.parameter.definition.kind === "lineReferenceList"
      ? context.parameter.definition.kind
      : context.parameter.definition.kind === "reference"
        ? "point"
        : null;
  return kind ? sourceGeometryDeclarations(compiled, statementIndex, kind) : [];
};

const queryCandidates = (
  context: Exclude<DslCompletionContext, null>,
  input: LogicalInput,
  position: number,
  semantic: DslCompletionSemanticSnapshot | undefined,
  compiled: CompiledDslDocument | undefined,
  exact: boolean,
  statementIndex: number
) => {
  if (context.kind === "keyword") return context.options.map((label) => ({ kind: "keyword" as const, label }));
  if (context.kind === "construction") return constructionCompletionCandidates(context.category).map((candidate) => ({ kind: "construction" as const, label: candidate.label, detail: candidate.detail, identity: candidate.label }));
  if (context.kind === "argument") return argumentCompletionCandidates(context.spec, context.usedArgumentNames).map((candidate) => ({ kind: "argumentName" as const, label: candidate.label, detail: candidate.detail, identity: candidate.label }));
  if (context.kind === "declaredType") return dslTypedDeclarationTypeNames.map((label) => ({ kind: "type" as const, label, identity: label }));
  if (context.kind === "moduleParameterType") return dslModuleParameterTypeNames.map((label) => ({ kind: "type" as const, label, identity: label }));
  if (context.kind === "numericTypeOption") return context.options.map((label) => ({ kind: "argumentName" as const, label, identity: label }));
  if (context.kind === "moduleCallee" || context.kind === "moduleArgumentLabel" || context.kind === "moduleArgumentValue" || context.kind === "moduleQualifiedMember" || context.kind === "moduleReference") {
    return moduleCandidatesAt(context, input, position, semantic, compiled, exact, statementIndex);
  }
  if (context.kind === "elementParameter") {
    return compiled && exact
      ? sourceGeometryPropertyCandidates(compiled, statementIndex, context.elementToken)
      : [];
  }
  if (context.kind === "typedInitializer" || context.kind === "conditionExpression" || context.kind === "propertyScalarValue" || context.kind === "templateHole") {
    return scalarCandidatesAt(context, input, semantic, compiled, exact, statementIndex);
  }
  if (context.kind === "setTarget") {
    const analysis = semantic?.bindingAnalysis ?? compiled?.bindingAnalysis;
    if (!analysis || !semantic || !exact) return [];
    const deps = setSiteDeps(analysis, position, statementIndex, exact, compiled);
    return deps
      ? setTargetCandidates(deps).map((candidate) => ({ kind: "binding" as const, label: candidate.name, identity: candidate.bindingId }))
      : [];
  }
  if (context.kind === "setRhs") {
    const analysis = semantic?.bindingAnalysis ?? compiled?.bindingAnalysis;
    if (!analysis || !semantic || !exact) return [];
    const deps = setSiteDeps(analysis, position, statementIndex, exact, compiled);
    const target = deps
      ? setTargetCandidates(deps).find((candidate) => candidate.name === context.targetName)
      : undefined;
    if (!deps || !target || context.geometryProperty) return context.geometryProperty && compiled && exact
      ? sourceGeometryPropertyCandidates(compiled, statementIndex, context.geometryProperty.elementToken)
      : [];
    return setRhsScalarCandidates(input.lineText, context.expressionSpan, input.localPosition, target.type, deps).map(scalarCandidate);
  }
  if (context.kind === "parameter") {
    if (context.parameter.definition.kind === "choice") {
      return (context.parameter.definition.choiceOptions ?? []).map((label) => ({ kind: "literal" as const, label, identity: label }));
    }
    if (context.parameter.definition.kind === "number") {
      const analysisInfo = bindingAnalysisFor(semantic, compiled, exact, statementIndex);
      if (!analysisInfo) return [];
      const accepts = (type: ScalarType | null) => type?.kind === "number";
      const deps = {
        catalog: analysisInfo.analysis.catalog,
        entriesById: analysisInfo.analysis.entriesById,
        ...(analysisInfo.site ? { site: analysisInfo.site } : {}),
        accepts
      };
      return typedBindingReferenceCandidates(deps).map((candidate) => ({ kind: "binding" as const, label: candidate.name, identity: candidate.bindingId }));
    }
    return statementElementReferenceCandidates(context, compiled, statementIndex);
  }
  return [];
};

/**
 * Query source completion semantics without importing an editor host.
 *
 * The query never evaluates geometry and never filters/ranks/truncates the
 * result. If a semantic snapshot is not proven current, syntax candidates
 * remain available while source-semantic candidates are omitted.
 */
export const queryDslCompletion = ({ source, position, semantic }: DslCompletionQueryInput): DslCompletionQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  const input = logicalInputAt(source, position);
  const context = dslCompletionContextAt(input.lineText, input.localPosition);
  if (!context) return null;
  const compiled = semantic?.compiled;
  const exact = semanticIsExact(source, semantic);
  const statementIndex = statementIndexFor(compiled, position, exact);
  let candidates = queryCandidates(context, input, position, semantic, compiled, exact, statementIndex);

  // Module scalar references are intentionally additive to ordinary scalar
  // candidates, but only through the existing source semantic Module owner.
  if (
    (context.kind === "typedInitializer" || context.kind === "conditionExpression" || context.kind === "propertyScalarValue" || context.kind === "templateHole") &&
    compiled && semantic && exact
  ) {
    const expected = context.kind === "typedInitializer"
      ? context.declaredType
      : context.kind === "conditionExpression"
        ? context.positionContext.kind === "operand" ? context.positionContext.expectedType : context.positionContext.kind === "operator" ? context.positionContext.rootType : null
        : context.kind === "propertyScalarValue"
          ? context.propertyContext.kind === "expression"
            ? context.propertyContext.positionContext.kind === "operand" ? context.propertyContext.positionContext.expectedType : context.propertyContext.positionContext.kind === "operator" ? context.propertyContext.positionContext.rootType : null
            : context.propertyContext.kind === "booleanLiteral" ? { kind: "boolean" as const } : context.propertyContext.expectedType
          : { kind: "string" as const };
    candidates = uniqueCandidates([
      ...candidates,
      ...moduleBodyReferenceCandidates(input, position, semantic, compiled, exact, statementIndex, expected)
    ]);
  }

  if (context.kind === "parameter" && context.parameter.definition.kind === "number" && compiled && semantic && exact) {
    candidates = uniqueCandidates([
      ...candidates,
      ...moduleBodyReferenceCandidates(input, position, semantic, compiled, exact, statementIndex, { kind: "number" })
    ]);
  }

  const logicalRange = replacementRangeInLogicalText(input.lineText, context);
  const replacementRange = projectReplacementRange(input, logicalRange);
  if (!replacementRange) return null;
  return {
    context,
    category: context.kind,
    replacementRange,
    candidates: uniqueCandidates(candidates)
  };
};

export type { SourceSnapshot } from "./logicalStatementSourceMap";
