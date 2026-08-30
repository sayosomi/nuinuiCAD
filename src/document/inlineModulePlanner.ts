import { encodeIdentityTuple } from "./identityTuple";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  semanticIdentityForModuleTarget,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { parseElementActivityLiteral } from "../dsl/dslActivity";
import { commonArgSpecs, constructionFor } from "../dsl/dslConstructions";
import { exactPhysicalSpan } from "../dsl/dslDiagnosticSpan";
import { parseGeometryArrayExpression } from "../dsl/geometryArrayExpression";
import {
  geometryArrayTypeOfModuleParameter,
  geometryArrayTypeOfTypedDeclaration
} from "../dsl/geometryArraySourceAnnotations";
import {
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "../dsl/geometryArrayTypes";
import { parseDslSnapshot } from "../dsl/dslParser";
import {
  formatDslReferencePath,
  parseDslSourceReference,
  parseDslSourceReferenceAt,
  readDslReferencePathSegments
} from "../dsl/dslReferenceTokens";
import { resolveModuleLexicalPath } from "../dsl/moduleLexicalResolution";
import type { DslModuleParameter, DslStatement } from "../dsl/dslTypes";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type {
  ModuleDefinitionSemantic,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
  ModuleInstanceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleRecordReferenceSemantic,
  ResolvedModuleParameterBinding
} from "../dsl/moduleSemanticTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarExpressionResolvedGeometryTarget, TypedScalarExpression } from "../scalars/typedExpressionAst";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type InlineModuleTargetIdentity = {
  /** The owning document identity; null means the current local document. */
  documentKey: string | null;
  statementId: StatementIdentity;
};

export type InlineModulePolicy = {
  /** Preserve source for branches removed by presence-specialized conditionals as comments. */
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
  | "parameter-lowering-required";

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
  /** Deduplicated target results in authored source order. */
  targets: readonly InlineModuleTargetResult[];
  /** One atomic batch in old-source coordinates. Callers apply all or none. */
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
type ExactSourceRange = { from: number; to: number };
type Activity = InlineModuleInlinedTarget["activity"];
type StatementEntry = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: DslStatement;
};

type BodyRange = {
  from: number;
  to: number;
  bodyLines: readonly string[];
  definitionIndent: string;
  definitionStatementIndex: number;
  entries: readonly StatementEntry[];
};

type ScalarParameterLowering = {
  parameterIndex: number;
  parameterName: string;
  parameter: DslModuleParameter;
  state: "requiredSupplied" | "defaultedOmitted" | "optionalSupplied" | "optionalOmitted";
  nameSource: string;
  typeSource: string;
  initializerSource: string | null;
  originalExpressionRange: { from: number; to: number } | null;
  eliminatedSourceRanges: readonly ExactSourceRange[];
};

type GeometryArrayParameterLowering = {
  parameterIndex: number;
  parameterName: string;
  parameter: DslModuleParameter;
  arrayType: GeometryArrayType;
  state: "requiredSupplied" | "optionalSupplied" | "optionalOmitted";
  nameSource: string;
  typeSource: string;
  initializerSource: string | null;
  originalExpressionRange: { from: number; to: number } | null;
};

type RecordParameterLowering = {
  parameterIndex: number;
  parameterName: string;
  parameter: DslModuleParameter;
  recordTypeIdentity: string;
  state: "requiredSupplied" | "optionalSupplied" | "optionalOmitted";
  nameSource: string;
  typeSource: string;
  initializerSource: string | null;
  originalExpressionRange: { from: number; to: number } | null;
  reference: ModuleRecordReferenceSemantic | null;
};

type ScalarParameterPreparation =
  | {
      kind: "supported";
      scalarParameters: readonly ScalarParameterLowering[];
      geometryArrayParameters: readonly GeometryArrayParameterLowering[];
      recordParameters: readonly RecordParameterLowering[];
      geometryParameters: readonly GeometryParameterSubstitution[];
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "unsafe"; code: "unsafe-source-span" | "unsafe-rewrite"; message: string };

type GeometryParameterOwner =
  | { kind: "source"; statementId: StatementIdentity }
  | { kind: "coordinate" };

type GeometryParameterSubstitution = {
  parameterIndex: number;
  parameterName: string;
  parameter: DslModuleParameter;
  interfaceType: "point" | "line" | "path";
  state: "requiredSupplied" | "optionalSupplied" | "optionalOmitted";
  argumentSource: string | null;
  argumentRange: ExactSourceRange | null;
  argumentReference: ModuleGeometryReferenceSemantic | null;
  expectedOwner: GeometryParameterOwner | null;
};

type GeometrySubstitutionProvenance = {
  originalStatementId: StatementIdentity;
  parameterDefinitionStatementId: StatementIdentity;
  parameterIndex: number;
  bodySourceRange: ExactSourceRange;
  callerArgumentRange: ExactSourceRange;
  callerArgumentSource: string;
  emittedSource: string;
  callerReference: ModuleGeometryReferenceSemantic;
  expectedOwner: GeometryParameterOwner;
  siteKind: "direct" | "property" | "builtin";
};

type GeometryArrayParameterReferenceProvenance = {
  originalStatementId: StatementIdentity;
  parameterIndex: number;
  bodySourceRange: ExactSourceRange;
};

type RecordReferenceProvenance = {
  originalStatementId: StatementIdentity;
  bodySourceRange: ExactSourceRange;
  record: Extract<ModuleGeometryPropertySourceTarget, { kind: "recordField" }>['record'];
  field: Extract<ModuleGeometryPropertySourceTarget, { kind: "recordField" }>['field'];
  source: string;
};

type GeometrySubstitutionReference = Omit<ModuleGeometryReferenceSemantic, "target"> & {
  target: ModuleGeometryReferenceSemantic["target"] |
    Extract<ModuleGeometryPropertySourceTarget, { kind: "parameterProperty" }>;
};

type InlineEntry = {
  target: InlineModuleTargetIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "moduleInstance" }>;
  instance: ModuleInstanceSemantic;
  definition: ModuleDefinitionSemantic;
  activity: Activity;
  statementInfo: NonNullable<CompiledDslDocument["statementMap"]>["statements"][number];
  body: BodyRange;
  scalarParameters: readonly ScalarParameterLowering[];
  geometryArrayParameters: readonly GeometryArrayParameterLowering[];
  recordParameters: readonly RecordParameterLowering[];
  geometryParameters: readonly GeometryParameterSubstitution[];
  bodyTransformation: BodyTransformation;
};

type GeneratedParameterMapping = {
  parameterIndex: number;
  statementIndex: number;
  statementId: StatementIdentity;
  bindingId: string | null;
  initializerRange: { from: number; to: number };
};

type OwnerMapping = {
  targetStatementId: StatementIdentity;
  generatedGroupStatementId: StatementIdentity;
  bodyStatementIds: ReadonlyMap<StatementIdentity, StatementIdentity>;
  parameterBindings: ReadonlyMap<string, GeneratedParameterMapping>;
};

type OccurrenceSlot = {
  kind: DslSemanticOccurrence["kind"];
  token: string;
  ordinal: number;
  owners: readonly string[];
};

type ReferenceOccurrence = DslSemanticOccurrence & {
  sourceFrom: number;
  sourceTo: number;
};

type InitializerRewrite = {
  targetStatementId: StatementIdentity;
  parameterIndex: number;
  replacement: AbsoluteReplacement;
};

type GeometryArgumentRewrite = {
  targetStatementId: StatementIdentity;
  parameterIndex: number;
  replacement: AbsoluteReplacement;
};

type BodyStatementProvenance = {
  originalStatementId: StatementIdentity;
  outputLineIndex: number;
  originalParentStatementId: StatementIdentity | null;
  originalBranch: "then" | "else" | null;
  eliminatedSourceRanges: readonly ExactSourceRange[];
};

type BodyTransformation = {
  bodyLines: readonly string[];
  provenance: readonly BodyStatementProvenance[];
  geometrySubstitutions: readonly GeometrySubstitutionProvenance[];
  geometryArrayReferences: readonly GeometryArrayParameterReferenceProvenance[];
  recordReferences: readonly RecordReferenceProvenance[];
};

const reject = (
  code: InlineModuleRejectCode,
  message: string,
  target?: InlineModuleTargetIdentity
): InlineModuleRejection => ({
  status: "rejected",
  code,
  message,
  ...(target ? { target } : {})
});

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const cleanSemanticAnalysis = (compiled: CompiledDslDocument): boolean => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  return analysis !== undefined && !analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

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

const parameterSlotKey = (definitionStatementId: StatementIdentity, parameterIndex: number): string =>
  encodeIdentityTuple([definitionStatementId, String(parameterIndex)]);

const isSupportedScalarParameterType = (
  type: DslModuleParameter["type"]
): boolean =>
  type?.kind === "number" ||
  type?.kind === "string" ||
  type?.kind === "boolean" ||
  type?.kind === "choice";

const localParameterLoweringsFor = (entry: Pick<InlineEntry, "scalarParameters" | "geometryArrayParameters" | "recordParameters">) => [
  ...entry.scalarParameters
    .filter((parameter) => parameter.initializerSource !== null)
    .map((parameter) => ({ kind: "scalar" as const, parameter })),
  ...entry.geometryArrayParameters
    .filter((parameter) => parameter.initializerSource !== null)
    .map((parameter) => ({ kind: "geometryArray" as const, parameter })),
  ...entry.recordParameters
    .filter((parameter) => parameter.initializerSource !== null)
    .map((parameter) => ({ kind: "record" as const, parameter }))
].sort((left, right) => left.parameter.parameterIndex - right.parameter.parameterIndex);

const directChildEntriesForGroup = (
  compiled: CompiledDslDocument,
  groupIndex: number
): StatementEntry[] => compiled.statements
  .map((statement, statementIndex) => ({ statement, statementIndex }))
  .filter(({ statement, statementIndex }) =>
    statementIndex !== groupIndex &&
    statement.enclosing?.statementIndex === groupIndex &&
    statement.kind !== "blockEnd" &&
    statement.kind !== "blockElse"
  )
  .map(({ statement, statementIndex }) => ({
    statementId: statementIdAt(compiled, statementIndex)!,
    statementIndex,
    statement
  }))
  .filter((entry): entry is StatementEntry => entry.statementId !== null);

type InlinePresenceValue = {
  value: boolean;
  /** True only when the value is known because an optional-presence fact was specialized. */
  presenceDerived: boolean;
};

type SpecializedExpressionNode = {
  text: string;
  range: ExactSourceRange;
  changed: boolean;
  known: InlinePresenceValue | null;
  eliminatedSourceRanges: readonly ExactSourceRange[];
};

type ExpressionSpecializationResult =
  | {
      kind: "ok";
      text: string;
      changed: boolean;
      known: InlinePresenceValue | null;
      eliminatedSourceRanges: readonly ExactSourceRange[];
    }
  | { kind: "unsafe"; message: string };

type InlineGeometryExpressionReplacement = {
  text: string;
  range: ExactSourceRange;
};

const semanticSpanKey = (span: { start: number; end: number }): string => `${span.start}:${span.end}`;

const physicalRangeForLogicalSpan = (
  compiled: CompiledDslDocument,
  statement: DslStatement,
  span: { start: number; end: number }
): { from: number; to: number } | null =>
  singlePhysicalRange(exactPhysicalSpan(compiled.spans, statement, span), compiled.spans.sourceMap.sourceRevision);

const replaceNestedExpressionText = (
  source: string,
  range: ExactSourceRange,
  childRanges: readonly { range: ExactSourceRange; text: string }[]
): string | null => {
  const ordered = [...childRanges].sort((left, right) => left.range.from - right.range.from || left.range.to - right.range.to);
  let previousTo = range.from;
  for (const child of ordered) {
    if (
      child.range.from < range.from ||
      child.range.to > range.to ||
      child.range.from < previousTo
    ) return null;
    previousTo = child.range.to;
  }
  let text = source.slice(range.from, range.to);
  for (const child of ordered.reverse()) {
    const from = child.range.from - range.from;
    const to = child.range.to - range.from;
    text = `${text.slice(0, from)}${child.text}${text.slice(to)}`;
  }
  return text;
};

const eliminatedSourceRangesForChildren = (
  children: readonly SpecializedExpressionNode[]
): readonly ExactSourceRange[] => children.flatMap((child) => child.eliminatedSourceRanges);

const specializeInlineScalarExpression = (
  source: string,
  compiled: CompiledDslDocument,
  statement: DslStatement,
  semantic: ModuleScalarExpressionSemantic,
  presenceByParameter: ReadonlyMap<string, boolean>,
  geometryReplacements: ReadonlyMap<string, InlineGeometryExpressionReplacement> = new Map()
): ExpressionSpecializationResult => {
  const metadataBySpan = new Map<string, { definitionStatementId: StatementIdentity; parameterIndex: number }>();
  for (const metadata of semantic.hasValueParameters) {
    const key = semanticSpanKey(metadata.span);
    if (metadataBySpan.has(key)) {
      return { kind: "unsafe", message: "validated hasValue metadata に重複した semantic span があります。" };
    }
    if (!presenceByParameter.has(parameterSlotKey(metadata.definitionStatementId, metadata.parameterIndex))) {
      return { kind: "unsafe", message: "validated hasValue の optional parameter presence を target-local に解決できません。" };
    }
    metadataBySpan.set(key, metadata);
  }

  const nodeRanges = new Map<ScalarExpressionAst, { from: number; to: number }>();
  const rangeFor = (node: ScalarExpressionAst): { from: number; to: number } | null => {
    const existing = nodeRanges.get(node);
    if (existing) return existing;
    const range = physicalRangeForLogicalSpan(compiled, statement, node.span);
    if (range) nodeRanges.set(node, range);
    return range;
  };
  const astSpanKeys = new Set<string>();
  const astHasValueCallSpans = new Set<string>();
  const visitAst = (node: ScalarExpressionAst): void => {
    astSpanKeys.add(semanticSpanKey(node.span));
    if (node.kind === "call" && node.name === "hasValue") astHasValueCallSpans.add(semanticSpanKey(node.span));
    if (node.kind === "group" || node.kind === "unary") {
      visitAst(node.kind === "group" ? node.expression : node.operand);
      return;
    }
    if (node.kind === "binary") {
      visitAst(node.left);
      visitAst(node.right);
      return;
    }
    if (node.kind === "call") for (const argument of node.args) visitAst(argument.expression);
  };
  visitAst(semantic.ast);
  for (const key of astHasValueCallSpans) {
    if (!metadataBySpan.has(key)) {
      return { kind: "unsafe", message: "Module-only hasValue occurrence が compiler metadata と一致しません。" };
    }
  }
  for (const key of metadataBySpan.keys()) {
    if (!astSpanKeys.has(key)) {
      return { kind: "unsafe", message: "validated hasValue metadata の exact semantic span が AST にありません。" };
    }
  }

  const specialize = (node: ScalarExpressionAst): SpecializedExpressionNode | null => {
    const range = rangeFor(node);
    if (!range) return null;
    const original = source.slice(range.from, range.to);
    const child = (nodes: readonly ScalarExpressionAst[]): SpecializedExpressionNode[] | null => {
      const result = nodes.map(specialize);
      return result.some((item) => item === null) ? null : result as SpecializedExpressionNode[];
    };
    const metadata = metadataBySpan.get(semanticSpanKey(node.span));
    if (metadata) {
      const value = presenceByParameter.get(parameterSlotKey(metadata.definitionStatementId, metadata.parameterIndex));
      if (value === undefined) return null;
      return {
        text: value ? "true" : "false",
        range,
        changed: true,
        known: { value, presenceDerived: true },
        eliminatedSourceRanges: [range]
      };
    }
    const geometryReplacement = geometryReplacements.get(semanticSpanKey(node.span));
    if (geometryReplacement && (
      geometryReplacement.range.from !== range.from ||
      geometryReplacement.range.to !== range.to
    )) return null;
    if (node.kind === "booleanLiteral") {
      return {
        text: original,
        range,
        changed: false,
        known: { value: node.value, presenceDerived: false },
        eliminatedSourceRanges: []
      };
    }
    if (node.kind === "group") {
      const expression = specialize(node.expression);
      if (!expression) return null;
      const text = replaceNestedExpressionText(source, range, [{ range: expression.range, text: expression.text }]);
      if (text === null) return null;
      return {
        text,
        range,
        changed: expression.changed,
        known: expression.known,
        eliminatedSourceRanges: expression.eliminatedSourceRanges
      };
    }
    if (node.kind === "unary") {
      const operand = specialize(node.operand);
      if (!operand) return null;
      if (node.operator === "!" && operand.known?.presenceDerived) {
        return {
          text: operand.known.value ? "false" : "true",
          range,
          changed: true,
          known: { value: !operand.known.value, presenceDerived: true },
          eliminatedSourceRanges: [range]
        };
      }
      const text = replaceNestedExpressionText(source, range, [{ range: operand.range, text: operand.text }]);
      if (text === null) return null;
      return {
        text,
        range,
        changed: operand.changed,
        known: operand.known,
        eliminatedSourceRanges: operand.eliminatedSourceRanges
      };
    }
    if (node.kind === "binary") {
      const operands = child([node.left, node.right]);
      if (!operands) return null;
      const left = operands[0]!;
      const right = operands[1]!;
      const leftPresence = left.known?.presenceDerived === true;
      const rightPresence = right.known?.presenceDerived === true;
      const identityResult = (
        selected: SpecializedExpressionNode,
        eliminated: SpecializedExpressionNode
      ): SpecializedExpressionNode => ({
        text: selected.text,
        range,
        changed: true,
        known: selected.known
          ? { value: selected.known.value, presenceDerived: true }
          : null,
        eliminatedSourceRanges: [eliminated.range, ...selected.eliminatedSourceRanges]
      });
      if (node.operator === "&&") {
        if (leftPresence) {
          if (!left.known!.value) {
            return {
              text: "false",
              range,
              changed: true,
              known: { value: false, presenceDerived: true },
              eliminatedSourceRanges: [range]
            };
          }
          return identityResult(right, left);
        }
        if (rightPresence) {
          if (!right.known!.value) {
            return {
              text: "false",
              range,
              changed: true,
              known: { value: false, presenceDerived: true },
              eliminatedSourceRanges: [range]
            };
          }
          return identityResult(left, right);
        }
      }
      if (node.operator === "||") {
        if (leftPresence) {
          if (left.known!.value) {
            return {
              text: "true",
              range,
              changed: true,
              known: { value: true, presenceDerived: true },
              eliminatedSourceRanges: [range]
            };
          }
          return identityResult(right, left);
        }
        if (rightPresence) {
          if (right.known!.value) {
            return {
              text: "true",
              range,
              changed: true,
              known: { value: true, presenceDerived: true },
              eliminatedSourceRanges: [range]
            };
          }
          return identityResult(left, right);
        }
      }
      const text = replaceNestedExpressionText(source, range, [
        { range: left.range, text: left.text },
        { range: right.range, text: right.text }
      ]);
      if (text === null) return null;
      return {
        text,
        range,
        changed: left.changed || right.changed,
        known: null,
        eliminatedSourceRanges: eliminatedSourceRangesForChildren([left, right])
      };
    }
    if (node.kind === "call") {
      const argumentsResult = child(node.args.map((argument) => argument.expression));
      if (!argumentsResult) return null;
      const text = replaceNestedExpressionText(
        source,
        range,
        argumentsResult.map((argument) => ({ range: argument.range, text: argument.text }))
      );
      if (text === null) return null;
      return {
        text,
        range,
        changed: argumentsResult.some((argument) => argument.changed),
        known: null,
        eliminatedSourceRanges: eliminatedSourceRangesForChildren(argumentsResult)
      };
    }
    return {
      text: geometryReplacement?.text ?? original,
      range,
      changed: geometryReplacement !== undefined,
      known: null,
      eliminatedSourceRanges: []
    };
  };

  const result = specialize(semantic.ast);
  if (!result) return { kind: "unsafe", message: "hasValue specialization の exact physical source span を解決できません。" };
  return {
    kind: "ok",
    text: result.text,
    changed: result.changed,
    known: result.known,
    eliminatedSourceRanges: result.eliminatedSourceRanges
  };
};

