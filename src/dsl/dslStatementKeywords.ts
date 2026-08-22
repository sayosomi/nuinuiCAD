/**
 * Statement-leading spellings accepted by the nui parser.
 *
 * This leaf module is the shared authority for parser dispatch, editor
 * completion, and multiline-continuation containment. Keep the list here
 * rather than duplicating parser keywords in editor/source-map helpers.
 */
export const dslStatementKeywords = {
  stop: "stop",
  version: "nui",
  for: "for",
  place: "place",
  role: "role",
  profile: "profile",
  view: "view",
  activeView: "activeView",
  layout: "layout",
  print: "print",
  svg: "svg",
  conditional: "if",
  constDeclaration: "const",
  letDeclaration: "let",
  setStatement: "set",
  reverseStatement: "reverse",
  edge: "edge",
  extend: "extend",
  move: "move",
  mirrorMove: "mirrorMove",
  point: "point",
  line: "line",
  curve: "curve",
  arc: "arc",
  text: "text",
  image: "image",
  group: "group",
  module: "module",
  modifier: "modifier",
  instance: "instance",
  import: "import",
  export: "export"
} as const;

export const dslStatementKeywordCompletions = Object.values(dslStatementKeywords);

export type DslContinuationSafetyOptions = {
  /**
   * The outer `module M(...)` parameter list permits `name: type = default`.
   * Keep this opt-in so tolerant authoring and ordinary call containment retain
   * the stricter SAY-92 assignment boundary by default.
   */
  allowModuleParameterFragment?: boolean;
};

const moduleParameterFragmentPattern = /^[^\s"'#=()[\]{},;:?]+\??\s*:/;

/**
 * Shared fail-closed check for code encountered while proving that an open
 * call/list continues across a blank-line boundary.
 *
 * Named argument fragments such as `y: 20` are safe. Structural fragments,
 * assignment-like statements, semicolon-separated code, and parser-owned
 * top-level statement starts are containment barriers. The one contextual
 * exception is a module parameter row, where `=` introduces a default value.
 */
export const isUnsafeDslContinuationFragment = (
  fragment: string,
  options: DslContinuationSafetyOptions = {}
) => {
  const trimmed = fragment.trim();
  if (!trimmed) return false;
  if (/[{};]/.test(trimmed)) return true;

  const moduleParameterFragment =
    options.allowModuleParameterFragment === true &&
    moduleParameterFragmentPattern.test(trimmed);

  if (/(^|[^=!<>])=([^=]|$)/.test(trimmed) && !moduleParameterFragment) return true;
  const leadingKeyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed)?.[0];
  return !moduleParameterFragment &&
    leadingKeyword !== undefined &&
    dslStatementKeywordCompletions.some((keyword) => keyword === leadingKeyword);
};

/**
 * A block-opening `{` immediately after a proven closing delimiter belongs to
 * valid headers such as `module M(...) {` / `if (...) {`. Everything else
 * uses the same fail-closed continuation rule.
 */
export const isUnsafeDslPostDelimiterFragment = (fragment: string) => {
  const trimmed = fragment.trim();
  if (!trimmed || trimmed === "{") return false;
  return isUnsafeDslContinuationFragment(fragment);
};
