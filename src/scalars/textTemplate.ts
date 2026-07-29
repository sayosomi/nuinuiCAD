// Task 26: parses the canonical `label(text: ...)` raw string value into a
// TextTemplateAst that Tasks 27 (TS evaluation), 28 (Rust parity), 36
// (dependency graph), 39 (value completion), and 43 (source spans) can all
// consume without re-parsing, re-resolving, or re-scanning raw source. See
// docs/typed-variables/tasks/26-text-template-analysis.md.
//
// Runs for every canonical `label(text: "...")` occurrence in a nui 3
// document regardless of whether the document has any typed declaration at
// all - brace/escape structure and legacy-vs-typed hole classification never
// depend on `bindingAnalysis` being present. Only a hole that actually
// contains a `@name` reference needing resolution touches the binding
// catalog, and only when one is available; a document with zero typed
// declarations classifies every reference-bearing, syntactically-plain hole
// as legacy (nothing else it could be, since no typed binding exists to
// reference) with no new diagnostic, preserving today's behavior exactly.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import { describeScalarType } from "./expressionTypecheck";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import {
  collectReferences,
  containsLegacyIncompatibleSyntax,
  isDefiniteLegacyReference,
  unresolvedReferenceMessage
} from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarSpan } from "./literalScanner";
import { scanTextTemplateLiteral, type TextTemplateRawHoleSegment, type TextTemplateRawLiteralSegment } from "./textTemplateScan";

export type TextTemplateLiteralSegment = TextTemplateRawLiteralSegment;

type TextTemplateHoleSegmentBase = {
  readonly kind: "hole";
  readonly span: ScalarSpan;
  readonly contentSpan: ScalarSpan;
  readonly cookedInsertOffset: number;
};

export type TextTemplateStringHoleSegment = TextTemplateHoleSegmentBase & {
  readonly holeKind: "string";
  readonly expression: TypedScalarExpression;
};
export type TextTemplateNumberHoleSegment = TextTemplateHoleSegmentBase & {
  readonly holeKind: "number";
  readonly expression: TypedScalarExpression;
};
/** Syntax the typed grammar never parsed, or that parsed but is fully
 * expressible by (and left to) the existing legacy numeric-expression
 * evaluator - untouched raw content for Task 27/28 to hand to the unchanged
 * legacy evaluation path. */
export type TextTemplateLegacyHoleSegment = TextTemplateHoleSegmentBase & {
  readonly holeKind: "legacy";
  readonly raw: string;
};
export type TextTemplateHoleSegment = TextTemplateStringHoleSegment | TextTemplateNumberHoleSegment | TextTemplateLegacyHoleSegment;
export type TextTemplateSegment = TextTemplateLiteralSegment | TextTemplateHoleSegment;

/** One resolved `@name` reference inside a typed hole - flat and
 * precomputed so Task 36 can build dependency edges by reading this array
 * directly, without walking each hole's `expression` tree or re-resolving
 * anything. Only ever produced for a reference that resolved to a usable
 * typed binding; legacy holes never contribute (their runtime dependency
 * extraction is the existing, unchanged `extractTextReferences`). */
export type TextTemplateDependency = {
  readonly holeSpan: ScalarSpan;
  readonly bindingId: BindingId;
  readonly name: string;
  readonly span: ScalarSpan;
};

export type TextTemplateAst = {
  readonly span: ScalarSpan;
  readonly quote: '"' | "'";
  readonly raw: string;
  readonly segments: readonly TextTemplateSegment[];
  readonly dependencies: readonly TextTemplateDependency[];
};

export const TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE = "text-template-hole-unresolved";
export const TEXT_TEMPLATE_HOLE_LEGACY_REFERENCE_CODE = "text-template-hole-legacy-reference";
export const TEXT_TEMPLATE_HOLE_INVALID_CODE = "text-template-hole-invalid";
export const TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE = "interpolation-type-mismatch";

type OccurrenceDiagnostic = { readonly span: ScalarSpan; readonly code: string; readonly message: string };

type ParsedHole = {
  readonly raw: TextTemplateRawHoleSegment;
  readonly ast: ReturnType<typeof parseScalarExpression>["ast"];
  readonly references: ReturnType<typeof collectReferences>;
};