const prepareScalarParameterLowering = (
  source: string,
  sourceRevision: number,
  compiled: CompiledDslDocument,
  entry: {
    statement: Extract<DslStatement, { kind: "moduleInstance" }>;
    instance: ModuleInstanceSemantic;
    definition: ModuleDefinitionSemantic;
  }
): ScalarParameterPreparation => {
  const definitionStatement = compiled.statements[entry.definition.statementIndex];
  if (definitionStatement?.kind !== "moduleDefinition") {
    return {
      kind: "unsafe",
      code: "unsafe-rewrite",
      message: "Resolved Module definition の authored parameter source を取得できません。"
    };
  }
  if (entry.definition.parameters.length === 0 && entry.instance.parameterBindings.length === 0) {
    return { kind: "supported", scalarParameters: [], geometryArrayParameters: [], recordParameters: [], geometryParameters: [] };
  }
  if (
    definitionStatement.parameters.length !== entry.definition.parameters.length ||
    entry.instance.parameterBindings.length !== entry.definition.parameters.length
  ) {
    return {
      kind: "unsafe",
      code: "unsafe-rewrite",
      message: "Module parameter と compiler binding の source-order mapping を証明できません。"
    };
  }

  const bindingsByParameterIndex = new Map<number, ResolvedModuleParameterBinding>();
  for (const binding of entry.instance.parameterBindings) {
    if (bindingsByParameterIndex.has(binding.parameterIndex)) {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: "Module parameter binding に重複した parameterIndex があります。"
      };
    }
    bindingsByParameterIndex.set(binding.parameterIndex, binding);
  }

  const scalarParameters: ScalarParameterLowering[] = [];
  const geometryArrayParameters: GeometryArrayParameterLowering[] = [];
  const recordParameters: RecordParameterLowering[] = [];
  const geometryParameters: GeometryParameterSubstitution[] = [];
  for (const resolvedParameter of entry.definition.parameters) {
    const parameterIndex = resolvedParameter.parameterIndex;
    const parameter = definitionStatement.parameters[parameterIndex];
    const binding = bindingsByParameterIndex.get(parameterIndex);
    if (!parameter || !binding || parameterIndex !== scalarParameters.length + geometryArrayParameters.length + recordParameters.length + geometryParameters.length) {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: "Module parameter の authored source order と compiler binding mapping が一致しません。"
      };
    }
    const parameterType = parameter.type;
    const optional = parameter.optional || resolvedParameter.optional;
    const geometryArrayType = geometryArrayTypeOfModuleParameter(parameter);
    const geometryInterfaceType = parameterType?.kind === "point" || parameterType?.kind === "line" || parameterType?.kind === "path"
      ? parameterType.kind
      : null;
    const scalarParameter = !parameter.recordTypeReference && !geometryArrayType && isSupportedScalarParameterType(parameterType);
    const geometryArrayParameter = geometryArrayType !== null;
    const recordParameter = parameter.recordTypeReference !== null && parameter.recordTypeReference !== undefined;
    const recordTypeIdentity = resolvedParameter.recordTypeIdentity;
    if (!recordParameter && recordTypeIdentity !== null) {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: `Module parameter「${resolvedParameter.name}」の record nominal type metadata と source type が一致しません。`
      };
    }
    const parameterTypeMatches = recordParameter
      ? binding.parameterType === null
      : binding.parameterType?.kind === parameterType?.kind;
    if (
      (!scalarParameter && !geometryArrayParameter && !recordParameter && geometryInterfaceType === null) ||
      !parameterTypeMatches
    ) {
      return {
        kind: "unsupported",
        reason: "geometry-array / unsupported Module parameter はこの Checkpoint では lowering しません。"
      };
    }
    if (recordParameter && !recordTypeIdentity) {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: `record Module parameter「${resolvedParameter.name}」の compiler-owned nominal type identity を解決できません。`
      };
    }
    if (optional && binding.state !== "optionalSupplied" && binding.state !== "optionalOmitted") {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: `optional Module parameter「${resolvedParameter.name}」の compiler binding state が一致しません。`
      };
    }
    if (!optional && binding.state !== "requiredSupplied" && binding.state !== "defaultedOmitted") {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: `required Module parameter「${resolvedParameter.name}」の compiler binding state が一致しません。`
      };
    }

    const nameRange = singlePhysicalRange(parameter.namePhysicalSpan, sourceRevision);
    const typeRange = singlePhysicalRange(parameter.typePhysicalSpan, sourceRevision);
    if (!nameRange || !typeRange || nameRange.from >= nameRange.to || typeRange.from >= typeRange.to) {
      return {
        kind: "unsafe",
        code: "unsafe-source-span",
        message: "Module parameter の exact-current name/type source span を解決できません。"
      };
    }

    if (recordParameter) {
      if (parameter.defaultValue !== null || resolvedParameter.defaultValue !== null || binding.usesDefault) {
        return {
          kind: "unsupported",
          reason: "record Module parameter の default はこの Inline slice では lowering しません。"
        };
      }
      if (binding.state === "optionalOmitted") {
        if (binding.argumentIndex !== null || binding.argumentSpan !== null || binding.usesDefault || binding.value !== null) {
          return {
            kind: "unsafe",
            code: "unsafe-rewrite",
            message: `optional omitted record Module parameter「${resolvedParameter.name}」の compiler binding が一致しません。`
          };
        }
        recordParameters.push({
          parameterIndex,
          parameterName: resolvedParameter.name,
          parameter,
          recordTypeIdentity: recordTypeIdentity!,
          state: "optionalOmitted",
          nameSource: source.slice(nameRange.from, nameRange.to),
          typeSource: source.slice(typeRange.from, typeRange.to),
          initializerSource: null,
          originalExpressionRange: null,
          reference: null
        });
        continue;
      }
      if (binding.state !== "requiredSupplied" && binding.state !== "optionalSupplied") {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `record Module parameter「${resolvedParameter.name}」の compiler binding state が一致しません。`
        };
      }
      if (binding.argumentIndex === null || binding.argumentIndex < 0) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `record Module parameter「${resolvedParameter.name}」の compiler argumentIndex がありません。`
        };
      }
      const argument = entry.statement.arguments[binding.argumentIndex];
      const argumentRange = argument
        ? singlePhysicalRange(argument.valuePhysicalSpan, sourceRevision)
        : null;
      const reference = binding.value?.kind === "record" ? binding.value.reference : null;
      const targetTypeIdentity = reference?.target?.typeIdentity ?? reference?.constructor?.targetTypeIdentity ?? null;
      if (
        !argument ||
        !binding.argumentSpan ||
        binding.argumentSpan.start !== argument.valueSpan.start ||
        binding.argumentSpan.end !== argument.valueSpan.end ||
        !argumentRange ||
        argumentRange.from >= argumentRange.to ||
        !reference ||
        reference.span.start !== argument.valueSpan.start ||
        reference.span.end !== argument.valueSpan.end ||
        reference.source !== source.slice(argumentRange.from, argumentRange.to) ||
        reference.resolution !== "resolved" ||
        reference.typeIdentity !== recordTypeIdentity ||
        targetTypeIdentity !== recordTypeIdentity ||
        (reference.constructor === null && reference.target === null) ||
        (reference.constructor !== null && reference.target !== null)
      ) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `record Module parameter「${resolvedParameter.name}」の compiler record argument binding / nominal identity を証明できません。`
        };
      }
      recordParameters.push({
        parameterIndex,
        parameterName: resolvedParameter.name,
        parameter,
        recordTypeIdentity: recordTypeIdentity!,
        state: binding.state === "optionalSupplied" ? "optionalSupplied" : "requiredSupplied",
        nameSource: source.slice(nameRange.from, nameRange.to),
        typeSource: source.slice(typeRange.from, typeRange.to),
        initializerSource: source.slice(argumentRange.from, argumentRange.to),
        originalExpressionRange: argumentRange,
        reference
      });
      continue;
    }

    if (geometryArrayType) {
      const arrayAnalysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
      const semanticParameter = arrayAnalysis?.moduleParametersBySlot.get(`${entry.definition.statementId}:${parameterIndex}`);
      if (!semanticParameter || semanticParameter.type.elementType !== geometryArrayType.elementType) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の geometry-array semantic owner を証明できません。`
        };
      }
      if (
        parameter.defaultValue !== null ||
        resolvedParameter.defaultValue !== null ||
        binding.usesDefault ||
        binding.state === "defaultedOmitted" ||
        binding.state === "requiredOmitted"
      ) {
        return {
          kind: "unsupported",
          reason: "required omitted / defaulted geometry-array parameter はこの Checkpoint では lowering しません。"
        };
      }
      if (binding.state === "optionalOmitted") {
        if (binding.argumentIndex !== null || binding.argumentSpan !== null || binding.usesDefault || binding.value !== null) {
          return {
            kind: "unsafe",
            code: "unsafe-rewrite",
            message: `optional omitted geometry-array Module parameter「${resolvedParameter.name}」の compiler binding が一致しません。`
          };
        }
        geometryArrayParameters.push({
          parameterIndex,
          parameterName: resolvedParameter.name,
          parameter,
          arrayType: geometryArrayType,
          state: "optionalOmitted",
          nameSource: source.slice(nameRange.from, nameRange.to),
          typeSource: source.slice(typeRange.from, typeRange.to),
          initializerSource: null,
          originalExpressionRange: null
        });
        continue;
      }
      if (binding.state !== "requiredSupplied" && binding.state !== "optionalSupplied") {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `geometry-array Module parameter「${resolvedParameter.name}」の compiler binding state が一致しません。`
        };
      }
      if (binding.argumentIndex === null || binding.argumentIndex < 0) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler argumentIndex がありません。`
        };
      }
      const argument = entry.statement.arguments[binding.argumentIndex];
      const argumentRange = argument
        ? singlePhysicalRange(argument.valuePhysicalSpan, sourceRevision)
        : null;
      if (
        !argument ||
        !binding.argumentSpan ||
        binding.argumentSpan.start !== argument.valueSpan.start ||
        binding.argumentSpan.end !== argument.valueSpan.end ||
        !argumentRange ||
        argumentRange.from >= argumentRange.to
      ) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler geometry-array argument binding を証明できません。`
        };
      }
      geometryArrayParameters.push({
        parameterIndex,
        parameterName: resolvedParameter.name,
        parameter,
        arrayType: geometryArrayType,
        state: binding.state,
        nameSource: source.slice(nameRange.from, nameRange.to),
        typeSource: source.slice(typeRange.from, typeRange.to),
        initializerSource: source.slice(argumentRange.from, argumentRange.to),
        originalExpressionRange: argumentRange
      });
      continue;
    }
    if (geometryInterfaceType !== null) {
      if (binding.state === "requiredOmitted" || binding.state === "defaultedOmitted") {
        return {
          kind: "unsupported",
          reason: "required omitted / defaulted geometry parameter はこの Checkpoint では lowering しません。"
        };
      }
      if (!optional && binding.state !== "requiredSupplied") {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `required geometry Module parameter「${resolvedParameter.name}」の compiler binding state が一致しません。`
        };
      }
      if (binding.state === "optionalOmitted") {
        if (binding.argumentIndex !== null || binding.argumentSpan !== null || binding.usesDefault || binding.value !== null) {
          return {
            kind: "unsafe",
            code: "unsafe-rewrite",
            message: `optional omitted geometry Module parameter「${resolvedParameter.name}」の compiler binding が一致しません。`
          };
        }
        geometryParameters.push({
          parameterIndex,
          parameterName: resolvedParameter.name,
          parameter,
          interfaceType: geometryInterfaceType,
          state: "optionalOmitted",
          argumentSource: null,
          argumentRange: null,
          argumentReference: null,
          expectedOwner: null
        });
        continue;
      }
      if (binding.argumentIndex === null || binding.argumentIndex < 0) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler argumentIndex がありません。`
        };
      }
      const argument = entry.statement.arguments[binding.argumentIndex];
      const argumentRange = argument
        ? singlePhysicalRange(argument.valuePhysicalSpan, sourceRevision)
        : null;
      const argumentReference = binding.value?.kind === "geometry" ? binding.value.reference : null;
      if (
        !argument ||
        !binding.argumentSpan ||
        binding.argumentSpan.start !== argument.valueSpan.start ||
        binding.argumentSpan.end !== argument.valueSpan.end ||
        binding.value?.kind !== "geometry" ||
        !argumentReference ||
        argumentReference.span.start !== argument.valueSpan.start ||
        argumentReference.span.end !== argument.valueSpan.end ||
        argumentReference.source !== source.slice(argumentRange?.from ?? 0, argumentRange?.to ?? 0) ||
        (argumentReference.resolution !== "resolved" && argumentReference.resolution !== "deferred") ||
        (argumentReference.coordinate === null && argumentReference.target === null) ||
        (argumentReference.coordinate !== null && argumentReference.target !== null) ||
        argumentReference.expectedGeometryKind !== (geometryInterfaceType === "point" ? "point" : "line") ||
        !argumentRange ||
        argumentRange.from >= argumentRange.to
      ) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler geometry argument binding を証明できません。`
        };
      }
      const expectedOwner = geometryOwnerForReference(compiled, argumentReference);
      if (!expectedOwner) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の caller geometry owner を証明できません。`
        };
      }
      geometryParameters.push({
        parameterIndex,
        parameterName: resolvedParameter.name,
        parameter,
        interfaceType: geometryInterfaceType,
        state: binding.state === "optionalSupplied" ? "optionalSupplied" : "requiredSupplied",
        argumentSource: source.slice(argumentRange.from, argumentRange.to),
        argumentRange,
        argumentReference,
        expectedOwner
      });
      continue;
    }

    let initializerRange: { from: number; to: number } | null = null;
    if (binding.state === "requiredSupplied" || binding.state === "optionalSupplied") {
      if (binding.argumentIndex === null || binding.argumentIndex < 0) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler argumentIndex がありません。`
        };
      }
      const argument = entry.statement.arguments[binding.argumentIndex];
      if (!argument || binding.value?.kind !== "scalar") {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `Module parameter「${resolvedParameter.name}」の compiler argument binding が scalar value と一致しません。`
        };
      }
      initializerRange = singlePhysicalRange(argument.valuePhysicalSpan, sourceRevision);
    } else if (binding.state === "defaultedOmitted") {
      if (
        binding.argumentIndex !== null ||
        parameter.defaultValue === null ||
        resolvedParameter.defaultValue === null ||
        !binding.usesDefault ||
        binding.value?.kind !== "scalar"
      ) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `defaulted Module parameter「${resolvedParameter.name}」の compiler default binding が一致しません。`
        };
      }
      initializerRange = singlePhysicalRange(parameter.defaultPhysicalSpan, sourceRevision);
    } else if (binding.state === "optionalOmitted") {
      if (binding.argumentIndex !== null || binding.usesDefault || binding.value !== null) {
        return {
          kind: "unsafe",
          code: "unsafe-rewrite",
          message: `optional omitted Module parameter「${resolvedParameter.name}」の compiler binding が一致しません。`
        };
      }
    } else {
      return {
        kind: "unsupported",
        reason: "required omitted Module parameter はこの Checkpoint では lowering しません."
      };
    }
    if (initializerRange && initializerRange.from >= initializerRange.to) {
      return {
        kind: "unsafe",
        code: "unsafe-source-span",
        message: `Module parameter「${resolvedParameter.name}」の exact-current value/default source span を解決できません。`
      };
    }
    scalarParameters.push({
      parameterIndex,
      parameterName: resolvedParameter.name,
      parameter,
      state: binding.state,
      nameSource: source.slice(nameRange.from, nameRange.to),
      typeSource: source.slice(typeRange.from, typeRange.to),
      initializerSource: initializerRange ? source.slice(initializerRange.from, initializerRange.to) : null,
      originalExpressionRange: initializerRange,
      eliminatedSourceRanges: []
    });
  }
  return { kind: "supported", scalarParameters, geometryArrayParameters, recordParameters, geometryParameters };
};

const specializeDefaultInitializersFor = (
  source: string,
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  presenceByParameter: ReadonlyMap<string, boolean>
): { kind: "ok"; parameters: readonly ScalarParameterLowering[] } | { kind: "unsafe"; message: string } => {
  const definitionStatement = compiled.statements[entry.definition.statementIndex];
  if (definitionStatement?.kind !== "moduleDefinition") {
    return { kind: "unsafe", message: "Module default initializer の authored definition source を取得できません。" };
  }
  const parameters: ScalarParameterLowering[] = [];
  for (const parameter of entry.scalarParameters) {
    if (parameter.state !== "defaultedOmitted" || parameter.initializerSource === null) {
      parameters.push(parameter);
      continue;
    }
    const resolved = entry.definition.parameters[parameter.parameterIndex];
    if (!resolved?.defaultExpression || resolved.defaultExpression.hasValueParameters.length === 0) {
      parameters.push(parameter);
      continue;
    }
    const specialized = specializeInlineScalarExpression(
      source,
      compiled,
      definitionStatement,
      resolved.defaultExpression,
      presenceByParameter
    );
    if (specialized.kind === "unsafe") return specialized;
    parameters.push(specialized.changed
      ? {
          ...parameter,
          initializerSource: specialized.text,
          eliminatedSourceRanges: specialized.eliminatedSourceRanges
        }
      : parameter);
  }
  return { kind: "ok", parameters };
};

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

const statementIdAt = (
  compiled: CompiledDslDocument,
  statementIndex: number
): StatementIdentity | null =>
  compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? null;

const statementIndexForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): number | null => {
  const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
  return statementIndex === undefined ? null : statementIndex;
};

const statementEntryForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): StatementEntry | null => {
  const statementIndex = statementIndexForId(compiled, statementId);
  const statement = statementIndex === null ? undefined : compiled.statements[statementIndex];
  return statementIndex === null || !statement ? null : { statementId, statementIndex, statement };
};

const inlineOpenBraceLine = (
  source: string,
  starts: readonly number[],
  statement: DslStatement
): number | null => {
  const physical = statement.physicalSpan.segments;
  for (const segment of physical) {
    const brace = source.indexOf("{", segment.from);
    if (brace >= segment.to) continue;
    const line = starts.findIndex((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1]! : source.length + 1;
      return start <= brace && brace < end;
    });
    if (line >= 0) return line + 1;
  }
  return null;
};

const bodyEntriesForDefinition = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): readonly StatementEntry[] | null => {
  const entries: StatementEntry[] = [];
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind === "blockEnd" || statement.kind === "blockElse") continue;
    if (statementIndex === definition.statementIndex) continue;
    let current = statement.enclosing?.statementIndex ?? null;
    const visited = new Set<number>();
    let ownedByDefinition = false;
    while (current !== null && !visited.has(current)) {
      if (current === definition.statementIndex) {
        ownedByDefinition = true;
        break;
      }
      visited.add(current);
      current = compiled.statements[current]?.enclosing?.statementIndex ?? null;
    }
    if (!ownedByDefinition) continue;
    const statementId = statementIdAt(compiled, statementIndex);
    if (!statementId) return null;
    entries.push({ statementId, statementIndex, statement });
  }
  return entries.sort((left, right) => left.statementIndex - right.statementIndex);
};

const bodyRequiresUnsupportedTypedLowering = (
  entries: readonly StatementEntry[]
): boolean => entries.some(({ statement }) =>
  statement.kind === "typedDeclaration" &&
  (statement.recordTypeReference !== null || geometryArrayTypeOfTypedDeclaration(statement) !== null)
);

const bodyRangeForDefinition = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): BodyRange | null => {
  const statement = compiled.statements[definition.statementIndex];
  const info = compiled.statementMap?.statements[definition.statementIndex];
  if (!statement || statement.kind !== "moduleDefinition" || !info) return null;
  const openBraceLine = info.openBraceLine ?? inlineOpenBraceLine(source, starts, statement);
  const closeBraceLine = info.closeBraceLine;
  if (openBraceLine === null || closeBraceLine === undefined || closeBraceLine <= openBraceLine) return null;

  const bodyStartLine = openBraceLine + 1;
  const bodyEndLine = closeBraceLine - 1;
  const definitionLine = source.slice(
    starts[info.line - 1]!,
    lineEndOffset(source, starts, info.line)
  );
  const definitionIndent = leadingWhitespace(definitionLine);
  const entries = bodyEntriesForDefinition(compiled, definition);
  if (!entries) return null;
  if (bodyStartLine > bodyEndLine) {
    const insertion = starts[closeBraceLine - 1];
    return insertion === undefined
      ? null
      : { from: insertion, to: insertion, bodyLines: [], definitionIndent, definitionStatementIndex: definition.statementIndex, entries };
  }

  const from = starts[bodyStartLine - 1];
  const to = lineEndOffset(source, starts, bodyEndLine);
  if (from === undefined || from > to) return null;
  return {
    from,
    to,
    bodyLines: source.slice(from, to).split("\n"),
    definitionIndent,
    definitionStatementIndex: definition.statementIndex,
    entries
  };
};

type BodyTransformationResult =
  | { kind: "ok"; transformation: BodyTransformation }
  | { kind: "unsafe"; message: string };

const lineStartFor = (starts: readonly number[], line: number): number | null =>
  line >= 1 && line <= starts.length ? starts[line - 1] ?? null : null;

const sourceRangeForLines = (
  source: string,
  starts: readonly number[],
  startLine: number,
  endLine: number
): { from: number; to: number } | null => {
  if (startLine > endLine) return null;
  const from = lineStartFor(starts, startLine);
  const to = lineEndOffset(source, starts, endLine);
  return from === null || from > to ? null : { from, to };
};

const commentSourceLine = (line: string, baseIndent: string): string => {
  if (line.trim().length === 0) return `${baseIndent}//`;
  const relative = line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line.trimStart();
  return `${baseIndent}// ${relative}`;
};

