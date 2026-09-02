// Parses the canonical `label(text: ...)` raw string value into a
// TextTemplateAst that evaluation, dependency analysis, completion, and source
// span consumers can all use without re-parsing, re-resolving, || re-scanning
// raw source.
//
// Runs for every canonical `label(text: "...")` occurrence in a nui 1
// document regardless of whether the document has any typed declaration at
// all - brace/escape structure && numeric-vs-typed hole classification never
// depend on `bindingAnalysis` being present. Only a hole that actually
// contains a `@name` reference needing resolution touches the binding
// catalog, && only when one is available; a document with zero typed
// declarations keeps syntactically-plain numeric holes on the numeric path;
// geometry-property holes are classified from the same typed geometry metadata
// used by the other scalar frontends.

import type { CadElement, ElementId } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "../dsl/dslCompilationGuard";
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
  containsNonNumericScalarSyntax,
  unresolvedReferenceMessage
} from "./typedDeclarationAnalysis";
import type { ScalarExpressionAst } from "./expressionAst";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarSpan } from "./literalScanner";
import { scanTextTemplateLiteral, type TextTemplateRawHoleSegment, type TextTemplateRawLiteralSegment } from "./textTemplateScan";
import { barePropertyReferenceIssues } from "../dsl/expressionReferenceToken";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";
import { resolveGeometryPropertyMetadata } from "./typedGeometryPropertyResolution";

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
export type TextTemplateBooleanHoleSegment = TextTemplateHoleSegmentBase & {
  readonly holeKind: "boolean";
  readonly expression: TypedScalarExpression;
};
/** A raw numeric expression evaluated in the text element's geometry/local
 * numeric context, independently of the typed binding catalog. */
export type TextTemplateNumericExpressionHoleSegment = TextTemplateHoleSegmentBase & {
  readonly holeKind: "numeric";
  readonly raw: string;
};
export type TextTemplateHoleSegment =
  | TextTemplateStringHoleSegment
  | TextTemplateNumberHoleSegment
  | TextTemplateBooleanHoleSegment
  | TextTemplateNumericExpressionHoleSegment;
export type TextTemplateSegment = TextTemplateLiteralSegment | TextTemplateHoleSegment;

/** One resolved `@name` reference inside a typed hole - flat &&
 * precomputed so dependency analysis can build edges by reading this array
 * directly, without walking each hole's `expression` tree || re-resolving
 * anything. Only ever produced for a reference that resolved to a usable
 * typed binding; numeric-expression holes never contribute (their runtime
 * dependency extraction remains local to the numeric evaluator). */
export type TextTemplateDependency = {
  readonly holeSpan: ScalarSpan;
  readonly bindingId: BindingId;
  readonly name: string;
  readonly span: ScalarSpan;
  /** The text element owning this hole, when known. */
  readonly elementId?: ElementId;
};

export type TextTemplateAst = {
  readonly span: ScalarSpan;
  readonly quote: '"' | "'";
  readonly raw: string;
  readonly segments: readonly TextTemplateSegment[];
  readonly dependencies: readonly TextTemplateDependency[];
};

export const TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE = "text-template-hole-unresolved";
export const TEXT_TEMPLATE_HOLE_INVALID_CODE = "text-template-hole-invalid";
export const TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE = "interpolation-type-mismatch";

type OccurrenceDiagnostic = { readonly span: ScalarSpan; readonly code: string; readonly message: string };

type ParsedHole = {
  readonly raw: TextTemplateRawHoleSegment;
  readonly ast: ReturnType<typeof parseScalarExpression>["ast"];
  readonly references: ReturnType<typeof collectReferences>;
};