/**
 * Analyzes one `text:` value's already-isolated span. `source` must be the
 * same offset-preserving padded text every sibling compiler in this
 * directory builds (`" ".repeat(valueStart) + value`), since none of these
 * compilers see the full document source - only a `DslAttribute.value`.
 * `bindingAnalysis` is optional: absent whenever the document has no typed
 * declarations at all, in which case every reference-bearing plain hole is
 * presumed legacy (nothing else it could resolve to) and only hole syntax
 * the legacy grammar could never represent (string/boolean literals, `!`)
 * still gets typechecked, with any reference inside it failing closed as
 * unresolved.
 */
export const analyzeTextTemplate = (
  source: string,
  valueSpan: ScalarSpan,
  bindingAnalysis: BindingAnalysis | undefined,
  scopeId: string | undefined,
  statementIndex: number
): { template: TextTemplateAst | null; diagnostics: readonly OccurrenceDiagnostic[] } => {
  const scanned = scanTextTemplateLiteral(source, valueSpan);
  if (scanned.kind === "error") {
    return { template: null, diagnostics: [{ span: scanned.span, code: scanned.issueCode, message: scanned.message }] };
  }

  const parsedHoles: ParsedHole[] = scanned.segments
    .filter((segment): segment is TextTemplateRawHoleSegment => segment.kind === "hole")
    .map((raw) => {
      const parsed = parseScalarExpression(source, raw.contentSpan);
      return { raw, ast: parsed.ast, references: parsed.ast ? collectReferences(parsed.ast) : [] };
    });

  const requestKey = (holeIndex: number, referenceIndex: number) => `${holeIndex}:${referenceIndex}`;
  const canResolve = bindingAnalysis !== undefined && scopeId !== undefined;
  const requests: SiteReferenceRequest[] = [];
  if (canResolve) {
    parsedHoles.forEach((hole, holeIndex) => {
      hole.references.forEach((reference, referenceIndex) => {
        requests.push({ key: requestKey(holeIndex, referenceIndex), name: reference.name, site: { scopeId: scopeId!, statementIndex } });
      });
    });
  }
  const resolutions = canResolve && requests.length > 0
    ? resolveReferencesAtSites(bindingAnalysis!.catalog, requests)
    : new Map<string, BindingResolution>();
  const resolutionAt = (holeIndex: number, referenceIndex: number) => resolutions.get(requestKey(holeIndex, referenceIndex));

  const diagnostics: OccurrenceDiagnostic[] = [];
  const dependencies: TextTemplateDependency[] = [];
  const segments: TextTemplateSegment[] = [];
  let holeIndex = -1;

  const legacyHoleSegment = (hole: ParsedHole): TextTemplateLegacyHoleSegment => ({
    kind: "hole",
    holeKind: "legacy",
    span: hole.raw.span,
    contentSpan: hole.raw.contentSpan,
    cookedInsertOffset: hole.raw.cookedInsertOffset,
    raw: source.slice(hole.raw.contentSpan.start, hole.raw.contentSpan.end)
  });

  for (const segment of scanned.segments) {
    if (segment.kind === "literal") {
      segments.push(segment);
      continue;
    }
    holeIndex += 1;
    const hole = parsedHoles[holeIndex];

    if (!hole.ast) {
      // Not valid typed-scalar-expression syntax at all - legacy path, untouched.
      segments.push(legacyHoleSegment(hole));
      continue;
    }
    const ast = hole.ast;

    const hasTypedOnlySyntax = containsLegacyIncompatibleSyntax(ast);
    const legacyEligible = !hasTypedOnlySyntax && (
      !canResolve || hole.references.every((_, referenceIndex) => isDefiniteLegacyReference(resolutionAt(holeIndex, referenceIndex)))
    );
    if (legacyEligible) {
      segments.push(legacyHoleSegment(hole));
      continue;
    }

    // Typed candidate: every reference must resolve to a usable typed
    // binding, or this hole fails closed with a diagnostic - never falls
    // back to the legacy path once committed to typed syntax.
    let hasReferenceDiagnostic = false;
    const referenceResolutions: BindingResolution[] = [];
    hole.references.forEach((reference, referenceIndex) => {
      const resolution = canResolve ? resolutionAt(holeIndex, referenceIndex) : undefined;
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push({ span: reference.span, code: TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE, message: unresolvedReferenceMessage(reference.name, resolution) });
        hasReferenceDiagnostic = true;
        return;
      }
      referenceResolutions.push(resolution);
      if (resolution.binding.declaredType === null) {
        const message = resolution.binding.kind === "legacy"
          ? `"${reference.name}" はlegacy変数であり、型付きtext templateの中では使用できません。`
          : `"${reference.name}" は無効な宣言のため参照できません。`;
        diagnostics.push({ span: reference.span, code: TEXT_TEMPLATE_HOLE_LEGACY_REFERENCE_CODE, message });
        hasReferenceDiagnostic = true;
        return;
      }
      const entry = bindingAnalysis!.entriesById.get(resolution.binding.id);
      if (entry?.status.kind === "invalid") {
        diagnostics.push({ span: reference.span, code: TEXT_TEMPLATE_HOLE_INVALID_CODE, message: `"${reference.name}" は無効な宣言のため参照できません。` });
        hasReferenceDiagnostic = true;
        return;
      }
      dependencies.push({ holeSpan: hole.raw.span, bindingId: resolution.binding.id, name: reference.name, span: reference.span });
    });
    if (hasReferenceDiagnostic) continue;

    const checked = typecheckScalarExpression(ast, { expectedType: null, references: referenceResolutions });
    if (checked.diagnostics.length > 0) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) => ({ span: diagnostic.span, code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE, message: diagnostic.message })));
      continue;
    }
    const holeSegmentBase = { span: hole.raw.span, contentSpan: hole.raw.contentSpan, cookedInsertOffset: hole.raw.cookedInsertOffset } as const;
    if (checked.type?.kind === "string") {
      segments.push({ kind: "hole", holeKind: "string", ...holeSegmentBase, expression: checked.typed });
    } else if (checked.type?.kind === "number") {
      segments.push({ kind: "hole", holeKind: "number", ...holeSegmentBase, expression: checked.typed });
    } else {
      const actual = checked.type ? describeScalarType(checked.type) : "unresolved";
      diagnostics.push({
        span: hole.raw.contentSpan,
        code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE,
        message: `テキスト埋め込みはstringまたはnumberである必要があります(実際: ${actual})。`
      });
    }
  }

  if (diagnostics.length > 0) return { template: null, diagnostics };
  return {
    template: { span: scanned.span, quote: scanned.quote, raw: scanned.raw, segments, dependencies },
    diagnostics: []
  };
};

