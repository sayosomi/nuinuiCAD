import { elementNameTokensForContext } from "../model/elementNames";
import { isLineLikeElement, isPointElement } from "../model/pointAnchors";
import type { CadElement, ElementId } from "../types/geometry";
import { formatDslReferenceToken } from "./dslReferenceTokens";
import { dslScopeBeforeParsedLine, isElementDslStatement, parseDsl } from "./dslParser";
import type { ParameterValueKind } from "../parameters/parameterDefinitions";
import { dslStatementElementType } from "./dslCompletionMetadata";

export type DslReferenceCompletionOption = {
  label: string;
  detail: string;
};

export type DslLiveStatementIdentity = ReadonlyMap<number, ElementId>;

const referenceKind = (kind: ParameterValueKind) =>
  kind === "reference" || kind === "lineEndpointReference" || kind === "lineReference" || kind === "lineReferenceList";

/**
 * Builds reference options from a newly parsed complete CM buffer. Runtime
 * elements supply only stable identities; live statement names, ordering, and
 * group nesting are reconstructed before each invocation.
 */
export const dslReferenceCompletionOptions = ({
  source,
  cursorLine,
  kind,
  statementElementIds,
  elements
}: {
  source: string;
  cursorLine: number;
  kind: ParameterValueKind;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
}): DslReferenceCompletionOption[] => {
  if (!referenceKind(kind)) return [];
  const parsed = parseDsl(source);
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  const parentGroupId = scopeStatement ? statementElementIds.get(scopeStatement.line) : undefined;
  if (scopeStatement && !parentGroupId) return [];

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const live = parsed.statements.flatMap((statement) => {
    if (statement.line >= cursorLine || !isElementDslStatement(statement)) return [];
    const elementId = statementElementIds.get(statement.line);
    const compiled = elementId ? elementsById.get(elementId) : undefined;
    const type = dslStatementElementType(statement);
    if (!compiled || !type || compiled.type !== type || !statement.name.trim()) return [];
    const enclosing = statement.enclosing ? parsed.statements[statement.enclosing.statementIndex] : null;
    const liveParentGroupId = enclosing ? statementElementIds.get(enclosing.line) : undefined;
    if (enclosing && !liveParentGroupId) return [];
    return [{ ...compiled, name: statement.name, parentGroupId: liveParentGroupId }];
  });
  const tokens = elementNameTokensForContext({
    elements: live,
    currentElement: { parentGroupId }
  });
  const options = new Map<string, DslReferenceCompletionOption>();
  for (const { token, element } of tokens) {
    const name = formatDslReferenceToken(token);
    const add = (label: string, detail: string) => options.set(label, { label, detail });
    if (kind === "reference" && isPointElement(element)) add(name, "point");
    if (kind === "lineReference" || kind === "lineReferenceList") {
      if (isLineLikeElement(element)) add(name, kind === "lineReferenceList" ? "line list" : "line");
    }
    if ((kind === "reference" || kind === "lineEndpointReference") && isLineLikeElement(element)) {
      add(`${name}.start`, "line start");
      add(`${name}.end`, "line end");
    }
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, "ja"));
};
