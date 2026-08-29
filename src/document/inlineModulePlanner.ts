import { encodeIdentityTuple } from "./identityTuple";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { parseElementActivityLiteral } from "../dsl/dslActivity";
import { exactPhysicalSpan } from "../dsl/dslDiagnosticSpan";
import { geometryArrayTypeOfTypedDeclaration } from "../dsl/geometryArraySourceAnnotations";
import { parseDslSnapshot } from "../dsl/dslParser";
import {
  formatDslReferencePath,
  parseDslSourceReference,
  parseDslSourceReferenceAt
} from "../dsl/dslReferenceTokens";
import type { DslModuleParameter, DslStatement } from "../dsl/dslTypes";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type {
  ModuleDefinitionSemantic,
  ModuleInstanceSemantic,
  ModuleScalarExpressionSemantic,
  ResolvedModuleParameterBinding
} from "../dsl/moduleSemanticTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
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

type ScalarParameterPreparation =
  | { kind: "supported"; parameters: readonly ScalarParameterLowering[] }
  | { kind: "unsupported"; reason: string }
  | { kind: "unsafe"; code: "unsafe-source-span" | "unsafe-rewrite"; message: string };

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
  bodyTransformation: BodyTransformation;
};

type GeneratedScalarParameterMapping = {
  parameterIndex: number;
  statementIndex: number;
  statementId: StatementIdentity;
  bindingId: string;
  initializerRange: { from: number; to: number };
};

