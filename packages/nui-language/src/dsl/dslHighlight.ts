import { constructionCandidatesFor, isGeometryDeclarationCategory } from "./dslConstructions";
import { dslStatementKeywords } from "./dslParser";
import type { DslHighlightLine, DslHighlightToken, DslTokenKind } from "./dslTypes";
import { scanDslSource, type DslLexedLine } from "./dslTokens";

// v2: category/construction キーワードは registry(dslParser.ts の
// dslStatementKeywords、dslConstructions.ts の constructionCandidatesFor)を
// 唯一の正として import する。本格的な磨き込み(補完の新コンテキスト等)はF2。
const keywords = new Set<string>(Object.values(dslStatementKeywords));

const stopKeywords = new Set(["stop"]);

// Task 51: `@name` && the pre-migration bare `Element.property` collapse
// into one `@?name(.property)?` shape here (matching
// expressionReferenceToken.ts's disambiguation-by-dot), so `@AB.length` now
// highlights as a single reference token instead of an unmatched `@AB`
// followed by a separate `.length` (this file's ASCII-only identifier
// limitation is unchanged either way - not fixed, not worsened).
const tokenPattern =
  /("[^"]*(?:"|$)|'[^']*(?:'|$)|[A-Za-z_][\w:-]*(?=\??:\s)|-?\d+(?:\.\d+)?|==|!=|>=|<=|[-={}()[\],;*/^%+?]|@?[A-Za-z_][\w:-]*(?:\.[A-Za-z_][\w:-]*)?)/g;

const classify = (text: string): DslTokenKind => {
  if (text.startsWith("\"") || text.startsWith("'")) return "string";
  if (stopKeywords.has(text)) return "keyword";
  if (/^[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^[A-Za-z_][\w:-]*\.[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^@[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^@[A-Za-z_][\w:-]*\.[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^-?\d+(\.\d+)?$/.test(text)) return "number";
  if (/^[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  return "operator";
};

const headKeywordSpan = (code: string) => {
  const match = code.match(/^\s*([A-Za-z_][\w:-]*)\b/);
  if (!match || !keywords.has(match[1]) && !stopKeywords.has(match[1])) return null;
  const start = (match.index ?? 0) + match[0].indexOf(match[1]);
  return { start, end: start + match[1].length };
};

const constructionSpan = (code: string, head: { start: number; end: number } | null) => {
  if (!head) return null;
  const category = code.slice(head.start, head.end);
  if (!isGeometryDeclarationCategory(category)) return null;
  const match = code.slice(head.end).match(/=\s*([A-Za-z_][\w-]*)/);
  if (!match) return null;
  const construction = match[1];
  if (!constructionCandidatesFor(category).some((spec) => spec.construction === construction)) return null;
  const start = head.end + (match.index ?? 0) + match[0].lastIndexOf(construction);
  return { start, end: start + construction.length };
};

const pushText = (tokens: DslHighlightToken[], kind: DslTokenKind, text: string) => {
  if (!text) return;
  const last = tokens.at(-1);
  if (last?.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
};

const highlightDslCode = (code: string): DslHighlightToken[] => {
  const tokens: DslHighlightToken[] = [];
  const head = headKeywordSpan(code);
  const construction = constructionSpan(code, head);
  let cursor = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const text = match[0];
    const start = match.index ?? cursor;
    pushText(tokens, "plain", code.slice(cursor, start));
    const kind =
      /^[A-Za-z_][\w:-]*$/.test(text) && (code[start + text.length] === ":" || (code[start + text.length] === "?" && code[start + text.length + 1] === ":")) && code[start + text.length + (code[start + text.length] === "?" ? 2 : 1)] === " "
        ? "attributeKey"
        : head && start === head.start && start + text.length === head.end
          ? "keyword"
          : construction && start === construction.start && start + text.length === construction.end
            ? "elementType"
            : text === "else" && /^\s*}\s*$/.test(code.slice(0, start))
              ? "keyword"
              : classify(text);
    pushText(tokens, kind, text);
    cursor = start + text.length;
  }
  pushText(tokens, "plain", code.slice(cursor));
  return tokens.length > 0 ? tokens : [{ kind: "plain", text: "" }];
};

const highlightDslLexedLine = (line: DslLexedLine): DslHighlightToken[] => {
  const tokens: DslHighlightToken[] = [];
  const events = [
    ...line.codeSegments.map((segment) => ({ start: segment.start, kind: "code" as const, segment })),
    ...line.comments.map((comment) => ({ start: comment.start, kind: "comment" as const, comment }))
  ].sort((left, right) => left.start - right.start);
  for (const event of events) {
    if (event.kind === "code") {
      for (const token of highlightDslCode(event.segment.text)) pushText(tokens, token.kind, token.text);
    } else {
      pushText(tokens, "comment", event.comment.text);
    }
  }
  return tokens.length > 0 ? tokens : [{ kind: "plain", text: "" }];
};

export const highlightDslLineWithState = (
  line: string,
  startsInBlockComment = false
): { tokens: DslHighlightToken[]; endsInBlockComment: boolean } => {
  const lexedLine = scanDslSource(line, { startsInBlockComment }).lines[0]!;
  return {
    tokens: highlightDslLexedLine(lexedLine),
    endsInBlockComment: lexedLine.endsInBlockComment
  };
};

export const highlightDslLine = (line: string): DslHighlightToken[] =>
  highlightDslLineWithState(line).tokens;

export const highlightDslSource = (source: string): DslHighlightLine[] => {
  const lexed = scanDslSource(source);
  return lexed.lines.map((line, index) => ({
    lineNumber: index + 1,
    tokens: highlightDslLexedLine(line)
  }));
};