const liftConditionalBranchLines = (
  lines: readonly string[],
  conditionalIndent: string
): string[] => {
  const branchIndent = `${conditionalIndent}${DSL_INDENT}`;
  return lines.map((line) => line.startsWith(branchIndent) ? `${conditionalIndent}${line.slice(branchIndent.length)}` : line);
};

const bodyStatementSemanticFor = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
) => {
  const analysis = semanticAnalysisFor(compiled);
  for (const definition of analysis?.definitions ?? []) {
    const body = definition.bodyStatements.find((candidate) => candidate.statementId === statementId);
    if (body) return body;
  }
  return null;
};

const geometryParameterForSlot = (
  entry: InlineEntry,
  definitionStatementId: StatementIdentity,
  parameterIndex: number
): GeometryParameterSubstitution | null => {
  if (definitionStatementId !== entry.definition.statementId) return null;
  return entry.geometryParameters.find((parameter) => parameter.parameterIndex === parameterIndex) ?? null;
};

const geometryArrayParameterForSlot = (
  entry: InlineEntry,
  parameterIndex: number
): GeometryArrayParameterLowering | null =>
  entry.geometryArrayParameters.find((parameter) => parameter.parameterIndex === parameterIndex) ?? null;

const geometryArrayParameterReferencesForStatement = (
  source: string,
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  bodyEntry: StatementEntry
): GeometryArrayParameterReferenceProvenance[] => {
  if (bodyEntry.statement.kind !== "element" || !bodyEntry.statement.type) return [];
  const spec = constructionFor(bodyEntry.statement.category, bodyEntry.statement.construction);
  if (!spec) return [];
  const definitionsByArg = new Map(
    getParameterDefinitions({ type: bodyEntry.statement.type, intermediatePoints: [] } as never)
      .map((parameter) => [parameter.key, parameter] as const)
  );
  const sites: GeometryArrayParameterReferenceProvenance[] = [];
  for (const arg of [...spec.args, ...commonArgSpecs]) {
    const parameter = arg.parameterKey ? definitionsByArg.get(arg.parameterKey) : definitionsByArg.get(arg.arg);
    const isArrayConsumer = arg.special === "points" || parameter?.kind === "lineReferenceList";
    if (!isArrayConsumer) continue;
    const valueSpan = bodyEntry.statement.payloadSpans[arg.arg] ?? (arg.parameterKey ? bodyEntry.statement.payloadSpans[arg.parameterKey] : undefined);
    if (!valueSpan) continue;
    const range = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, valueSpan);
    if (!range || range.from >= range.to) continue;
    const parsed = parseDslSourceReference(source.slice(range.from, range.to));
    if (parsed.kind !== "valid" || parsed.reference.property || parsed.reference.path.absolute || parsed.reference.path.segments.length !== 1) continue;
    const arrayParameter = entry.geometryArrayParameters.find((candidate) =>
      candidate.parameterName === parsed.reference.path.segments[0]
    );
    if (!arrayParameter) continue;
    sites.push({
      originalStatementId: bodyEntry.statementId,
      parameterIndex: arrayParameter.parameterIndex,
      bodySourceRange: range
    });
  }
  return sites;
};

type GeometrySubstitutionResult =
  | { kind: "none" }
  | { kind: "ok"; replacement: AbsoluteReplacement; provenance: GeometrySubstitutionProvenance }
  | { kind: "unsafe"; message: string };

const geometrySubstitutionFor = (
  source: string,
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  bodyEntry: StatementEntry,
  reference: GeometrySubstitutionReference,
  siteKind: GeometrySubstitutionProvenance["siteKind"],
  property: string | null = null
): GeometrySubstitutionResult => {
  const target = reference.target;
  const slotTarget = target && (target.kind === "parameter" || target.kind === "parameterProperty") ? target : null;
  if (!slotTarget) return { kind: "none" };
  const parameter = geometryParameterForSlot(entry, slotTarget.definitionStatementId, slotTarget.parameterIndex);
  if (!parameter) {
    if (slotTarget.definitionStatementId === entry.definition.statementId) {
      return { kind: "unsafe", message: "Module body geometry parameter の target slot を解決できません。" };
    }
    return { kind: "none" };
  }
  if (parameter.state === "optionalOmitted") return { kind: "none" };
  if (
    parameter.argumentSource === null ||
    parameter.argumentRange === null ||
    parameter.argumentReference === null ||
    parameter.expectedOwner === null
  ) return { kind: "unsafe", message: "supplied geometry parameter の caller source provenance がありません。" };

  const bodyRange = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, reference.span);
  if (!bodyRange || bodyRange.from >= bodyRange.to) {
    return { kind: "unsafe", message: "Module body geometry reference の exact physical source span を解決できません。" };
  }
  let propertySuffix = property === null ? "" : `.${property}`;
  if (siteKind === "direct") {
    const parsed = parseDslSourceReference(source.slice(bodyRange.from, bodyRange.to));
    if (parsed.kind !== "valid") {
      return { kind: "unsafe", message: "Module body geometry reference の source form を検証できません。" };
    }
    propertySuffix = parsed.reference.property ? `.${parsed.reference.property}` : "";
  }
  if (propertySuffix && parameter.argumentReference.coordinate !== null) {
    return {
      kind: "unsafe",
      message: "coordinate geometry argument を source-reference-only geometry property として移動できません。"
    };
  }
  if (siteKind === "builtin" && parameter.argumentReference.coordinate !== null) {
    return {
      kind: "unsafe",
      message: "coordinate geometry argument を scalar geometry builtin operand として移動できません。"
    };
  }
  const emittedSource = `${parameter.argumentSource}${propertySuffix}`;
  return {
    kind: "ok",
    replacement: { from: bodyRange.from, to: bodyRange.to, text: emittedSource },
    provenance: {
      originalStatementId: bodyEntry.statementId,
      parameterDefinitionStatementId: entry.definition.statementId,
      parameterIndex: slotTarget.parameterIndex,
      bodySourceRange: bodyRange,
      callerArgumentRange: parameter.argumentRange,
      callerArgumentSource: parameter.argumentSource,
      emittedSource,
      callerReference: parameter.argumentReference,
      expectedOwner: parameter.expectedOwner,
      siteKind
    }
  };
};

