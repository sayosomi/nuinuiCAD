import { scanCallArgs, scanDslNesting } from "./dslArgScanner";
import { parseNameWithModifiers, type DslCallDiagnostic } from "./dslCallParser";
import { parseDslSourceReference } from "./dslReferenceTokens";
import type { DslAttribute, DslExtractPart, DslSpan, DslStatementBase } from "./dslTypes";

const trim = (source: string, start: number, end: number): DslSpan => {
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  return { start, end };
};

/** The extract grammar extends the shared declaration-head and argument
 * scanners. Interval punctuation is confined to the authored parts list. */
export const parseDslExtract = (source: string, declaration: "extract" | "transformCopy" = "extract") => {
  const copy = declaration === "transformCopy";
  const requiredArgs = [copy ? "startPoint" : "source", "parts"];
  const allowedArgs = [...requiredArgs, "enabled", "visible", ...copy ? ["endPoint", "scale", "angleDeg", "mirrorX"] : []];
  const diagnostics: DslCallDiagnostic[] = [];
  const report = (code: string, span: DslSpan, message: string) => diagnostics.push({ code, span, message });
  const outer = scanDslNesting(source);
  const call = outer.matchedDelimiters.find(pair => pair.open.delimiter === "(" && outer.topLevelPositions.has(pair.open.index));
  const open = call?.open.index ?? outer.unmatchedOpeners.find(item => item.delimiter === "(")?.index ?? source.length;
  const close = call?.close.index ?? source.length;
  const head = parseNameWithModifiers(source, trim(source, declaration.length, open), diagnostics, true);
  if (!head.name || !head.nameSpan) report("extract-missing-name", { start: 0, end: open }, `${declaration} には名前が必要です。`);
  if (!call) report("unclosed-call", { start: open, end: source.length }, `${declaration} の引数を閉じてください。`);
  if (call && source.slice(close + 1).trim()) report("extract-unexpected-trailing-source", { start: close + 1, end: source.length }, `${declaration} の後に不正な構文があります。`);
  const scanned = scanCallArgs(source, { start: Math.min(open + 1, source.length), end: close });
  diagnostics.push(...scanned.errors);
  const seen = new Set<string>();
  const attrs: DslAttribute[] = [];
  for (const arg of scanned.args) {
    if (!arg.key || !allowedArgs.includes(arg.key)) {
      report("extract-unknown-argument", arg.keySpan ?? arg.valueSpan, `${declaration} の引数は ${allowedArgs.join(" / ")} です。`);
      continue;
    }
    if (seen.has(arg.key)) report("extract-duplicate-argument", arg.keySpan!, `${declaration} の引数が重複しています。`);
    seen.add(arg.key);
    attrs.push({ key: arg.key, value: arg.value, keyStart: arg.keySpan!.start, valueStart: arg.valueSpan.start, valueEnd: arg.valueSpan.end, ...(arg.rawValueSpan ? { rawValueSpan: arg.rawValueSpan } : {}) });
  }
  const payloadSpans = Object.fromEntries(attrs.map(a => [a.key, { start: a.valueStart, end: a.valueEnd }]));
  for (const key of requiredArgs) if (!seen.has(key)) report("extract-missing-argument", { start: open, end: close }, `${declaration} には ${key} が必要です。`);
  const partsSpan = payloadSpans.parts;
  const parts: DslExtractPart[] = [];
  if (partsSpan) {
    if (source[partsSpan.start] !== "[" || source[partsSpan.end - 1] !== "]") {
      report("extract-parts-list-required", partsSpan, "parts は名前付き区間のリストで指定してください。");
    }
    const content = { start: partsSpan.start + 1, end: source[partsSpan.end - 1] === "]" ? partsSpan.end - 1 : partsSpan.end };
    const nesting = scanDslNesting(source, content);
    const limits = [content.start - 1, ...nesting.topLevelCommas, content.end];
    const names = new Set<string>();
    for (let i = 1; i < limits.length; i++) {
      const span = trim(source, limits[i - 1] + 1, limits[i]);
      if (span.start === span.end) continue;
      const positions = [...scanDslNesting(source, span).topLevelPositions];
      const colon = positions.find(n => source[n] === ":") ?? -1;
      if (colon < 0) { report("extract-part-colon-required", span, "part 名の後に : が必要です。"); continue; }
      const partHead = parseNameWithModifiers(source, trim(source, span.start, colon), diagnostics, true);
      if (!partHead.name) report("extract-part-name-required", { start: span.start, end: colon }, "part 名が必要です。");
      if (names.has(partHead.name)) report("extract-duplicate-part", partHead.nameSpan ?? span, "同じ extract 内の part 名が重複しています。");
      names.add(partHead.name);
      const colonSpan = { start: colon, end: colon + 1 };
      if (copy) {
        const sourceSpan = trim(source, colon + 1, span.end);
        parts.push({ ...partHead, colonSpan, kind: "source", sourceSpan, source: source.slice(sourceSpan.start, sourceSpan.end) });
        continue;
      }
      const separators = positions.filter(n => n > colon && source.slice(n, n + 2) === "..");
      if (separators.length !== 1) { report("extract-interval-required", { start: colon + 1, end: span.end }, "区間は left..right で指定してください。"); continue; }
      const separator = separators[0];
      const leftSpan = trim(source, colon + 1, separator), rightSpan = trim(source, separator + 2, span.end);
      const left = source.slice(leftSpan.start, leftSpan.end), right = source.slice(rightSpan.start, rightSpan.end);
      for (const [value, boundSpan] of [[left, leftSpan], [right, rightSpan]] as const) {
        if (value !== "start" && value !== "end" && parseDslSourceReference(value).kind !== "valid") report("extract-point-boundary-required", boundSpan, "境界は start / end または明示的な点参照で指定してください。");
      }
      parts.push({ ...partHead, kind: "interval", colonSpan, left, leftSpan, right, rightSpan, intervalSpan: { start: separator, end: separator + 2 } });
    }
    if (!parts.length) report("extract-parts-empty", partsSpan, "extract には少なくとも1つの区間が必要です。");
  }
  return { ...head, parts, attrs, payloadSpans, keywordSpan: { start: 0, end: declaration.length }, opensBlock: false, diagnostics };
};

