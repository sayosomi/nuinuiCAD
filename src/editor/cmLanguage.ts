import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightDslLineWithState } from "../dsl/dslHighlight";
import type { DslHighlightToken } from "../dsl/dslTypes";

type StreamState = { tokens: DslHighlightToken[]; tokenIndex: number; inBlockComment: boolean };

const tokenName = {
  attributeKey: "dslAttribute",
  comment: "dslComment",
  elementType: "dslElementType",
  keyword: "dslKeyword",
  number: "dslNumber",
  operator: "dslOperator",
  reference: "dslReference",
  string: "dslString"
} as const;

const resetLine = (state: StreamState, line: string) => {
  const highlighted = highlightDslLineWithState(line, state.inBlockComment);
  state.tokens = highlighted.tokens.filter((token) => token.text.length > 0);
  state.tokenIndex = 0;
  state.inBlockComment = highlighted.endsInBlockComment;
};

const token = (stream: StringStream, state: StreamState) => {
  if (stream.pos === 0) resetLine(state, stream.string);
  const next = state.tokens[state.tokenIndex];
  if (!next) return null;
  state.tokenIndex += 1;
  stream.pos += next.text.length;
  return next.kind === "plain" ? null : tokenName[next.kind];
};

export const dslCmLanguage = StreamLanguage.define<StreamState>({
  startState: () => ({ tokens: [], tokenIndex: 0, inBlockComment: false }),
  token,
  blankLine: (state) => resetLine(state, ""),
  tokenTable: {
    dslAttribute: tags.propertyName,
    dslComment: tags.comment,
    dslElementType: tags.typeName,
    dslKeyword: tags.keyword,
    dslNumber: tags.number,
    dslOperator: tags.operator,
    dslReference: tags.variableName,
    dslString: tags.string
  }
});

const dslHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "#586a63" },
  { tag: tags.comment, color: "#8a8d84", fontStyle: "italic" },
  { tag: tags.typeName, color: "#0f766e", fontWeight: "600" },
  { tag: tags.keyword, color: "#7c5a1f", fontWeight: "600" },
  { tag: tags.number, color: "#9a4f2e" },
  { tag: tags.operator, color: "#5c625b" },
  { tag: tags.variableName, color: "#2e514a" },
  { tag: tags.string, color: "#8b4a5d" }
]);

export const dslCmLanguageExtension = [dslCmLanguage, syntaxHighlighting(dslHighlightStyle)];