const buildBodyTransformation = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  presenceByParameter: ReadonlyMap<string, boolean>,
  emitOmittedBranchComments: boolean
): BodyTransformationResult => {
  const bodyInfo = compiled.statementMap?.statements[entry.definition.statementIndex];
  const definitionStatement = compiled.statements[entry.definition.statementIndex];
  const openBraceLine = bodyInfo && definitionStatement?.kind === "moduleDefinition"
    ? bodyInfo.openBraceLine ?? inlineOpenBraceLine(source, starts, definitionStatement)
    : null;
  if (!bodyInfo || openBraceLine === null || bodyInfo.closeBraceLine === undefined) {
    return { kind: "unsafe", message: "Module body の structural source range を解決できません。" };
  }
  const exportReplacements = exportedTokenReplacements(source, compiled, entry.body);
  if (!exportReplacements) return { kind: "unsafe", message: "Module export marker の exact-current source span を解決できません。" };
  const eliminatedSourceRangesByStatement = new Map<StatementIdentity, ExactSourceRange[]>();
  const geometrySubstitutions: GeometrySubstitutionProvenance[] = [];
  const geometryArrayReferences: GeometryArrayParameterReferenceProvenance[] = [];
  const recordReferences: RecordReferenceProvenance[] = [];
  const rememberEliminatedSourceRanges = (
    statementId: StatementIdentity,
    ranges: readonly ExactSourceRange[]
  ): void => {
    if (ranges.length === 0) return;
    const existing = eliminatedSourceRangesByStatement.get(statementId) ?? [];
    eliminatedSourceRangesByStatement.set(statementId, [...existing, ...ranges]);
  };
  const eliminatedSourceRangesFor = (statementId: StatementIdentity): readonly ExactSourceRange[] =>
    eliminatedSourceRangesByStatement.get(statementId) ?? [];
  const replacementsByStatement = new Map<StatementIdentity, AbsoluteReplacement[]>();
  const replacementsForEntry = (
    bodyEntry: StatementEntry,
    includeCondition: boolean
  ): {
    kind: "ok";
    replacements: readonly AbsoluteReplacement[];
    geometrySubstitutions: readonly GeometrySubstitutionProvenance[];
  } | { kind: "unsafe"; message: string } => {
    const semantic = bodyStatementSemanticFor(compiled, bodyEntry.statementId);
    if (!semantic) {
      // A nested module definition owns its own body semantics. Its header is
      // copied as authored source; descendants are visited through their own
      // compiler-owned ModuleDefinitionSemantic below.
      if (bodyEntry.statement.kind === "moduleDefinition") return { kind: "ok", replacements: [], geometrySubstitutions: [] };
      return { kind: "unsafe", message: "Module body statement の semantic owner がありません。" };
    }
    geometryArrayReferences.push(...geometryArrayParameterReferencesForStatement(source, compiled, entry, bodyEntry));
    const rememberRecordReferences = (
      expression: ModuleScalarExpressionSemantic
    ): { kind: "ok" } | { kind: "unsafe"; message: string } => {
      for (const reference of expression.geometryProperties) {
        if (reference.target?.kind !== "recordField") continue;
        const bodySourceRange = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, reference.span);
        if (!bodySourceRange || bodySourceRange.from >= bodySourceRange.to) {
          return { kind: "unsafe", message: "Module body record field reference の exact physical source span を解決できません。" };
        }
        recordReferences.push({
          originalStatementId: bodyEntry.statementId,
          bodySourceRange,
          record: reference.target.record,
          field: reference.target.field,
          source: source.slice(bodySourceRange.from, bodySourceRange.to)
        });
      }
      return { kind: "ok" };
    };
    const replacements: AbsoluteReplacement[] = [];
    const eliminatedSourceRanges: ExactSourceRange[] = [];
    const substitutions: GeometrySubstitutionProvenance[] = [];
    const geometryReplacements = new Map<string, InlineGeometryExpressionReplacement>();
    const addGeometryReplacement = (
      result: GeometrySubstitutionResult,
      semanticSpan: { start: number; end: number }
    ): { kind: "ok" } | { kind: "unsafe"; message: string } => {
      if (result.kind === "none") return { kind: "ok" };
      if (result.kind === "unsafe") return result;
      const key = semanticSpanKey(semanticSpan);
      const existing = geometryReplacements.get(key);
      if (existing && (
        existing.range.from !== result.replacement.from ||
        existing.range.to !== result.replacement.to ||
        existing.text !== result.replacement.text
      )) {
        return { kind: "unsafe", message: "Module body geometry semantic sites が重複または競合しています。" };
      }
      if (existing) return { kind: "unsafe", message: "Module body geometry semantic site が重複しています。" };
      if ([...geometryReplacements.values()].some((candidate) =>
        candidate.range.from < result.replacement.to && result.replacement.from < candidate.range.to
      )) {
        return { kind: "unsafe", message: "Module body geometry semantic sites の physical span が重複しています。" };
      }
      geometryReplacements.set(key, { range: { from: result.replacement.from, to: result.replacement.to }, text: result.replacement.text });
      substitutions.push(result.provenance);
      return { kind: "ok" };
    };

    for (const site of semantic.geometryReferences) {
      const target = site.reference.target;
      if (target?.kind !== "parameter" || target.definitionStatementId !== entry.definition.statementId) continue;
      const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, site.reference, "direct");
      const added = addGeometryReplacement(result, site.reference.span);
      if (added.kind === "unsafe") return added;
      if (result.kind === "ok") replacements.push(result.replacement);
    }
    for (const site of semantic.scalarExpressions) {
      const remembered = rememberRecordReferences(site.expression);
      if (remembered.kind === "unsafe") return remembered;
      if (!includeCondition && site.parameterKey === "condition") continue;
      for (const reference of site.expression.geometryProperties) {
        if (reference.target?.kind !== "parameterProperty" || reference.target.definitionStatementId !== entry.definition.statementId) continue;
        const geometryReference: GeometrySubstitutionReference = {
          source: `@${reference.geometryName}.${reference.property}`,
          span: reference.span,
          nameSpan: reference.elementNameSpan,
          expectedGeometryKind: reference.target.geometryKind,
          role: reference.target.geometryKind === "point" ? "pointReference" : "lineReference",
          target: reference.target,
          coordinate: null,
          resolution: reference.resolution === "resolved" ? "resolved" : "invalid"
        };
        const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, geometryReference, "property", reference.property);
        const added = addGeometryReplacement(result, reference.span);
        if (added.kind === "unsafe") return added;
      }
      for (const builtin of site.expression.geometryBuiltinArguments) {
        const target = builtin.reference.target;
        if (target?.kind !== "parameter" || target.definitionStatementId !== entry.definition.statementId) continue;
        const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, builtin.reference, "builtin");
        const added = addGeometryReplacement(result, builtin.reference.span);
        if (added.kind === "unsafe") return added;
      }
      const hasInlinePresenceFact = site.expression.hasValueParameters.some((metadata) =>
        presenceByParameter.has(parameterSlotKey(metadata.definitionStatementId, metadata.parameterIndex))
      );
      if (!hasInlinePresenceFact && geometryReplacements.size === 0) continue;
      const range = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, site.span);
      if (!range) return { kind: "unsafe", message: "Module body scalar expression の exact physical source span を解決できません。" };
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        bodyEntry.statement,
        site.expression,
        presenceByParameter,
        geometryReplacements
      );
      if (specialized.kind === "unsafe") return specialized;
      eliminatedSourceRanges.push(...specialized.eliminatedSourceRanges);
      if (specialized.changed) replacements.push({ from: range.from, to: range.to, text: specialized.text });
    }
    for (const site of semantic.textTemplateHoles) {
      const remembered = rememberRecordReferences(site.expression);
      if (remembered.kind === "unsafe") return remembered;
      for (const reference of site.expression.geometryProperties) {
        if (reference.target?.kind !== "parameterProperty" || reference.target.definitionStatementId !== entry.definition.statementId) continue;
        const geometryReference: GeometrySubstitutionReference = {
          source: `@${reference.geometryName}.${reference.property}`,
          span: reference.span,
          nameSpan: reference.elementNameSpan,
          expectedGeometryKind: reference.target.geometryKind,
          role: reference.target.geometryKind === "point" ? "pointReference" : "lineReference",
          target: reference.target,
          coordinate: null,
          resolution: reference.resolution === "resolved" ? "resolved" : "invalid"
        };
        const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, geometryReference, "property", reference.property);
        const added = addGeometryReplacement(result, reference.span);
        if (added.kind === "unsafe") return added;
      }
      for (const builtin of site.expression.geometryBuiltinArguments) {
        const target = builtin.reference.target;
        if (target?.kind !== "parameter" || target.definitionStatementId !== entry.definition.statementId) continue;
        const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, builtin.reference, "builtin");
        const added = addGeometryReplacement(result, builtin.reference.span);
        if (added.kind === "unsafe") return added;
      }
      const hasInlinePresenceFact = site.expression.hasValueParameters.some((metadata) =>
        presenceByParameter.has(parameterSlotKey(metadata.definitionStatementId, metadata.parameterIndex))
      );
      if (!hasInlinePresenceFact && geometryReplacements.size === 0) continue;
      const range = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, site.contentSpan);
      if (!range) return { kind: "unsafe", message: "Module text-template hole の exact physical source span を解決できません。" };
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        bodyEntry.statement,
        site.expression,
        presenceByParameter,
        geometryReplacements
      );
      if (specialized.kind === "unsafe") return specialized;
      eliminatedSourceRanges.push(...specialized.eliminatedSourceRanges);
      if (specialized.changed) replacements.push({ from: range.from, to: range.to, text: specialized.text });
    }
    rememberEliminatedSourceRanges(bodyEntry.statementId, eliminatedSourceRanges);
    const retainedSubstitutions = substitutions.filter((substitution) => !eliminatedSourceRanges.some((range) =>
      substitution.bodySourceRange.from >= range.from && substitution.bodySourceRange.to <= range.to
    ));
    geometrySubstitutions.push(...retainedSubstitutions);
    return { kind: "ok", replacements, geometrySubstitutions: retainedSubstitutions };
  };

  const conditionalStates = new Map<StatementIdentity, InlinePresenceValue | null>();
  for (const bodyEntry of entry.body.entries) {
    const result = replacementsForEntry(bodyEntry, false);
    if (result.kind === "unsafe") return result;
    replacementsByStatement.set(bodyEntry.statementId, [...result.replacements]);
    if (bodyEntry.statement.kind !== "element" || bodyEntry.statement.type !== "conditionalGroup") continue;

    const info = compiled.statementMap?.statements[bodyEntry.statementIndex];
    const conditionalSemantic = bodyStatementSemanticFor(compiled, bodyEntry.statementId);
    const conditionSite = conditionalSemantic?.scalarExpressions.find((site) => site.parameterKey === "condition");
    if (!info || info.closeBraceLine === undefined || !conditionSite) {
      return { kind: "unsafe", message: "conditional condition の compiler semantic owner を解決できません。" };
    }
    const conditionRange = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, conditionSite.span);
    if (!conditionRange) return { kind: "unsafe", message: "conditional condition の exact physical source span を解決できません。" };
    let conditionText = source.slice(conditionRange.from, conditionRange.to);
    let conditionKnown: InlinePresenceValue | null = null;
    const conditionGeometryReplacements = new Map<string, InlineGeometryExpressionReplacement>();
    const conditionSubstitutions: GeometrySubstitutionProvenance[] = [];
    const addConditionGeometryReplacement = (
      substitution: GeometrySubstitutionResult,
      semanticSpan: { start: number; end: number }
    ): { kind: "ok" } | { kind: "unsafe"; message: string } => {
      if (substitution.kind === "none") return { kind: "ok" };
      if (substitution.kind === "unsafe") return substitution;
      const key = semanticSpanKey(semanticSpan);
      if (conditionGeometryReplacements.has(key)) {
        return { kind: "unsafe", message: "conditional condition の geometry semantic site が重複しています。" };
      }
      if ([...conditionGeometryReplacements.values()].some((candidate) =>
        candidate.range.from < substitution.replacement.to && substitution.replacement.from < candidate.range.to
      )) {
        return { kind: "unsafe", message: "conditional condition の geometry semantic sites の physical span が重複しています。" };
      }
      conditionGeometryReplacements.set(key, {
        range: { from: substitution.replacement.from, to: substitution.replacement.to },
        text: substitution.replacement.text
      });
      conditionSubstitutions.push(substitution.provenance);
      return { kind: "ok" };
    };
    for (const reference of conditionSite.expression.geometryProperties) {
      if (reference.target?.kind !== "parameterProperty" || reference.target.definitionStatementId !== entry.definition.statementId) continue;
      const geometryReference: GeometrySubstitutionReference = {
        source: `@${reference.geometryName}.${reference.property}`,
        span: reference.span,
        nameSpan: reference.elementNameSpan,
        expectedGeometryKind: reference.target.geometryKind,
        role: reference.target.geometryKind === "point" ? "pointReference" : "lineReference",
        target: reference.target,
        coordinate: null,
        resolution: reference.resolution === "resolved" ? "resolved" : "invalid"
      };
      const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, geometryReference, "property", reference.property);
      const added = addConditionGeometryReplacement(result, reference.span);
      if (added.kind === "unsafe") return added;
    }
    for (const builtin of conditionSite.expression.geometryBuiltinArguments) {
      const target = builtin.reference.target;
      if (target?.kind !== "parameter" || target.definitionStatementId !== entry.definition.statementId) continue;
      const result = geometrySubstitutionFor(source, compiled, entry, bodyEntry, builtin.reference, "builtin");
      const added = addConditionGeometryReplacement(result, builtin.reference.span);
      if (added.kind === "unsafe") return added;
    }
    const hasInlinePresenceFact = conditionSite.expression.hasValueParameters.some((metadata) =>
      presenceByParameter.has(parameterSlotKey(metadata.definitionStatementId, metadata.parameterIndex))
    );
    if (hasInlinePresenceFact || conditionGeometryReplacements.size > 0) {
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        bodyEntry.statement,
        conditionSite.expression,
        presenceByParameter,
        conditionGeometryReplacements
      );
      if (specialized.kind === "unsafe") return specialized;
      conditionText = specialized.text;
      conditionKnown = specialized.known?.presenceDerived ? specialized.known : null;
      rememberEliminatedSourceRanges(bodyEntry.statementId, specialized.eliminatedSourceRanges);
      geometrySubstitutions.push(...conditionSubstitutions.filter((substitution) => !specialized.eliminatedSourceRanges.some((range) =>
        substitution.bodySourceRange.from >= range.from && substitution.bodySourceRange.to <= range.to
      )));
    }
    conditionalStates.set(bodyEntry.statementId, conditionKnown);
    const conditionReplacement = conditionText === source.slice(conditionRange.from, conditionRange.to)
      ? null
      : { from: conditionRange.from, to: conditionRange.to, text: conditionText };
    if (conditionReplacement) {
      replacementsByStatement.set(bodyEntry.statementId, [
        ...(replacementsByStatement.get(bodyEntry.statementId) ?? []),
        conditionReplacement
      ]);
    }
  }

  const allReplacements = [
    ...[...replacementsByStatement.values()].flat(),
    ...exportReplacements
  ];
  const entriesByParent = new Map<number, StatementEntry[]>();
  for (const bodyEntry of entry.body.entries) {
    const parent = bodyEntry.statement.enclosing?.statementIndex;
    if (parent === undefined) return { kind: "unsafe", message: "Module body statement の parent owner を解決できません。" };
    entriesByParent.set(parent, [...(entriesByParent.get(parent) ?? []), bodyEntry]);
  }
  for (const children of entriesByParent.values()) children.sort((left, right) => left.statementIndex - right.statementIndex);

  type OutputParent = { statementId: StatementIdentity | null; branch: "then" | "else" | null };
  type Rendered = { lines: string[]; provenance: BodyStatementProvenance[] };
  const provenanceFor = (bodyEntry: StatementEntry, outputLineIndex: number, parent: OutputParent): BodyStatementProvenance => ({
    originalStatementId: bodyEntry.statementId,
    outputLineIndex,
    originalParentStatementId: parent.statementId,
    originalBranch: parent.branch,
    eliminatedSourceRanges: eliminatedSourceRangesFor(bodyEntry.statementId)
  });
  const replacementsInRange = (range: { from: number; to: number }): AbsoluteReplacement[] => allReplacements.filter((replacement) =>
    replacement.from >= range.from && replacement.to <= range.to
  );
  const rawLinesFor = (startLine: number, endLine: number, applyReplacements: boolean): string[] | null => {
    if (startLine > endLine) return [];
    const range = sourceRangeForLines(source, starts, startLine, endLine);
    if (!range) return null;
    const rendered = applyReplacements
      ? applyAbsoluteReplacements(source, range.from, range.to, replacementsInRange(range))
      : source.slice(range.from, range.to);
    return rendered === null ? null : rendered.split("\n");
  };

  const renderSequence = (
    startLine: number,
    endLine: number,
    parentIndex: number,
    branch: "then" | "else",
    parent: OutputParent
  ): Rendered | null => {
    const children = (entriesByParent.get(parentIndex) ?? []).filter((candidate) => candidate.statement.enclosing?.branch === branch);
    const output: Rendered = { lines: [], provenance: [] };
    let cursorLine = startLine;
    const append = (lines: readonly string[], provenance: readonly BodyStatementProvenance[]) => {
      const start = output.lines.length;
      output.lines.push(...lines);
      output.provenance.push(...provenance.map((item) => ({ ...item, outputLineIndex: item.outputLineIndex + start })));
    };
    for (const child of children) {
      const info = compiled.statementMap?.statements[child.statementIndex];
      if (!info || child.statement.line < startLine || info.range.endLine > endLine || child.statement.line < cursorLine) return null;
      const before = rawLinesFor(cursorLine, child.statement.line - 1, true);
      if (before === null) return null;
      append(before, []);
      const rendered = renderStatement(child, parent);
      if (!rendered) return null;
      append(rendered.lines, rendered.provenance);
      cursorLine = info.range.endLine + 1;
    }
    const after = rawLinesFor(cursorLine, endLine, true);
    if (after === null) return null;
    append(after, []);
    return output;
  };

  const renderConditional = (bodyEntry: StatementEntry, parent: OutputParent): Rendered | null => {
    const info = compiled.statementMap?.statements[bodyEntry.statementIndex];
    if (!info || info.closeBraceLine === undefined) return null;
    const conditionalIndent = leadingWhitespace(source.slice(
      lineStartFor(starts, info.range.startLine) ?? 0,
      lineEndOffset(source, starts, info.range.startLine)
    ));
    const conditionalOpenLine = info.openBraceLine ?? inlineOpenBraceLine(source, starts, bodyEntry.statement);
    const openLine = conditionalOpenLine ?? info.range.startLine;
    const thenStartLine = openLine + 1;
    const thenEndLine = (info.elseLine ?? info.closeBraceLine) - 1;
    const elseStartLine = info.elseLine === undefined ? info.closeBraceLine : info.elseLine + 1;
    const elseEndLine = info.closeBraceLine - 1;
    const header = rawLinesFor(info.range.startLine, openLine, true);
    const originalHeader = rawLinesFor(info.range.startLine, openLine, false);
    const then = renderSequence(thenStartLine, thenEndLine, bodyEntry.statementIndex, "then", {
      statementId: bodyEntry.statementId,
      branch: "then"
    });
    const elseRendered = info.elseLine === undefined
      ? { lines: [], provenance: [] as BodyStatementProvenance[] }
      : renderSequence(elseStartLine, elseEndLine, bodyEntry.statementIndex, "else", {
          statementId: bodyEntry.statementId,
          branch: "else"
        });
    const close = rawLinesFor(info.closeBraceLine, info.closeBraceLine, true);
    const elseMarker = info.elseLine === undefined ? [] : rawLinesFor(info.elseLine, info.elseLine, true);
    if (!header || !originalHeader || !then || !elseRendered || !close || !elseMarker) return null;
    const known = conditionalStates.get(bodyEntry.statementId) ?? null;
    const conditionKnown = known !== null;
    const thenLines = conditionKnown ? liftConditionalBranchLines(then.lines, conditionalIndent) : then.lines;
    const elseLines = conditionKnown ? liftConditionalBranchLines(elseRendered.lines, conditionalIndent) : elseRendered.lines;
    if (!conditionKnown) {
      const headerLength = header.length;
      const thenOffset = headerLength;
      const elseOffset = thenOffset + thenLines.length + elseMarker.length;
      return {
        lines: [...header, ...thenLines, ...elseMarker, ...elseLines, ...close],
        provenance: [
          provenanceFor(bodyEntry, 0, parent),
          ...then.provenance.map((item) => ({ ...item, outputLineIndex: item.outputLineIndex + thenOffset })),
          ...elseRendered.provenance.map((item) => ({ ...item, outputLineIndex: item.outputLineIndex + elseOffset }))
        ]
      };
    }
    if (known.value) {
      const lines = [...thenLines];
      const provenance = then.provenance.map((item) => ({
        ...item,
        originalParentStatementId: parent.statementId,
        originalBranch: parent.branch
      }));
      if (info.elseLine !== undefined && emitOmittedBranchComments) {
        lines.push(`${conditionalIndent}// Inline omitted: condition resolved to true`);
        const omitted = [
          ...elseMarker,
          ...(rawLinesFor(elseStartLine, elseEndLine, false) ?? []),
          ...close
        ].map((line) => commentSourceLine(line, conditionalIndent));
        lines.push(...omitted);
      }
      return { lines, provenance };
    }
    if (info.elseLine === undefined) {
      if (!emitOmittedBranchComments) return { lines: [], provenance: [] };
      return {
        lines: [
          `${conditionalIndent}// Inline omitted: condition resolved to false`,
          ...[
            ...originalHeader,
            ...(rawLinesFor(thenStartLine, thenEndLine, false) ?? []),
            ...close
          ].map((line) => commentSourceLine(line, conditionalIndent))
        ],
        provenance: []
      };
    }
    if (!emitOmittedBranchComments) {
      return {
        lines: elseLines,
        provenance: elseRendered.provenance.map((item) => ({
          ...item,
          originalParentStatementId: parent.statementId,
          originalBranch: parent.branch
        }))
      };
    }
    const omitted = [
      ...originalHeader,
      ...(rawLinesFor(thenStartLine, thenEndLine, false) ?? []),
      ...elseMarker
    ].map((line) => commentSourceLine(line, conditionalIndent));
    return {
      lines: [
        `${conditionalIndent}// Inline omitted: condition resolved to false`,
        ...omitted,
        ...elseLines
      ],
      provenance: elseRendered.provenance.map((item) => ({
        ...item,
        outputLineIndex: item.outputLineIndex + omitted.length + 1
      }))
    };
  };

  const renderStatement = (bodyEntry: StatementEntry, parent: OutputParent): Rendered | null => {
    const info = compiled.statementMap?.statements[bodyEntry.statementIndex];
    if (!info) return null;
    if (bodyEntry.statement.kind === "element" && bodyEntry.statement.type === "conditionalGroup") {
      return renderConditional(bodyEntry, parent);
    }
    if (!bodyEntry.statement.opensBlock) {
      const lines = rawLinesFor(info.range.startLine, info.range.endLine, true);
      return lines === null ? null : {
        lines,
        provenance: [provenanceFor(bodyEntry, 0, parent)]
      };
    }
    const openLine = info.openBraceLine ?? inlineOpenBraceLine(source, starts, bodyEntry.statement);
    const closeLine = info.closeBraceLine;
    if (openLine === null || openLine === undefined || closeLine === undefined || closeLine <= openLine) return null;
    const header = rawLinesFor(info.range.startLine, openLine, true);
    const body = renderSequence(openLine + 1, closeLine - 1, bodyEntry.statementIndex, "then", {
      statementId: bodyEntry.statementId,
      branch: null
    });
    const close = rawLinesFor(closeLine, closeLine, true);
    if (!header || !body || !close) return null;
    return {
      lines: [...header, ...body.lines, ...close],
      provenance: [
        provenanceFor(bodyEntry, 0, parent),
        ...body.provenance.map((item) => ({ ...item, outputLineIndex: item.outputLineIndex + header.length }))
      ]
    };
  };

  const bodyStartLine = openBraceLine + 1;
  const bodyEndLine = bodyInfo.closeBraceLine - 1;
  const renderedBody = renderSequence(bodyStartLine, bodyEndLine, entry.definition.statementIndex, "then", {
    statementId: null,
    branch: null
  });
  if (!renderedBody) return { kind: "unsafe", message: "Module body の recursive structural source rewrite を構成できません。" };
  const emittedStatementIds = new Set(renderedBody.provenance.map((item) => item.originalStatementId));
  return {
    kind: "ok",
    transformation: {
      bodyLines: renderedBody.lines,
      provenance: renderedBody.provenance,
      geometrySubstitutions: geometrySubstitutions.filter((substitution) =>
        emittedStatementIds.has(substitution.originalStatementId)
      ),
      geometryArrayReferences: geometryArrayReferences.filter((reference) =>
        emittedStatementIds.has(reference.originalStatementId)
      ),
      recordReferences: recordReferences.filter((reference) =>
        emittedStatementIds.has(reference.originalStatementId)
      )
    }
  };
};

const exportedTokenReplacements = (
  source: string,
  compiled: CompiledDslDocument,
  body: BodyRange
): AbsoluteReplacement[] | null => {
  const replacements: AbsoluteReplacement[] = [];
  const sourceRevision = compiled.spans.sourceMap.sourceRevision;
  const analysis = semanticAnalysisFor(compiled);
  const definitionId = statementIdAt(compiled, body.definitionStatementIndex);
  const ownedExportedStatementIds = new Set(
    analysis?.definitions
      .find((definition) => definition.statementId === definitionId)
      ?.exports.map((entry) => entry.exportedStatementId) ?? []
  );
  for (const entry of body.entries) {
    if (entry.statement.kind !== "typedDeclaration" && entry.statement.kind !== "element") continue;
    if (!entry.statement.exported) continue;
    if (!ownedExportedStatementIds.has(entry.statementId)) continue;
    const range = singlePhysicalRange(entry.statement.exportPhysicalSpan, sourceRevision);
    if (
      !range ||
      range.from < body.from ||
      range.to > body.to ||
      source.slice(range.from, range.to) !== "export"
    ) return null;
    let to = range.to;
    while (to < body.to && (source[to] === " " || source[to] === "\t")) to += 1;
    replacements.push({ from: range.from, to, text: "" });
  }
  return replacements;
};

const rebaseBodyLines = (
  lines: readonly string[],
  definitionIndent: string,
  instanceIndent: string
): string[] => lines.map((line) => {
  if (line.trim().length === 0) return line;
  return line.startsWith(definitionIndent)
    ? `${instanceIndent}${line.slice(definitionIndent.length)}`
    : `${instanceIndent}${DSL_INDENT}${line}`;
});

const trailingSourceSuffix = (
  source: string,
  starts: readonly number[],
  statement: DslStatement,
  info: NonNullable<CompiledDslDocument["statementMap"]>["statements"][number]
): string | null => {
  if (info.range.startLine !== info.range.endLine) return null;
  const lineStart = starts[info.range.startLine - 1];
  if (lineStart === undefined) return null;
  const lineEnd = lineEndOffset(source, starts, info.range.endLine);
  const physical = singlePhysicalRange(statement.physicalSpan, statement.sourceRevision);
  if (!physical || physical.from < lineStart || physical.to > lineEnd) return null;
  return source.slice(physical.to, lineEnd);
};

const instanceActivity = (
  statement: Extract<DslStatement, { kind: "moduleInstance" }>
): Activity | null => {
  const option = statement.options.find((candidate) => candidate.name === "state");
  if (!option) return "visible";
  return parseElementActivityLiteral(option.value) as Activity | null;
};

const semanticAnalysisFor = (compiled: CompiledDslDocument) =>
  compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;

const geometryOwnerForReference = (
  compiled: CompiledDslDocument,
  reference: ModuleGeometryReferenceSemantic
): GeometryParameterOwner | null => {
  if (reference.coordinate !== null && reference.target === null) return { kind: "coordinate" };
  const target = reference.target;
  if (!target) return null;
  if (target.kind === "sourceGeometry") return { kind: "source", statementId: target.statementId };
  if (target.kind !== "deferredModuleExport") return null;
  const analysis = semanticAnalysisFor(compiled);
  const instance = analysis?.instancesByStatementId.get(target.instanceStatementId);
  const exported = instance?.callee
    ? analysis?.definitionsByStatementId.get(instance.callee.definitionStatementId)?.exports.find((candidate) =>
        candidate.name === target.exportName
      )
    : undefined;
  return exported ? { kind: "source", statementId: exported.exportedStatementId } : null;
};

const skip = (
  target: InlineModuleTargetIdentity,
  statementIndex: number | null,
  instanceName: string | null,
  code: InlineModuleKnownSkipCode,
  reason: string
): InlineModuleSkippedTarget => ({
  status: "skipped",
  target,
  statementIndex,
  instanceName,
  code,
  reason
});

const targetKey = (target: InlineModuleTargetIdentity): string =>
  encodeIdentityTuple([
    target.documentKey === null ? "local-document" : "qualified-document",
    target.documentKey ?? "",
    target.statementId
  ]);

const ownerStatementIdForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): StatementIdentity | null => {
  if (identity.kind === "source" || identity.kind === "recordType" || identity.kind === "recordValue") {
    return identity.statementId;
  }
  if (identity.kind === "modifier") return null;
  if (identity.kind === "recordField") return identity.field.recordStatementId;
  if (identity.kind === "typed") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }
  if (identity.kind === "element") {
    const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }

  const target = identity.target;
  if (target.kind === "documentBinding") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }
  if (target.kind === "moduleParameter") return target.slot.definitionStatementId;
  return target.statementId;
};

const ownerTokenForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): string => {
  const statementId = ownerStatementIdForIdentity(compiled, identity);
  return statementId === null
    ? `identity:${dslSemanticIdentityKey(identity)}`
    : `statement:${statementId}`;
};

const remappedOwnerTokenForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  currentMapping: OwnerMapping,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): string => {
  const copiedStatementIdFor = (statementId: StatementIdentity): StatementIdentity | undefined =>
    currentMapping.bodyStatementIds.get(statementId) ??
    [...mappingsByTarget.values()].map((mapping) => mapping.bodyStatementIds.get(statementId)).find(Boolean);
  if (identity.kind === "module") {
    if (identity.target.kind === "moduleParameter") {
      const generated = currentMapping.parameterBindings.get(
        parameterSlotKey(
          identity.target.slot.definitionStatementId,
          identity.target.slot.parameterIndex
        )
      );
      if (generated) return `statement:${generated.statementId}`;
      const copiedDefinition = copiedStatementIdFor(identity.target.slot.definitionStatementId);
      if (copiedDefinition) return `statement:${copiedDefinition}`;
    } else if (identity.target.kind === "moduleInstance") {
      const mapping = mappingsByTarget.get(identity.target.statementId);
      if (mapping) return `statement:${mapping.generatedGroupStatementId}`;
      const copied = copiedStatementIdFor(identity.target.statementId);
      if (copied) return `statement:${copied}`;
    } else if (identity.target.kind === "moduleSource") {
      const copied = copiedStatementIdFor(identity.target.statementId);
      if (copied) return `statement:${copied}`;
    } else if (identity.target.kind !== "documentBinding") {
      const copied = copiedStatementIdFor(identity.target.statementId);
      if (copied) return `statement:${copied}`;
    }
  }
  const owner = ownerStatementIdForIdentity(compiled, identity);
  const copied = owner === null ? undefined : copiedStatementIdFor(owner);
  if (copied) return `statement:${copied}`;
  return ownerTokenForIdentity(compiled, identity);
};