/** Member declarations enter the ordinary parser/semantic statement sequence;
 * the head remains a source-only namespace, never a runtime group. */
export const extractMemberStatements = (head: Extract<import("./dslTypes").DslStatement, { kind: "extract" }>, declarationIndex: number) =>
  head.parts.map((part, partIndex): Extract<import("./dslTypes").DslStatement, { kind: "element" }> => {
    const attr = (key: string, value: string, span: DslSpan): DslAttribute =>
      ({ key, value, keyStart: span.start, valueStart: span.start, valueEnd: span.end });
    const shared = head.attrs.filter(a => a.key !== "parts");
    const inputs = part.kind === "source"
      ? [attr("source", part.source, part.sourceSpan)]
      : [attr("left", part.left, part.leftSpan), attr("right", part.right, part.rightSpan)];
    const attrs = [...shared, ...inputs];
    const base: DslStatementBase = {
      ...head, name: part.name, nameSpan: part.nameSpan, opensBlock: false,
      modifierNames: [...head.modifierNames ?? [], ...part.modifierNames],
      modifierNameSpans: [...head.modifierNameSpans ?? [], ...part.modifierNameSpans],
      attrs,
      payloadSpans: Object.fromEntries(attrs.map(a => [a.key, { start: a.valueStart, end: a.valueEnd }])),
      enclosing: { statementIndex: declarationIndex, branch: "then" }
    };
    const layerReference = part.layerReference ?? head.layerReference;
    return { ...base, kind: "element", type: "materializedPath", category: "path", construction: "from", exported: false,
      ...(layerReference !== undefined ? { layerReference, layerReferenceSpan: part.layerReferenceSpan ?? head.layerReferenceSpan } : {}),
      extractPart: { declarationIndex, partIndex, declaration: head.declaration } };
  });
