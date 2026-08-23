// Compiles/typechecks a CAD element's scalar property value through the
// shared scalar parser, resolver, && typechecker. Direct `@name` values keep
// the compact binding source; compound values retain the typed AST.
//
// Scope boundary: this module only classifies && typechecks. It never
// evaluates a binding's runtime value && never writes to a CadElement
// field - literal property compile output (src/dsl/dslApplyArgs.ts) is
// completely untouched. Number args keep their pre-existing numeric-reference
// compiler; all other scalar schema kinds use this common frontend.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "../dsl/dslCompilationGuard";
import { parameterKeyForArg } from "../dsl/dslConstructions";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import { describeScalarType, typecheckScalarExpression } from "./expressionTypecheck";
import { isScalarExpressionCandidateSource, parseScalarExpression } from "./expressionParser";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { isScalarTypeAssignable } from "./scalarAssignability";
import type { ScalarType } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";
import { resolveTypedGeometryProperties } from "./typedGeometryPropertyResolution";
import { createElementNameContext } from "../model/elementNames";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";

/**
 * The compiled source of a property's value. `binding` keeps the existing
 * direct-reference representation; `expression` carries the same typed AST
 * used by scalar initializers && conditions for compound scalar values.
 * The parameter schema supplies the expected type; there is no separate
 * property capability registry.
 */
export type ScalarValueSource =
  | { kind: "literal" }
  | {
      kind: "binding";
      bindingId: BindingId;
      type: ScalarType;
      /** Span of the whole `@name` token, including the `@`. */
      span: DslSpan;
      /** Span of just the identifier, excluding the `@`. */
      nameSpan: DslSpan;
      name: string;
    }
  | {
      kind: "expression";
      expression: TypedScalarExpression;
      type: ScalarType;
      span: DslSpan;
    };

export const PROPERTY_BINDING_NOT_SUPPORTED_CODE = "property-binding-not-supported";
export const PROPERTY_BINDING_UNRESOLVED_CODE = "property-binding-unresolved";
export const PROPERTY_BINDING_INVALID_CODE = "property-binding-invalid";
export const PROPERTY_BINDING_TYPE_MISMATCH_CODE = "property-binding-type-mismatch";

/** Shared key format between this module's output map && any later reader
 * (Tasks 23-26), so the format is never re-derived at a second call site. */
export const propertyBindingOccurrenceKey = (statementIndex: number, parameterKey: string): string =>
  `${statementIndex}:${parameterKey}`;

/** Inverse of propertyBindingOccurrenceKey - split on the first `:` only, since
 * every parameterKey is a plain identifier with no `:` of its own. Task 45 uses this to resolve a
 * `doc.propertyBindings`/`conditionalGroupConditions`/`textTemplates` entry that
 * matches a selected binding back to its owning statement/parameter without a
 * second document scan || re-parse. */
export const parsePropertyBindingOccurrenceKey = (occurrenceKey: string): { statementIndex: number; parameterKey: string } | null => {
  const separator = occurrenceKey.indexOf(":");
  if (separator < 0) return null;
  const statementIndex = Number(occurrenceKey.slice(0, separator));
  if (!Number.isInteger(statementIndex)) return null;
  return { statementIndex, parameterKey: occurrenceKey.slice(separator + 1) };
};

export type CompilePropertyBindingsInput = {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
  includeStatement?: DslStatementInclusion;
};

export type PropertyBindingCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, ScalarValueSource>;
  /** Task 48: every occurrenceKey whose resolved source is `{kind:"binding"}`,
   * grouped by bindingId in the same single pass that builds
   * sourcesByOccurrenceKey - so a runtime-diagnostic consumer lookup for one
   * binding is an O(1) map get, never a scan over every property binding in
   * the document. */
  occurrenceKeysByBindingId: ReadonlyMap<BindingId, readonly string[]>;
  diagnostics: readonly DslDiagnostic[];
};

type Candidate = {
  key: string;
  statement: DslStatement;
  statementIndex: number;
  parameterKey: string;
  expectedType: ScalarType;
  span: DslSpan;
  ast: NonNullable<ReturnType<typeof parseScalarExpression>["ast"]>;
  references: readonly { name: string; span: DslSpan }[];
};