const sourceReferenceRangeForOccurrence = (
  source: string,
  occurrences: readonly DslSemanticOccurrence[],
  occurrence: DslSemanticOccurrence,
  range: { from: number; to: number }
): { from: number; to: number } | null => {
  let firstFrom = occurrence.from;
  let cursor = occurrence.from;
  while (true) {
    let prior: DslSemanticOccurrence | null = null;
    for (const candidate of occurrences) {
      if (
        candidate.kind === "reference" &&
        candidate.to + 2 === cursor &&
        source.slice(candidate.to, cursor) === "::" &&
        candidate.from >= range.from &&
        candidate.to <= range.to &&
        (!prior || candidate.from > prior.from)
      ) prior = candidate;
    }
    if (!prior) break;
    firstFrom = prior.from;
    cursor = prior.from;
  }
  const sigilFrom = source[firstFrom] === "@"
    ? firstFrom
    : source[firstFrom - 1] === "@"
      ? firstFrom - 1
      : source.slice(firstFrom - 3, firstFrom) === "@::"
        ? firstFrom - 3
        : null;
  if (sigilFrom === null || sigilFrom < range.from) return null;
  const parsed = parseDslSourceReferenceAt(source, sigilFrom, range.to);
  if (parsed.kind !== "valid" || parsed.reference.fullRange.start < range.from || parsed.end > range.to) return null;
  return { from: parsed.reference.fullRange.start, to: parsed.end };
};

const finalReferenceOccurrencesForRange = (
  source: string,
  index: DslSemanticOccurrenceIndex,
  range: { from: number; to: number }
): ReferenceOccurrence[] => {
  const references = index.occurrences.filter((occurrence) =>
    occurrence.kind === "reference" &&
    occurrence.from >= range.from &&
    occurrence.to <= range.to &&
    source.slice(occurrence.to, occurrence.to + 2) !== "::"
  );
  const seen = new Set<string>();
  const result: ReferenceOccurrence[] = [];
  for (const occurrence of references) {
    const sourceRange = sourceReferenceRangeForOccurrence(source, index.occurrences, occurrence, range);
    if (!sourceRange) continue;
    const key = `${sourceRange.from}:${sourceRange.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...occurrence, sourceFrom: sourceRange.from, sourceTo: sourceRange.to });
  }
  return result.sort((left, right) => left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo);
};

const sourceDeclarationForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return null;
  let statementId: StatementIdentity | null = null;
  if (identity.kind === "typed") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
    statementId = statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  } else if (identity.kind === "element") {
    const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
    statementId = statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  } else if (identity.kind === "module") {
    if (identity.target.kind === "documentBinding") {
      const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.target.bindingId)?.statementIndex;
      statementId = statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
    } else if (identity.target.kind === "moduleInstance" || identity.target.kind === "moduleSource") {
      statementId = identity.target.statementId;
    }
  }
  if (!statementId) return null;
  const declarations = namespace.allDeclarations.filter((declaration) => declaration.statementId === statementId);
  return declarations.length === 1 ? declarations[0] : null;
};

const canonicalPathForDeclaration = (
  compiled: CompiledDslDocument,
  declaration: NonNullable<ReturnType<typeof sourceDeclarationForIdentity>>,
  referenceStatementIndex: number
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || !declaration.name) return null;
  const containerNames: string[] = [];
  let scopeId: string | null = declaration.scopeId;
  while (scopeId !== null && scopeId !== namespace.scopeIndex.rootScopeId) {
    const scope = namespace.scopeIndex.scopes.get(scopeId);
    if (!scope || scope.openingStatementIndex === null || scope.kind === "module" || scope.kind === "layout") return null;
    const opening = compiled.statements[scope.openingStatementIndex];
    if (!opening?.name) return null;
    const openingDeclaration = namespace.allDeclarations.find((candidate) =>
      candidate.statementIndex === scope.openingStatementIndex && candidate.name === opening.name
    );
    if (!openingDeclaration) return null;
    containerNames.unshift(opening.name);
    scopeId = scope.parentId;
  }
  const path = { absolute: true, segments: [...containerNames, declaration.name] };
  const resolved = resolveSourceLexicalPath(namespace, referenceStatementIndex, path);
  return resolved.kind === "resolved" && resolved.declaration.statementId === declaration.statementId
    ? path
    : null;
};

const canonicalSourceReferenceFor = (
  source: string,
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  reference: ReferenceOccurrence,
  referenceStatementIndex: number
): string | null => {
  const parsed = parseDslSourceReference(source.slice(reference.sourceFrom, reference.sourceTo));
  if (parsed.kind !== "valid") return null;
  if (
    identity.kind === "module" &&
    identity.target.kind === "moduleSource" &&
    !parsed.reference.path.absolute &&
    parsed.reference.path.segments.length > 1
  ) {
    const absolutePath = { absolute: true, segments: parsed.reference.path.segments };
    const absoluteSource = `@${formatDslReferencePath(absolutePath)}`;
    const absoluteIdentity = moduleSourceIdentityForReference(compiled, referenceStatementIndex, absoluteSource);
    if (absoluteIdentity && dslSemanticIdentityKey(absoluteIdentity) === dslSemanticIdentityKey(identity)) {
      return `${absoluteSource}${parsed.reference.property ? `.${parsed.reference.property}` : ""}`;
    }
  }
  const declaration = sourceDeclarationForIdentity(compiled, identity);
  if (!declaration) return null;
  const path = canonicalPathForDeclaration(compiled, declaration, referenceStatementIndex);
  if (!path) return null;
  return `@${formatDslReferencePath(path)}${parsed.reference.property ? `.${parsed.reference.property}` : ""}`;
};

const occurrenceSlotsForStatement = (
  source: string,
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  statementIndex: number,
  includeOccurrence: (occurrence: DslSemanticOccurrence) => boolean = () => true,
  extraOccurrences: readonly DslSemanticOccurrence[] = []
): OccurrenceSlot[] => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return [];
  const slots = new Map<string, { kind: DslSemanticOccurrence["kind"]; token: string; ordinal: number; owners: Set<string> }>();
  const ordinalByToken = new Map<string, number>();
  const occurrences = [...index.occurrences, ...extraOccurrences].sort((left, right) =>
    left.from - right.from || left.to - right.to || left.kind.localeCompare(right.kind)
  );
  const moduleOccurrenceKeys = new Set(
    occurrences
      .filter((occurrence) => occurrence.identity.kind === "module")
      .map((occurrence) => `${occurrence.from}:${occurrence.to}:${occurrence.kind}`)
  );
  for (const occurrence of occurrences) {
    if (!includeOccurrence(occurrence)) continue;
    if (
      occurrence.identity.kind !== "module" &&
      moduleOccurrenceKeys.has(`${occurrence.from}:${occurrence.to}:${occurrence.kind}`)
    ) continue;
    if (
      occurrence.from < statement.documentRange.from ||
      occurrence.to > statement.documentRange.to
    ) continue;
    const key = `${occurrence.from}:${occurrence.to}:${occurrence.kind}`;
    const tokenKey = `${occurrence.kind}:${source.slice(occurrence.from, occurrence.to)}`;
    const current = slots.get(key);
    if (current) {
      current.owners.add(ownerTokenForIdentity(compiled, occurrence.identity));
    } else {
      const ordinal = ordinalByToken.get(tokenKey) ?? 0;
      ordinalByToken.set(tokenKey, ordinal + 1);
      slots.set(key, {
        kind: occurrence.kind,
        token: source.slice(occurrence.from, occurrence.to),
        ordinal,
        owners: new Set([ownerTokenForIdentity(compiled, occurrence.identity)])
      });
    }
  }
  return [...slots.values()].map((slot) => ({
    kind: slot.kind,
    token: slot.token,
    ordinal: slot.ordinal,
    owners: [...slot.owners].sort()
  }));
};

/**
 * The module semantic index intentionally covers Module-owned source. A
 * copied forGroup is ordinary document/group source after inlining, so its
 * iteration references are not emitted into that index. Re-read only those
 * compiler-owned iteration identities through the existing module lexical
 * resolver for the candidate statement; no new semantic index is created.
 */
const iterationOccurrencesForStatement = (
  source: string,
  compiled: CompiledDslDocument,
  statementIndex: number
): readonly DslSemanticOccurrence[] => {
  const statement = compiled.statements[statementIndex];
  const namespace = compiled.sourceLexicalNamespace;
  const stableIds = compiled.statementMap?.statementIdByStatementIndex;
  if (!statement || !namespace || !stableIds) return [];
  const result: DslSemanticOccurrence[] = [];
  const seen = new Set<string>();
  for (const segment of statement.physicalSpan.segments) {
    for (let at = source.indexOf("@", segment.from); at >= 0 && at < segment.to; at = source.indexOf("@", at + 1)) {
      const parsed = parseDslSourceReferenceAt(source, at, segment.to);
      if (parsed.kind !== "valid") continue;
      const lookup = resolveModuleLexicalPath(
        { sourceNamespace: namespace, stableStatementIdByIndex: stableIds },
        statementIndex,
        parsed.reference.path
      );
      if (lookup.kind !== "iteration") continue;
      const identity = semanticIdentityForModuleTarget(compiled, {
        kind: "moduleIteration",
        statementId: lookup.statementId
      });
      if (!identity) continue;
      const key = `${parsed.reference.pathRange.start}:${parsed.reference.pathRange.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        from: parsed.reference.pathRange.start,
        to: parsed.reference.pathRange.end,
        kind: "reference",
        identity
      });
    }
  }
  return result;
};

const occurrenceIsQualifiedTargetMember = (
  source: string,
  occurrence: DslSemanticOccurrence,
  statementOccurrences: readonly DslSemanticOccurrence[],
  targetStatementIds: ReadonlySet<StatementIdentity>
): StatementIdentity | null => {
  if (occurrence.kind !== "reference" || occurrence.identity.kind !== "module") return null;
  if (occurrence.identity.target.kind !== "moduleSource") return null;
  for (const prior of statementOccurrences) {
    if (
      prior.kind !== "reference" ||
      prior.identity.kind !== "module" ||
      prior.identity.target.kind !== "moduleInstance" ||
      !targetStatementIds.has(prior.identity.target.statementId) ||
      prior.to > occurrence.from ||
      source.slice(prior.to, occurrence.from) !== "::"
    ) continue;
    return prior.identity.target.statementId;
  }
  return null;
};

const expectedOwnerToken = (
  source: string,
  compiled: CompiledDslDocument,
  occurrence: DslSemanticOccurrence,
  statementOccurrences: readonly DslSemanticOccurrence[],
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): string => {
  const owner = ownerStatementIdForIdentity(compiled, occurrence.identity);
  if (owner === null) return ownerTokenForIdentity(compiled, occurrence.identity);

  if (occurrence.identity.kind === "module" && occurrence.identity.target.kind === "moduleInstance") {
    const mapping = mappingsByTarget.get(occurrence.identity.target.statementId);
    if (mapping) return `statement:${mapping.generatedGroupStatementId}`;
  }
  const targetStatementId = occurrenceIsQualifiedTargetMember(
    source,
    occurrence,
    statementOccurrences,
    new Set(mappingsByTarget.keys())
  );
  if (targetStatementId) {
    const mapping = mappingsByTarget.get(targetStatementId);
    const copiedStatementId = mapping?.bodyStatementIds.get(owner);
    if (copiedStatementId) return `statement:${copiedStatementId}`;
  }
  return `statement:${owner}`;
};

const compareSlots = (
  expected: readonly OccurrenceSlot[],
  actual: readonly OccurrenceSlot[]
): boolean =>
  expected.length === actual.length && expected.every((slot, index) => {
    const candidate = actual[index];
    return Boolean(
      candidate &&
      candidate.kind === slot.kind &&
      candidate.token === slot.token &&
      candidate.owners.length === slot.owners.length &&
      candidate.owners.every((owner, ownerIndex) => owner === slot.owners[ownerIndex])
    );
  });

const verifyPreservedSemanticOwners = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  replacedStatementIds: ReadonlySet<StatementIdentity>,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): boolean => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  for (const [statementIndex, statementId] of compiled.statementMap?.statementIdByStatementIndex ?? []) {
    if (replacedStatementIds.has(statementId)) continue;
    const statement = compiled.statements[statementIndex];
    if (!statement) return false;
    const statementOccurrences = beforeIndex.occurrences.filter((occurrence) =>
      occurrence.from >= statement.documentRange.from && occurrence.to <= statement.documentRange.to
    );
    // Structural and settings statements can receive reconciler ids in test
    // and host adapters, but they do not own semantic occurrences. There is
    // no resolution proof to perform for those ids.
    if (statementOccurrences.length === 0) continue;
    const nextIndex = nextCompiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (nextIndex === undefined) return false;
    const nextStatement = nextCompiled.statements[nextIndex];
    if (!nextStatement || nextStatement.kind !== statement.kind || nextStatement.name !== statement.name) return false;
    const expected = occurrenceSlotsForStatement(source, compiled, beforeIndex, statementIndex).map((slot) => {
      const owners = new Set<string>();
      const candidates = statementOccurrences.filter((candidate) =>
        candidate.kind === slot.kind && source.slice(candidate.from, candidate.to) === slot.token
      );
      // Module semantic occurrences are authoritative when binding analysis
      // also reports a synthetic typed occurrence at the same source span.
      const candidate = candidates.find((occurrence) => occurrence.identity.kind === "module") ?? candidates[slot.ordinal];
      if (candidate) owners.add(expectedOwnerToken(source, compiled, candidate, statementOccurrences, mappingsByTarget));
      return { ...slot, owners: [...owners].sort() };
    });
    const actual = occurrenceSlotsForStatement(nextCompiled.spans.sourceMap.source, nextCompiled, afterIndex, nextIndex);
    if (!compareSlots(expected, actual)) return false;
  }
  return true;
};

const copyOwnerMappingFor = (
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  groupIndex: number,
  entry: InlineEntry,
  parameterBindings: ReadonlyMap<string, GeneratedParameterMapping>
): OwnerMapping | null => {
  const groupInfo = nextCompiled.statementMap?.statements[groupIndex];
  const generatedBodyLine = groupInfo?.openBraceLine ?? groupInfo?.line;
  if (!groupInfo || generatedBodyLine === undefined) return null;
  const emittedParameterCount = localParameterLoweringsFor(entry).length;
  const bodyStatementIds = new Map<StatementIdentity, StatementIdentity>();
  for (const provenance of entry.bodyTransformation.provenance) {
    if (bodyStatementIds.has(provenance.originalStatementId)) return null;
    const oldBody = statementEntryForId(compiled, provenance.originalStatementId);
    const generatedLine = generatedBodyLine + emittedParameterCount + 1 + provenance.outputLineIndex;
    const nextInfo = nextCompiled.statementMap?.statements.find((candidate) => candidate.range.startLine === generatedLine);
    const nextBody = nextInfo ? nextCompiled.statements[nextInfo.statementIndex] : undefined;
    const nextBodyId = nextInfo ? statementIdAt(nextCompiled, nextInfo.statementIndex) : null;
    if (
      !oldBody ||
      !nextBody ||
      !nextBodyId ||
      oldBody.statement.kind !== nextBody.kind ||
      oldBody.statement.name !== nextBody.name ||
      (oldBody.statement.kind === "element" && nextBody.kind === "element" && oldBody.statement.type !== nextBody.type)
    ) return null;

    if (provenance.originalParentStatementId === null) {
      if (nextInfo?.enclosing?.statementIndex !== groupIndex) return null;
    } else {
      const parentMapping = bodyStatementIds.get(provenance.originalParentStatementId);
      if (!parentMapping || nextInfo?.enclosing?.statementIndex !== statementIndexForId(nextCompiled, parentMapping)) return null;
      const parentIndex = statementIndexForId(nextCompiled, parentMapping);
      const parentStatement = parentIndex === null ? undefined : nextCompiled.statements[parentIndex];
      if (
        provenance.originalBranch !== null &&
        (!nextInfo.enclosing || parentStatement?.kind !== "element" || parentStatement.type !== "conditionalGroup" || nextInfo.enclosing.branch !== provenance.originalBranch)
      ) return null;
    }
    bodyStatementIds.set(oldBody.statementId, nextBodyId);
  }

  const generatedGroupStatementId = statementIdAt(nextCompiled, groupIndex);
  return generatedGroupStatementId
    ? {
        targetStatementId: entry.target.statementId,
        generatedGroupStatementId,
        bodyStatementIds,
        parameterBindings
      }
    : null;
};

