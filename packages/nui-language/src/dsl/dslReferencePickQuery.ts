import type { StatementIdentity } from "../document/statementIdentity";
import { getBuiltinFunctionDefinition, type BuiltinParameterType } from "../scalars/builtinFunctions";
import {
  scalarExpressionCompletionContextAt
} from "../scalars/scalarExpressionPositionClassifier";
import { tokenizeScalarExpression, type ScalarExpressionToken } from "../scalars/expressionTokenizer";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import { scanCallArgs, matchingDslDelimiter, scanDslNesting, type ScannedArg } from "./dslArgScanner";
import { dslCallAuthoringContextAt, type DslCallAuthoringContext } from "./dslCallAuthoringContext";
import { dslCompletionMetadataForType, type DslCompletionParameter } from "./dslCompletionMetadata";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type LogicalStatement,
  type LogicalStatementSourceMap,
  type SourceRevision,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import {
  moduleGeometryInterfaceTypeOf,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";
import { scalarTypeOfDslValueType } from "./dslValueTypes";
import { setCompletionContextAt } from "./dslSetCompletionContext";
import type { DslSpan, DslModuleParameterType } from "./dslTypes";
import { resolveSourceLexicalDeclaration } from "./sourceLexicalNamespaceIndex";
import {
  isNumericComputedGeometryProperty
} from "../geometry/numericExpressions";

export type DslReferencePickRange = { from: number; to: number };

export type DslReferencePickRole = "geometry" | "endpoint" | "numericPropertyBase";

export type DslReferencePickMultiplicity = "single" | "multiple";

export type DslReferencePickNumericPropertyTarget = { kind: "propertySelectionRequired" };

export type DslReferencePickSourceAnchor = {
  sourceRevision: SourceRevision;
  statementId: StatementIdentity;
  statementIndex: number;
  sourceOrderIndex: number;
  scopeId: ScopeId;
  statementRange: { from: number; to: number; startLine: number; endLine: number };
};

export type DslReferencePickTarget = {
  sourceAnchor: DslReferencePickSourceAnchor;
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
  range: DslReferencePickRange;
  /** Operation activation span; numeric-property targets may edit only a sub-span. */
  activationRange?: DslReferencePickRange;
  numericProperty?: DslReferencePickNumericPropertyTarget;
};

export type DslReferencePickSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
};

export type DslReferencePickQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslReferencePickSemanticSnapshot;
};

type ExactPosition = {
  map: LogicalStatementSourceMap;
  statement: LogicalStatement;
  statementIndex: number;
  logicalPosition: number;
};

type ActiveCallArgument = {
  index: number;
  segment: DslSpan;
  scanned: ScannedArg | null;
  valueSpan: DslSpan;
};

type PickExpectation = {
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
};

type NumericOperandTarget = {
  expectation: PickExpectation;
  range: DslSpan;
  activationRange?: DslSpan;
  numericProperty?: DslReferencePickNumericPropertyTarget;
};

type ReferencePickTargetCandidate = {
  target: DslReferencePickTarget;
  /** The syntactic region that identifies this target during broad activation. */
  region: DslReferencePickRange;
};

export type DslReferencePickTargetResolution =
  | { kind: "target"; target: DslReferencePickTarget }
  | { kind: "ambiguous"; targets: readonly DslReferencePickTarget[] }
  | { kind: "none" };

