// Parses the canonical `label(text: ...)` raw string value into a
// TextTemplateAst that evaluation, dependency analysis, completion, and source
// span consumers can all use without re-parsing, re-resolving, || re-scanning
// raw source.

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
import type { ScalarExpressionAst, ScalarSpan } from "./expressionAst";
import type { TypedScalarExpression } from "./typedExpressionAst";
import { scanTextTemplateLiteral, type TextTemplateRawHoleSegment, type TextTemplateRawLiteralSegment } from "./textTemplateScan";
import { barePropertyReferenceIssues } from "../dsl/expressionReferenceToken";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";

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

export type TextTemplateDependency = {
  readonly holeSpan: ScalarSpan;
  readonly bindingId: BindingId;
  readonly name: string;
  readonly span: ScalarSpan;
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

const hasRecordScalarProperty = (
  ast: ScalarExpressionAst,
  bindingAnalysis: BindingAnalysis | undefined,
  statementIndex: number
): boolean => {
  if (!bindingAnalysis?.catalog.sourceNamespaceBindingResolver) return false;
  const catalog = bindingAnalysis.catalog;
  const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;
  let found = false;
  const visit = (node: ScalarExpressionAst): void => {
    if (found) return;
    switch (node.kind) {
      case "geometryProperty": {
        const lookup = catalog.sourceNamespaceBindingResolver?.(`${node.elementName}.${node.property}`, statementIndex, scopeId);
        found = lookup?.kind === "resolved" || (lookup?.kind === "blocked" && lookup.declarationKind === "recordValue");
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

export const analyzeTextTemplate = (
  source: string,
  valueSpan: ScalarSpan,
  bindingAnalysis: BindingAnalysis | undefined,
  scopeId: string | undefined,
  statementIndex: number,
  elementId: ElementId | undefined
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
          site: { scopeId: scopeId!, statementIndex }
        });
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

  const numericExpressionHoleSegment = (hole: ParsedHole): TextTemplateNumericExpressionHoleSegment => ({
    kind: "hole",
    holeKind: "numeric",
    span: hole.raw.span,
    contentSpan: hole.raw.contentSpan,
    cookedInsertOffset: hole.raw.cookedInsertOffset,
    raw: source.slice(hole.raw.contentSpan.start, hole.raw.contentSpan.end)
  });

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
      const bareDiagnostics = numericExpressionHoleBareReferenceDiagnostics(hole);
      if (bareDiagnostics.length > 0) {
        diagnostics.push(...bareDiagnostics);
        continue;
      }
      segments.push(numericExpressionHoleSegment(hole));
      continue;
    }
    const ast = hole.ast;
    const ownsRecordProperty = hasRecordScalarProperty(ast, bindingAnalysis, statementIndex);

    const isNumericEligible =
      !ownsRecordProperty &&
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

    let hasReferenceDiagnostic = false;
    const referenceResolutions: BindingResolution[] = [];
    hole.references.forEach((reference, referenceIndex) => {
      const resolution = canResolve ? resolutionAt(holeIndex, referenceIndex) : undefined;
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
      references: prepared?.references ?? referenceResolutions
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

export const compileTextTemplates = ({
  statements,
  elementIdByStatementIndex,
  elements,
  bindingAnalysis,
  spans,
  includeStatement
}: CompileTextTemplatesInput): TextTemplateCompilation => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const diagnostics: DslDiagnostic[] = [];
  const templatesByOccurrenceKey = new Map<string, TextTemplateAst>();

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind !== "element" || statement.type !== "text") return;
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId || !elementsById.has(elementId)) return;

    const attr = statement.attrs.find((item) => item.key === "text");
    if (!attr || attr.value.startsWith("@")) return;

    const paddedSource = " ".repeat(attr.valueStart) + attr.value;
    const span: DslSpan = { start: attr.valueStart, end: attr.valueEnd };
    const scopeId = bindingAnalysis
      ? bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId
      : undefined;

    const { template, diagnostics: occurrenceDiagnostics } = analyzeTextTemplate(paddedSource, span, bindingAnalysis, scopeId, statementIndex, elementId);
    if (occurrenceDiagnostics.length > 0) {
      diagnostics.push(...occurrenceDiagnostics.map((diagnostic) => diagnosticAt(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message)));
      return;
    }
    if (template) templatesByOccurrenceKey.set(propertyBindingOccurrenceKey(statementIndex, "text"), template);
  });

  return { templatesByOccurrenceKey, diagnostics };
};
