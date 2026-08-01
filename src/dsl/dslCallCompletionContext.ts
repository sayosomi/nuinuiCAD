import { scanCallArgs } from "./dslArgScanner";
import {
  constructionCandidatesFor,
  constructionFor,
  type DslConstructionCategory,
  type DslConstructionSpec
} from "./dslConstructions";

export type DslCallCompletionContext =
  | { kind: "construction"; from: number; to: number; category: DslConstructionCategory }
  | { kind: "argument"; from: number; to: number; spec: DslConstructionSpec; usedArgumentNames: ReadonlySet<string> }
  | null;

const identifierStart = /[A-Za-z_]/;
const identifierPart = /[A-Za-z0-9_-]/;
const categories = new Set<DslConstructionCategory>([
  "point", "line", "curve", "arc", "text", "image", "var", "group", "if", "for"
]);
const containerCategories = new Set<DslConstructionCategory>(["group", "if", "for"]);

const isEscaped = (source: string, index: number) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
};

const topLevelIndex = (source: string, target: string, from = 0) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === target && depth === 0) {
      return index;
    }
  }
  return -1;
};

const topLevelOpenParen = (source: string, from = 0) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) quote = character;
    else if (character === "(" && depth === 0) return index;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
  }
  return -1;
};

const matchingParen = (source: string, open: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
};

const nestedDepthAt = (source: string, from: number, pos: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < pos; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && !isEscaped(source, index)) quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
  }
  return quote ? 1 : depth;
};

const trimStart = (source: string, from: number, to = source.length) => {
  while (from < to && /\s/.test(source[from])) from += 1;
  return from;
};

const tokenStartAt = (source: string, pos: number, floor: number) => {
  let start = pos;
  while (start > floor && identifierPart.test(source[start - 1])) start -= 1;
  return start;
};

const categoryAt = (source: string): DslConstructionCategory | null => {
  const match = source.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  return match && categories.has(match[0] as DslConstructionCategory) ? match[0] as DslConstructionCategory : null;
};

const argumentContextAt = (
  source: string,
  pos: number,
  spec: DslConstructionSpec,
  open: number,
  close: number
): DslCallCompletionContext => {
  const content = { start: open + 1, end: close };
  if (pos < content.start || pos > content.end || nestedDepthAt(source, content.start, pos) !== 0) return null;
  const { args } = scanCallArgs(source, content);
  const from = tokenStartAt(source, pos, content.start);
  const prefix = source.slice(from, pos);
  if (prefix && (!identifierStart.test(prefix[0]) || ![...prefix].every((character) => identifierPart.test(character)))) return null;
  const previous = from > content.start ? source[from - 1] : "";
  if (previous && !/\s/.test(previous)) return null;
  const beforePrefix = source.slice(content.start, from).trimEnd();
  const previousTokenCharacter = beforePrefix.at(-1) ?? "";
  const isArgumentDraft =
    !previousTokenCharacter ||
    (!"+-*/=:([,".includes(previousTokenCharacter) && !/\s/.test(previousTokenCharacter));
  // An empty value's trimmed valueSpan always collapses toward the far edge
  // of its raw gap (see trimSpan in dslArgScanner.ts), which can land past
  // `pos` once the gap is wider than one separating space - e.g. right after
  // deleting a value that had its own leading+trailing space. Fall back to
  // the untrimmed rawValueSpan (set only for empty values) so the cursor is
  // still recognized as sitting inside that argument's own value, not at a
  // fresh attribute-key slot.
  if (args.some((arg) => {
    const span = arg.valueSpan.start === arg.valueSpan.end && arg.rawValueSpan ? arg.rawValueSpan : arg.valueSpan;
    return pos >= span.start && pos <= span.end;
  }) && !isArgumentDraft) return null;
  if (spec.args.some((arg) => arg.positional) && !args.some((arg) => arg.key === null)) return null;
  // `for (i ` is still the positional-variable entry flow. The argument
  // scanner cannot split `i fr` until `fr:` is complete, so only surface a
  // named-key menu once the user starts that next token; an empty separator
  // must not make the menu race the positional input.
  if (spec.category === "for" && !args.some((arg) => arg.key !== null) && !prefix) return null;
  return {
    kind: "argument",
    from,
    to: pos,
    spec,
    usedArgumentNames: new Set(args.flatMap((arg) => arg.key ? [arg.key] : []))
  };
};

const constructionContextAt = (
  source: string,
  pos: number,
  category: DslConstructionCategory,
  equals: number
): DslCallCompletionContext => {
  const from = trimStart(source, equals + 1);
  if (pos < from) return null;
  const prefix = source.slice(from, pos);
  if (!prefix && category === "var") return null;
  if (prefix && (!identifierStart.test(prefix[0]) || ![...prefix].every((character) => identifierPart.test(character)))) return null;
  const candidates = constructionCandidatesFor(category).filter((spec) => spec.construction.startsWith(prefix));
  return candidates.length > 0 ? { kind: "construction", from, to: pos, category } : null;
};

/**
 * Tolerantly identifies only a call's construction slot or its depth-one
 * argument-key slot. This intentionally runs before a complete parse exists,
 * so partial vertical statements keep completing without a parallel grammar.
 */
export const dslCallCompletionContextAt = (source: string, pos: number): DslCallCompletionContext => {
  const category = categoryAt(source);
  if (!category) return null;

  if (containerCategories.has(category)) {
    const open = topLevelOpenParen(source);
    if (open < 0) return null;
    const close = matchingParen(source, open);
    const spec = constructionFor(category, "");
    return spec ? argumentContextAt(source, pos, spec, open, close >= 0 ? close : source.length) : null;
  }

  const equals = topLevelIndex(source, "=");
  if (equals < 0) return null;
  const open = topLevelOpenParen(source, equals + 1);
  if (open < 0 || pos <= open) return constructionContextAt(source, pos, category, equals);
  const construction = source.slice(trimStart(source, equals + 1), open).trim();
  const spec = constructionFor(category, construction);
  if (!spec) return null;
  const close = matchingParen(source, open);
  return argumentContextAt(source, pos, spec, open, close >= 0 ? close : source.length);
};
