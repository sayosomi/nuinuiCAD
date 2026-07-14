import { dslStatementKeywordCompletions } from "./dslParser";
import { dslLineElementStatement, dslLineLabeledValueSpans } from "./dslValueSpans";
import { splitDslComment, splitDslTerms } from "./dslTokens";
import { dslCompletionMetadataForType, dslStatementElementType, type DslCompletionParameter } from "./dslCompletionMetadata";

export type DslCompletionContext =
  | { kind: "keyword"; from: number; to: number; options: readonly string[] }
  | { kind: "attribute"; from: number; to: number; elementType: NonNullable<ReturnType<typeof dslStatementElementType>> }
  | { kind: "parameter"; from: number; to: number; parameter: DslCompletionParameter }
  | null;

const termAt = (line: string, pos: number) =>
  splitDslTerms(line).find((term) => pos >= term.start && pos <= term.end) ?? null;

const lineHeadContext = (code: string, pos: number): DslCompletionContext | null => {
  const terms = splitDslTerms(code);
  if (terms.length === 0) return { kind: "keyword", from: pos, to: pos, options: dslStatementKeywordCompletions };
  const first = terms[0];
  if (terms.length === 1 && pos >= first.start && pos <= first.end) {
    return { kind: "keyword", from: first.start, to: pos, options: dslStatementKeywordCompletions };
  }
  return null;
};

/**
 * Resolves only from a freshly reparsed live line. Erroring lines deliberately
 * receive at most line-head keyword completion; no partial DSL parser exists
 * alongside the document parser.
 */
export const dslCompletionContextAt = (lineText: string, pos: number): DslCompletionContext => {
  const { code, comment } = splitDslComment(lineText);
  if (comment && pos >= code.length) return null;
  const head = lineHeadContext(code, pos);
  if (head) return head;

  const statement = dslLineElementStatement(lineText);
  const elementType = statement ? dslStatementElementType(statement) : null;
  if (!statement || !elementType) return null;
  const metadata = dslCompletionMetadataForType(elementType);
  const span = dslLineLabeledValueSpans(lineText).find((item) => pos >= item.start && pos <= item.end);
  if (span) {
    const parameters = metadata.parameters.filter((parameter) => parameter.source === span.source && parameter.key === span.key);
    if (parameters.length === 1) return { kind: "parameter", from: span.start, to: pos, parameter: parameters[0] };
    return null;
  }

  const term = termAt(code, pos);
  const lastValueEnd = Math.max(statement.keywordSpan.end, ...dslLineLabeledValueSpans(lineText).map((item) => item.end));
  if (term && !term.text.includes("=") && term.start >= lastValueEnd) {
    return { kind: "attribute", from: term.start, to: pos, elementType };
  }
  if (!term && pos >= lastValueEnd) return { kind: "attribute", from: pos, to: pos, elementType };
  return null;
};