const semanticSourceText = (semantic: DslReferencePickSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactCompiledSemantic = (
  source: SourceSnapshot,
  semantic: DslReferencePickSemanticSnapshot | undefined
): CompiledDslDocument | null => {
  if (!semantic?.compiled || semantic.sourceRevision !== source.sourceRevision) return null;
  if (source.normalizedSource.includes("\r") || semanticSourceText(semantic) !== source.normalizedSource) return null;
  if (semantic.compiled.spans.sourceMap.source !== source.normalizedSource) return null;
  if (semantic.compiled.spans.sourceMap.sourceRevision !== source.sourceRevision) return null;
  if (semantic.compiled.statementMap && semantic.compiled.statementMap.sourceRevision !== source.sourceRevision) return null;
  return semantic.compiled;
};

const exactPositionAt = (
  source: SourceSnapshot,
  position: number,
  map = createLogicalStatementSourceMap(source)
): ExactPosition | null => {
  const statementIndex = map.statements.findIndex((candidate) =>
    position >= candidate.range.from && position <= candidate.range.to
  );
  if (statementIndex < 0) return null;
  const statement = map.statements[statementIndex]!;
  const logicalPosition = physicalToLogicalOffset(map, statement, position) ?? (() => {
    for (let index = 0, logicalStart = 0; index < statement.segments.length - 1; index += 1) {
      const current = statement.segments[index]!;
      const next = statement.segments[index + 1]!;
      const gap = source.normalizedSource.slice(current.to, position);
      if (
        position > current.to &&
        position < next.from &&
        gap.length > 0 &&
        !gap.includes("\n") &&
        gap.trim().length === 0
      ) return logicalStart + current.to - current.from;
      logicalStart += current.to - current.from + 1;
    }
    const lastSegment = statement.segments.at(-1);
    if (!lastSegment || position < lastSegment.to || position > statement.range.to) return null;
    return source.normalizedSource.slice(lastSegment.to, position).trim().length === 0
      ? statement.logicalText.length
      : null;
  })();
  return logicalPosition === null ? null : { map, statement, statementIndex, logicalPosition };
};

const oneExactString = (values: readonly (string | undefined)[]): string | null => {
  const unique = [...new Set(values.filter((value): value is string => value !== undefined))];
  return unique.length === 1 ? unique[0]! : null;
};

const sourceAnchorFor = (
  compiled: CompiledDslDocument,
  exact: ExactPosition
): DslReferencePickSourceAnchor | null => {
  const statementIndices = compiled.statements.flatMap((statement, statementIndex) =>
    statement.documentRange.from === exact.statement.range.from &&
    statement.documentRange.to === exact.statement.range.to
      ? [statementIndex]
      : []
  );
  if (statementIndices.length !== 1) return null;
  const statementIndex = statementIndices[0]!;
  const compiledStatement = compiled.statements[statementIndex];
  if (!compiledStatement) return null;

  const namespace = compiled.sourceLexicalNamespace;
  const namespaceDeclaration = namespace?.allDeclarations.find((candidate) =>
    candidate.statementIndex === statementIndex
  );
  const setAnalysis = compiled.setStatements?.get(statementIndex);
  const statementId = oneExactString([
    compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex),
    namespaceDeclaration?.statementId,
    setAnalysis?.statementId
  ]);
  const scopeId = oneExactString([
    namespace?.scopeIndex.scopeOfStatement.get(statementIndex),
    setAnalysis?.scopeId
  ]);
  if (!statementId || !scopeId) return null;

  return {
    sourceRevision: exact.map.sourceRevision,
    statementId,
    statementIndex,
    sourceOrderIndex: statementIndex,
    scopeId,
    statementRange: {
      from: exact.statement.range.from,
      to: exact.statement.range.to,
      startLine: exact.statement.range.startLine,
      endLine: exact.statement.range.endLine
    }
  };
};

const physicalRangeForLogical = (
  exact: ExactPosition,
  range: DslSpan,
  sourcePosition: number
): DslReferencePickRange | null => {
  if (range.start === range.end) {
    if (range.start === exact.logicalPosition) return { from: sourcePosition, to: sourcePosition };
    const physical = logicalOffsetToPhysical(exact.map, exact.statement, range.start);
    return physical === null ? null : { from: physical, to: physical };
  }
  const physical = physicalSpanForLogicalRange(exact.map, exact.statement, range);
  if (!physical || physical.segments.length !== 1) return null;
  return { from: physical.segments[0]!.from, to: physical.segments[0]!.to };
};