/** Exact-span-or-nothing (Task 48): see typedDeclarationAnalysis.ts's
 * compileDiagnostic for the shared rationale. This module's own diagnostic
 * codes (property-binding-*) are about an occurrence that itself failed to
 * resolve, so - unlike a BindingIssue || runtime diagnostic - there is no
 * separately-resolved index entry to navigate to; these carry an exact span
 * for the gutter but no navigationTarget. */
const diagnosticAt = (spans: DiagnosticSpanContext, statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

const unresolvedMessage = (name: string, resolution: BindingResolution | undefined): string => {
  if (resolution?.kind === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "duplicate") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  return `未定義の変数 "${name}" を参照しています。`;
};

const collectPropertyReferences = (ast: NonNullable<ReturnType<typeof parseScalarExpression>["ast"]>) =>
  collectScalarExpressionReferences(ast).map((reference) => ({ name: reference.name, span: reference.span }));

const collectTypedExpressionBindingIds = (expression: TypedScalarExpression): BindingId[] => {
  switch (expression.kind) {
    case "reference":
      return expression.bindingId ? [expression.bindingId] : [];
    case "unary":
      return collectTypedExpressionBindingIds(expression.operand);
    case "binary":
      return [...collectTypedExpressionBindingIds(expression.left), ...collectTypedExpressionBindingIds(expression.right)];
    case "group":
      return collectTypedExpressionBindingIds(expression.expression);
    case "call":
      return expression.args.flatMap((argument) => argument.kind === "scalar" ? collectTypedExpressionBindingIds(argument.expression) : []);
    default:
      return [];
  }
};

export const compilePropertyBindings = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans,
  includeStatement
}: CompilePropertyBindingsInput): PropertyBindingCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const candidates: Candidate[] = [];
  const requests: SiteReferenceRequest[] = [];
  const sourceOrderByElementId = new Map<ElementId, number>();
  for (const [sourceOrder, elementId] of elementIdByStatementIndex) sourceOrderByElementId.set(elementId, sourceOrder);
  const nameContext = createElementNameContext([...elements]);

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    // "group" is its own DslStatement kind (elementType is implicitly
    // "group", never stored on the statement); every other element type,
    // including forGroup/conditionalGroup, parses as "element" with `.type`
    // set. Both carry `.attrs` via DslStatementBase.
    if (statement.kind !== "element" && statement.kind !== "group") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    const element = elementId ? elementsById.get(elementId) : undefined;
    if (!element) return;

    for (const attr of statement.attrs) {
      const parameterKey = parameterKeyForArg(element.type, attr.key);
      const definition = findParameterDefinition(element, parameterKey);
      const expectedType = scalarTypeForParameterDefinition(definition);
      if (!definition || !expectedType || expectedType.kind === "number") continue;
      // Quoted literals && ordinary bare literals remain owned by
      // dslApplyArgs. Compound typed values must reach the common frontend
      // regardless of whether their first token is `@`, `(`, `not`, || a
      // boolean literal followed by `and`/`or`.
      if (!isScalarExpressionCandidateSource(attr.value)) continue;

      const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
      const parsed = parseScalarExpression(" ".repeat(attr.valueStart) + attr.value, span);
      if (!parsed.ast) {
        const parseDiagnostic = parsed.diagnostics[0];
        if (parseDiagnostic) diagnostics.push(diagnosticAt(spans, statement, parseDiagnostic.span, parseDiagnostic.code, parseDiagnostic.message));
        continue;
      }

      const key = propertyBindingOccurrenceKey(statementIndex, parameterKey);
      const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex)
        ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
      const references = collectPropertyReferences(parsed.ast);
      candidates.push({
        key,
        statement,
        statementIndex,
        parameterKey,
        expectedType,
        span,
        ast: parsed.ast,
        references
      });
      references.forEach((reference, index) => requests.push({ key: `${key}:${index}`, name: reference.name, site: { scopeId, statementIndex } }));
    }
  });

  // One batch sweep for every candidate in the document, not one lookup per
  // occurrence - see resolveReferencesAtSites's own O(n) batching contract.
  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests);
  const sourcesByOccurrenceKey = new Map<string, ScalarValueSource>();

  for (const candidate of candidates) {
    let invalidReference = false;
    const referenceResolutions = candidate.references.map((reference, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push(diagnosticAt(spans, candidate.statement, reference.span, PROPERTY_BINDING_UNRESOLVED_CODE, unresolvedMessage(reference.name, resolution)));
        invalidReference = true;
        return undefined;
      }
      const entry = bindingAnalysis.entriesById.get(resolution.binding.id);
      if (resolution.binding.declaredType === null || entry?.status.kind === "invalid") {
        diagnostics.push(diagnosticAt(spans, candidate.statement, reference.span, PROPERTY_BINDING_INVALID_CODE, `"${reference.name}" は無効な宣言のため参照できません。`));
        invalidReference = true;
      }
      return resolution;
    });
    if (invalidReference) continue;

    const prepared = prepareRecordScalarExpressionFromCatalog({
      ast: candidate.ast,
      statementIndex: candidate.statementIndex,
      catalog: bindingAnalysis.catalog,
      referenceResolutions: referenceResolutions as NonNullable<typeof referenceResolutions[number]>[]
    });
    if (prepared.issues.length > 0) {
      diagnostics.push(...prepared.issues.map((issue) =>
        diagnosticAt(spans, candidate.statement, issue.span, PROPERTY_BINDING_INVALID_CODE, issue.message)
      ));
      continue;
    }

    const checked = typecheckScalarExpression(prepared.ast, {
      expectedType: candidate.expectedType,
      references: prepared.references
    });
    if (checked.diagnostics.length > 0 || checked.type === null) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) => diagnosticAt(
        spans,
        candidate.statement,
        diagnostic.span,
        PROPERTY_BINDING_TYPE_MISMATCH_CODE,
        diagnostic.message
      )));
      if (checked.diagnostics.length === 0) diagnostics.push(diagnosticAt(spans, candidate.statement, candidate.span, PROPERTY_BINDING_INVALID_CODE, `"${candidate.parameterKey}" のtyped expressionを解決できません。`));
      continue;
    }

    const element = elementIdByStatementIndex.get(candidate.statementIndex)
      ? elementsById.get(elementIdByStatementIndex.get(candidate.statementIndex)!)
      : undefined;
    const geometryResolution = resolveTypedGeometryProperties(
      checked.typed,
      elements,
      sourceOrderByElementId,
      {
        currentElement: element,
        nameContext,
        currentSourceOrder: candidate.statementIndex
      }
    );
    if (geometryResolution.issues.length > 0) {
      diagnostics.push(...geometryResolution.issues.map((issue) =>
        diagnosticAt(spans, candidate.statement, issue.span, PROPERTY_BINDING_INVALID_CODE, issue.message)
      ));
      continue;
    }

    if (candidate.ast.kind === "reference" && candidate.references.length === 1) {
      const resolution = referenceResolutions[0];
      if (!resolution || resolution.kind !== "resolved" || !resolution.binding.declaredType || !isScalarTypeAssignable(resolution.binding.declaredType, candidate.expectedType)) {
        const actual = resolution?.kind === "resolved" ? resolution.binding.declaredType : null;
        diagnostics.push(diagnosticAt(spans, candidate.statement, candidate.ast.span, PROPERTY_BINDING_TYPE_MISMATCH_CODE, `"${candidate.parameterKey}" の型が一致しません(期待: ${describeScalarType(candidate.expectedType)}, 実際: ${actual ? describeScalarType(actual) : "unknown"})。`));
        continue;
      }
      sourcesByOccurrenceKey.set(candidate.key, {
        kind: "binding",
        bindingId: resolution.binding.id,
        type: resolution.binding.declaredType,
        span: candidate.ast.span,
        nameSpan: candidate.ast.nameSpan,
        name: candidate.ast.name
      });
    } else {
      sourcesByOccurrenceKey.set(candidate.key, { kind: "expression", expression: geometryResolution.expression, type: checked.type, span: candidate.span });
    }
  }

  // Task 48: grouped in the same pass that builds sourcesByOccurrenceKey, in
  // source order (statements.forEach/candidates order is already statement
  // order) - never a second scan || a comparison sort.
  const occurrenceKeysByBindingId = new Map<BindingId, string[]>();
  for (const [occurrenceKey, source] of sourcesByOccurrenceKey) {
    const bindingIds = source.kind === "binding"
      ? [source.bindingId]
      : source.kind === "expression"
        ? collectTypedExpressionBindingIds(source.expression)
        : [];
    for (const bindingId of bindingIds) {
      const existing = occurrenceKeysByBindingId.get(bindingId);
      if (existing) existing.push(occurrenceKey);
      else occurrenceKeysByBindingId.set(bindingId, [occurrenceKey]);
    }
  }

  return { sourcesByOccurrenceKey, occurrenceKeysByBindingId, diagnostics };
};