type OwnerMapping = {
  targetStatementId: StatementIdentity;
  generatedGroupStatementId: StatementIdentity;
  bodyStatementIds: ReadonlyMap<StatementIdentity, StatementIdentity>;
  parameterBindings: ReadonlyMap<string, GeneratedScalarParameterMapping>;
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
  presenceByParameter: ReadonlyMap<string, boolean>
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
    return { text: original, range, changed: false, known: null, eliminatedSourceRanges: [] };
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
    return { kind: "supported", parameters: [] };
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

  const parameters: ScalarParameterLowering[] = [];
  for (const resolvedParameter of entry.definition.parameters) {
    const parameterIndex = resolvedParameter.parameterIndex;
    const parameter = definitionStatement.parameters[parameterIndex];
    const binding = bindingsByParameterIndex.get(parameterIndex);
    if (!parameter || !binding || parameterIndex !== parameters.length) {
      return {
        kind: "unsafe",
        code: "unsafe-rewrite",
        message: "Module parameter の authored source order と compiler binding mapping が一致しません。"
      };
    }
    const parameterType = parameter.type;
    const optional = parameter.optional || resolvedParameter.optional;
    if (
      parameter.recordTypeReference ||
      !isSupportedScalarParameterType(parameterType) ||
      binding.parameterType?.kind !== parameterType?.kind
    ) {
      return {
        kind: "unsupported",
        reason: "optional scalar 以外の Module parameter はこの Checkpoint では lowering しません。"
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
    parameters.push({
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
  return { kind: "supported", parameters };
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
  statement: Extract<DslStatement, { kind: "moduleDefinition" }>
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
  for (const statementId of definition.bodyStatementIds) {
    const entry = statementEntryForId(compiled, statementId);
    if (!entry) return null;
    let current = entry.statement.enclosing?.statementIndex ?? null;
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
    if (!ownedByDefinition) return null;
    entries.push(entry);
  }
  return entries.sort((left, right) => left.statementIndex - right.statementIndex);
};

const bodyRequiresDeferredValidation = (
  entries: readonly StatementEntry[],
  definitionStatementIndex: number
): boolean => {
  const directConditionals = new Set(
    entries
      .filter(({ statement }) =>
        statement.enclosing?.statementIndex === definitionStatementIndex &&
        statement.kind === "element" &&
        statement.type === "conditionalGroup"
      )
      .map((entry) => entry.statementIndex)
  );
  const isOrdinary = (statement: DslStatement): boolean =>
    (statement.kind === "typedDeclaration" &&
      !statement.recordTypeReference &&
      !geometryArrayTypeOfTypedDeclaration(statement)) ||
    statement.kind === "set" ||
    (statement.kind === "element" && statement.type !== "conditionalGroup" && statement.type !== "forGroup");

  return entries.some(({ statement }) => {
    const enclosing = statement.enclosing;
    if (enclosing?.statementIndex === definitionStatementIndex) {
      return !isOrdinary(statement) && !(statement.kind === "element" && statement.type === "conditionalGroup");
    }
    if (enclosing && directConditionals.has(enclosing.statementIndex)) return !isOrdinary(statement);
    return true;
  });
};

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

const linesForRange = (
  source: string,
  starts: readonly number[],
  startLine: number,
  endLine: number
): string[] => {
  if (startLine > endLine) return [];
  const result: string[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    const start = lineStartFor(starts, line);
    if (start === null) return [];
    result.push(source.slice(start, lineEndOffset(source, starts, line)));
  }
  return result;
};

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
  definition: ModuleDefinitionSemantic,
  statementId: StatementIdentity
) => definition.bodyStatements.find((body) => body.statementId === statementId) ?? null;

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
  const directConditionals = entry.body.entries
    .filter(({ statement }) =>
      statement.enclosing?.statementIndex === entry.definition.statementIndex &&
      statement.kind === "element" &&
      statement.type === "conditionalGroup"
    )
    .sort((left, right) => left.statementIndex - right.statementIndex);
  const conditionalIndexes = new Set(directConditionals.map((candidate) => candidate.statementIndex));
  const conditionalChildren = new Set(
    entry.body.entries
      .filter(({ statement }) => statement.enclosing && conditionalIndexes.has(statement.enclosing.statementIndex))
      .map((candidate) => candidate.statementId)
  );
  const eliminatedSourceRangesByStatement = new Map<StatementIdentity, ExactSourceRange[]>();
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
  const replacementsForEntry = (
    bodyEntry: StatementEntry,
    includeCondition: boolean
  ): {
    kind: "ok";
    replacements: readonly AbsoluteReplacement[];
  } | { kind: "unsafe"; message: string } => {
    const semantic = bodyStatementSemanticFor(entry.definition, bodyEntry.statementId);
    if (!semantic) return { kind: "unsafe", message: "Module body statement の semantic owner がありません。" };
    const replacements: AbsoluteReplacement[] = [];
    const eliminatedSourceRanges: ExactSourceRange[] = [];
    for (const site of semantic.scalarExpressions) {
      if (!includeCondition && site.parameterKey === "condition") continue;
      if (site.expression.hasValueParameters.length === 0) continue;
      const range = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, site.span);
      if (!range) return { kind: "unsafe", message: "Module body scalar expression の exact physical source span を解決できません。" };
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        bodyEntry.statement,
        site.expression,
        presenceByParameter
      );
      if (specialized.kind === "unsafe") return specialized;
      eliminatedSourceRanges.push(...specialized.eliminatedSourceRanges);
      if (specialized.changed) replacements.push({ from: range.from, to: range.to, text: specialized.text });
    }
    for (const site of semantic.textTemplateHoles) {
      if (site.expression.hasValueParameters.length === 0) continue;
      const range = physicalRangeForLogicalSpan(compiled, bodyEntry.statement, site.contentSpan);
      if (!range) return { kind: "unsafe", message: "Module text-template hole の exact physical source span を解決できません。" };
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        bodyEntry.statement,
        site.expression,
        presenceByParameter
      );
      if (specialized.kind === "unsafe") return specialized;
      eliminatedSourceRanges.push(...specialized.eliminatedSourceRanges);
      if (specialized.changed) replacements.push({ from: range.from, to: range.to, text: specialized.text });
    }
    rememberEliminatedSourceRanges(bodyEntry.statementId, eliminatedSourceRanges);
    return { kind: "ok", replacements };
  };

  type ConditionalOutput = {
    startLine: number;
    endLine: number;
    lines: string[];
    provenance: BodyStatementProvenance[];
  };
  const conditionalOutputs: ConditionalOutput[] = [];
  for (const conditional of directConditionals) {
    const info = compiled.statementMap?.statements[conditional.statementIndex];
    const conditionalSemantic = bodyStatementSemanticFor(entry.definition, conditional.statementId);
    const conditionSite = conditionalSemantic?.scalarExpressions.find((site) => site.parameterKey === "condition");
    if (
      !info ||
      info.closeBraceLine === undefined ||
      !conditionSite
    ) return { kind: "unsafe", message: "conditional condition の compiler semantic owner を解決できません。" };
    const conditionRange = physicalRangeForLogicalSpan(compiled, conditional.statement, conditionSite.span);
    if (!conditionRange) return { kind: "unsafe", message: "conditional condition の exact physical source span を解決できません。" };
    let conditionText = source.slice(conditionRange.from, conditionRange.to);
    let conditionKnown: InlinePresenceValue | null = null;
    if (conditionSite.expression.hasValueParameters.length > 0) {
      const specialized = specializeInlineScalarExpression(
        source,
        compiled,
        conditional.statement,
        conditionSite.expression,
        presenceByParameter
      );
      if (specialized.kind === "unsafe") return specialized;
      conditionText = specialized.text;
      conditionKnown = specialized.known?.presenceDerived ? specialized.known : null;
      rememberEliminatedSourceRanges(conditional.statementId, specialized.eliminatedSourceRanges);
    }
    const conditionReplacement = conditionText === source.slice(conditionRange.from, conditionRange.to)
      ? []
      : [{ from: conditionRange.from, to: conditionRange.to, text: conditionText }];
    const branchEntries = entry.body.entries.filter((candidate) =>
      candidate.statement.enclosing?.statementIndex === conditional.statementIndex
    );
    const thenEntries = branchEntries.filter((candidate) => candidate.statement.enclosing?.branch === "then");
    const elseEntries = branchEntries.filter((candidate) => candidate.statement.enclosing?.branch === "else");
    const thenStartLine = info.endLine + 1;
    const thenEndLine = (info.elseLine ?? info.closeBraceLine) - 1;
    const elseStartLine = info.elseLine === undefined ? info.closeBraceLine : info.elseLine + 1;
    const elseEndLine = info.closeBraceLine - 1;
    const thenRange = sourceRangeForLines(source, starts, thenStartLine, thenEndLine);
    const elseRange = info.elseLine === undefined ? null : sourceRangeForLines(source, starts, elseStartLine, elseEndLine);
    const regionRange = sourceRangeForLines(source, starts, info.range.startLine, info.range.endLine);
    if (!regionRange || (thenStartLine <= thenEndLine && !thenRange)) {
      return { kind: "unsafe", message: "conditional branch の exact physical source range を解決できません。" };
    }

    const replacementsForEntries = (candidates: readonly StatementEntry[]): { kind: "ok"; replacements: AbsoluteReplacement[] } | { kind: "unsafe"; message: string } => {
      const replacements: AbsoluteReplacement[] = [];
      for (const candidate of candidates) {
        const result = replacementsForEntry(candidate, false);
        if (result.kind === "unsafe") return result;
        replacements.push(...result.replacements);
      }
      return { kind: "ok", replacements };
    };
    const thenReplacements = replacementsForEntries(thenEntries);
    if (thenReplacements.kind === "unsafe") return thenReplacements;
    const elseReplacements = replacementsForEntries(elseEntries);
    if (elseReplacements.kind === "unsafe") return elseReplacements;

    const renderedBranch = (range: { from: number; to: number } | null, replacements: readonly AbsoluteReplacement[]): string[] => {
      if (!range) return [];
      const rendered = applyAbsoluteReplacements(source, range.from, range.to, replacements);
      return rendered === null || rendered.length === 0 ? [] : rendered.split("\n");
    };
    const headerLines = linesForRange(source, starts, info.range.startLine, info.endLine);
    const conditionalIndent = leadingWhitespace(headerLines[0] ?? "");
    const thenAuthoredLines = renderedBranch(thenRange, [
      ...thenReplacements.replacements,
      ...exportReplacements.filter((replacement) => thenRange !== null && replacement.from >= thenRange.from && replacement.to <= thenRange.to)
    ]);
    const elseAuthoredLines = renderedBranch(elseRange, [
      ...elseReplacements.replacements,
      ...exportReplacements.filter((replacement) => elseRange !== null && replacement.from >= elseRange.from && replacement.to <= elseRange.to)
    ]);
    const thenLines = liftConditionalBranchLines(thenAuthoredLines, conditionalIndent);
    const elseLines = liftConditionalBranchLines(elseAuthoredLines, conditionalIndent);
    const elseMarkerLines = info.elseLine === undefined ? [] : linesForRange(source, starts, info.elseLine, info.elseLine);
    const closeLines = linesForRange(source, starts, info.closeBraceLine, info.closeBraceLine);
    const allLines = (
      conditionKnown === null
        ? (() => {
            const replacements = [
              ...conditionReplacement,
              ...thenReplacements.replacements,
              ...elseReplacements.replacements,
              ...exportReplacements.filter((replacement) => replacement.from >= regionRange.from && replacement.to <= regionRange.to)
            ];
            const rendered = applyAbsoluteReplacements(source, regionRange.from, regionRange.to, replacements);
            return rendered === null ? null : rendered.split("\n");
          })()
        : null
    );
    if (allLines === null && conditionKnown === null) return { kind: "unsafe", message: "conditional source specialization の重複 rewrite を構成できません。" };

    const originalParentStatementId = conditional.statement.enclosing?.statementIndex === entry.definition.statementIndex
      ? null
      : statementIdAt(compiled, conditional.statement.enclosing?.statementIndex ?? -1);
    const provenanceFor = (candidates: readonly StatementEntry[], outputStart: number, branch: "then" | "else" | null) => candidates.map((candidate) => ({
      originalStatementId: candidate.statementId,
      outputLineIndex: outputStart + candidate.statement.line - (branch === "then" ? thenStartLine : elseStartLine),
      originalParentStatementId: candidate.statement.enclosing?.statementIndex === conditional.statementIndex ? conditional.statementId : originalParentStatementId,
      originalBranch: branch,
      eliminatedSourceRanges: eliminatedSourceRangesFor(candidate.statementId)
    }));
    let lines: string[];
    let provenance: BodyStatementProvenance[];
    if (conditionKnown === null) {
      lines = allLines!;
      provenance = [
        {
          originalStatementId: conditional.statementId,
          outputLineIndex: 0,
          originalParentStatementId,
          originalBranch: null,
          eliminatedSourceRanges: eliminatedSourceRangesFor(conditional.statementId)
        },
        ...provenanceFor(thenEntries, headerLines.length, "then"),
        ...provenanceFor(elseEntries, info.elseLine === undefined ? 0 : info.elseLine - info.range.startLine + 1, "else")
      ];
    } else if (conditionKnown.value) {
      lines = [...thenLines];
      provenance = provenanceFor(thenEntries, 0, "then");
      if (info.elseLine !== undefined && emitOmittedBranchComments) {
        lines.push(`${entry.body.definitionIndent}${DSL_INDENT}// Inline omitted: condition resolved to true`);
        lines.push(...[...elseMarkerLines, ...elseAuthoredLines, ...closeLines].map((line) => commentSourceLine(line, conditionalIndent)));
      }
    } else {
      provenance = info.elseLine === undefined ? [] : provenanceFor(elseEntries, emitOmittedBranchComments ? 0 : 0, "else");
      if (info.elseLine === undefined) {
        lines = emitOmittedBranchComments
          ? [
              `${entry.body.definitionIndent}${DSL_INDENT}// Inline omitted: condition resolved to false`,
              ...[...headerLines, ...thenAuthoredLines, ...closeLines].map((line) => commentSourceLine(line, conditionalIndent))
            ]
          : [];
      } else if (emitOmittedBranchComments) {
        lines = [
          `${entry.body.definitionIndent}${DSL_INDENT}// Inline omitted: condition resolved to false`,
          ...[...headerLines, ...thenAuthoredLines, ...elseMarkerLines].map((line) => commentSourceLine(line, conditionalIndent)),
          ...elseLines
        ];
        provenance = provenanceFor(elseEntries, lines.length - elseLines.length, "else");
      } else {
        lines = [...elseLines];
        provenance = provenanceFor(elseEntries, 0, "else");
      }
    }
    conditionalOutputs.push({ startLine: info.range.startLine, endLine: info.range.endLine, lines, provenance });
  }

  const ordinaryReplacements: AbsoluteReplacement[] = [];
  const ordinaryEntries = entry.body.entries.filter((candidate) =>
    !conditionalIndexes.has(candidate.statementIndex) && !conditionalChildren.has(candidate.statementId)
  );
  for (const candidate of ordinaryEntries) {
    const result = replacementsForEntry(candidate, false);
    if (result.kind === "unsafe") return result;
    ordinaryReplacements.push(...result.replacements);
  }
  ordinaryReplacements.push(
    ...exportReplacements.filter((replacement) => !conditionalOutputs.some((output) => {
      const start = lineStartFor(starts, output.startLine);
      const end = lineEndOffset(source, starts, output.endLine);
      return start !== null && replacement.from >= start && replacement.to <= end;
    }))
  );

  const outputLines: string[] = [];
  const provenance: BodyStatementProvenance[] = [];
  const bodyStartLine = openBraceLine + 1;
  const bodyEndLine = bodyInfo.closeBraceLine - 1;
  const appendOrdinaryRange = (startLine: number, endLine: number): boolean => {
    if (startLine > endLine) return true;
    const range = sourceRangeForLines(source, starts, startLine, endLine);
    if (!range) return false;
    const rendered = applyAbsoluteReplacements(
      source,
      range.from,
      range.to,
      ordinaryReplacements.filter((replacement) => replacement.from >= range.from && replacement.to <= range.to)
    );
    if (rendered === null) return false;
    const startOutput = outputLines.length;
    outputLines.push(...rendered.split("\n"));
    for (const candidate of ordinaryEntries) {
      if (candidate.statement.line < startLine || candidate.statement.line > endLine) continue;
      provenance.push({
        originalStatementId: candidate.statementId,
        outputLineIndex: startOutput + candidate.statement.line - startLine,
        originalParentStatementId: null,
        originalBranch: null,
        eliminatedSourceRanges: eliminatedSourceRangesFor(candidate.statementId)
      });
    }
    return true;
  };
  let cursorLine = bodyStartLine;
  for (const output of conditionalOutputs) {
    if (!appendOrdinaryRange(cursorLine, output.startLine - 1)) {
      return { kind: "unsafe", message: "body ordinary source rewrite の exact range を構成できません。" };
    }
    const outputStart = outputLines.length;
    outputLines.push(...output.lines);
    provenance.push(...output.provenance.map((item) => ({ ...item, outputLineIndex: item.outputLineIndex + outputStart })));
    cursorLine = output.endLine + 1;
  }
  if (!appendOrdinaryRange(cursorLine, bodyEndLine)) {
    return { kind: "unsafe", message: "body ordinary source rewrite の exact range を構成できません。" };
  }
  return { kind: "ok", transformation: { bodyLines: outputLines, provenance } };
};