const activeCallArgument = (call: DslCallAuthoringContext): ActiveCallArgument | null => {
  const open = call.callee.logicalOpenParen;
  const close = matchingDslDelimiter(call.logicalText, open);
  const end = close >= 0 ? close : call.logicalText.length;
  if (call.logicalCursorPosition < open + 1 || call.logicalCursorPosition > end) return null;
  const commas = scanDslNesting(call.logicalText, { start: open + 1, end }).topLevelCommas;
  const previous = [...commas].reverse().find((comma) => comma < call.logicalCursorPosition);
  const next = commas.find((comma) => comma >= call.logicalCursorPosition);
  const segment = { start: (previous ?? open) + 1, end: next ?? end };
  const index = commas.filter((comma) => comma < call.logicalCursorPosition).length;
  const scannedResult = scanCallArgs(call.logicalText, segment);
  if (scannedResult.args.length > 1) return null;
  const scanned = scannedResult.args[0] ?? null;
  if (
    call.logicalText[call.logicalCursorPosition] === "," &&
    scanned?.valueSpan.start !== scanned?.valueSpan.end
  ) return null;
  if (scanned?.keySpan) {
    const colon = call.logicalText.indexOf(":", scanned.keySpan.end);
    if (colon < 0 || call.logicalCursorPosition <= colon) return null;
  }
  const valueSpan = scanned && scanned.valueSpan.start < scanned.valueSpan.end
    ? scanned.valueSpan
    : { start: call.logicalCursorPosition, end: call.logicalCursorPosition };
  return { index, segment, scanned, valueSpan };
};

const expectationForParameter = (
  parameter: DslCompletionParameter
): PickExpectation | "number" | null => {
  switch (parameter.definition.kind) {
    case "reference":
      return { expectedGeometryInterface: "point", role: "geometry", multiplicity: "single" };
    case "lineEndpointReference":
      return { expectedGeometryInterface: "point", role: "endpoint", multiplicity: "single" };
    case "lineReference":
      return { expectedGeometryInterface: "path", role: "geometry", multiplicity: "single" };
    case "lineReferenceList":
      return { expectedGeometryInterface: "path", role: "geometry", multiplicity: "multiple" };
    case "pointReferenceList":
      return { expectedGeometryInterface: "point", role: "geometry", multiplicity: "multiple" };
    case "number":
      return "number";
    default:
      return null;
  }
};

const trimPhysicalCallValueRange = (
  source: SourceSnapshot,
  range: DslReferencePickRange
): DslReferencePickRange => {
  let from = range.from;
  let to = range.to;
  while (from < to && /\s/.test(source.normalizedSource[from]!)) from += 1;
  while (to > from && /\s/.test(source.normalizedSource[to - 1]!)) to -= 1;
  if (to > from && source.normalizedSource[to - 1] === ",") {
    to -= 1;
    while (to > from && /\s/.test(source.normalizedSource[to - 1]!)) to -= 1;
  }
  return { from, to };
};

const callValueRange = (
  source: SourceSnapshot,
  exact: ExactPosition,
  argument: ActiveCallArgument,
  sourcePosition: number
): DslReferencePickRange | null => {
  if (!argument.scanned || argument.scanned.valueSpan.start === argument.scanned.valueSpan.end) {
    if (argument.scanned?.rawValueSpan) {
      const insertion = physicalRangeForLogical(
        exact,
        { start: argument.scanned.rawValueSpan.start, end: argument.scanned.rawValueSpan.start },
        sourcePosition
      );
      if (insertion) return insertion;
    }
    return { from: sourcePosition, to: sourcePosition };
  }
  const physical = physicalRangeForLogical(exact, argument.scanned.valueSpan, sourcePosition);
  return physical ? trimPhysicalCallValueRange(source, physical) : null;
};