const recordScalarPropertySpanStarts = (
  ast: ScalarExpressionAst,
  bindingAnalysis: BindingAnalysis | undefined,
  statementIndex: number
): ReadonlySet<number> => {
  if (!bindingAnalysis?.catalog.sourceNamespaceBindingResolver) return new Set();
  const catalog = bindingAnalysis.catalog;
  const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
  const found = new Set<number>();
  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "geometryProperty": {
        const lookup = catalog.sourceNamespaceBindingResolver?.(`${node.elementName}.${node.property}`, statementIndex, scopeId);
        if (lookup?.kind === "resolved" || (lookup?.kind === "blocked" && lookup.declarationKind === "recordValue")) {
          found.add(node.span.start);
        }
        return;
      }
      case "unary": visit(node.operand); return;
      case "binary": visit(node.left); visit(node.right); return;
      case "group": visit(node.expression); return;
      case "call": node.args.forEach((argument) => visit(argument.expression)); return;
      default: return;
    }
  };
  visit(ast);
  return found;
};

/**
 * Analyzes one `text:` value's already-isolated span. `source` must be the
 * same offset-preserving padded text every sibling compiler in this
 * directory builds (`" ".repeat(valueStart) + value`), since none of these
 * compilers see the full document source - only a `DslAttribute.value`.
 * `bindingAnalysis` is optional: absent whenever the document has no typed
 * declarations at all. Numeric-expression holes contain no typed `@name`
 * binding reference; geometry-property metadata is resolved from the document
 * element list and source order before deciding whether a hole is numeric.
 */