const exportedTokenReplacements = (
  source: string,
  compiled: CompiledDslDocument,
  body: BodyRange
): AbsoluteReplacement[] | null => {
  const replacements: AbsoluteReplacement[] = [];
  const sourceRevision = compiled.spans.sourceMap.sourceRevision;
  for (const entry of body.entries) {
    if (entry.statement.kind !== "typedDeclaration" && entry.statement.kind !== "element") continue;
    if (!entry.statement.exported) continue;
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
  if (identity.kind === "module") {
    if (identity.target.kind === "moduleParameter") {
      const generated = currentMapping.parameterBindings.get(
        parameterSlotKey(
          identity.target.slot.definitionStatementId,
          identity.target.slot.parameterIndex
        )
      );
      if (generated) return `statement:${generated.statementId}`;
    } else if (identity.target.kind === "moduleInstance") {
      const mapping = mappingsByTarget.get(identity.target.statementId);
      if (mapping) return `statement:${mapping.generatedGroupStatementId}`;
    } else if (identity.target.kind === "moduleSource") {
      for (const mapping of mappingsByTarget.values()) {
        const copiedStatementId = mapping.bodyStatementIds.get(identity.target.statementId);
        if (copiedStatementId) return `statement:${copiedStatementId}`;
      }
    }
  }
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
  includeOccurrence: (occurrence: DslSemanticOccurrence) => boolean = () => true
): OccurrenceSlot[] => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return [];
  const slots = new Map<string, { kind: DslSemanticOccurrence["kind"]; token: string; ordinal: number; owners: Set<string> }>();
  const ordinalByToken = new Map<string, number>();
  for (const occurrence of index.occurrences) {
    if (!includeOccurrence(occurrence)) continue;
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
  parameterBindings: ReadonlyMap<string, GeneratedScalarParameterMapping>
): OwnerMapping | null => {
  const groupInfo = nextCompiled.statementMap?.statements[groupIndex];
  const generatedBodyLine = groupInfo?.openBraceLine ?? groupInfo?.line;
  if (!groupInfo || generatedBodyLine === undefined) return null;
  const emittedParameterCount = entry.scalarParameters.filter((parameter) => parameter.initializerSource !== null).length;
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
      const parentMapping = [...bodyStatementIds.entries()].find(([oldId]) => oldId === provenance.originalParentStatementId);
      if (provenance.originalBranch !== null) {
        if (!parentMapping) {
          if (nextInfo?.enclosing?.statementIndex !== groupIndex) return null;
        } else if (
          nextInfo?.enclosing?.statementIndex !== statementIndexForId(nextCompiled, parentMapping[1]) ||
          nextInfo.enclosing.branch !== provenance.originalBranch
        ) return null;
      } else if (nextInfo?.enclosing?.statementIndex !== groupIndex) {
        return null;
      }
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

const verifyCopiedBodyOwners = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entry: InlineEntry,
  mapping: OwnerMapping
): boolean => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const nextGroupIndex = statementIndexForId(nextCompiled, mapping.generatedGroupStatementId);
  if (nextGroupIndex === null) return false;

  for (const [oldBodyId, nextBodyId] of mapping.bodyStatementIds) {
    const oldBodyIndex = statementIndexForId(compiled, oldBodyId);
    const nextBodyIndex = nextBodyId ? statementIndexForId(nextCompiled, nextBodyId) : null;
    if (oldBodyIndex === null || nextBodyIndex === null) return false;
    const oldBodySemantic = entry.definition.bodyStatements.find((body) => body.statementId === oldBodyId);
    const oldBodyStatement = compiled.statements[oldBodyIndex];
    if (!oldBodySemantic || !oldBodyStatement) return false;
    const eliminatedSourceRanges = entry.bodyTransformation.provenance.find((provenance) =>
      provenance.originalStatementId === oldBodyId
    )?.eliminatedSourceRanges ?? [];
    const oldStatementOccurrences = beforeIndex.occurrences.filter((occurrence) => {
      const statement = compiled.statements[oldBodyIndex];
      return Boolean(statement && occurrence.from >= statement.documentRange.from && occurrence.to <= statement.documentRange.to);
    });
    const expected = occurrenceSlotsForStatement(
      source,
      compiled,
      beforeIndex,
      oldBodyIndex,
      (occurrence) => {
        const occurrenceStatement = compiled.statements[oldBodyIndex];
        if (!occurrenceStatement || eliminatedSourceRanges.length === 0) return true;
        const occurrenceRange = occurrence.kind === "reference"
          ? sourceReferenceRangeForOccurrence(source, beforeIndex.occurrences, occurrence, occurrenceStatement.documentRange)
          : { from: occurrence.from, to: occurrence.to };
        return occurrenceRange === null || !eliminatedSourceRanges.some((range) =>
          occurrenceRange.from >= range.from && occurrenceRange.to <= range.to
        );
      }
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
        if (candidate.identity.kind === "module" && candidate.identity.target.kind === "moduleParameter") {
          const generated = mapping.parameterBindings.get(parameterSlotKey(
            candidate.identity.target.slot.definitionStatementId,
            candidate.identity.target.slot.parameterIndex
          ));
          return generated ? [`statement:${generated.statementId}`] : [];
        }
        const owner = ownerStatementIdForIdentity(compiled, candidate.identity);
        const copied = owner ? mapping.bodyStatementIds.get(owner) : undefined;
        return [copied ? `statement:${copied}` : ownerTokenForIdentity(compiled, candidate.identity)];
      })().sort()
    }));
    const actual = occurrenceSlotsForStatement(nextCompiled.spans.sourceMap.source, nextCompiled, afterIndex, nextBodyIndex);
    if (!compareSlots(expected, actual)) return false;
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