const targetFromExpectation = (
  anchor: DslReferencePickSourceAnchor,
  expectation: PickExpectation,
  range: DslReferencePickRange,
  details: Pick<DslReferencePickTarget, "activationRange" | "numericProperty"> = {}
): DslReferencePickTarget => ({
  sourceAnchor: anchor,
  expectedGeometryInterface: expectation.expectedGeometryInterface,
  role: expectation.role,
  multiplicity: expectation.multiplicity,
  range,
  ...details
});

const scalarTokenSpan = (token: ScalarExpressionToken): DslSpan =>
  token.kind === "literal" ? token.literal.span : token.span;

const tokenOwnsCaret = (source: string, expressionSpan: DslSpan, token: ScalarExpressionToken, position: number) => {
  const span = scalarTokenSpan(token);
  if (token.kind === "operator" || token.kind === "comma" || token.kind === "colon") return false;
  if (position >= span.start && position < span.end) return true;
  if (position !== span.end) return false;
  return source.slice(span.end, expressionSpan.end).trim().length === 0;
};

const numericOperandTarget = (
  source: string,
  logicalPosition: number,
  expressionSpan: DslSpan
): NumericOperandTarget | null => {
  if (logicalPosition < expressionSpan.start || logicalPosition > expressionSpan.end) return null;
  const tokenized = tokenizeScalarExpression(source, expressionSpan);
  if (tokenized.error) return null;
  const token = tokenized.tokens.find((candidate) => tokenOwnsCaret(source, expressionSpan, candidate, logicalPosition));
  const expectation: PickExpectation = {
    expectedGeometryInterface: "path",
    role: "numericPropertyBase",
    multiplicity: "single"
  };

  if (token?.kind === "geometryProperty") {
    if (!isNumericComputedGeometryProperty(token.property)) return null;
    return logicalPosition >= token.span.start && logicalPosition <= token.span.end
      ? {
          expectation,
          range: token.span,
          numericProperty: { kind: "propertySelectionRequired" }
        }
      : null;
  }
  if (token?.kind === "reference") {
    return {
      expectation,
      range: token.span,
      numericProperty: { kind: "propertySelectionRequired" }
    };
  }
  if (token?.kind === "literal") {
    return token.literal.kind === "number"
      ? {
          expectation,
          range: token.literal.span,
          numericProperty: { kind: "propertySelectionRequired" }
        }
      : null;
  }
  if (token) return null;

  // Completion classifiers intentionally inspect only the prefix ending at
  // the caret. For Pick targeting, that prefix may describe a missing
  // operand only when the remainder of the expression is whitespace; never
  // reinterpret the gap before an existing operand as an empty slot.
  if (source.slice(logicalPosition, expressionSpan.end).trim().length > 0) return null;

  const completion = scalarExpressionCompletionContextAt(
    source,
    logicalPosition,
    expressionSpan,
    { kind: "number" }
  );
  if (completion?.kind !== "operand" || completion.expectedType?.kind !== "number") return null;
  const lastToken = tokenized.tokens.at(-1);
  const insertionAt = lastToken && (
    lastToken.kind === "operator" ||
    lastToken.kind === "leftParen" ||
    lastToken.kind === "comma"
  )
    ? scalarTokenSpan(lastToken).end
    : completion.from;
  return {
    expectation,
    range: { start: insertionAt, end: insertionAt },
    numericProperty: { kind: "propertySelectionRequired" }
  };
};

const constructionParameter = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  call: DslCallAuthoringContext,
  argument: ActiveCallArgument
): DslCompletionParameter | null => {
  const key = argument.scanned?.key;
  if (!key) return null;
  const statement = compiled.statements[statementIndex];
  if (statement?.kind !== "element" || !statement.type || statement.construction !== call.callee.name) return null;
  const parameters = dslCompletionMetadataForType(statement.type).parameters.filter((parameter) =>
    parameter.source === "attr" && parameter.key === key
  );
  return parameters.length === 1 ? parameters[0]! : null;
};

