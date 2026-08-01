// Task 22: compiles/typechecks a CAD element property value that is
// entirely a single `@name` reference into a typed binding source. See
// docs/typed-variables/tasks/22-property-reference-typecheck.md.
//
// Scope boundary: this module only classifies and typechecks. It never
// evaluates a binding's runtime value and never writes to a CadElement
// field - literal property compile output (src/dsl/dslApplyArgs.ts) is
// completely untouched. Only args whose ParameterDefinition.kind is
// text/choice/boolean are ever inspected; `number` args keep their
// pre-existing, unrelated legacy `@name` numeric-variable-reference syntax.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import { commonArgSpecs, constructionForElementType } from "../dsl/dslConstructions";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import { findParameterDefinition, type ParameterValueKind } from "../parameters/parameterDefinitions";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import { describeScalarType } from "./expressionTypecheck";
import { parseScalarExpression } from "./expressionParser";
import { isAssignableToPropertyCapability, type PropertyBindingCapability } from "./scalarAssignability";
import type { ScalarType } from "./types";

/**
 * The compiled source of a property's value. Task 22 only ever produces
 * `binding` entries (an absent map entry means "literal", i.e. use the
 * element's own compiled field as before). `literal` is kept as an explicit
 * tag for Tasks 23-26 to pattern-match on if they choose to; a `template`
 * variant belongs to Task 26 and is intentionally not added here.
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
    };

export const PROPERTY_BINDING_NOT_SUPPORTED_CODE = "property-binding-not-supported";
export const PROPERTY_BINDING_UNRESOLVED_CODE = "property-binding-unresolved";
export const PROPERTY_BINDING_INVALID_CODE = "property-binding-invalid";
export const PROPERTY_BINDING_TYPE_MISMATCH_CODE = "property-binding-type-mismatch";

/** Shared key format between this module's output map and any later reader
 * (Tasks 23-26), so the format is never re-derived at a second call site. */
export const propertyBindingOccurrenceKey = (statementIndex: number, parameterKey: string): string =>
  `${statementIndex}:${parameterKey}`;

/** Inverse of propertyBindingOccurrenceKey - split on the first `:` only, since
 * every registered parameterKey (parameterDefinitions.ts's propertyBindingCapabilities)
 * is a plain identifier with no `:` of its own. Task 45 uses this to resolve a
 * `doc.propertyBindings`/`conditionalGroupConditions`/`textTemplates` entry that
 * matches a selected binding back to its owning statement/parameter without a
 * second document scan or re-parse. */
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

const SCALAR_ELIGIBLE_PARAMETER_KINDS: ReadonlySet<ParameterValueKind> = new Set(["text", "choice", "boolean"]);

type Candidate = {
  key: string;
  statement: DslStatement;
  parameterKey: string;
  referenceName: string;
  referenceSpan: DslSpan;
  referenceNameSpan: DslSpan;
  capability: PropertyBindingCapability;
};

/** Exact-span-or-nothing (Task 48): see typedDeclarationAnalysis.ts's
 * compileDiagnostic for the shared rationale. This module's own diagnostic
 * codes (property-binding-*) are about an occurrence that itself failed to
 * resolve, so - unlike a BindingIssue or runtime diagnostic - there is no
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

/**
 * A DSL arg name (e.g. `extensions`) is not always the parameter key
 * `findParameterDefinition` indexes by (e.g. `useExtensions`) - the same
 * remap `dslApplyArgs.ts`'s `applyArgs` already applies via
 * `dslConstructions.ts`'s per-construction `DslArgSpec.parameterKey`. Reused
 * here rather than re-declared so there is exactly one arg-name-to-property
 * mapping in the codebase.
 */
const parameterKeyForArg = (elementType: CadElement["type"], argName: string): string => {
  const spec = constructionForElementType(elementType);
  const argSpec = [...spec.args, ...commonArgSpecs].find((item) => item.arg === argName);
  return argSpec?.parameterKey ?? argSpec?.arg ?? argName;
};

const unresolvedMessage = (name: string, resolution: BindingResolution | undefined): string => {
  if (resolution?.kind === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "duplicate") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  return `未定義の変数 "${name}" を参照しています。`;
};