const geometryTargetForReference = (
  reference: ModuleGeometryReferenceSemantic,
  expectedGeometryType: "point" | "line"
): ScalarExpressionResolvedGeometryTarget | null => {
  const target = reference.target;
  if (target?.kind === "sourceGeometry") {
    return {
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      geometryType: expectedGeometryType,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  if (target?.kind === "deferredModuleExport") {
    return {
      statementId: target.instanceStatementId,
      statementIndex: target.instanceStatementIndex,
      geometryType: expectedGeometryType,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  return null;
};

const sameGeometryTarget = (
  left: ScalarExpressionResolvedGeometryTarget | null,
  right: ScalarExpressionResolvedGeometryTarget | null
): boolean => Boolean(
  left && right &&
  left.statementId === right.statementId &&
  left.geometryType === right.geometryType &&
  left.pointKey === right.pointKey
);

const geometryTargetsInTypedExpression = (
  expression: TypedScalarExpression
): ScalarExpressionResolvedGeometryTarget[] => {
  switch (expression.kind) {
    case "group":
    case "unary":
      return geometryTargetsInTypedExpression(expression.kind === "group" ? expression.expression : expression.operand);
    case "binary":
      return [
        ...geometryTargetsInTypedExpression(expression.left),
        ...geometryTargetsInTypedExpression(expression.right)
      ];
    case "call": {
      const targets: ScalarExpressionResolvedGeometryTarget[] = [];
      for (const argument of expression.args) {
        if (argument.kind === "geometryReference") {
          if (argument.target) targets.push(argument.target);
        } else {
          targets.push(...geometryTargetsInTypedExpression(argument.expression));
        }
      }
      return targets;
    }
    default:
      return [];
  }
};

const typedExpressionsForStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number
): TypedScalarExpression[] => {
  const expressions: TypedScalarExpression[] = [];
  const seen = new Set<TypedScalarExpression>();
  const add = (expression: TypedScalarExpression | undefined): void => {
    if (!expression || seen.has(expression)) return;
    seen.add(expression);
    expressions.push(expression);
  };
  for (const declaration of compiled.scalarProgram?.statements ?? []) {
    if (compiled.bindingAnalysis?.catalog.bindingsById.get(declaration.bindingId)?.statementIndex === statementIndex) {
      add(declaration.declaration.initializer);
    }
  }
  const statementIndexFromKey = (key: string): number | null => {
    const separator = key.indexOf(":");
    const parsed = Number(separator < 0 ? key : key.slice(0, separator));
    return Number.isInteger(parsed) ? parsed : null;
  };
  for (const [key, value] of compiled.propertyBindings ?? []) {
    if (statementIndexFromKey(key) === statementIndex && value.kind === "expression") add(value.expression);
  }
  for (const [key, value] of compiled.numericBindings ?? []) {
    if (statementIndexFromKey(key) === statementIndex) add(value.typedExpression);
  }
  for (const [key, expression] of compiled.conditionalGroupConditions ?? []) {
    if (statementIndexFromKey(key) === statementIndex) add(expression);
  }
  for (const [key, template] of compiled.textTemplates ?? []) {
    if (statementIndexFromKey(key) !== statementIndex) continue;
    for (const segment of template.segments) {
      if (segment.kind === "hole" && segment.holeKind !== "numeric") add(segment.expression);
    }
  }
  add(compiled.setStatements?.get(statementIndex)?.expression);
  return expressions;
};

type GeometryRewriteResult =
  | { kind: "ok"; rewrites: readonly GeometryArgumentRewrite[] }
  | { kind: "invalid"; message: string; target?: InlineModuleTargetIdentity };

const geometryCallerReferenceFor = (
  source: string,
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  parameter: GeometryParameterSubstitution
): ReferenceOccurrence | null => {
  if (
    !parameter.argumentRange ||
    !parameter.argumentSource ||
    !parameter.argumentReference ||
    parameter.expectedOwner?.kind !== "source"
  ) return null;
  const expectedOwner = `statement:${parameter.expectedOwner.statementId}`;
  const candidates = finalReferenceOccurrencesForRange(source, index, parameter.argumentRange).filter((candidate) =>
    candidate.sourceFrom === parameter.argumentRange!.from &&
    candidate.sourceTo === parameter.argumentRange!.to &&
    source.slice(candidate.sourceFrom, candidate.sourceTo) === parameter.argumentSource &&
    ownerTokenForIdentity(compiled, candidate.identity) === expectedOwner
  );
  return candidates.length === 1 ? candidates[0]! : null;
};

const geometryRewriteForCapture = (
  source: string,
  compiled: CompiledDslDocument,
  beforeIndex: DslSemanticOccurrenceIndex,
  entry: InlineEntry,
  substitution: GeometrySubstitutionProvenance
): GeometryArgumentRewrite | null => {
  if (substitution.expectedOwner.kind !== "source") return null;
  const parameter = entry.geometryParameters.find((candidate) =>
    candidate.parameterIndex === substitution.parameterIndex
  );
  if (!parameter) return null;
  const caller = geometryCallerReferenceFor(source, compiled, beforeIndex, parameter);
  if (!caller) return null;
  const originalSource = source.slice(caller.sourceFrom, caller.sourceTo);
  const canonical = canonicalSourceReferenceFor(
    source,
    compiled,
    caller.identity,
    caller,
    entry.statementIndex
  );
  if (!canonical || canonical === originalSource) return null;
  return {
    targetStatementId: entry.target.statementId,
    parameterIndex: substitution.parameterIndex,
    replacement: { from: parameter.argumentRange!.from, to: parameter.argumentRange!.to, text: canonical }
  };
};

const moduleSourceIdentityForReference = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  sourceReference: string,
  expectedArrayType: GeometryArrayType | null = null
): DslSemanticIdentity | null => {
  const namespace = compiled.sourceLexicalNamespace;
  const parsed = parseDslSourceReference(sourceReference);
  if (!namespace || parsed.kind !== "valid") return null;
  const path = parsed.reference.path;
  const lookup = resolveSourceLexicalPath(namespace, statementIndex, path);
  if (lookup.kind === "resolved") {
    if (expectedArrayType) {
      const value = namespace.geometryArraySemanticAnalysis?.valuesByStatementId.get(lookup.declaration.statementId);
      if (!value || !isGeometryArrayTypeAssignable(value.type, expectedArrayType)) return null;
    }
    return semanticIdentityForModuleTarget(compiled, {
      kind: "moduleSource",
      statementId: lookup.declaration.statementId
    });
  }
  if (
    lookup.kind !== "invalidTraversal" ||
    lookup.declaration.kind !== "moduleInstance" ||
    path.segments.length !== 2
  ) return null;
  const analysis = semanticAnalysisFor(compiled);
  const instance = analysis?.instancesByStatementId.get(lookup.declaration.statementId);
  const arrayAnalysis = namespace.geometryArraySemanticAnalysis;
  const exportedArray = instance?.callee && arrayAnalysis
    ? arrayAnalysis.values.find((candidate) =>
        candidate.ownerModuleDefinitionStatementIndex === instance.callee?.definitionStatementIndex &&
        candidate.exported &&
        candidate.name === path.segments[1] &&
        (!expectedArrayType || isGeometryArrayTypeAssignable(candidate.type, expectedArrayType))
      )
    : undefined;
  if (exportedArray) {
    return semanticIdentityForModuleTarget(compiled, {
      kind: "moduleSource",
      statementId: exportedArray.statementId
    });
  }
  if (expectedArrayType) return null;
  const exported = instance?.callee
    ? analysis?.definitionsByStatementId.get(instance.callee.definitionStatementId)?.exports.find((candidate) =>
        candidate.name === path.segments[1]
      )
    : undefined;
  return exported
    ? semanticIdentityForModuleTarget(compiled, {
        kind: "moduleSource",
        statementId: exported.exportedStatementId
      })
    : null;
};

const geometryArrayInitializerOccurrencesFor = (
  source: string,
  compiled: CompiledDslDocument,
  statementIndex: number,
  range: ExactSourceRange,
  arrayType: GeometryArrayType
): ReferenceOccurrence[] | null => {
  const parsed = parseGeometryArrayExpression(source.slice(range.from, range.to));
  if (!parsed.expression || parsed.diagnostics.length > 0) return null;
  const references: ReferenceOccurrence[] = [];
  const addReference = (
    text: string,
    relativeFrom: number,
    relativeTo: number,
    expectedArrayType: GeometryArrayType | null = null
  ): boolean => {
    const identity = moduleSourceIdentityForReference(compiled, statementIndex, text, expectedArrayType);
    if (!identity) return false;
    references.push({
      from: range.from + relativeFrom,
      to: range.from + relativeTo,
      kind: "reference",
      identity,
      sourceFrom: range.from + relativeFrom,
      sourceTo: range.from + relativeTo
    });
    return true;
  };
  if (parsed.expression.kind === "reference") {
    return addReference(
      parsed.expression.text,
      parsed.expression.span.start,
      parsed.expression.span.end,
      arrayType
    ) ? references : null;
  }
  for (const member of parsed.expression.members) {
    const parsedMember = parseDslSourceReference(member.text);
    if (parsedMember.kind !== "valid") {
      // Coordinates have no semantic source owner and therefore need no move
      // rewrite. The generated geometry-array semantic pass validates them.
      if (member.text.trimStart().startsWith("(")) continue;
      return null;
    }
    if (!addReference(member.text, member.span.start, member.span.end)) return null;
  }
  return references;
};

const geometryArrayCaptureRewritesFor = (
  source: string,
  compiled: CompiledDslDocument,
  entries: readonly InlineEntry[]
): InitializerRewriteResult => {
  const rewrites: InitializerRewrite[] = [];
  for (const entry of entries) {
    const localNames = new Set(localParameterLoweringsFor(entry).map(({ parameter }) => parameter.parameterName));
    for (const parameter of entry.geometryArrayParameters) {
      if (parameter.initializerSource === null || parameter.originalExpressionRange === null) continue;
      const occurrences = geometryArrayInitializerOccurrencesFor(
        source,
        compiled,
        entry.statementIndex,
        parameter.originalExpressionRange,
        parameter.arrayType
      );
      if (occurrences === null) {
        return {
          kind: "invalid",
          message: `Module parameter「${parameter.parameterName}」の array initializer source owner を証明できません。`,
          target: entry.target
        };
      }
      for (const occurrence of occurrences) {
        const parsed = parseDslSourceReference(source.slice(occurrence.sourceFrom, occurrence.sourceTo));
        if (
          parsed.kind !== "valid" ||
          parsed.reference.path.absolute ||
          parsed.reference.path.segments.length === 0 ||
          !localNames.has(parsed.reference.path.segments[0]!)
        ) continue;
        const canonical = canonicalSourceReferenceFor(
          source,
          compiled,
          occurrence.identity,
          occurrence,
          entry.statementIndex
        );
        if (!canonical || canonical === source.slice(occurrence.sourceFrom, occurrence.sourceTo)) {
          return {
            kind: "invalid",
            message: `Module parameter「${parameter.parameterName}」の array initializer reference を安全に canonicalize できません。`,
            target: entry.target
          };
        }
        rewrites.push({
          targetStatementId: entry.target.statementId,
          parameterIndex: parameter.parameterIndex,
          replacement: { from: occurrence.sourceFrom, to: occurrence.sourceTo, text: canonical }
        });
      }
    }
  }
  return { kind: "ok", rewrites };
};

const lexicalGeometryOwnerForSource = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  sourceReference: string
): StatementIdentity | null => {
  const namespace = compiled.sourceLexicalNamespace;
  const parsed = parseDslSourceReference(sourceReference);
  if (!namespace || parsed.kind !== "valid") return null;
  const resolved = resolveSourceLexicalPath(namespace, statementIndex, parsed.reference.path);
  return resolved.kind === "resolved" ? resolved.declaration.statementId : null;
};

const remappedGeometryTarget = (
  target: ScalarExpressionResolvedGeometryTarget,
  nextCompiled: CompiledDslDocument,
  mapping: OwnerMapping
): ScalarExpressionResolvedGeometryTarget => {
  const statementId = mapping.bodyStatementIds.get(target.statementId) ?? target.statementId;
  const statementIndex = statementIndexForId(nextCompiled, statementId) ?? target.statementIndex;
  return { ...target, statementId, statementIndex };
};

const geometryRewritesFor = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entries: readonly InlineEntry[],
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): GeometryRewriteResult => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const rewrites: GeometryArgumentRewrite[] = [];
  const addRewrite = (
    entry: InlineEntry,
    substitution: GeometrySubstitutionProvenance
  ): boolean => {
    const rewrite = geometryRewriteForCapture(source, compiled, beforeIndex, entry, substitution);
    if (!rewrite) return false;
    const existing = rewrites.find((candidate) =>
      candidate.targetStatementId === rewrite.targetStatementId &&
      candidate.parameterIndex === rewrite.parameterIndex &&
      candidate.replacement.from === rewrite.replacement.from &&
      candidate.replacement.to === rewrite.replacement.to
    );
    if (existing) return existing.replacement.text === rewrite.replacement.text;
    rewrites.push(rewrite);
    return true;
  };

  for (const entry of entries) {
    const mapping = mappingsByTarget.get(entry.target.statementId);
    if (!mapping) return { kind: "invalid", message: "生成した Module group の geometry mapping がありません。", target: entry.target };
    for (const substitution of entry.bodyTransformation.geometrySubstitutions) {
      const oldBodyIndex = statementIndexForId(compiled, substitution.originalStatementId);
      const nextBodyId = mapping.bodyStatementIds.get(substitution.originalStatementId);
      const nextBodyIndex = nextBodyId ? statementIndexForId(nextCompiled, nextBodyId) : null;
      if (oldBodyIndex === null || nextBodyIndex === null || nextBodyId === undefined) {
        return { kind: "invalid", message: "geometry substitution の body owner mapping がありません。", target: entry.target };
      }
      const nextStatement = nextCompiled.statements[nextBodyIndex];
      if (!nextStatement) return { kind: "invalid", message: "geometry substitution の generated body statement がありません。", target: entry.target };

      if (substitution.siteKind === "builtin") continue;
      const generatedReferences = finalReferenceOccurrencesForRange(
        nextCompiled.spans.sourceMap.source,
        afterIndex,
        nextStatement.documentRange
      ).filter((reference) =>
        nextCompiled.spans.sourceMap.source.slice(reference.sourceFrom, reference.sourceTo) === substitution.emittedSource
      );
      if (substitution.expectedOwner.kind === "coordinate") {
        if (generatedReferences.length !== 0 || nextStatement.kind !== "element" || !nextCompiled.sourceElementsByStatementIndex?.has(nextBodyIndex)) {
          return { kind: "invalid", message: "coordinate geometry substitution の generated geometry role を証明できません。", target: entry.target };
        }
        continue;
      }
      const expectedOwner = `statement:${substitution.expectedOwner.statementId}`;
      const peerSubstitutions = entry.bodyTransformation.geometrySubstitutions
        .filter((candidate) =>
          candidate.originalStatementId === substitution.originalStatementId &&
          candidate.siteKind !== "builtin" &&
          candidate.emittedSource === substitution.emittedSource
        )
        .sort((left, right) => left.bodySourceRange.from - right.bodySourceRange.from);
      const peerIndex = peerSubstitutions.indexOf(substitution);
      if (
        generatedReferences.length === peerSubstitutions.length &&
        peerIndex >= 0 &&
        ownerTokenForIdentity(nextCompiled, generatedReferences[peerIndex]!.identity) === expectedOwner
      ) continue;
      const generatedText = nextCompiled.spans.sourceMap.source.slice(nextStatement.documentRange.from, nextStatement.documentRange.to);
      let generatedTextCount = 0;
      let generatedTextCursor = 0;
      while (true) {
        const found = generatedText.indexOf(substitution.emittedSource, generatedTextCursor);
        if (found < 0) break;
        generatedTextCount += 1;
        generatedTextCursor = found + substitution.emittedSource.length;
      }
      const lexicalOwner = generatedReferences.length === 0 && generatedTextCount === peerSubstitutions.length
        ? lexicalGeometryOwnerForSource(nextCompiled, nextBodyIndex, substitution.emittedSource)
        : null;
      if (lexicalOwner === substitution.expectedOwner.statementId) continue;
      if (generatedReferences.length > 1 || !addRewrite(entry, substitution)) {
        return { kind: "invalid", message: "generated geometry reference の semantic owner を canonicalize できません。", target: entry.target };
      }
    }

    const expectedBuiltins: { target: ScalarExpressionResolvedGeometryTarget; substitution: GeometrySubstitutionProvenance | null }[] = [];
    const actualBuiltins: ScalarExpressionResolvedGeometryTarget[] = [];
    for (const oldBodyId of mapping.bodyStatementIds.keys()) {
      const body = bodyStatementSemanticFor(compiled, oldBodyId);
      const index = statementIndexForId(compiled, oldBodyId);
      if (!body || index === null) continue;
      const oldStatement = compiled.statements[index];
      if (!oldStatement) return { kind: "invalid", message: "Module body statement がありません。", target: entry.target };
      const nextBodyId = mapping.bodyStatementIds.get(body.statementId);
      const nextBodyIndex = nextBodyId ? statementIndexForId(nextCompiled, nextBodyId) : null;
      if (nextBodyIndex === null || nextBodyId === undefined) return { kind: "invalid", message: "generated Module body statement がありません。", target: entry.target };
      actualBuiltins.push(...typedExpressionsForStatement(nextCompiled, nextBodyIndex).flatMap(geometryTargetsInTypedExpression));
      const eliminated = entry.bodyTransformation.provenance.find((provenance) => provenance.originalStatementId === body.statementId)?.eliminatedSourceRanges ?? [];
      const sites = [
        ...body.scalarExpressions.map((site) => ({ span: site.span, expression: site.expression })),
        ...body.textTemplateHoles.map((site) => ({ span: site.span, expression: site.expression }))
      ].sort((left, right) => left.span.start - right.span.start);
      for (const site of sites) {
        for (const builtin of site.expression.geometryBuiltinArguments) {
          const referenceRange = physicalRangeForLogicalSpan(compiled, oldStatement, builtin.reference.span);
          if (!referenceRange) return { kind: "invalid", message: "geometry builtin の exact physical source span を解決できません。", target: entry.target };
          if (eliminated.some((range) => referenceRange.from >= range.from && referenceRange.to <= range.to)) continue;
          const target = builtin.reference.target;
          if (target?.kind === "parameter" && target.definitionStatementId === entry.definition.statementId) {
            const substitution = entry.bodyTransformation.geometrySubstitutions.find((candidate) =>
              candidate.originalStatementId === body.statementId &&
              candidate.parameterIndex === target.parameterIndex &&
              candidate.siteKind === "builtin" &&
              candidate.bodySourceRange.from === referenceRange.from &&
              candidate.bodySourceRange.to === referenceRange.to
            );
            if (!substitution) return { kind: "invalid", message: "geometry builtin parameter substitution の provenance がありません。", target: entry.target };
            const callerTarget = geometryTargetForReference(substitution.callerReference, builtin.expectedGeometryType);
            if (!callerTarget) return { kind: "invalid", message: "geometry builtin caller target を解決できません。", target: entry.target };
            expectedBuiltins.push({ target: callerTarget, substitution });
            continue;
          }
          if (!target || target.kind === "parameter") {
            return { kind: "invalid", message: "geometry builtin target の semantic owner を解決できません。", target: entry.target };
          }
          const originalTarget = geometryTargetForReference(builtin.reference, builtin.expectedGeometryType);
          if (!originalTarget) return { kind: "invalid", message: "geometry builtin target の semantic geometry を解決できません。", target: entry.target };
          expectedBuiltins.push({ target: remappedGeometryTarget(originalTarget, nextCompiled, mapping), substitution: null });
        }
      }
    }
    if (actualBuiltins.length !== expectedBuiltins.length) {
      return { kind: "invalid", message: "geometry builtin operand 数を証明できません。", target: entry.target };
    }
    for (const [index, expected] of expectedBuiltins.entries()) {
      if (sameGeometryTarget(expected.target, actualBuiltins[index]!)) continue;
      if (!expected.substitution || expected.substitution.expectedOwner.kind !== "source" || !addRewrite(entry, expected.substitution)) {
        return { kind: "invalid", message: "geometry builtin operand の semantic owner を証明できません。", target: entry.target };
      }
    }
  }
  return { kind: "ok", rewrites };
};

const recordTargetIdentityForCopiedSource = (
  target: RecordReferenceProvenance["record"],
  mapping: OwnerMapping,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): DslSemanticIdentity | null => {
  if (target.kind === "recordParameter") {
    const generated = mapping.parameterBindings.get(
      parameterSlotKey(target.definitionStatementId, target.parameterIndex)
    );
    return generated ? { kind: "recordValue", statementId: generated.statementId } : null;
  }
  if (target.kind === "recordValue") {
    const copied = mapping.bodyStatementIds.get(target.statementId) ??
      [...mappingsByTarget.values()].map((candidate) => candidate.bodyStatementIds.get(target.statementId)).find(Boolean);
    return { kind: "recordValue", statementId: copied ?? target.statementId };
  }
  return null;
};

const recordOccurrencesForCopiedBody = (
  source: string,
  compiled: CompiledDslDocument,
  statementIndex: number,
  provenances: readonly RecordReferenceProvenance[],
  mapping: OwnerMapping,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): readonly DslSemanticOccurrence[] | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const occurrences: DslSemanticOccurrence[] = [];
  let cursor = statement.documentRange.from;
  for (const provenance of [...provenances].sort((left, right) =>
    left.bodySourceRange.from - right.bodySourceRange.from || left.bodySourceRange.to - right.bodySourceRange.to
  )) {
    const from = source.indexOf(provenance.source, cursor);
    if (
      from < statement.documentRange.from ||
      from < 0 ||
      from + provenance.source.length > statement.documentRange.to
    ) return null;
    const parsed = parseDslSourceReferenceAt(source, from, statement.documentRange.to);
    if (parsed.kind !== "valid" || parsed.end !== from + provenance.source.length) return null;
    const pathRanges = readDslReferencePathSegments(
      source,
      parsed.reference.pathRange.start,
      parsed.reference.pathRange.end
    );
    if (pathRanges.kind !== "valid") return null;
    const baseIdentity = recordTargetIdentityForCopiedSource(provenance.record, mapping, mappingsByTarget);
    if (baseIdentity && pathRanges.segments.length === 1) {
      const range = pathRanges.segments[0];
      if (range) occurrences.push({ from: range.start, to: range.end, kind: "reference", identity: baseIdentity });
    } else if (provenance.record.kind === "deferredModuleRecordExport" && pathRanges.segments.length >= 2) {
      const instanceRange = pathRanges.segments[0];
      const memberRange = pathRanges.segments[pathRanges.segments.length - 1];
      const instanceMapping = mappingsByTarget.get(provenance.record.instanceStatementId);
      const copiedInstanceId = instanceMapping?.generatedGroupStatementId ?? provenance.record.instanceStatementId;
      const copiedExportId = instanceMapping?.bodyStatementIds.get(provenance.record.exportedStatementId) ?? provenance.record.exportedStatementId;
      if (instanceRange) occurrences.push({
        from: instanceRange.start,
        to: instanceRange.end,
        kind: "reference",
        identity: { kind: "module", target: { kind: "moduleInstance", statementId: copiedInstanceId } }
      });
      if (memberRange) occurrences.push({
        from: memberRange.start,
        to: memberRange.end,
        kind: "reference",
        identity: { kind: "module", target: { kind: "moduleSource", statementId: copiedExportId } }
      });
    } else {
      return null;
    }
    const propertyStart = parsed.reference.propertyRange?.start;
    const propertyEnd = parsed.reference.propertyRange?.end;
    if (
      propertyStart === undefined ||
      propertyEnd === undefined ||
      source.slice(propertyStart, propertyEnd) !== provenance.source.slice(provenance.source.lastIndexOf(".") + 1)
    ) return null;
    occurrences.push({
      from: propertyStart,
      to: propertyEnd,
      kind: "reference",
      identity: { kind: "recordField", field: provenance.field }
    });
    cursor = parsed.end;
  }
  return occurrences;
};