const builtinParameterTypes = (
  call: DslCallAuthoringContext,
  argument: ActiveCallArgument
): readonly BuiltinParameterType[] => {
  const definition = getBuiltinFunctionDefinition(call.callee.name);
  if (!definition) return [];
  const key = argument.scanned?.key;
  return definition.signatures.flatMap((signature) => {
    if (signature.callingStyle === "named") {
      if (!key) return [];
      const parameter = signature.parameters.find((candidate) => candidate.name === key);
      return parameter ? [parameter.type] : [];
    }
    if (key) return [];
    const parameter = signature.parameters[argument.index];
    return parameter ? [parameter.type] : [];
  });
};

const builtinExpectation = (
  call: DslCallAuthoringContext,
  argument: ActiveCallArgument
): PickExpectation | "number" | null => {
  const types = builtinParameterTypes(call, argument);
  if (types.length === 0) return null;
  if (types.every((type) => typeof type === "string")) {
    const geometryTypes = [...new Set(types as readonly ModuleGeometryInterfaceType[])];
    return geometryTypes.length === 1
      ? { expectedGeometryInterface: geometryTypes[0]!, role: "geometry", multiplicity: "single" }
      : null;
  }
  return types.every((type) => typeof type !== "string" && type.kind === "number") ? "number" : null;
};

const moduleParameterType = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  call: DslCallAuthoringContext,
  argument: ActiveCallArgument
): DslModuleParameterType | null => {
  const key = argument.scanned?.key;
  if (!key) return null;
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return null;
  const lookup = resolveSourceLexicalDeclaration(namespace, statementIndex, call.callee.name);
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "moduleDefinition") return null;
  const definition = compiled.statements[lookup.declaration.statementIndex];
  if (definition?.kind !== "moduleDefinition") return null;
  return definition.parameters.find((parameter) => parameter.name === key)?.type ?? null;
};

const moduleExpectation = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  call: DslCallAuthoringContext,
  argument: ActiveCallArgument
): PickExpectation | "number" | null => {
  const type = moduleParameterType(compiled, statementIndex, call, argument);
  const geometry = moduleGeometryInterfaceTypeOf(type);
  if (geometry) return { expectedGeometryInterface: geometry, role: "geometry", multiplicity: "single" };
  return type?.kind === "number" ? "number" : null;
};

const targetForCall = (
  source: SourceSnapshot,
  position: number,
  exact: ExactPosition,
  compiled: CompiledDslDocument,
  anchor: DslReferencePickSourceAnchor,
  call: DslCallAuthoringContext
): DslReferencePickTarget | null => {
  if (call.sourceRevision !== source.sourceRevision || call.sourceOrderAnchor.statementIndex !== exact.statementIndex) return null;
  const argument = activeCallArgument(call);
  if (!argument) return null;

  const expectation = call.kind === "construction"
    ? (() => {
        const parameter = constructionParameter(compiled, anchor.statementIndex, call, argument);
        return parameter ? expectationForParameter(parameter) : null;
      })()
    : call.kind === "module"
      ? moduleExpectation(compiled, anchor.statementIndex, call, argument)
      : builtinExpectation(call, argument);
  if (!expectation) return null;

  if (expectation !== "number") {
    const range = callValueRange(source, exact, argument, position);
    return range ? targetFromExpectation(anchor, expectation, range) : null;
  }

  const numeric = numericOperandTarget(call.logicalText, call.logicalCursorPosition, argument.valueSpan);
  if (!numeric) return null;
  const range = physicalRangeForLogical(exact, numeric.range, position);
  if (!range) return null;
  const activationRange = numeric.activationRange
    ? physicalRangeForLogical(exact, numeric.activationRange, position)
    : range;
  return activationRange
    ? targetFromExpectation(anchor, numeric.expectation, range, {
        activationRange,
        numericProperty: numeric.numericProperty
      })
    : null;
};

