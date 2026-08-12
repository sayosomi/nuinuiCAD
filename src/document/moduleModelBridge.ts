import { argNameForParameter, constructionFor } from "../dsl/dslConstructions";
import type { CompiledDslDocument, DslDocumentData, StatementInfo } from "../dsl/dslDocument";
import type { DslStatement } from "../dsl/dslTypes";
import { coordinateComponent } from "../dsl/dslParameterSpanScanner";
import { formatDslName, quoteDslString } from "../dsl/dslTokens";
import { formatDslReferenceToken } from "../dsl/dslReferenceTokens";
import { getParameterValue } from "../parameters/parameterAccess";
import { findParameterDefinition, getParameterDefinitions, type ParameterValueKind } from "../parameters/parameterDefinitions";
import { sourceOwnerForRuntimeElementId, type SourceOwner } from "../dsl/sourceOwnership";
import { applyLineSplices, buildTextPatch, UnappliedTextPatchError, type LineSplice } from "./textPatch";
import type { CanonicalDocumentValue } from "./canonicalDocument";
import type { CadElement } from "../types/geometry";

export type ModuleModelBridgeResult =
  | { status: "ready"; splices: LineSplice[] }
  | { status: "noop" }
  | { status: "unapplied"; reason: string };

type ChangedElement = { before: CadElement; after: CadElement; owner: SourceOwner };
type CharacterEdit = { from: number; to: number; replacement: string };
type ParameterEditResult =
  | { status: "ready"; edit: CharacterEdit }
  | { status: "unapplied"; reason: string };

const unapplied = (reason: string): ModuleModelBridgeResult => ({ status: "unapplied", reason });
const statementUnapplied = (reason: string): { status: "unapplied"; reason: string } => ({ status: "unapplied", reason });

const sameParameterValue = (left: unknown, right: unknown) =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);

const anchorSourceShape = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || !("mode" in value)) return value;
  const anchor = value as Record<string, unknown>;
  switch (anchor.mode) {
    case "coordinate":
      return { mode: "coordinate" };
    case "reference":
      return { mode: "reference", pointId: anchor.pointId };
    case "derived":
      return { mode: "derived", elementId: anchor.elementId, pointKey: anchor.pointKey };
    case "none":
      return { mode: "none" };
    default:
      return value;
  }
};

const parameterKeysChanged = (before: CadElement, after: CadElement) => {
  const keys = new Set([
    ...getParameterDefinitions(before).map((definition) => definition.key),
    ...getParameterDefinitions(after).map((definition) => definition.key),
  ]);
  const changed = [...keys].filter((key) => !sameParameterValue(getParameterValue(before, key), getParameterValue(after, key)));
  const changedSet = new Set(changed);
  const syntheticCoordinateParents = new Set(
    changed
      .filter((key) => !key.endsWith(":x") && !key.endsWith(":y"))
      .filter((key) => changedSet.has(`${key}:x`) || changedSet.has(`${key}:y`))
      .filter((key) => sameParameterValue(
        anchorSourceShape(getParameterValue(before, key)),
        anchorSourceShape(getParameterValue(after, key))
      ))
  );
  return changed.filter((key) => !syntheticCoordinateParents.has(key));
};

const numericLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const booleanLiteral = /^(?:true|false)$/;
const nameLiteral = /^(?:[A-Za-z_][A-Za-z0-9_]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

const literalForValue = (kind: ParameterValueKind, value: unknown): string | null => {
  switch (kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? `${value}` : null;
    case "boolean":
      return typeof value === "boolean" ? `${value}` : null;
    case "choice":
    case "color":
      return typeof value === "string" ? formatDslName(value) : null;
    case "text":
      return typeof value === "string" ? quoteDslString(value) : null;
    case "reference":
    case "lineEndpointReference":
    case "lineReference":
    case "lineReferenceList":
      return null;
    default:
      return null;
  }
};

const safeLiteralFor = (
  kind: ParameterValueKind,
  value: unknown,
  sourceValue: string
): string | null => {
  const replacement = literalForValue(kind, value);
  if (replacement === null) return null;
  switch (kind) {
    case "number":
      return numericLiteral.test(sourceValue) ? replacement : null;
    case "boolean":
      return booleanLiteral.test(sourceValue) ? replacement : null;
    case "choice":
    case "color":
      return nameLiteral.test(sourceValue) && !sourceValue.includes("@") ? replacement : null;
    case "text":
      return typeof value === "string" && /^(["']).*\1$/.test(sourceValue) && !sourceValue.includes("@")
        ? quoteDslString(value)
        : null;
    case "reference":
    case "lineEndpointReference":
    case "lineReference":
    case "lineReferenceList":
      return null;
    default:
      return null;
  }
};

/** A semantic Module pick carries this canonical token explicitly. Raw
 * materialized IDs are intentionally rejected here so source adoption cannot
 * persist a private/runtime identity by accident. */
const moduleReferenceLiteralFor = (kind: ParameterValueKind, value: unknown): string | null => {
  const qualified = (token: unknown) =>
    typeof token === "string" && !token.startsWith("module-runtime:")
      ? `@${formatDslReferenceToken(token.replace(/^@/, ""))}`
      : null;
  if (kind === "reference" && value && typeof value === "object" && "mode" in value) {
    const anchor = value as { mode?: string; pointId?: unknown; elementId?: unknown; pointKey?: unknown };
    if (anchor.mode === "reference") return qualified(anchor.pointId);
    if (anchor.mode === "derived") {
      const base = qualified(anchor.elementId);
      return base && typeof anchor.pointKey === "string" ? `${base}.${anchor.pointKey}` : null;
    }
    return null;
  }
  if (kind === "lineEndpointReference" && value && typeof value === "object") {
    const endpoint = value as { lineId?: unknown; endpointKey?: unknown };
    const line = qualified(endpoint.lineId);
    return line && typeof endpoint.endpointKey === "string" ? `${line}.${endpoint.endpointKey}` : null;
  }
  if (kind === "lineReference") return qualified(value);
  if (kind === "lineReferenceList" && Array.isArray(value)) {
    const tokens = value.map(qualified);
    return tokens.every((token): token is string => token !== null) ? `[${tokens.join(", ")}]` : null;
  }
  return null;
};

const singlePhysicalSegment = (span: { segments: readonly { from: number; to: number }[] } | null | undefined) =>
  span?.segments.length === 1 ? span.segments[0] : null;

const lineStartOffsets = (sourceLines: readonly string[]) => {
  const starts: number[] = [];
  let offset = 0;
  for (const line of sourceLines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
};

const sourceStatementLines = (sourceLines: readonly string[], info: StatementInfo) =>
  sourceLines.slice(info.line - 1, info.endLine);

const applyCharacterEdits = (
  sourceLines: readonly string[],
  info: StatementInfo,
  edits: readonly CharacterEdit[]
): { status: "ready"; splice: LineSplice } | { status: "unapplied"; reason: string } | { status: "noop" } => {
  if (edits.length === 0) return { status: "noop" };
  const starts = lineStartOffsets(sourceLines);
  const blockStart = starts[info.line - 1];
  const oldLines = sourceStatementLines(sourceLines, info);
  let replacement = oldLines.join("\n");
  const ordered = [...edits].sort((left, right) => right.from - left.from);
  let previousFrom = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    const from = edit.from - blockStart;
    const to = edit.to - blockStart;
    if (from < 0 || to < from || to > replacement.length || to > previousFrom) {
      return { status: "unapplied", reason: "Module call source spanがstatement範囲外です。" };
    }
    replacement = `${replacement.slice(0, from)}${edit.replacement}${replacement.slice(to)}`;
    previousFrom = from;
  }
  if (replacement === oldLines.join("\n")) return { status: "noop" };
  return {
    status: "ready",
    splice: { startLine: info.line, endLine: info.endLine, replacementLines: replacement.split("\n") }
  };
};

const sourceArgumentName = (element: CadElement, parameterKey: string) => {
  if (parameterKey === "activity") return "state";
  const coordinate = parameterKey.match(/^(.+):(x|y)$/);
  return argNameForParameter(element.type, coordinate?.[1] ?? parameterKey);
};

const statementCallClose = (sourceLines: readonly string[], source: DslStatement): number | null => {
  const segments = source.physicalSpan.segments;
  if (segments.length === 0) return null;
  const sourceText = sourceLines.join("\n");
  const from = segments[0].from;
  const to = segments[segments.length - 1].to;
  const close = sourceText.lastIndexOf(")", to);
  return close >= from ? close : null;
};

const statementOpenBrace = (sourceLines: readonly string[], source: DslStatement): number | null => {
  const segments = source.physicalSpan.segments;
  if (segments.length === 0) return null;
  const sourceText = sourceLines.join("\n");
  const from = segments[0].from;
  const to = segments[segments.length - 1].to;
  const open = sourceText.indexOf("{", from);
  return open >= from && open < to ? open : null;
};

const insertArgumentEdit = (
  sourceLines: readonly string[],
  source: DslStatement,
  argumentName: string,
  replacement: string
): ParameterEditResult => {
  const construction = source.kind === "element"
    ? constructionFor(source.category, source.construction)
    : null;
  const supportsPositionalContainer = construction?.category === "if" || construction?.category === "for";
  const hasPositionalPayload = construction?.args.some((argument) => argument.positional) ?? false;
  if (source.kind !== "element" && source.kind !== "group") {
    return { status: "unapplied", reason: `要素 ${source.name || ""} の省略引数 ${argumentName} は安全に追加できません。` };
  }
  if (hasPositionalPayload && !supportsPositionalContainer) {
    return { status: "unapplied", reason: `要素 ${source.name || ""} の省略引数 ${argumentName} は安全に追加できません。` };
  }
  const close = statementCallClose(sourceLines, source);
  if (close !== null) {
    return {
      status: "ready",
      edit: {
        from: close,
        to: close,
        replacement: `${source.attrs.length > 0 ? ", " : ""}${argumentName}: ${replacement}`
      }
    };
  }
  if (source.kind !== "group") {
    return { status: "unapplied", reason: `要素 ${source.name || ""} の引数リスト終端を解決できません。` };
  }
  const open = statementOpenBrace(sourceLines, source);
  if (open === null) {
    return { status: "unapplied", reason: `要素 ${source.name || ""} のgroup argument insertion位置を解決できません。` };
  }
  return {
    status: "ready",
    edit: {
      from: open,
      to: open,
      replacement: `(${argumentName}: ${replacement}) `
    }
  };
};

const parameterEditFor = (
  sourceLines: readonly string[],
  source: DslStatement,
  after: CadElement,
  parameterKey: string
): ParameterEditResult => {
  const argumentName = sourceArgumentName(after, parameterKey);
  if (!argumentName) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${parameterKey} はsourceへ安全に戻せません。` };
  }
  const attribute = source.attrs.find((candidate) => candidate.key === argumentName);
  const physical = attribute?.physicalSpan;
  const segment = singlePhysicalSegment(physical);

  if (parameterKey === "activity") {
    if (!attribute || !physical || !segment || physical.sourceRevision !== source.sourceRevision) {
      return insertArgumentEdit(sourceLines, source, argumentName, after.activity);
    }
    if (!/^(?:visible|hidden|disabled)$/.test(attribute.value)) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} のstateはsource-owned expressionです。` };
    }
    return { status: "ready", edit: { from: segment.from, to: segment.to, replacement: after.activity } };
  }

  const coordinate = parameterKey.match(/^(.+):(x|y)$/);
  if (coordinate) {
    if (!attribute || !physical || !segment || physical.sourceRevision !== source.sourceRevision) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${argumentName} source spanを解決できません。` };
    }
    const coordinateSpan = coordinateComponent(attribute.value, { start: 0, end: attribute.value.length }, coordinate[2] as "x" | "y");
    if (!coordinateSpan) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} のgeometry referenceをsourceへ逆変換しません。` };
    }
    const value = getParameterValue(after, parameterKey);
    const replacement = safeLiteralFor("number", value, attribute.value.slice(coordinateSpan.start, coordinateSpan.end));
    if (replacement === null) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${parameterKey} はliteral source valueではありません。` };
    }
    return {
      status: "ready",
      edit: {
        from: segment.from + coordinateSpan.start,
        to: segment.from + coordinateSpan.end,
        replacement
      }
    };
  }

  const definition = parameterKey === "activity"
    ? { kind: "boolean" as const }
    : findParameterDefinition(after, parameterKey);
  if (!definition) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${parameterKey} source parameter定義を解決できません。` };
  }
  const value = getParameterValue(after, parameterKey);
  const moduleReference = moduleReferenceLiteralFor(definition.kind, value);
  if (moduleReference !== null) {
    if (!attribute || !physical || !segment || physical.sourceRevision !== source.sourceRevision) {
      return insertArgumentEdit(sourceLines, source, argumentName, moduleReference);
    }
    return { status: "ready", edit: { from: segment.from, to: segment.to, replacement: moduleReference } };
  }
  if (!attribute || !physical || !segment || physical.sourceRevision !== source.sourceRevision) {
    const replacement = literalForValue(definition.kind, value);
    if (replacement === null) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${parameterKey} は省略引数として安全に追加できません。` };
    }
    return insertArgumentEdit(sourceLines, source, argumentName, replacement);
  }
  const replacement = safeLiteralFor(definition.kind, value, attribute.value);
  if (replacement === null) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} の ${parameterKey} はgeometry referenceまたはsource-owned expressionです。` };
  }
  return { status: "ready", edit: { from: segment.from, to: segment.to, replacement } };
};