const verifyCopiedBodyOwners = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entry: InlineEntry,
  mapping: OwnerMapping,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): boolean => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const nextGroupIndex = statementIndexForId(nextCompiled, mapping.generatedGroupStatementId);
  if (nextGroupIndex === null) return false;

  for (const [oldBodyId, nextBodyId] of mapping.bodyStatementIds) {
    const oldBodyIndex = statementIndexForId(compiled, oldBodyId);
    const nextBodyIndex = nextBodyId ? statementIndexForId(nextCompiled, nextBodyId) : null;
    if (oldBodyIndex === null || nextBodyIndex === null) return false;
    const oldBodyStatement = compiled.statements[oldBodyIndex];
    if (!oldBodyStatement) return false;
    const eliminatedSourceRanges = entry.bodyTransformation.provenance.find((provenance) =>
      provenance.originalStatementId === oldBodyId
    )?.eliminatedSourceRanges ?? [];
    const geometrySubstitutions = entry.bodyTransformation.geometrySubstitutions.filter((substitution) =>
      substitution.originalStatementId === oldBodyId
    );
    const oldOccurrenceIsRetained = (occurrence: DslSemanticOccurrence): boolean => {
      const statement = compiled.statements[oldBodyIndex];
      if (!statement || occurrence.from < statement.documentRange.from || occurrence.to > statement.documentRange.to) return false;
      const occurrenceRange = occurrence.kind === "reference"
        ? sourceReferenceRangeForOccurrence(source, beforeIndex.occurrences, occurrence, statement.documentRange) ?? { from: occurrence.from, to: occurrence.to }
        : { from: occurrence.from, to: occurrence.to };
      if (!occurrenceRange) return false;
      if (eliminatedSourceRanges.some((range) => occurrenceRange.from >= range.from && occurrenceRange.to <= range.to)) return false;
      return !geometrySubstitutions.some((substitution) =>
        occurrenceRange.from >= substitution.bodySourceRange.from && occurrenceRange.to <= substitution.bodySourceRange.to
      );
    };
    const oldStatementOccurrences = beforeIndex.occurrences.filter(oldOccurrenceIsRetained);
    const expected = occurrenceSlotsForStatement(
      source,
      compiled,
      beforeIndex,
      oldBodyIndex,
      oldOccurrenceIsRetained
    ).map((slot) => ({
      ...slot,
      owners: (() => {
        const candidates = oldStatementOccurrences.filter((occurrence) =>
          occurrence.kind === slot.kind && source.slice(occurrence.from, occurrence.to) === slot.token
        );
        // A module-parameter reference can also have a synthetic typed-binding
        // occurrence at the same source span. Prefer the module-semantic
        // occurrence so the copied-body proof follows the actual parameter
        // identity and maps it to the generated const.
        const candidate = candidates.find((occurrence) => occurrence.identity.kind === "module") ?? candidates[slot.ordinal];
        if (!candidate) return [];
        return [remappedOwnerTokenForIdentity(compiled, candidate.identity, mapping, mappingsByTarget)];
      })().sort()
    }));
    const generatedGeometryRanges = new Set<string>();
    for (const substitution of geometrySubstitutions) {
      const generated = finalReferenceOccurrencesForRange(
        nextCompiled.spans.sourceMap.source,
        afterIndex,
        nextCompiled.statements[nextBodyIndex]!.documentRange
      ).filter((occurrence) =>
        nextCompiled.spans.sourceMap.source.slice(occurrence.sourceFrom, occurrence.sourceTo) === substitution.emittedSource
      );
      for (const occurrence of generated) generatedGeometryRanges.add(`${occurrence.sourceFrom}:${occurrence.sourceTo}`);
    }
    const recordReferences = entry.bodyTransformation.recordReferences.filter((reference) => {
      if (reference.originalStatementId !== oldBodyId) return false;
      return !eliminatedSourceRanges.some((range) =>
        reference.bodySourceRange.from >= range.from && reference.bodySourceRange.to <= range.to
      );
    });
    const copiedRecordOccurrences = recordOccurrencesForCopiedBody(
      nextCompiled.spans.sourceMap.source,
      nextCompiled,
      nextBodyIndex,
      recordReferences,
      mapping,
      mappingsByTarget
    );
    if (copiedRecordOccurrences === null) return false;
    const actual = occurrenceSlotsForStatement(
      nextCompiled.spans.sourceMap.source,
      nextCompiled,
      afterIndex,
      nextBodyIndex,
      (occurrence) => {
        if (occurrence.kind !== "reference") return true;
        const range = sourceReferenceRangeForOccurrence(
          nextCompiled.spans.sourceMap.source,
          afterIndex.occurrences,
          occurrence,
          nextCompiled.statements[nextBodyIndex]!.documentRange
        );
        return range === null || !generatedGeometryRanges.has(`${range.from}:${range.to}`);
      },
      [
        ...iterationOccurrencesForStatement(nextCompiled.spans.sourceMap.source, nextCompiled, nextBodyIndex),
        ...copiedRecordOccurrences
      ]
    );
    if (!compareSlots(expected, actual)) return false;

    const oldArrayReferences = entry.bodyTransformation.geometryArrayReferences.filter((reference) =>
      reference.originalStatementId === oldBodyId
    );
    const nextArrayReferences = geometryArrayParameterReferencesForStatement(
      nextCompiled.spans.sourceMap.source,
      nextCompiled,
      entry,
      { statementId: nextBodyId, statementIndex: nextBodyIndex, statement: nextCompiled.statements[nextBodyIndex]! }
    );
    if (oldArrayReferences.length !== nextArrayReferences.length) return false;
    for (const [index, oldReference] of oldArrayReferences.entries()) {
      const nextReference = nextArrayReferences[index];
      const parameter = geometryArrayParameterForSlot(entry, oldReference.parameterIndex);
      const generated = mapping.parameterBindings.get(
        parameterSlotKey(entry.definition.statementId, oldReference.parameterIndex)
      );
      if (!nextReference || !parameter || !generated) return false;
      const parsed = parseDslSourceReference(nextCompiled.spans.sourceMap.source.slice(
        nextReference.bodySourceRange.from,
        nextReference.bodySourceRange.to
      ));
      if (
        parsed.kind !== "valid" ||
        parsed.reference.property ||
        parsed.reference.path.absolute ||
        parsed.reference.path.segments.length !== 1 ||
        parsed.reference.path.segments[0] !== parameter.parameterName
      ) return false;
      const lookup = resolveSourceLexicalPath(nextCompiled.sourceLexicalNamespace!, nextBodyIndex, parsed.reference.path);
      const arrayValue = nextCompiled.sourceLexicalNamespace!.geometryArraySemanticAnalysis?.valuesByStatementId.get(generated.statementId);
      if (
        lookup.kind !== "resolved" ||
        lookup.declaration.statementId !== generated.statementId ||
        !arrayValue ||
        arrayValue.type.elementType !== parameter.arrayType.elementType
      ) return false;
    }
  }

  return nextCompiled.statements[nextGroupIndex]?.kind === "group";
};

const generatedGroupFor = (
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entry: InlineEntry
): number | null => {
  const scopeId = compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(entry.statementIndex);
  if (!scopeId || !nextCompiled.sourceLexicalNamespace) return null;
  const candidates = nextCompiled.sourceLexicalNamespace.allDeclarations.filter((declaration) =>
    declaration.kind === "group" &&
    declaration.name === entry.statement.name &&
    declaration.scopeId === scopeId
  );
  return candidates.length === 1 ? candidates[0]!.statementIndex : null;
};

const generatedParameterMappingsFor = (
  nextCompiled: CompiledDslDocument,
  groupIndex: number,
  entry: InlineEntry
): ReadonlyMap<string, GeneratedParameterMapping> | null => {
  const children = directChildEntriesForGroup(nextCompiled, groupIndex);
  const emittedParameters = localParameterLoweringsFor(entry);
  const generated = children.slice(0, emittedParameters.length);
  if (generated.length !== emittedParameters.length) return null;
  const mappings = new Map<string, GeneratedParameterMapping>();
  for (const [index, local] of emittedParameters.entries()) {
    const parameter = local.parameter;
    const child = generated[index];
    if (
      !child ||
      child.statement.kind !== "typedDeclaration" ||
      child.statement.bindingKind !== "const" ||
      child.statement.name !== parameter.parameterName
    ) return null;
    const scalarTypeMatches = local.kind === "scalar" && child.statement.declaredType?.kind === local.parameter.parameter.type?.kind;
    const arrayType = local.kind === "geometryArray" ? geometryArrayTypeOfTypedDeclaration(child.statement) : null;
    const arrayTypeMatches = local.kind === "geometryArray" && arrayType?.elementType === local.parameter.arrayType.elementType;
    const recordValue = local.kind === "record"
      ? nextCompiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementIndex.get(child.statementIndex)
      : null;
    const recordTypeMatches = local.kind === "record" &&
      child.statement.declaredType === null &&
      geometryArrayTypeOfTypedDeclaration(child.statement) === null &&
      child.statement.recordTypeReference?.name === local.parameter.parameter.recordTypeReference?.name &&
      recordValue?.typeIdentity === local.parameter.recordTypeIdentity;
    if ((!scalarTypeMatches && !arrayTypeMatches && !recordTypeMatches) || (local.kind === "scalar" && arrayType !== null)) return null;
    const bindingCandidates = local.kind === "scalar"
      ? [...(nextCompiled.bindingAnalysis?.catalog.bindings.values() ?? [])]
        .filter((binding) => binding.kind === "typed" && binding.statementIndex === child.statementIndex)
      : [];
    if (local.kind === "scalar" && bindingCandidates.length !== 1) return null;
    const binding = bindingCandidates[0] ?? null;
    const statementId = child.statementId;
    if (!statementId) return null;
    const initializer = exactPhysicalSpan(
      nextCompiled.spans,
      child.statement,
      child.statement.payloadSpans.initializer
    );
    const initializerRange = singlePhysicalRange(initializer, nextCompiled.spans.sourceMap.sourceRevision);
    if (!initializerRange) return null;
    mappings.set(parameterSlotKey(entry.definition.statementId, parameter.parameterIndex), {
      parameterIndex: parameter.parameterIndex,
      statementIndex: child.statementIndex,
      statementId,
      bindingId: binding?.id ?? null,
      initializerRange
    });
  }
  return mappings;
};

const replacementFor = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  body: BodyRange
): LineSplice | InlineModuleRejection => {
  const instanceLine = source.slice(
    starts[entry.statementInfo.line - 1]!,
    lineEndOffset(source, starts, entry.statementInfo.line)
  );
  const instanceIndent = leadingWhitespace(instanceLine);
  const suffix = trailingSourceSuffix(source, starts, entry.statement, entry.statementInfo);
  if (suffix === null) {
    return reject("unsafe-source-span", "Inline target の exact-current source range を解決できません。", entry.target);
  }
  const activityText = entry.activity === "visible" ? "" : `(state: ${entry.activity})`;
  const localParameterLines = localParameterLoweringsFor(entry).map(({ parameter }) =>
      `${instanceIndent}${DSL_INDENT}const ${parameter.nameSource}: ${parameter.typeSource} = ${parameter.initializerSource}`
    );
  return {
    startLine: entry.statementInfo.range.startLine,
    endLine: entry.statementInfo.range.endLine,
    replacementLines: [
      `${instanceIndent}group ${formatDslName(entry.statement.name)}${activityText} {${suffix}`,
      ...localParameterLines,
      ...rebaseBodyLines(entry.bodyTransformation.bodyLines, body.definitionIndent, instanceIndent),
      `${instanceIndent}}`
    ]
  };
};

const ownerMappingsFor = (
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entries: readonly InlineEntry[]
): ReadonlyMap<StatementIdentity, OwnerMapping> | null => {
  const mappings = new Map<StatementIdentity, OwnerMapping>();
  for (const entry of entries) {
    const groupIndex = generatedGroupFor(compiled, nextCompiled, entry);
    if (groupIndex === null) return null;
    const parameterBindings = generatedParameterMappingsFor(nextCompiled, groupIndex, entry);
    if (!parameterBindings) return null;
    const mapping = copyOwnerMappingFor(compiled, nextCompiled, groupIndex, entry, parameterBindings);
    if (!mapping) return null;
    mappings.set(entry.target.statementId, mapping);
  }
  return mappings;
};

type InitializerRewriteResult =
  | { kind: "ok"; rewrites: readonly InitializerRewrite[] }
  | { kind: "invalid"; message: string; target?: InlineModuleTargetIdentity };

const initializerRewritesFor = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entries: readonly InlineEntry[],
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): InitializerRewriteResult => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const rewrites: InitializerRewrite[] = [];
  for (const entry of entries) {
    const mapping = mappingsByTarget.get(entry.target.statementId);
    if (!mapping) return { kind: "invalid", message: "生成した Module group の semantic mapping がありません。", target: entry.target };
    const proveInitializer = (
      parameter: {
        parameterIndex: number;
        parameterName: string;
        initializerSource: string | null;
        originalExpressionRange: ExactSourceRange | null;
        eliminatedSourceRanges?: readonly ExactSourceRange[];
      },
      before: ReferenceOccurrence[] | null,
      kind: "scalar" | "geometry-array" | "record"
    ): InitializerRewriteResult | null => {
      if (parameter.initializerSource === null || parameter.originalExpressionRange === null) {
        if (mapping.parameterBindings.has(parameterSlotKey(entry.definition.statementId, parameter.parameterIndex))) {
          return { kind: "invalid", message: "optional omitted parameter に生成 const mapping があります。", target: entry.target };
        }
        return null;
      }
      const generated = mapping.parameterBindings.get(
        parameterSlotKey(entry.definition.statementId, parameter.parameterIndex)
      );
      if (!generated) return { kind: "invalid", message: `生成した ${kind} parameter const の semantic mapping がありません。`, target: entry.target };
      if (!before) return { kind: "invalid", message: `moved ${kind} initializer の source owner を証明できません。`, target: entry.target };
      const nextSource = nextCompiled.spans.sourceMap.source;
      const after = kind === "geometry-array"
        ? geometryArrayInitializerOccurrencesFor(
            nextSource,
            nextCompiled,
            generated.statementIndex,
            generated.initializerRange,
            (parameter as GeometryArrayParameterLowering).arrayType
          )
        : finalReferenceOccurrencesForRange(nextSource, afterIndex, generated.initializerRange);
      if (!after) {
        return {
          kind: "invalid",
          message: `Module parameter「${parameter.parameterName}」の moved initializer source owner を証明できません。`,
          target: entry.target
        };
      }
      const retainedBefore = before.filter((original) => !(parameter.eliminatedSourceRanges ?? []).some((range) =>
        original.sourceFrom >= range.from &&
        original.sourceTo <= range.to
      ));
      if (retainedBefore.length !== after.length) {
        return {
          kind: "invalid",
          message: `Module parameter「${parameter.parameterName}」の moved initializer reference 数を証明できません。`,
          target: entry.target
        };
      }
      for (const [index, original] of retainedBefore.entries()) {
        const candidate = after[index];
        if (!candidate) {
          return { kind: "invalid", message: "moved initializer の reference 対応を証明できません。", target: entry.target };
        }
        const expectedOwner = remappedOwnerTokenForIdentity(
          compiled,
          original.identity,
          mapping,
          mappingsByTarget
        );
        const actualOwner = ownerTokenForIdentity(nextCompiled, candidate.identity);
        const originalReferenceSource = source.slice(original.sourceFrom, original.sourceTo);
        if (expectedOwner === actualOwner) continue;
        const canonical = canonicalSourceReferenceFor(
          source,
          compiled,
          original.identity,
          original,
          entry.statementIndex
        );
        if (!canonical || canonical === originalReferenceSource) {
          return {
            kind: "invalid",
            message: `Module parameter「${parameter.parameterName}」の moved reference を安全に canonicalize できません。`,
            target: entry.target
          };
        }
        if (!rewrites.some((rewrite) =>
          rewrite.targetStatementId === entry.target.statementId &&
          rewrite.parameterIndex === parameter.parameterIndex &&
          rewrite.replacement.from === original.sourceFrom &&
          rewrite.replacement.to === original.sourceTo
        )) {
          rewrites.push({
            targetStatementId: entry.target.statementId,
            parameterIndex: parameter.parameterIndex,
            replacement: {
              from: original.sourceFrom,
              to: original.sourceTo,
              text: canonical
            }
          });
        }
      }
      return null;
    };
    for (const parameter of entry.scalarParameters) {
      const before = parameter.initializerSource === null || parameter.originalExpressionRange === null
        ? []
        : finalReferenceOccurrencesForRange(source, beforeIndex, parameter.originalExpressionRange);
      const result = proveInitializer(parameter, before, "scalar");
      if (result) return result;
    }
    for (const parameter of entry.geometryArrayParameters) {
      const before = parameter.initializerSource === null || parameter.originalExpressionRange === null
        ? []
        : geometryArrayInitializerOccurrencesFor(
            source,
            compiled,
            entry.statementIndex,
            parameter.originalExpressionRange,
            parameter.arrayType
          );
      const result = proveInitializer(parameter, before, "geometry-array");
      if (result) return result;
    }
    for (const parameter of entry.recordParameters) {
      const before = parameter.initializerSource === null || parameter.originalExpressionRange === null
        ? []
        : finalReferenceOccurrencesForRange(source, beforeIndex, parameter.originalExpressionRange);
      const result = proveInitializer(parameter, before, "record");
      if (result) return result;
    }
  }
  return { kind: "ok", rewrites };
};

const entriesWithInitializerRewrites = (
  source: string,
  entries: readonly InlineEntry[],
  rewrites: readonly InitializerRewrite[]
): readonly InlineEntry[] | null => {
  const rewrittenEntries = entries.map((entry): InlineEntry | null => {
    const scalarParameters = entry.scalarParameters.map((parameter) => {
      const replacements = rewrites
        .filter((rewrite) =>
          rewrite.targetStatementId === entry.target.statementId &&
          rewrite.parameterIndex === parameter.parameterIndex
        )
        .map((rewrite) => rewrite.replacement);
      if (replacements.length === 0) return parameter;
      if (parameter.originalExpressionRange === null) return null;
      const initializerSource = applyAbsoluteReplacements(
        source,
        parameter.originalExpressionRange.from,
        parameter.originalExpressionRange.to,
        replacements
      );
      if (initializerSource === null) return null;
      return { ...parameter, initializerSource };
    });
    const geometryArrayParameters = entry.geometryArrayParameters.map((parameter) => {
      const replacements = rewrites
        .filter((rewrite) =>
          rewrite.targetStatementId === entry.target.statementId &&
          rewrite.parameterIndex === parameter.parameterIndex
        )
        .map((rewrite) => rewrite.replacement);
      if (replacements.length === 0) return parameter;
      if (parameter.originalExpressionRange === null) return null;
      const initializerSource = applyAbsoluteReplacements(
        source,
        parameter.originalExpressionRange.from,
        parameter.originalExpressionRange.to,
        replacements
      );
      if (initializerSource === null) return null;
      return { ...parameter, initializerSource };
    });
    const recordParameters = entry.recordParameters.map((parameter) => {
      const replacements = rewrites
        .filter((rewrite) =>
          rewrite.targetStatementId === entry.target.statementId &&
          rewrite.parameterIndex === parameter.parameterIndex
        )
        .map((rewrite) => rewrite.replacement);
      if (replacements.length === 0) return parameter;
      if (parameter.originalExpressionRange === null) return null;
      const initializerSource = applyAbsoluteReplacements(
        source,
        parameter.originalExpressionRange.from,
        parameter.originalExpressionRange.to,
        replacements
      );
      if (initializerSource === null) return null;
      return { ...parameter, initializerSource };
    });
    return scalarParameters.some((parameter) => parameter === null) ||
      geometryArrayParameters.some((parameter) => parameter === null) ||
      recordParameters.some((parameter) => parameter === null)
      ? null
      : {
          ...entry,
          scalarParameters: scalarParameters as readonly ScalarParameterLowering[],
          geometryArrayParameters: geometryArrayParameters as readonly GeometryArrayParameterLowering[],
          recordParameters: recordParameters as readonly RecordParameterLowering[]
        };
  });
  return rewrittenEntries.some((entry) => entry === null)
    ? null
    : rewrittenEntries.filter((entry): entry is InlineEntry => entry !== null);
};