const emptyConstructionTarget = (
  position: number,
  exact: ExactPosition,
  compiled: CompiledDslDocument,
  anchor: DslReferencePickSourceAnchor
): DslReferencePickTarget | null => {
  const statement = compiled.statements[anchor.statementIndex];
  if (statement?.kind !== "element" || !statement.type) return null;
  const emptyAttrs = statement.attrs.filter((attr) =>
    attr.value === "" &&
    attr.rawValueSpan &&
    exact.logicalPosition >= attr.rawValueSpan.start &&
    exact.logicalPosition <= attr.rawValueSpan.end
  );
  if (emptyAttrs.length !== 1) return null;
  const attr = emptyAttrs[0]!;
  const parameters = dslCompletionMetadataForType(statement.type).parameters.filter((parameter) =>
    parameter.source === "attr" && parameter.key === attr.key
  );
  if (parameters.length !== 1) return null;
  const expectation = expectationForParameter(parameters[0]!);
  if (!expectation) return null;
  const range = { from: position, to: position };
  if (expectation !== "number") return targetFromExpectation(anchor, expectation, range);
  return targetFromExpectation(anchor, {
    expectedGeometryInterface: "path",
    role: "numericPropertyBase",
    multiplicity: "single"
  }, range, {
    activationRange: range,
    numericProperty: { kind: "propertySelectionRequired" }
  });
};

const typedDeclarationTarget = (
  position: number,
  exact: ExactPosition,
  anchor: DslReferencePickSourceAnchor
): DslReferencePickTarget | null => {
  const parsed = parseDslTypedDeclarationStatement(exact.statement.logicalText).statement;
  if (!parsed || scalarTypeOfDslValueType(parsed.valueType)?.kind !== "number") return null;
  const existing = parsed.payloadSpans.initializer;
  const expressionSpan = existing
    ? { start: existing.start, end: exact.statement.logicalText.length }
    : (() => {
        const equals = exact.statement.logicalText.indexOf("=");
        return equals < 0 ? null : { start: equals + 1, end: exact.statement.logicalText.length };
      })();
  if (!expressionSpan) return null;
  const numeric = numericOperandTarget(exact.statement.logicalText, exact.logicalPosition, expressionSpan);
  if (!numeric) return null;
  const emptyInitializer = !existing && numeric.range.start === numeric.range.end;
  const numericRange = emptyInitializer
    ? { start: expressionSpan.start, end: expressionSpan.start }
    : numeric.range;
  const range = emptyInitializer
    ? (() => {
        const physical = logicalOffsetToPhysical(exact.map, exact.statement, expressionSpan.start);
        return physical === null ? null : { from: physical, to: physical };
      })()
    : physicalRangeForLogical(exact, numericRange, position);
  if (!range) return null;
  const activationRange = emptyInitializer
    ? range
    : numeric.activationRange
    ? physicalRangeForLogical(exact, numeric.activationRange, position)
    : range;
  return activationRange
    ? targetFromExpectation(anchor, numeric.expectation, range, {
        activationRange,
        numericProperty: numeric.numericProperty
      })
    : null;
};

const setNumericTarget = (
  position: number,
  exact: ExactPosition,
  compiled: CompiledDslDocument,
  anchor: DslReferencePickSourceAnchor
): DslReferencePickTarget | null => {
  const context = setCompletionContextAt(exact.statement.logicalText, exact.logicalPosition);
  if (context?.kind !== "rhs") return null;
  const analysis = compiled.setStatements?.get(anchor.statementIndex);
  if (!analysis || analysis.statementId !== anchor.statementId || analysis.scopeId !== anchor.scopeId) return null;
  const targetBinding = compiled.bindingAnalysis?.catalog.bindingsById.get(analysis.targetBindingId);
  if (targetBinding?.declaredType?.kind !== "number") return null;
  const numeric = numericOperandTarget(exact.statement.logicalText, exact.logicalPosition, context.expressionSpan);
  if (!numeric) return null;
  const range = physicalRangeForLogical(exact, numeric.range, position);
  if (!range) return null;
  const activationRange = numeric.activationRange
    ? physicalRangeForLogical(exact, numeric.activationRange, position)
    : range;
  return activationRange
    ? targetFromExpectation(anchor, numeric.expectation, range, {
        activationRange,
        numericProperty: numeric.numericProperty
      })
    : null;
};