export type CompileTextTemplatesInput = {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis | undefined;
  spans: DiagnosticSpanContext;
};

export type TextTemplateCompilation = {
  templatesByOccurrenceKey: ReadonlyMap<string, TextTemplateAst>;
  diagnostics: readonly DslDiagnostic[];
};

/** Exact-span-or-nothing (Task 48) - see typedDeclarationAnalysis.ts's
 * compileDiagnostic. No navigationTarget: a failed hole occurrence never
 * reaches templatesByOccurrenceKey, so there is no resolved index entry to
 * jump to for it. */
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
 * Scans every canonical `label(text: "...")` occurrence in the document -
 * `label` is the sole construction producing `CadElementType "text"`
 * (src/dsl/dslConstructions.ts). Runs whenever this is called at all
 * (callers gate on nui 3, not on typed declarations existing - see
 * dslDocument.ts): a document with zero typed declarations still gets full
 * brace/escape/legacy-vs-typed classification, just with `bindingAnalysis`
 * absent for every occurrence.
 */
export const compileTextTemplates = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans
}: CompileTextTemplatesInput): TextTemplateCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const templatesByOccurrenceKey = new Map<string, TextTemplateAst>();

  statements.forEach((statement, statementIndex) => {
    if (statement.kind !== "element" || statement.type !== "text") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "text");
    if (!attr || attr.value.startsWith("@")) return; // bare @binding text is Task 22's propertyBindings territory.

    const paddedSource = " ".repeat(attr.valueStart) + attr.value;
    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const scopeId = bindingAnalysis
      ? bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId
      : undefined;

    const { template, diagnostics: occurrenceDiagnostics } = analyzeTextTemplate(paddedSource, span, bindingAnalysis, scopeId, statementIndex);
    if (occurrenceDiagnostics.length > 0) {
      diagnostics.push(...occurrenceDiagnostics.map((diagnostic) => diagnosticAt(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message)));
      return;
    }
    if (template) templatesByOccurrenceKey.set(propertyBindingOccurrenceKey(statementIndex, "text"), template);
  });

  return { templatesByOccurrenceKey, diagnostics };
};