export const analyzeTextTemplate = (
  source: string,
  valueSpan: ScalarSpan,
  bindingAnalysis: BindingAnalysis | undefined,
  scopeId: string | undefined,
  statementIndex: number,
  elementId: ElementId | undefined,
  elements: readonly CadElement[] = [],
  sourceOrderByElementId: ReadonlyMap<ElementId, number> = new Map()
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
        requests.push({
          key: requestKey(holeIndex, referenceIndex),
          name: reference.name,
          site: {
            scopeId: scopeId!,
            statementIndex
          }
        });
      });
    });
  }
  const resolutions = canResolve && requests.length > 0
    ? resolveReferencesAtSites(bindingAnalysis!.catalog, requests)
    : new Map<string, BindingResolution>();
  const resolutionAt = (holeIndex: number, referenceIndex: number) => resolutions.get(requestKey(holeIndex, referenceIndex));
  const currentElement = elementId === undefined ? undefined : elements.find((element) => element.id === elementId);

  const diagnostics: OccurrenceDiagnostic[] = [];
  const dependencies: TextTemplateDependency[] = [];
  const segments: TextTemplateSegment[] = [];
  let holeIndex = -1;

  const numericExpressionHoleSegment = (hole: ParsedHole): TextTemplateNumericExpressionHoleSegment => ({
    kind: "hole",
    holeKind: "numeric",
    span: hole.raw.span,
    contentSpan: hole.raw.contentSpan,
    cookedInsertOffset: hole.raw.cookedInsertOffset,
    raw: source.slice(hole.raw.contentSpan.start, hole.raw.contentSpan.end)
  });

  // Numeric-expression holes are exactly where the nui 1 sigil requirement for
  // element-property references applies. Checked once here (not by a
  // separate document-wide pass) since this is the only place the hole's
  // exact raw content span is already isolated.
  const numericExpressionHoleBareReferenceDiagnostics = (hole: ParsedHole): OccurrenceDiagnostic[] =>
    barePropertyReferenceIssues(
      source.slice(hole.raw.contentSpan.start, hole.raw.contentSpan.end),
      hole.raw.contentSpan.start
    ).map((issue) => ({ span: { start: issue.start, end: issue.end }, code: issue.code, message: issue.message }));

  for (const segment of scanned.segments) {
    if (segment.kind === "literal") {
      segments.push(segment);
      continue;
    }
    holeIndex += 1;
    const hole = parsedHoles[holeIndex];

    if (!hole.ast) {
      // Not typed-scalar syntax: keep the separate numeric-expression path.
      const bareDiagnostics = numericExpressionHoleBareReferenceDiagnostics(hole);
      if (bareDiagnostics.length > 0) {
        diagnostics.push(...bareDiagnostics);
        continue;
      }
      segments.push(numericExpressionHoleSegment(hole));
      continue;
    }
    const ast = hole.ast;
    const recordPropertySpanStarts = recordScalarPropertySpanStarts(ast, bindingAnalysis, statementIndex);
    const geometryResolution = resolveGeometryPropertyMetadata(ast, elements, sourceOrderByElementId, {
      currentElement,
      currentSourceOrder: statementIndex,
      skipPropertySpanStarts: recordPropertySpanStarts
    });
    if (geometryResolution.issues.length > 0) {
      diagnostics.push(...geometryResolution.issues.map((issue) => ({
        span: issue.span,
        code: TEXT_TEMPLATE_HOLE_INVALID_CODE,
        message: issue.message
      })));
      continue;
    }
    const hasChoiceGeometryProperty = [...geometryResolution.geometryPropertyReferences.values()]
      .some((reference) => reference?.type.kind === "choice");
    const ownsRecordProperty = recordPropertySpanStarts.size > 0;

    // A syntactically numeric hole with no references, whose every reference
    // resolves to a non-typed catalog kind (iteration), or whose references
    // cannot be resolved at all (no binding catalog present - canResolve is
    // false) stays in the numeric-expression path, exactly like a bare
    // numeric-expression property. A hole with typed-only syntax goes through
    // strict typed-hole handling below even without references. Record dotted
    // fields are also strict typed holes even though they contain no ordinary
    // `reference` AST node before compile-time lowering.
    const isNumericEligible =
      !ownsRecordProperty &&
      !hasChoiceGeometryProperty &&
      !containsNonNumericScalarSyntax(ast) &&
      (hole.references.length === 0 ||
        !canResolve ||
        hole.references.every((_, referenceIndex) => {
          const resolution = resolutionAt(holeIndex, referenceIndex);
          return resolution?.kind === "resolved" && resolution.binding.kind !== "typed";
        }));

    if (isNumericEligible) {
      const bareDiagnostics = numericExpressionHoleBareReferenceDiagnostics(hole);
      if (bareDiagnostics.length > 0) {
        diagnostics.push(...bareDiagnostics);
        continue;
      }
      segments.push(numericExpressionHoleSegment(hole));
      continue;
    }

    // Every `@` reference is a typed binding reference && fails closed when
    // it cannot resolve.
    let hasReferenceDiagnostic = false;
    const referenceResolutions: BindingResolution[] = [];
    hole.references.forEach((reference, referenceIndex) => {
      const resolution = canResolve ? resolutionAt(holeIndex, referenceIndex) : undefined;
      // `resolution.kind !== "resolved"` also catches a
      // "resolved"-but-non-typed reference reaching this strict typed-hole
      // path: isNumericEligible already routes an all-non-typed hole to the
      // numeric-expression path above, so this only fires for a hole mixing
      // a typed reference with a non-typed one - the same
      // TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE fail-closed diagnostic applies.
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push({ span: reference.span, code: TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE, message: unresolvedReferenceMessage(reference.name, resolution) });
        hasReferenceDiagnostic = true;
        return;
      }
      if (resolution.binding.kind !== "typed") {
        diagnostics.push({
          span: reference.span,
          code: TEXT_TEMPLATE_HOLE_UNRESOLVED_CODE,
          message: `"${reference.name}" は型付き宣言ではないため、型付き参照を含むtext埋め込みの中では使用できません。`
        });
        hasReferenceDiagnostic = true;
        return;
      }
      referenceResolutions.push(resolution);
      const entry = bindingAnalysis!.entriesById.get(resolution.binding.id);
      if (entry?.status.kind === "invalid") {
        diagnostics.push({ span: reference.span, code: TEXT_TEMPLATE_HOLE_INVALID_CODE, message: `"${reference.name}" は無効な宣言のため参照できません。` });
        hasReferenceDiagnostic = true;
        return;
      }
      dependencies.push({
        holeSpan: hole.raw.span,
        bindingId: resolution.binding.id,
        name: reference.name,
        span: reference.span,
        ...(elementId !== undefined ? { elementId } : {})
      });
    });
    if (hasReferenceDiagnostic) continue;

    const prepared = bindingAnalysis
      ? prepareRecordScalarExpressionFromCatalog({
          ast,
          statementIndex,
          catalog: bindingAnalysis.catalog,
          referenceResolutions
        })
      : null;
    if (prepared?.issues.length) {
      diagnostics.push(...prepared.issues.map((issue) => ({
        span: issue.span,
        code: TEXT_TEMPLATE_HOLE_INVALID_CODE,
        message: issue.message
      })));
      continue;
    }
    if (prepared) {
      for (const dependency of prepared.dependencies) {
        dependencies.push({
          holeSpan: hole.raw.span,
          bindingId: dependency.bindingId,
          name: dependency.name,
          span: dependency.span,
          ...(elementId !== undefined ? { elementId } : {})
        });
      }
    }

    const checked = typecheckScalarExpression(prepared?.ast ?? ast, {
      expectedType: null,
      references: prepared?.references ?? referenceResolutions,
      geometryPropertyReferences: geometryResolution.geometryPropertyReferences
    });
    if (checked.diagnostics.length > 0) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) => ({ span: diagnostic.span, code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE, message: diagnostic.message })));
      continue;
    }
    const holeSegmentBase = { span: hole.raw.span, contentSpan: hole.raw.contentSpan, cookedInsertOffset: hole.raw.cookedInsertOffset } as const;
    if (checked.type?.kind === "string") {
      segments.push({ kind: "hole", holeKind: "string", ...holeSegmentBase, expression: checked.typed });
    } else if (checked.type?.kind === "number") {
      segments.push({ kind: "hole", holeKind: "number", ...holeSegmentBase, expression: checked.typed });
    } else if (checked.type?.kind === "boolean") {
      segments.push({ kind: "hole", holeKind: "boolean", ...holeSegmentBase, expression: checked.typed });
    } else {
      const actual = checked.type ? describeScalarType(checked.type) : "unresolved";
      diagnostics.push({
        span: hole.raw.contentSpan,
        code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE,
        message: `テキスト埋め込みはstring、number、またはbooleanである必要があります(実際: ${actual})。`
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
  includeStatement?: DslStatementInclusion;
};

export type TextTemplateCompilation = {
  templatesByOccurrenceKey: ReadonlyMap<string, TextTemplateAst>;
  diagnostics: readonly DslDiagnostic[];
};

/** Exact-span-or-nothing - see typedDeclarationAnalysis.ts's
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
    presentation: { key: `diagnostic.${code}` },
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

/**
 * Scans every canonical `label(text: "...")` occurrence in the document -
 * `label` is the sole construction producing `CadElementType "text"`
 * (src/dsl/dslConstructions.ts). Runs whenever this is called at all
 * (callers gate on nui 1, not on typed declarations existing - see
 * dslDocument.ts): a document with zero typed declarations still gets full
 * brace/escape/numeric-vs-typed classification, just with `bindingAnalysis`
 * absent for every occurrence.
 */
export const compileTextTemplates = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans,
  includeStatement
}: CompileTextTemplatesInput): TextTemplateCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const sourceOrderByElementId = new Map<ElementId, number>(
    [...elementIdByStatementIndex].map(([statementIndex, elementId]) => [elementId, statementIndex])
  );
  const diagnostics: DslDiagnostic[] = [];
  const templatesByOccurrenceKey = new Map<string, TextTemplateAst>();

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind !== "element" || statement.type !== "text") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "text");
    if (!attr || attr.value.startsWith("@")) return; // bare @binding text uses the property-binding path.

    const paddedSource = " ".repeat(attr.valueStart) + attr.value;
    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const scopeId = bindingAnalysis
      ? bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId
      : undefined;

    const { template, diagnostics: occurrenceDiagnostics } = analyzeTextTemplate(
      paddedSource,
      span,
      bindingAnalysis,
      scopeId,
      statementIndex,
      elementId,
      elements,
      sourceOrderByElementId
    );
    if (occurrenceDiagnostics.length > 0) {
      diagnostics.push(...occurrenceDiagnostics.map((diagnostic) => diagnosticAt(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message)));
      return;
    }
    if (template) templatesByOccurrenceKey.set(propertyBindingOccurrenceKey(statementIndex, "text"), template);
  });

  return { templatesByOccurrenceKey, diagnostics };
};