const sameRange = (
  left: DslReferencePickRange,
  right: DslReferencePickRange
): boolean => left.from === right.from && left.to === right.to;

const sameTarget = (
  left: DslReferencePickTarget,
  right: DslReferencePickTarget
): boolean =>
  left.sourceAnchor.statementIndex === right.sourceAnchor.statementIndex &&
  left.expectedGeometryInterface === right.expectedGeometryInterface &&
  left.role === right.role &&
  left.multiplicity === right.multiplicity &&
  sameRange(left.range, right.range) &&
  (left.numericProperty?.kind ?? null) === (right.numericProperty?.kind ?? null);

const lineRangeAt = (
  source: string,
  position: number
): DslReferencePickRange => {
  const from = source.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const newline = source.indexOf("\n", position);
  return { from, to: newline < 0 ? source.length : newline };
};

const containsRange = (
  range: DslReferencePickRange,
  position: number
): boolean => range.from === range.to
  ? position === range.from
  : range.from <= position && position < range.to;

const targetCandidateAt = (
  source: SourceSnapshot,
  position: number,
  compiled: CompiledDslDocument,
  map: LogicalStatementSourceMap
): ReferencePickTargetCandidate | null => {
  const exact = exactPositionAt(source, position, map);
  if (!exact) return null;
  const anchor = sourceAnchorFor(compiled, exact);
  if (!anchor) return null;

  const primary = dslCallAuthoringContextAt(source, position);
  for (const call of [primary]) {
    if (!call) continue;
    const target = targetForCall(source, position, exact, compiled, anchor, call);
    if (!target) continue;
    const candidateLine = lineRangeAt(source.normalizedSource, position);
    const argument = activeCallArgument(call);
    const callEnd = matchingDslDelimiter(call.logicalText, call.callee.logicalOpenParen);
    const callArguments = scanCallArgs(call.logicalText, {
      start: call.callee.logicalOpenParen + 1,
      end: callEnd >= 0 ? callEnd : call.logicalText.length
    }).args;
    const physicalArgument = argument
      ? physicalSpanForLogicalRange(exact.map, exact.statement, argument.segment)
      : null;
    const argumentRegion = physicalArgument?.segments.length === 1
      ? physicalArgument.segments[0]
      : null;
    const region = callArguments.length <= 1 || !argumentRegion
      ? candidateLine
      : argumentRegion;
    return { target, region };
  }

  const target = emptyConstructionTarget(position, exact, compiled, anchor) ??
    typedDeclarationTarget(position, exact, anchor) ??
    setNumericTarget(position, exact, compiled, anchor);
  return target
    ? { target, region: lineRangeAt(source.normalizedSource, position) }
    : null;
};

const targetCandidatesOnLine = (
  source: SourceSnapshot,
  position: number,
  compiled: CompiledDslDocument,
  map: LogicalStatementSourceMap
): ReferencePickTargetCandidate[] => {
  const line = lineRangeAt(source.normalizedSource, position);
  const candidates: ReferencePickTargetCandidate[] = [];
  for (let probe = line.from; probe <= line.to; probe += 1) {
    const candidate = targetCandidateAt(source, probe, compiled, map);
    if (!candidate) continue;
    if (candidates.some((existing) => sameTarget(existing.target, candidate.target))) continue;
    candidates.push(candidate);
  }
  return candidates;
};

const numericCandidateRegion = (
  candidate: ReferencePickTargetCandidate,
  candidates: readonly ReferencePickTargetCandidate[]
): DslReferencePickRange => {
  if (candidate.target.role !== "numericPropertyBase") return candidate.region;
  const sameRegion = candidates.filter((other) =>
    other.target.role === "numericPropertyBase" && sameRange(other.region, candidate.region)
  );
  return sameRegion.length > 1 ? candidate.target.range : candidate.region;
};

