import { evaluateElements } from "../geometry/evaluate";
import { resolveElementNamePath } from "../model/elementNames";
import { pickCandidates } from "../model/pickCandidates";
import type { PickRef } from "../model/pickReferences";
import { rankedReferenceSuggestions, referenceSuggestions } from "../model/referenceSuggestions";
import type {
  CadElement,
  ComputedGeometry,
  DependencyError,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { dslScopeBeforeParsedLine, isElementDslStatement, parseDsl } from "./dslParser";
import type { ParseDslResult } from "./dslTypes";
import type { ParameterValueKind } from "../parameters/parameterDefinitions";
import { argNameForParameter } from "./dslConstructions";
import { dslStatementElementType } from "./dslCompletionMetadata";
import { splitDslTopLevelSpans } from "./dslParameterSpanScanner";
import { parseDslReferenceToken } from "./dslReferenceTokens";

export type DslReferenceCompletionOption = {
  label: string;
  displayLabel: string;
  detail: string;
  pickRef: PickRef;
};

export type DslLiveStatementIdentity = ReadonlyMap<number, ElementId>;

const referenceKind = (kind: ParameterValueKind) =>
  kind === "reference" || kind === "lineEndpointReference" || kind === "lineReference" || kind === "lineReferenceList";

/**
 * Reconstructs live CadElement-shaped objects (stable id/other fields from the
 * last compiled document, but name/parentGroupId taken from the freshly
 * reparsed live text) for every element statement strictly before
 * `cutoffLine`. A statement is excluded entirely (not included with stale
 * data) whenever its live type no longer matches the compiled element's type,
 * its name is empty, or its live enclosing group has no live identity yet -
 * callers must never fall back to compiled data for a statement that fails
 * this check. Shared by dslReferenceCompletionOptions (cutoffLine = cursorLine,
 * unchanged behavior) and the element-parameter completion candidates
 * (cutoffLine additionally clamped to the first `@stop` line).
 */
export const liveElementsBeforeLine = (
  parsed: ParseDslResult,
  cutoffLine: number,
  statementElementIds: DslLiveStatementIdentity,
  elements: readonly CadElement[]
): CadElement[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  return parsed.statements.flatMap((statement) => {
    if (statement.endLine >= cutoffLine || !isElementDslStatement(statement)) return [];
    const elementId = statementElementIds.get(statement.line);
    const compiled = elementId ? elementsById.get(elementId) : undefined;
    const type = dslStatementElementType(statement);
    if (!compiled || !type || compiled.type !== type || !statement.name.trim()) return [];
    const enclosing = statement.enclosing ? parsed.statements[statement.enclosing.statementIndex] : null;
    const liveParentGroupId = enclosing ? statementElementIds.get(enclosing.line) : undefined;
    if (enclosing && !liveParentGroupId) return [];
    return [{ ...compiled, name: statement.name, parentGroupId: liveParentGroupId }];
  });
};

/**
 * Builds reference options from a newly parsed complete CM buffer. Runtime
 * elements supply only stable identities; live statement names, ordering, and
 * group nesting are reconstructed before each invocation.
 */
export const dslReferenceCompletionOptions = ({
  source,
  cursorLine,
  kind,
  parameterKey,
  query,
  replacementFrom,
  statementElementIds,
  elements,
  computedGeometry,
  forGroupGeneratedRows,
  effectiveEnabledElementIds,
  errors
}: {
  source: string;
  cursorLine: number;
  kind: ParameterValueKind;
  parameterKey?: string;
  query?: string;
  replacementFrom?: number;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
  computedGeometry?: Map<ElementId, ComputedGeometry>;
  forGroupGeneratedRows?: EvaluationResult["forGroupGeneratedRows"];
  effectiveEnabledElementIds?: Set<ElementId>;
  errors?: DependencyError[];
}): DslReferenceCompletionOption[] => {
  if (!referenceKind(kind)) return [];
  const parsed = parseDsl(source);
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  const parentGroupId = scopeStatement ? statementElementIds.get(scopeStatement.line) : undefined;
  if (scopeStatement && !parentGroupId) return [];

  const live = liveElementsBeforeLine(parsed, cursorLine, statementElementIds, elements);
  const fallbackEvaluation = computedGeometry ? null : evaluateElements([...elements]);
  const evaluation = {
    computedGeometry: computedGeometry ?? fallbackEvaluation!.computedGeometry,
    forGroupGeneratedRows: forGroupGeneratedRows ?? fallbackEvaluation?.forGroupGeneratedRows,
    computedVariables: new Map(),
    effectiveEnabledElementIds: effectiveEnabledElementIds ?? fallbackEvaluation?.effectiveEnabledElementIds,
    errors: errors ?? fallbackEvaluation?.errors ?? [],
    warnings: []
  };
  const targetElementId = statementElementIds.get(cursorLine) ?? "__dsl-reference-completion__";
  const candidates = pickCandidates([...elements], evaluation, {
    activePointPickTarget: kind === "reference" || kind === "lineEndpointReference"
      ? {
          elementId: targetElementId,
          parameterKey: parameterKey ?? "__reference__",
          insertionIndex: live.length
        }
      : null,
    activeLinePickTarget: kind === "lineReference" || kind === "lineReferenceList"
      ? {
          elementId: targetElementId,
          parameterKey: parameterKey ?? "__line__",
          insertionIndex: live.length,
          ...(kind === "lineReferenceList" ? { draftLineIds: [] } : {})
        }
      : null,
    activeNumericReferencePickTarget: null,
    referenceElements: live
  });
  const suggestions = referenceSuggestions({
    candidates,
    elements: live,
    currentElement: { parentGroupId }
  });
  const selectedOtherLineIds = (() => {
    if (kind !== "lineReferenceList" || replacementFrom === undefined || !parameterKey) return new Set<ElementId>();
    const cursorElementType = elements.find((element) => element.id === targetElementId)?.type ?? null;
    const argName = (cursorElementType && argNameForParameter(cursorElementType, parameterKey)) ?? parameterKey;
    // A lineReferenceList arg such as `sources: [...]` can sit on its own
    // continuation line of a multi-line vertical call in v2, so it cannot be
    // reparsed as a standalone one-line statement the way dslLineLabeledValueSpans
    // requires. Resolve its physical span from the full-document parse instead.
    const statement = parsed.statements.find(
      (item) => isElementDslStatement(item) && cursorLine >= item.line && cursorLine <= item.endLine
    );
    const attr = statement?.attrs.find((item) => item.key === argName);
    const segments = attr?.physicalSpan?.segments;
    const lines = source.split("\n");
    const lineText = lines[cursorLine - 1] ?? "";
    let lineStart = 0;
    for (let index = 0; index < cursorLine - 1; index += 1) lineStart += lines[index].length + 1;
    const segment = segments?.length === 1 ? segments[0] : null;
    const span = segment ? { start: segment.from - lineStart, end: segment.to - lineStart } : null;
    if (!span || span.start < 0 || span.end > lineText.length || lineText[span.start] !== "[" || lineText[span.end - 1] !== "]") return new Set<ElementId>();
    const ids = new Set<ElementId>();
    for (const item of splitDslTopLevelSpans(
      lineText,
      { start: span.start + 1, end: span.end - 1 },
      ","
    )) {
      if (item.start === replacementFrom) continue;
      const parsedToken = parseDslReferenceToken(lineText.slice(item.start, item.end));
      const resolution = resolveElementNamePath({
        path: { absolute: parsedToken.absolute, parts: parsedToken.segments },
        elements: live,
        currentElement: { parentGroupId }
      });
      if (resolution.status === "resolved") ids.add(resolution.element.id);
    }
    return ids;
  })();
  const selectableSuggestions = suggestions.filter((suggestion) =>
    suggestion.pickRef.kind !== "line" || !selectedOtherLineIds.has(suggestion.referenceElementId)
  );
  const ranked = query === undefined
    ? selectableSuggestions
    : rankedReferenceSuggestions(selectableSuggestions, query, 8);
  return ranked.map((suggestion) => ({
    label: suggestion.canonicalToken,
    displayLabel: suggestion.displayLabel,
    detail: suggestion.detail,
    pickRef: suggestion.pickRef
  }));
};