const serializeOwnedElement = (
  compiled: CompiledDslDocument,
  owner: SourceOwner,
  before: CadElement,
  after: CadElement
): { status: "ready"; splice: LineSplice } | { status: "unapplied"; reason: string } | { status: "noop" } => {
  const source = compiled.statements[owner.sourceStatementIndex];
  if (!source || (source.kind !== "element" && source.kind !== "group")) {
    return { status: "unapplied", reason: `要素 ${after.id} のsource ownerがgeometry statementではありません。` };
  }
  if (before.type !== after.type || before.name !== after.name || before.parentGroupId !== after.parentGroupId ||
      before.conditionalBranch !== after.conditionalBranch) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} の構造変更はModule source bridgeで扱えません。` };
  }

  const rawChangedKeys = parameterKeysChanged(before, after);
  // A coordinate anchor exposes synthetic `:x`/`:y` inspector parameters.
  // When a pick adopts a canonical Module reference, the anchor root changes
  // from coordinate to reference and only that root source span is authored;
  // attempting to patch the now-nonexistent coordinate children would reject
  // the otherwise valid semantic reference adoption.
  const changedKeys = rawChangedKeys.filter((key) => {
    const coordinate = key.match(/^(.+):(x|y)$/);
    if (!coordinate || !rawChangedKeys.includes(coordinate[1])) return true;
    const nextAnchor = getParameterValue(after, coordinate[1]);
    return !nextAnchor || typeof nextAnchor !== "object" || !("mode" in nextAnchor) ||
      (nextAnchor as { mode?: unknown }).mode === "coordinate";
  });
  if (before.activity !== after.activity) changedKeys.push("activity");
  if (changedKeys.length === 0) {
    if (!sameParameterValue(before, after)) {
      return { status: "unapplied", reason: `要素 ${after.name || after.id} の未対応model差分をsourceへ適用できません。` };
    }
    return { status: "noop" };
  }

  const edits: CharacterEdit[] = [];
  for (const parameterKey of changedKeys) {
    const result = parameterEditFor(compiled.sourceLines, source, after, parameterKey);
    if (result.status === "unapplied") return result;
    edits.push(result.edit);
  }
  const close = statementCallClose(compiled.sourceLines, source);
  const insertionAnchor = close ?? (source.kind === "group" ? statementOpenBrace(compiled.sourceLines, source) : null);
  const insertions = insertionAnchor === null
    ? []
    : edits.filter((edit) => edit.from === insertionAnchor && edit.to === insertionAnchor);
  if (insertionAnchor !== null && insertions.length > 1) {
    const insertionText = close !== null
      ? insertions
        .map((edit) => source.attrs.length > 0 ? edit.replacement.replace(/^,\s*/, "") : edit.replacement)
        .join(", ")
      : insertions
        .map((edit) => edit.replacement.replace(/^\(|\)\s*$/g, ""))
        .join(", ");
    const nonInsertions = edits.filter((edit) => edit.from !== insertionAnchor || edit.to !== insertionAnchor);
    edits.splice(0, edits.length, ...nonInsertions, {
      from: insertionAnchor,
      to: insertionAnchor,
      replacement: close !== null
        ? `${source.attrs.length > 0 ? ", " : ""}${insertionText}`
        : `(${insertionText}) `
    });
  }
  const patched = applyCharacterEdits(compiled.sourceLines, owner.statement, edits);
  return patched;
};

const moduleInstanceActivitySplice = (
  compiled: CompiledDslDocument,
  owner: SourceOwner,
  before: CadElement,
  after: CadElement
) => {
  if (owner.kind !== "moduleInstance" || before.activity === after.activity) return { status: "noop" as const };
  const source = compiled.statements[owner.sourceStatementIndex];
  if (!source || source.kind !== "moduleInstance") return statementUnapplied("module instanceのcall statementが見つかりません。");
  const option = source.options.find((candidate) => candidate.name === "state");
  const nextActivity = after.activity;
  if (option) {
    const value = singlePhysicalSegment(option.valuePhysicalSpan);
    if (!value) return statementUnapplied("module instance stateのsource spanを解決できません。");
    if (nextActivity !== "visible") {
      return applyCharacterEdits(compiled.sourceLines, owner.statement, [{ from: value.from, to: value.to, replacement: nextActivity }]);
    }
    const options = singlePhysicalSegment(source.payloadPhysicalSpans?.options);
    if (!options) return statementUnapplied("module instance option listのsource spanを解決できません。");
    const sourceText = compiled.sourceLines.join("\n");
    const open = options.from > 0 && sourceText[options.from - 1] === "(" ? options.from - 1 : -1;
    const close = sourceText[options.to] === ")" ? options.to + 1 : -1;
    if (open < 0 || close < 0) return statementUnapplied("module instance option listの括弧を解決できません。");
    return applyCharacterEdits(compiled.sourceLines, owner.statement, [{ from: open, to: close, replacement: "" }]);
  }
  if (nextActivity === "visible") return { status: "noop" as const };
  const name = singlePhysicalSegment(source.namePhysicalSpan);
  if (!name) return statementUnapplied("module instance nameのsource spanを解決できません。");
  return applyCharacterEdits(compiled.sourceLines, owner.statement, [{
    from: name.to,
    to: name.to,
    replacement: `(state: ${nextActivity})`
  }]);
};

const sameElementIdSequence = (before: readonly CadElement[], after: readonly CadElement[]) =>
  before.length === after.length && before.every((element, index) => element.id === after[index]?.id);

/**
 * Build a source-only patch for a Module document. Runtime materialized
 * elements are never passed to the normal element serializer; only their
 * resolved source owner is patched, once per authored statement.
 */
export const buildModuleModelPatch = (
  current: CanonicalDocumentValue,
  afterDocument: DslDocumentData
): ModuleModelBridgeResult => {
  const compiled = current.doc;
  if (!compiled.moduleMaterialization) return { status: "unapplied", reason: "Module materializationがありません。" };
  if (compiled.document.evaluationLimitIndex !== afterDocument.evaluationLimitIndex) {
    return unapplied("Module文書の@stop境界変更はsource-owned mutationとして扱えません。");
  }
  if (!sameElementIdSequence(compiled.document.elements, afterDocument.elements)) {
    return unapplied("Module文書の要素追加・削除・並べ替えはsource mutationとして表現できません。");
  }

  const oldById = new Map(compiled.document.elements.map((element) => [element.id, element]));
  const changed: ChangedElement[] = [];
  for (const after of afterDocument.elements) {
    const before = oldById.get(after.id);
    if (!before || before === after) continue;
    const owner = sourceOwnerForRuntimeElementId(compiled, after.id);
    if (!owner) return unapplied(`要素 ${after.name || after.id} のsource ownerを解決できません。`);
    changed.push({ before, after, owner });
  }

  const splices: LineSplice[] = [];
  const elementBySourceStatementId = new Map<string, ChangedElement>();
  for (const entry of changed) {
    if (entry.owner.kind === "moduleInstance") {
      const result = moduleInstanceActivitySplice(compiled, entry.owner, entry.before, entry.after);
      if (result.status === "unapplied") return result;
      if (result.status === "ready") splices.push(result.splice);
      continue;
    }
    const existing = elementBySourceStatementId.get(entry.owner.sourceStatementId);
    if (existing && existing.after !== entry.after) {
      const first = serializeOwnedElement(compiled, existing.owner, existing.before, existing.after);
      const second = serializeOwnedElement(compiled, entry.owner, entry.before, entry.after);
      if (first.status === "unapplied" || second.status === "unapplied") return unapplied("同一definition source ownerへのruntime変更が競合しています。");
      if (first.status === "ready" && second.status === "ready" &&
          JSON.stringify(first.splice.replacementLines) !== JSON.stringify(second.splice.replacementLines)) {
        return unapplied("同一definition source ownerへのruntime変更が競合しています。");
      }
      continue;
    }
    elementBySourceStatementId.set(entry.owner.sourceStatementId, entry);
  }
  for (const entry of elementBySourceStatementId.values()) {
    const result = serializeOwnedElement(compiled, entry.owner, entry.before, entry.after);
    if (result.status === "unapplied") return result;
    if (result.status === "ready") splices.push(result.splice);
  }

  const sourceElements = afterDocument.elements.filter((element) => {
    const owner = sourceOwnerForRuntimeElementId(compiled, element.id);
    return owner?.kind === "ordinary";
  });
  try {
    splices.push(...buildTextPatch({
      old: compiled,
      newDocument: { ...afterDocument, elements: sourceElements },
      skipElements: true
    }));
  } catch (error) {
    if (error instanceof UnappliedTextPatchError) return unapplied(error.message);
    return unapplied(error instanceof Error ? error.message : String(error));
  }

  splices.sort((left, right) => left.startLine - right.startLine);
  for (let index = 1; index < splices.length; index += 1) {
    if (splices[index - 1].endLine >= splices[index].startLine) {
      return unapplied("Module source patchのstatement範囲が重複しています。");
    }
  }
  if (splices.length === 0) return { status: "noop" };
  // Validate the combined old-coordinate patch before canonicalDocument
  // recompiles it. This also rejects malformed source span edits without any
  // mutation or runtime serialization fallback.
  applyLineSplices(current.sourceText, splices);
  return { status: "ready", splices };
};