const generatedScalarParameterMappingsFor = (
  nextCompiled: CompiledDslDocument,
  groupIndex: number,
  entry: InlineEntry
): ReadonlyMap<string, GeneratedScalarParameterMapping> | null => {
  const children = directChildEntriesForGroup(nextCompiled, groupIndex);
  const emittedParameters = entry.scalarParameters.filter((parameter) => parameter.initializerSource !== null);
  const generated = children.slice(0, emittedParameters.length);
  if (generated.length !== emittedParameters.length) return null;
  const mappings = new Map<string, GeneratedScalarParameterMapping>();
  for (const [index, parameter] of emittedParameters.entries()) {
    const child = generated[index];
    if (
      !child ||
      child.statement.kind !== "typedDeclaration" ||
      child.statement.bindingKind !== "const" ||
      child.statement.name !== parameter.parameterName ||
      child.statement.declaredType?.kind !== parameter.parameter.type?.kind
    ) return null;
    const bindingCandidates = [...(nextCompiled.bindingAnalysis?.catalog.bindings.values() ?? [])]
      .filter((binding) => binding.kind === "typed" && binding.statementIndex === child.statementIndex);
    if (bindingCandidates.length !== 1) return null;
    const binding = bindingCandidates[0]!;
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
      bindingId: binding.id,
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
  const parameterLines = entry.scalarParameters
    .filter((parameter) => parameter.initializerSource !== null)
    .map((parameter) =>
    `${instanceIndent}${DSL_INDENT}const ${parameter.nameSource}: ${parameter.typeSource} = ${parameter.initializerSource}`
    );
  return {
    startLine: entry.statementInfo.range.startLine,
    endLine: entry.statementInfo.range.endLine,
    replacementLines: [
      `${instanceIndent}group ${formatDslName(entry.statement.name)}${activityText} {${suffix}`,
      ...parameterLines,
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
    const parameterBindings = generatedScalarParameterMappingsFor(nextCompiled, groupIndex, entry);
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
    for (const parameter of entry.scalarParameters) {
      if (parameter.initializerSource === null || parameter.originalExpressionRange === null) {
        if (mapping.parameterBindings.has(parameterSlotKey(entry.definition.statementId, parameter.parameterIndex))) {
          return { kind: "invalid", message: "optional omitted parameter に生成 const mapping があります。", target: entry.target };
        }
        continue;
      }
      const generated = mapping.parameterBindings.get(
        parameterSlotKey(entry.definition.statementId, parameter.parameterIndex)
      );
      if (!generated) return { kind: "invalid", message: "生成した scalar parameter const の semantic mapping がありません。", target: entry.target };
      const before = finalReferenceOccurrencesForRange(
        source,
        beforeIndex,
        parameter.originalExpressionRange
      );
      const nextSource = nextCompiled.spans.sourceMap.source;
      const after = finalReferenceOccurrencesForRange(nextSource, afterIndex, generated.initializerRange);
      const retainedBefore = before.filter((original) => !parameter.eliminatedSourceRanges.some((range) =>
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
    return scalarParameters.some((parameter) => parameter === null)
      ? null
      : { ...entry, scalarParameters: scalarParameters as readonly ScalarParameterLowering[] };
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

/** Plan a safe, host-neutral Module inline mutation with scalar parameter lowering. */
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
    if (instance.callerModuleDefinitionStatementId !== null) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "nested-module-validation-required",
        "Module body 内の Module instance は broad capture-preservation 検証が必要なためこの slice の対象外です。"
      ));
      continue;
    }

    const body = bodyRangeForDefinition(source, starts, compiled, definition);
    if (!body) {
      return reject("unsafe-source-span", "Module body の exact-current source range を解決できません。", target);
    }
    if (bodyRequiresDeferredValidation(body.entries, body.definitionStatementIndex)) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "nested-module-validation-required",
        "Module body の nested structure は broad capture-preservation 検証が必要なためこの slice の対象外です."
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
    const inlineEntryBase: Omit<InlineEntry, "scalarParameters" | "bodyTransformation"> = {
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
    for (const parameter of scalarParameterPreparation.parameters) {
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
      { ...inlineEntryBase, scalarParameters: scalarParameterPreparation.parameters, bodyTransformation: { bodyLines: [], provenance: [] } },
      presenceByParameter
    );
    if (defaultParameters.kind === "unsafe") return reject("unsafe-rewrite", defaultParameters.message, target);
    const bodyTransformation = buildBodyTransformation(
      source,
      starts,
      compiled,
      { ...inlineEntryBase, scalarParameters: defaultParameters.parameters, bodyTransformation: { bodyLines: [], provenance: [] } },
      presenceByParameter,
      policy.emitOmittedBranchComments
    );
    if (bodyTransformation.kind === "unsafe") return reject("unsafe-rewrite", bodyTransformation.message, target);
    const inlineEntry: InlineEntry = {
      ...inlineEntryBase,
      scalarParameters: defaultParameters.parameters,
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
  let rewriteResult = initializerRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
  if (rewriteResult.kind === "invalid") return reject("unsafe-rewrite", rewriteResult.message, rewriteResult.target);
  if (rewriteResult.rewrites.length > 0) {
    const rewrittenEntries = entriesWithInitializerRewrites(source, activeEntries, rewriteResult.rewrites);
    if (!rewrittenEntries) return reject("unsafe-rewrite", "moved initializer の atomic source rewrite を構成できません。");
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
    rewriteResult = initializerRewritesFor(source, compiled, nextCompiled, activeEntries, mappings);
    if (rewriteResult.kind === "invalid") return reject("unsafe-rewrite", rewriteResult.message, rewriteResult.target);
    if (rewriteResult.rewrites.length > 0) {
      return reject("unsafe-rewrite", "moved initializer の semantic owner を一度の canonical rewrite で証明できません。");
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
    if (!mapping || !verifyCopiedBodyOwners(source, compiled, nextCompiled, entry, mapping)) {
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