export const compilePropertyBindings = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans
}: CompilePropertyBindingsInput): PropertyBindingCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const candidates: Candidate[] = [];
  const requests: SiteReferenceRequest[] = [];

  statements.forEach((statement, statementIndex) => {
    // "group" is its own DslStatement kind (elementType is implicitly
    // "group", never stored on the statement); every other element type,
    // including forGroup/conditionalGroup, parses as "element" with `.type`
    // set. Both carry `.attrs` via DslStatementBase.
    if (statement.kind !== "element" && statement.kind !== "group") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    const element = elementId ? elementsById.get(elementId) : undefined;
    if (!element) return;

    for (const attr of statement.attrs) {
      // Never touches quoted literals (strings always start with a quote)
      // or the pre-existing legacy numeric `@name` measurement-reference
      // syntax - only unquoted, `@`-prefixed text/choice/boolean values.
      if (!attr.value.startsWith("@")) continue;
      const parameterKey = parameterKeyForArg(element.type, attr.key);
      const definition = findParameterDefinition(element, parameterKey);
      if (!definition || !SCALAR_ELIGIBLE_PARAMETER_KINDS.has(definition.kind)) continue;

      const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
      const parsed = parseScalarExpression(" ".repeat(attr.valueStart) + attr.value, span);
      const referenceNode = parsed.ast && parsed.ast.kind === "reference" ? parsed.ast : null;

      if (!definition.propertyCapability) {
        if (referenceNode) {
          diagnostics.push(diagnosticAt(
            spans,
            statement,
            referenceNode.span,
            PROPERTY_BINDING_NOT_SUPPORTED_CODE,
            `"${parameterKey}" はbindingを受け付けないプロパティです。リテラル値を指定してください。`
          ));
        }
        // A malformed `@...` on a non-opted property was already silent
        // literal garbage before this task; not this module's concern.
        continue;
      }

      if (!referenceNode) {
        // Task 51: surface the tokenizer's own geometry-property-in-typed-
        // expression diagnostic verbatim when that is why parsing failed,
        // rather than the generic "single @binding reference only" message -
        // this property's value can never be a geometry property (it is
        // text/choice/boolean-typed), so telling the user exactly which
        // spelling is unavailable here is more actionable.
        const tokenizeError = parsed.diagnostics[0];
        if (tokenizeError?.code === "geometry-property-in-typed-expression") {
          diagnostics.push(diagnosticAt(spans, statement, tokenizeError.span, tokenizeError.code, tokenizeError.message));
          continue;
        }
        diagnostics.push(diagnosticAt(
          spans,
          statement,
          span,
          PROPERTY_BINDING_INVALID_CODE,
          `"${parameterKey}" の値は単独の @binding 参照のみ指定できます。`
        ));
        continue;
      }

      const key = propertyBindingOccurrenceKey(statementIndex, parameterKey);
      const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex)
        ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
      candidates.push({
        key,
        statement,
        parameterKey,
        referenceName: referenceNode.name,
        referenceSpan: referenceNode.span,
        referenceNameSpan: referenceNode.nameSpan,
        capability: definition.propertyCapability
      });
      requests.push({ key, name: referenceNode.name, site: { scopeId, statementIndex } });
    }
  });

  // One batch sweep for every candidate in the document, not one lookup per
  // occurrence - see resolveReferencesAtSites's own O(n) batching contract.
  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests);
  const sourcesByOccurrenceKey = new Map<string, ScalarValueSource>();

  for (const candidate of candidates) {
    const resolution = resolutions.get(candidate.key);
    if (!resolution || resolution.kind !== "resolved") {
      diagnostics.push(diagnosticAt(
        spans,
        candidate.statement,
        candidate.referenceSpan,
        PROPERTY_BINDING_UNRESOLVED_CODE,
        unresolvedMessage(candidate.referenceName, resolution)
      ));
      continue;
    }

    const binding = resolution.binding;
    const entry = bindingAnalysis.entriesById.get(binding.id);
    if (binding.declaredType === null || entry?.status.kind === "invalid") {
      diagnostics.push(diagnosticAt(
        spans,
        candidate.statement,
        candidate.referenceSpan,
        PROPERTY_BINDING_INVALID_CODE,
        `"${candidate.referenceName}" は無効な宣言のため参照できません。`
      ));
      continue;
    }

    if (!isAssignableToPropertyCapability(binding.declaredType, candidate.capability)) {
      diagnostics.push(diagnosticAt(
        spans,
        candidate.statement,
        candidate.referenceSpan,
        PROPERTY_BINDING_TYPE_MISMATCH_CODE,
        `"${candidate.parameterKey}" の型が一致しません(期待: ${describeScalarType(candidate.capability.propertyType)}, 実際: ${describeScalarType(binding.declaredType)})。`
      ));
      continue;
    }

    sourcesByOccurrenceKey.set(candidate.key, {
      kind: "binding",
      bindingId: binding.id,
      type: binding.declaredType,
      span: candidate.referenceSpan,
      nameSpan: candidate.referenceNameSpan,
      name: candidate.referenceName
    });
  }

  // Task 48: grouped in the same pass that builds sourcesByOccurrenceKey, in
  // source order (statements.forEach/candidates order is already statement
  // order) - never a second scan or a comparison sort.
  const occurrenceKeysByBindingId = new Map<BindingId, string[]>();
  for (const [occurrenceKey, source] of sourcesByOccurrenceKey) {
    if (source.kind !== "binding") continue;
    const existing = occurrenceKeysByBindingId.get(source.bindingId);
    if (existing) existing.push(occurrenceKey);
    else occurrenceKeysByBindingId.set(source.bindingId, [occurrenceKey]);
  }

  return { sourcesByOccurrenceKey, occurrenceKeysByBindingId, diagnostics };
};