const entriesWithGeometryRewrites = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  entries: readonly InlineEntry[],
  rewrites: readonly GeometryArgumentRewrite[],
  emitOmittedBranchComments: boolean
): readonly InlineEntry[] | null => {
  const rewrittenEntries: (InlineEntry | null)[] = entries.map((entry) => {
    let changed = false;
    const geometryParameters = entry.geometryParameters.map((parameter) => {
      const replacements = rewrites
        .filter((rewrite) =>
          rewrite.targetStatementId === entry.target.statementId &&
          rewrite.parameterIndex === parameter.parameterIndex
        )
        .map((rewrite) => rewrite.replacement);
      if (replacements.length === 0) return parameter;
      if (parameter.argumentRange === null || parameter.argumentSource === null) return null;
      const argumentSource = applyAbsoluteReplacements(
        source,
        parameter.argumentRange.from,
        parameter.argumentRange.to,
        replacements
      );
      if (argumentSource === null) return null;
      changed = true;
      return { ...parameter, argumentSource };
    });
    if (geometryParameters.some((parameter) => parameter === null)) return null;
    const nextGeometryParameters = geometryParameters as readonly GeometryParameterSubstitution[];
    if (!changed) return entry;
    const presenceByParameter = new Map<string, boolean>();
    for (const parameter of [...entry.scalarParameters, ...entry.geometryArrayParameters, ...entry.recordParameters, ...nextGeometryParameters]) {
      if (parameter.state === "optionalSupplied" || parameter.state === "optionalOmitted") {
        presenceByParameter.set(
          parameterSlotKey(entry.definition.statementId, parameter.parameterIndex),
          parameter.state === "optionalSupplied"
        );
      }
    }
    const bodyTransformation = buildBodyTransformation(
      source,
      starts,
      compiled,
      { ...entry, geometryParameters: nextGeometryParameters },
      presenceByParameter,
      emitOmittedBranchComments
    );
    return bodyTransformation.kind === "unsafe"
      ? null
      : { ...entry, geometryParameters: nextGeometryParameters, bodyTransformation: bodyTransformation.transformation };
  });
  return rewrittenEntries.some((entry) => entry === null)
    ? null
    : rewrittenEntries.filter((entry): entry is InlineEntry => entry !== null);
};

const buildInlineSplices = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  entries: readonly InlineEntry[]
): readonly LineSplice[] | InlineModuleRejection => {
  const splices: LineSplice[] = [];
  for (const entry of entries) {
    const replacement = replacementFor(source, starts, compiled, entry, entry.body);
    if ("status" in replacement) return replacement;
    splices.push(replacement);
  }
  splices.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  return splices;
};

/** Plan a safe, host-neutral Module inline mutation with scalar, singular geometry, and geometry-array parameter lowering. */
export const planInlineModule = (input: InlineModulePlanInput): InlineModulePlanResult => {
  const { source: snapshot, compiled, policy } = input;
  const source = snapshot.normalizedSource;
  const statementMap = compiled.statementMap;
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = semanticAnalysisFor(compiled);
  if (
    !statementMap ||
    !namespace ||
    !analysis ||
    snapshot.sourceRevision !== statementMap.sourceRevision ||
    snapshot.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    source !== compiled.spans.sourceMap.source ||
    !cleanCompile(compiled) ||
    !cleanSemanticAnalysis(compiled)
  ) {
    return reject(
      "stale-semantic-snapshot",
      "Inline Module には error-free な exact-current source/semantic snapshot が必要です。"
    );
  }
  if (input.targets.length === 0) {
    return reject("invalid-target", "Inline Module には1件以上の document-qualified target が必要です。");
  }

  const deduplicated = new Map<string, InlineModuleTargetIdentity>();
  for (const target of input.targets) {
    if (
      typeof target.statementId !== "string" ||
      (target.documentKey !== null && typeof target.documentKey !== "string")
    ) {
      return reject("invalid-target", "Inline target identity の document/statement owner が不正です。");
    }
    const key = targetKey(target);
    if (!deduplicated.has(key)) deduplicated.set(key, target);
  }

  const resolved = [...deduplicated.values()].map((target) => {
    if (target.documentKey !== null) return { target, statementIndex: null as number | null };
    return {
      target,
      statementIndex: statementIndexForId(compiled, target.statementId)
    };
  });
  const invalidLocal = resolved.find((entry) =>
    entry.target.documentKey === null && entry.statementIndex === null
  );
  if (invalidLocal) {
    return reject(
      "invalid-target",
      "Inline target が current authored source statement として解決できません。",
      invalidLocal.target
    );
  }
  resolved.sort((left, right) => {
    if (left.statementIndex === null && right.statementIndex === null) {
      return targetKey(left.target).localeCompare(targetKey(right.target));
    }
    if (left.statementIndex === null) return 1;
    if (right.statementIndex === null) return -1;
    return left.statementIndex - right.statementIndex;
  });

  const starts = lineStarts(source);
  const results: InlineModuleTargetResult[] = [];
  let splices: LineSplice[] = [];
  const inlined: InlineEntry[] = [];

  for (const entry of resolved) {
    const { target, statementIndex } = entry;
    if (target.documentKey !== null) {
      results.push(skip(target, null, null, "non-local-target", "Imported / multi-document Inline はこの local planner slice の対象外です。"));
      continue;
    }
    if (statementIndex === null) {
      return reject("invalid-target", "Inline target が current authored source statement として解決できません。", target);
    }
    const statement = compiled.statements[statementIndex];
    const instance = analysis.instancesByStatementId.get(target.statementId);
    const mappedTargetInfo = statementMap.statementRangeById.get(target.statementId);
    if (!statement || statement.kind !== "moduleInstance") {
      results.push(skip(target, statementIndex, statement?.name ?? null, "not-module-instance", "対象 statement は Module instance ではありません。"));
      continue;
    }
    if (
      !mappedTargetInfo ||
      mappedTargetInfo.statementIndex !== statementIndex ||
      mappedTargetInfo.sourceRevision !== snapshot.sourceRevision
    ) {
      return reject("stale-semantic-snapshot", "Inline target の authored statement map が exact-current ではありません。", target);
    }
    if (
      !instance ||
      instance.statementIndex !== statementIndex ||
      instance.name !== statement.name ||
      instance.calleeResolution !== "resolved" ||
      !instance.callee ||
      instance.callee.name !== statement.moduleName
    ) {
      results.push(skip(target, statementIndex, statement.name, "unresolved-callee", "local Module definition を一意に解決できません。"));
      continue;
    }
    const definition = analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    const definitionStatement = definition ? compiled.statements[definition.statementIndex] : undefined;
    if (
      !definition ||
      definition.statementId !== instance.callee.definitionStatementId ||
      definition.statementIndex !== instance.callee.definitionStatementIndex ||
      definitionStatement?.kind !== "moduleDefinition"
    ) {
      return reject("unsafe-rewrite", "Resolved Module definition の semantic owner が見つかりません。", target);
    }

    const activity = instanceActivity(statement);
    if (!activity) {
      return reject("unsafe-source-span", "Module instance の activity を exact-current semantic value として解決できません。", target);
    }
    if (activity === "hidden" && !policy.includeHiddenInstances) {
      results.push(skip(target, statementIndex, statement.name, "hidden-excluded", "hidden instance は現在の policy で除外されています。"));
      continue;
    }
    if (activity === "disabled" && !policy.includeDisabledInstances) {
      results.push(skip(target, statementIndex, statement.name, "disabled-excluded", "disabled instance は現在の policy で除外されています。"));
      continue;
    }
    const scalarParameterPreparation = prepareScalarParameterLowering(
      source,
      snapshot.sourceRevision,
      compiled,
      { statement, instance, definition }
    );
    if (scalarParameterPreparation.kind === "unsupported") {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "parameter-lowering-required",
        scalarParameterPreparation.reason
      ));
      continue;
    }
    if (scalarParameterPreparation.kind === "unsafe") {
      return reject(scalarParameterPreparation.code, scalarParameterPreparation.message, target);
    }
    const body = bodyRangeForDefinition(source, starts, compiled, definition);
    if (!body) {
      return reject("unsafe-source-span", "Module body の exact-current source range を解決できません。", target);
    }
    if (bodyRequiresUnsupportedTypedLowering(body.entries)) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "parameter-lowering-required",
        "Module body の record / geometry-array local はこの Inline slice では lowering しません。"
      ));
      continue;
    }

    const info = statementMap.statements[statementIndex];
    const targetPhysical = singlePhysicalRange(statement.physicalSpan, snapshot.sourceRevision);
    if (
      !info ||
      info.sourceRevision !== snapshot.sourceRevision ||
      statement.documentRange.sourceRevision !== snapshot.sourceRevision ||
      info.range.startLine !== info.range.endLine ||
      !targetPhysical
    ) {
      return reject("unsafe-source-span", "Inline target の exact-current authored statement span を解決できません。", target);
    }
    const inlineEntryBase: Omit<InlineEntry, "scalarParameters" | "geometryArrayParameters" | "recordParameters" | "geometryParameters" | "bodyTransformation"> = {
      target,
      statementIndex,
      statement,
      instance,
      definition,
      activity,
      statementInfo: info,
      body,
    };
    const presenceByParameter = new Map<string, boolean>();
    for (const parameter of scalarParameterPreparation.scalarParameters) {
      if (parameter.state === "optionalSupplied" || parameter.state === "optionalOmitted") {
        presenceByParameter.set(
          parameterSlotKey(definition.statementId, parameter.parameterIndex),
          parameter.state === "optionalSupplied"
        );
      }
    }
    for (const parameter of scalarParameterPreparation.geometryArrayParameters) {
      if (parameter.state === "optionalSupplied" || parameter.state === "optionalOmitted") {
        presenceByParameter.set(
          parameterSlotKey(definition.statementId, parameter.parameterIndex),
          parameter.state === "optionalSupplied"
        );
      }
    }
    for (const parameter of scalarParameterPreparation.recordParameters) {
      if (parameter.state === "optionalSupplied" || parameter.state === "optionalOmitted") {
        presenceByParameter.set(
          parameterSlotKey(definition.statementId, parameter.parameterIndex),
          parameter.state === "optionalSupplied"
        );
      }
    }
    for (const parameter of scalarParameterPreparation.geometryParameters) {
      if (parameter.state === "optionalSupplied" || parameter.state === "optionalOmitted") {
        presenceByParameter.set(
          parameterSlotKey(definition.statementId, parameter.parameterIndex),
          parameter.state === "optionalSupplied"
        );
      }
    }
    const defaultParameters = specializeDefaultInitializersFor(
      source,
      compiled,
      {
        ...inlineEntryBase,
        scalarParameters: scalarParameterPreparation.scalarParameters,
        geometryParameters: scalarParameterPreparation.geometryParameters,
        geometryArrayParameters: scalarParameterPreparation.geometryArrayParameters,
        recordParameters: scalarParameterPreparation.recordParameters,
        bodyTransformation: { bodyLines: [], provenance: [], geometrySubstitutions: [], geometryArrayReferences: [], recordReferences: [] }
      },
      presenceByParameter
    );
    if (defaultParameters.kind === "unsafe") return reject("unsafe-rewrite", defaultParameters.message, target);
    const bodyTransformation = buildBodyTransformation(
      source,
      starts,
      compiled,
      {
        ...inlineEntryBase,
        scalarParameters: defaultParameters.parameters,
        geometryParameters: scalarParameterPreparation.geometryParameters,
        geometryArrayParameters: scalarParameterPreparation.geometryArrayParameters,
        recordParameters: scalarParameterPreparation.recordParameters,
        bodyTransformation: { bodyLines: [], provenance: [], geometrySubstitutions: [], geometryArrayReferences: [], recordReferences: [] }
      },
      presenceByParameter,
      policy.emitOmittedBranchComments
    );
    if (bodyTransformation.kind === "unsafe") return reject("unsafe-rewrite", bodyTransformation.message, target);
    const inlineEntry: InlineEntry = {
      ...inlineEntryBase,
      scalarParameters: defaultParameters.parameters,
      geometryArrayParameters: scalarParameterPreparation.geometryArrayParameters,
      recordParameters: scalarParameterPreparation.recordParameters,
      geometryParameters: scalarParameterPreparation.geometryParameters,
      bodyTransformation: bodyTransformation.transformation
    };
    const replacement = replacementFor(source, starts, compiled, inlineEntry, body);
    if ("status" in replacement) return replacement;
    splices.push(replacement);
    inlined.push(inlineEntry);
    results.push({
      status: "inlined",
      target,
      statementIndex,
      instanceName: statement.name,
      moduleDefinitionStatementId: definition.statementId,
      activity,
      generatedGroupName: statement.name,
      sourceRange: { startLine: info.range.startLine, endLine: info.range.endLine }
    });
  }

  const geometryArrayCaptureRewriteResult = geometryArrayCaptureRewritesFor(source, compiled, inlined);
  if (geometryArrayCaptureRewriteResult.kind === "invalid") {
    return reject("unsafe-rewrite", geometryArrayCaptureRewriteResult.message, geometryArrayCaptureRewriteResult.target);
  }
  if (geometryArrayCaptureRewriteResult.rewrites.length > 0) {
    const rewrittenEntries = entriesWithInitializerRewrites(
      source,
      inlined,
      geometryArrayCaptureRewriteResult.rewrites
    );
    if (!rewrittenEntries) return reject("unsafe-rewrite", "array initializer の atomic source rewrite を構成できません。");
    inlined.splice(0, inlined.length, ...rewrittenEntries);
    const rebuiltSplices = buildInlineSplices(source, starts, compiled, inlined);
    if ("status" in rebuiltSplices) return rebuiltSplices;
    splices = [...rebuiltSplices];
  }

  try {
    applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }
  if (splices.length === 0) {
    return { status: "planned", sourceRevision: snapshot.sourceRevision, targets: results, splices };
  }

  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }

  const nextRevision = snapshot.sourceRevision + 1;
  const compileCandidate = (sourceText: string): CompiledDslDocument | null => {
    try {
    const parsed = parseDslSnapshot({ normalizedSource: sourceText, sourceRevision: nextRevision });
    const reconciled = reconcileStatements({
      oldStatements: compiled.statements,
      oldLines: compiled.sourceLines,
      oldElementIds: statementMap.elementIdByStatementIndex,
      oldStatementIds: statementMap.statementIdByStatementIndex,
      newStatements: parsed.statements,
      newLines: sourceText.split("\n")
    });
    return compileDslDocument(sourceText, {
      preparsed: parsed,
      sourceRevision: nextRevision,
      assignedElementIds: reconciled.assignedIds,
      assignedStatementIds: reconciled.assignedIds
    });
    } catch {
      return null;
    }
  };

  let nextCompiled = compileCandidate(candidateSource);
  if (!nextCompiled) return reject("unsafe-rewrite", "Inline 後の source semantics を再コンパイルできません。");

  let activeEntries: readonly InlineEntry[] = inlined;
  let mappings = ownerMappingsFor(compiled, nextCompiled, activeEntries);
  if (!mappings) return reject("unsafe-rewrite", "生成した group / scalar parameter const の semantic owner を解決できません。");
  let initializerRewriteResult = initializerRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
  if (initializerRewriteResult.kind === "invalid") return reject("unsafe-rewrite", initializerRewriteResult.message, initializerRewriteResult.target);
  let geometryRewriteResult = geometryRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
  if (geometryRewriteResult.kind === "invalid") return reject("unsafe-rewrite", geometryRewriteResult.message, geometryRewriteResult.target);
  if (initializerRewriteResult.rewrites.length > 0 || geometryRewriteResult.rewrites.length > 0) {
    let rewrittenEntries = activeEntries;
    if (initializerRewriteResult.rewrites.length > 0) {
      const entries = entriesWithInitializerRewrites(source, rewrittenEntries, initializerRewriteResult.rewrites);
      if (!entries) return reject("unsafe-rewrite", "moved initializer の atomic source rewrite を構成できません。");
      rewrittenEntries = entries;
    }
    if (geometryRewriteResult.rewrites.length > 0) {
      const entries = entriesWithGeometryRewrites(
        source,
        starts,
        compiled,
        rewrittenEntries,
        geometryRewriteResult.rewrites,
        policy.emitOmittedBranchComments
      );
      if (!entries) return reject("unsafe-rewrite", "caller geometry の atomic source rewrite を構成できません。");
      rewrittenEntries = entries;
    }
    activeEntries = rewrittenEntries;
    const rebuiltSplices = buildInlineSplices(source, starts, compiled, activeEntries);
    if ("status" in rebuiltSplices) return rebuiltSplices;
    splices = [...rebuiltSplices];
    try {
      candidateSource = applyLineSplices(source, splices);
    } catch (error) {
      return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
    }
    nextCompiled = compileCandidate(candidateSource);
    if (!nextCompiled) return reject("unsafe-rewrite", "canonicalized Inline source を再コンパイルできません。");
    mappings = ownerMappingsFor(compiled, nextCompiled, activeEntries);
    if (!mappings) return reject("unsafe-rewrite", "canonicalized group / scalar parameter const の semantic owner を解決できません。");
    initializerRewriteResult = initializerRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
    if (initializerRewriteResult.kind === "invalid") return reject("unsafe-rewrite", initializerRewriteResult.message, initializerRewriteResult.target);
    geometryRewriteResult = geometryRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
    if (geometryRewriteResult.kind === "invalid") return reject("unsafe-rewrite", geometryRewriteResult.message, geometryRewriteResult.target);
    if (initializerRewriteResult.rewrites.length > 0) {
      return reject("unsafe-rewrite", "moved initializer の semantic owner を一度の canonical rewrite で証明できません。");
    }
    if (geometryRewriteResult.rewrites.length > 0) {
      return reject("unsafe-rewrite", "caller geometry の semantic owner を一度の canonical rewrite で証明できません。");
    }
  }

  if (
    !nextCompiled.statementMap ||
    !nextCompiled.sourceLexicalNamespace ||
    !semanticAnalysisFor(nextCompiled) ||
    !cleanCompile(nextCompiled) ||
    !cleanSemanticAnalysis(nextCompiled)
  ) {
    const diagnostic = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
      .find((candidate) => candidate.severity === "error");
    return reject("unsafe-rewrite", diagnostic?.message ?? "Inline 後の source semantics を安全に再コンパイルできません。");
  }

  for (const entry of activeEntries) {
    const mapping = mappings.get(entry.target.statementId);
    if (!mapping || !verifyCopiedBodyOwners(source, compiled, nextCompiled, entry, mapping, mappings)) {
      return reject("unsafe-rewrite", "コピーした Module body の semantic ownership を証明できません。", entry.target);
    }
  }

  const replacedIds = new Set(activeEntries.map((entry) => entry.target.statementId));
  if (!verifyPreservedSemanticOwners(source, compiled, nextCompiled, replacedIds, mappings)) {
    return reject("unsafe-rewrite", "Inline 後に preserved statement の semantic resolution が変化するため適用できません。");
  }

  return {
    status: "planned",
    sourceRevision: snapshot.sourceRevision,
    targets: results,
    splices
  };
};
