import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightDslLine } from "../dsl/dslHighlight";
import type { DslHighlightToken } from "../dsl/dslTypes";

type StreamState = { tokens: DslHighlightToken[]; tokenIndex: number };

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
  state.tokens = highlightDslLine(line).filter((token) => token.text.length > 0);
  state.tokenIndex = 0;
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
  startState: () => ({ tokens: [], tokenIndex: 0 }),
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

export const dslCmLanguageExtension = [dslCmLanguage, syntaxHighlighting(defaultHighlightStyle)];
