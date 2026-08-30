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
import { setCompletionContextAt } from "./dslSetCompletionContext";
import type { DslSpan, DslModuleParameterType } from "./dslTypes";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import { isNumericMeasurementKey } from "../geometry/numericReferenceProperties";

export type DslReferencePickRange = { from: number; to: number };

export type DslReferencePickRole = "geometry" | "endpoint" | "numericPropertyBase";

export type DslReferencePickMultiplicity = "single" | "multiple";

export type DslReferencePickNumericPropertyTarget =
  | { kind: "propertySelectionRequired" }
  | { kind: "fixedProperty"; property: NumericMeasurementKey };

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

const exactPositionAt = (source: SourceSnapshot, position: number): ExactPosition | null => {
  const map = createLogicalStatementSourceMap(source);
  const statementIndex = map.statements.findIndex((candidate) =>
    position >= candidate.range.from && position <= candidate.range.to
  );
  if (statementIndex < 0) return null;
  const statement = map.statements[statementIndex]!;
  const logicalPosition = physicalToLogicalOffset(map, statement, position);
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
    if (!isNumericMeasurementKey(token.property)) return null;
    const baseRange = { start: token.span.start, end: token.elementNameSpan.end };
    return logicalPosition >= baseRange.start && logicalPosition <= token.span.end
      ? {
          expectation,
          range: baseRange,
          activationRange: token.span,
          numericProperty: { kind: "fixedProperty", property: token.property }
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

  const completion = scalarExpressionCompletionContextAt(
    source,
    logicalPosition,
    expressionSpan,
    { kind: "number" }
  );
  if (completion?.kind !== "operand" || completion.expectedType?.kind !== "number") return null;
  return {
    expectation,
    range: { start: completion.from, end: completion.to },
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
  argument: ActiveCallArgument
): DslModuleParameterType | null => {
  const key = argument.scanned?.key;
  if (!key) return null;
  const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.statementIndex === statementIndex);
  const definition = instance?.callee
    ? compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(instance.callee.definitionStatementId)
    : null;
  return definition?.parameters.find((parameter) => parameter.name === key)?.type ?? null;
};

const moduleExpectation = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argument: ActiveCallArgument
): PickExpectation | "number" | null => {
  const type = moduleParameterType(compiled, statementIndex, argument);
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
      ? moduleExpectation(compiled, anchor.statementIndex, argument)
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

const callTarget = (
  source: SourceSnapshot,
  position: number,
  exact: ExactPosition,
  compiled: CompiledDslDocument,
  anchor: DslReferencePickSourceAnchor
): DslReferencePickTarget | null => {
  const primary = dslCallAuthoringContextAt(source, position);
  const primaryTarget = primary
    ? targetForCall(source, position, exact, compiled, anchor, primary)
    : null;
  if (primaryTarget) return primaryTarget;

  const currentCharacter = source.normalizedSource[position];
  if (position <= 0 || (currentCharacter !== "," && currentCharacter !== ")" && currentCharacter !== "]")) return null;
  const previous = dslCallAuthoringContextAt(source, position - 1);
  return previous
    ? targetForCall(source, position, exact, compiled, anchor, previous)
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
  if (!parsed || parsed.declaredType?.kind !== "number") return null;
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
  if (!Number.isInteger(position) || position < 0 || position > source.normalizedSource.length) return null;
  const compiled = exactCompiledSemantic(source, semantic);
  if (!compiled) return null;
  const exact = exactPositionAt(source, position);
  if (!exact) return null;
  const anchor = sourceAnchorFor(compiled, exact);
  if (!anchor) return null;
  return callTarget(source, position, exact, compiled, anchor)
    ?? emptyConstructionTarget(position, exact, compiled, anchor)
    ?? typedDeclarationTarget(position, exact, anchor)
    ?? setNumericTarget(position, exact, compiled, anchor);
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