const targetWithActivation = (
  candidate: ReferencePickTargetCandidate,
  activationRange: DslReferencePickRange
): DslReferencePickTarget => ({
  ...candidate.target,
  activationRange: { ...activationRange }
});

const targetResolutionForCandidates = (
  source: SourceSnapshot,
  position: number,
  exactCandidate: ReferencePickTargetCandidate | null,
  candidates: readonly ReferencePickTargetCandidate[]
): DslReferencePickTargetResolution => {
  if (candidates.length === 0) return { kind: "none" };

  const exactRangeCandidates = candidates.filter((candidate) => {
    const range = candidate.target.range;
    return range.from === range.to
      ? position === range.from
      : range.from <= position && position < range.to;
  });
  if (exactRangeCandidates.length === 1) {
    const candidate = exactRangeCandidates[0]!;
    return {
      kind: "target",
      target: targetWithActivation(candidate, numericCandidateRegion(candidate, candidates))
    };
  }

  const regionCandidates = candidates.filter((candidate) => containsRange(candidate.region, position));
  const empty = regionCandidates.filter((candidate) => candidate.target.range.from === candidate.target.range.to);
  if (empty.length === 1) {
    const candidate = empty[0]!;
    return {
      kind: "target",
      target: targetWithActivation(candidate, candidate.region)
    };
  }
  if (empty.length > 1) {
    return {
      kind: "ambiguous",
      targets: empty.map((candidate) => targetWithActivation(candidate, candidate.region))
    };
  }

  if (regionCandidates.length === 1) {
    const candidate = regionCandidates[0]!;
    return {
      kind: "target",
      target: targetWithActivation(candidate, candidate.region)
    };
  }

  if (regionCandidates.length > 1) {
    return {
      kind: "ambiguous",
      targets: regionCandidates.map((candidate) => targetWithActivation(
        candidate,
        numericCandidateRegion(candidate, candidates)
      ))
    };
  }

  if (exactCandidate && candidates.length === 1) {
    return {
      kind: "target",
      target: targetWithActivation(candidates[0]!, lineRangeAt(source.normalizedSource, position))
    };
  }

  if (candidates.length === 1) {
    return {
      kind: "target",
      target: targetWithActivation(candidates[0]!, lineRangeAt(source.normalizedSource, position))
    };
  }

  return {
    kind: "ambiguous",
    targets: candidates.map((candidate) => targetWithActivation(
      candidate,
      numericCandidateRegion(candidate, candidates)
    ))
  };
};

/**
 * Identify the one exact-current Source Editor range that may be mutated by a
 * Canvas reference-pick session. The query is host-neutral and read-only. It
 * accepts no last-good semantic recovery: source text, revision, compiled
 * source map, statement identity, lexical scope, and active argument must all
 * agree or the query fails closed.
 */
export const queryDslReferencePickTarget = ({
  source,
  position,
  semantic
}: DslReferencePickQueryInput): DslReferencePickTarget | null => {
  const resolution = queryDslReferencePickTargetResolution({ source, position, semantic });
  return resolution.kind === "target" ? resolution.target : null;
};

/**
 * Resolves the broad Source activation region without weakening the exact
 * mutation range. Multiple targets on one line remain explicit ambiguity so
 * the Extension Host can ask the user before entering Canvas Pick Mode.
 */
export const queryDslReferencePickTargetResolution = ({
  source,
  position,
  semantic
}: DslReferencePickQueryInput): DslReferencePickTargetResolution => {
  if (!Number.isInteger(position) || position < 0 || position > source.normalizedSource.length) return { kind: "none" };
  const compiled = exactCompiledSemantic(source, semantic);
  if (!compiled) return { kind: "none" };
  const map = createLogicalStatementSourceMap(source);
  const exactCandidate = targetCandidateAt(source, position, compiled, map);
  const candidates = targetCandidatesOnLine(source, position, compiled, map);
  return targetResolutionForCandidates(source, position, exactCandidate, candidates);
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
