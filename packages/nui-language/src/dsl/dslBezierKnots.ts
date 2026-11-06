import { matchingDslDelimiter, scanCallArgs, scanDslNesting, type ScannedArg } from "./dslArgScanner";
import { splitDslTopLevelSpans } from "./dslParameterSpanScanner";
import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";

export const bezierKnotFields = ["point", "angle", "incoming", "outgoing"] as const;
export type BezierKnotSyntax = { span: DslSpan; args: readonly ScannedArg[] };
type KnotDiagnostic = { span: DslSpan; code?: string; message: string; presentation?: DslDiagnosticPresentation };

/** Bezier's dedicated array element syntax; values retain the ordinary argument scanner's exact spans. */
export const parseBezierKnots = (source: string, span: DslSpan) => {
  const knots: BezierKnotSyntax[] = [];
  const diagnostics: KnotDiagnostic[] = [];
  const invalid = (range: DslSpan) => diagnostics.push({ span: range, code: "invalid-bezier-knot", message: "intermediates requires [knot(point: @Point, angle: number, incoming: number, outgoing: number), …]. Old colon/semicolon records are not supported." });
  if (source[span.start] !== "[" || source[span.end - 1] !== "]") {
    invalid(span);
    return { knots, diagnostics };
  }
  const entries = splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ",");
  for (const [index, entry] of entries.entries()) {
    if (entry.start === entry.end && index === entries.length - 1) continue;
    const head = /^knot\s*\(/.exec(source.slice(entry.start, entry.end));
    const open = head ? entry.start + head[0].length - 1 : -1;
    if (open < 0 || matchingDslDelimiter(source, open, entry.end) !== entry.end - 1) {
      invalid(entry.start === entry.end ? { start: Math.max(span.start, entry.start - 1), end: entry.start } : entry);
      continue;
    }
    const scanned = scanCallArgs(source, { start: open + 1, end: entry.end - 1 });
    diagnostics.push(...scanned.errors);
    const seen = new Set<string>();
    for (const arg of scanned.args) {
      if (!arg.key || !bezierKnotFields.includes(arg.key as typeof bezierKnotFields[number])) {
        diagnostics.push({ span: arg.keySpan ?? arg.valueSpan, code: "unknown-construction-argument", message: "knot accepts only point, angle, incoming, outgoing named arguments.", presentation: { key: "diagnostic.unknown-construction-argument", parameters: { construction: "knot", argument: arg.key ?? "", candidates: bezierKnotFields.join(", ") } } });
      } else if (seen.has(arg.key)) {
        diagnostics.push({ span: arg.keySpan!, code: "construction-argument-duplicate", message: `knot argument ${arg.key} is duplicated.`, presentation: { key: "diagnostic.construction-argument-duplicate", parameters: { argument: arg.key } } });
      } else seen.add(arg.key);
    }
    for (const field of bezierKnotFields) {
      if (!seen.has(field)) diagnostics.push({ span: { start: entry.start, end: entry.start + 4 }, code: "missing-construction-argument", message: `knot requires ${field}.`, presentation: { key: "diagnostic.missing-construction-argument", parameters: { construction: "knot", argument: field } } });
    }
    knots.push({ span: entry, args: scanned.args });
  }
  return { knots, diagnostics };
};

export const knotSpans = (source: string, span: DslSpan) => parseBezierKnots(source, span).knots.map(knot => knot.span);
export const knotFields = (source: string, span: DslSpan) => {
  const open = source.indexOf("(", span.start);
  if (open < 0 || open >= span.end) return [];
  const { args } = scanCallArgs(source, { start: open + 1, end: span.end - 1 });
  return bezierKnotFields.map(field => args.find(arg => arg.key === field)?.valueSpan);
};
export const knotField = (source: string, span: DslSpan, index: number) => knotFields(source, span)[index] ?? null;

/** Tolerant authoring projection over the same nesting/argument scanner, including empty point values. */
export const bezierKnotAuthoringAt = (source: string, position: number) => {
  const nesting = scanDslNesting(source);
  const opens = [...nesting.matchedDelimiters.map(pair => pair.open), ...nesting.unmatchedOpeners];
  const bezier = opens.find(open => open.delimiter === "(" && /\bbezier\s*$/.test(source.slice(0, open.index)));
  if (!bezier) return null;
  const close = matchingDslDelimiter(source, bezier.index);
  const outer = scanCallArgs(source, { start: bezier.index + 1, end: close < 0 ? source.length : close });
  const array = outer.args.find(arg => arg.key === "intermediates");
  if (!array || source[array.valueSpan.start] !== "[" || position <= array.valueSpan.start || position > array.valueSpan.end) return null;
  const end = source[array.valueSpan.end - 1] === "]" ? array.valueSpan.end - 1 : array.valueSpan.end;
  const entry = splitDslTopLevelSpans(source, { start: array.valueSpan.start + 1, end }, ",").find(span => position >= span.start && position <= span.end);
  if (!entry) {
    // Whitespace between entries is a constructor slot.
    const from = position;
    return { kind: "constructor" as const, from, to: from };
  }
  const head = /^knot\s*\(/.exec(source.slice(entry.start, entry.end));
  if (!head) return /^\w*$/.test(source.slice(entry.start, position)) ? { kind: "constructor" as const, from: entry.start, to: position } : null;
  const open = entry.start + head[0].length - 1;
  const knotClose = matchingDslDelimiter(source, open, entry.end);
  const content = { start: open + 1, end: knotClose < 0 ? entry.end : knotClose };
  if (position < content.start || position > content.end) return null;
  const scanned = scanCallArgs(source, content);
  for (const arg of scanned.args) {
    const span = arg.rawValueSpan ?? arg.valueSpan;
    if (arg.key && position >= span.start && position <= span.end) return { kind: "value" as const, field: arg.key, span: arg.valueSpan, rawSpan: span };
  }
  let from = position;
  while (from > content.start && /[A-Za-z]/.test(source[from - 1]!)) from -= 1;
  const before = source.slice(content.start, from).trimEnd();
  if (before && !before.endsWith(",")) return null;
  return { kind: "field" as const, from, to: position, used: new Set(scanned.args.flatMap(arg => arg.key ? [arg.key] : [])) };
};
