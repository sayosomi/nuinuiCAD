import { DSL_INDENT } from "../dsl/dslTokens";
import { documentDslRefs } from "../dsl/dslSerializer";
import { serializeElementStatementBlock, type SerializedStatement } from "../dsl/dslSerializeElement";
import type { CompiledDslDocument, DslDocumentData, StatementInfo } from "../dsl/dslDocument";
import type { DslStatement } from "../dsl/dslTypes";
import {
  sourceOwnerForRuntimeElementId,
  type SourceOwner
} from "../dsl/sourceOwnership";
import { applyLineSplices, buildTextPatch, UnappliedTextPatchError, type LineSplice } from "./textPatch";
import { mergeStatementComments } from "./statementCommentMerge";
import type { CanonicalDocumentValue } from "./canonicalDocument";
import type { CadElement } from "../types/geometry";

export type ModuleModelBridgeResult =
  | { status: "ready"; splices: LineSplice[] }
  | { status: "noop" }
  | { status: "unapplied"; reason: string };

type ChangedElement = { before: CadElement; after: CadElement; owner: SourceOwner };
type CharacterEdit = { from: number; to: number; replacement: string };

const unapplied = (reason: string): ModuleModelBridgeResult => ({ status: "unapplied", reason });
const statementUnapplied = (reason: string): { status: "unapplied"; reason: string } => ({ status: "unapplied", reason });

const hasKeyForStatement = (map: ReadonlyMap<string, unknown> | undefined, statementIndex: number) => {
  const prefix = `${statementIndex}:`;
  return [...(map?.keys() ?? [])].some((key) => key.startsWith(prefix));
};

/** Source-owned scalar expressions have no reverse runtime serializer. */
const hasSourceOwnedScalarValue = (compiled: CompiledDslDocument, statementIndex: number) =>
  hasKeyForStatement(compiled.propertyBindings, statementIndex) ||
  hasKeyForStatement(compiled.numericBindings, statementIndex) ||
  hasKeyForStatement(compiled.conditionalGroupConditions, statementIndex) ||
  hasKeyForStatement(compiled.textTemplates, statementIndex);

const lineStartOffsets = (sourceLines: readonly string[]) => {
  const starts: number[] = [];
  let offset = 0;
  for (const line of sourceLines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
};

const oldArgLineByKeyFor = (
  statement: DslStatement,
  sourceLines: readonly string[],
  firstLine: number
): Map<string, number> => {
  const starts = lineStartOffsets(sourceLines);
  const map = new Map<string, number>();
  for (const attr of statement.attrs) {
    const offset = attr.physicalSpan?.segments[0]?.from;
    if (offset === undefined) continue;
    let line = 1;
    for (let index = 0; index < starts.length; index += 1) {
      if (starts[index] > offset) break;
      line = index + 1;
    }
    map.set(attr.key, line - firstLine);
  }
  return map;
};

const sourceStatementLines = (
  sourceLines: readonly string[],
  info: StatementInfo
) => sourceLines.slice(info.line - 1, info.endLine);

const withStatementIndent = (statement: SerializedStatement, info: StatementInfo, source: DslStatement) => {
  let next = statement;
  if (source.kind === "element" && source.exported) {
    next = { ...next, header: `export ${next.header}` };
  }
  if (source.opensBlock && next.close === null && info.openBraceLine === undefined) {
    next = { ...next, header: `${next.header} {` };
  }
  return next;
};

const serializeOwnedElement = (
  compiled: CompiledDslDocument,
  owner: SourceOwner,
  before: CadElement,
  after: CadElement,
  elements: readonly CadElement[]
): { status: "ready"; splice: LineSplice } | { status: "unapplied"; reason: string } | { status: "noop" } => {
  const source = compiled.statements[owner.sourceStatementIndex];
  if (!source || (source.kind !== "element" && source.kind !== "group")) {
    return { status: "unapplied", reason: `要素 ${after.id} のsource ownerがgeometry statementではありません。` };
  }
  if (before.type !== after.type || before.name !== after.name || before.parentGroupId !== after.parentGroupId ||
      before.conditionalBranch !== after.conditionalBranch) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} の構造変更はModule source bridgeで扱えません。` };
  }
  if (hasSourceOwnedScalarValue(compiled, owner.sourceStatementIndex)) {
    return { status: "unapplied", reason: `要素 ${after.name || after.id} はsource-owned scalarを持つためmodel mutationを適用できません。` };
  }

  const info = owner.statement;
  const refs = documentDslRefs([...elements], compiled.majorVersion ?? 3);
  const serialized = withStatementIndent(serializeElementStatementBlock(after, refs), info, source);
  const indent = DSL_INDENT.repeat(info.indentDepth);
  const nextLines = serialized.close === null
    ? [`${indent}${serialized.header}`]
    : serialized.close === ")"
      ? [
          `${indent}${serialized.header}`,
          ...serialized.args.map((arg, index) =>
            `${indent}${DSL_INDENT}${arg.text}${serialized.argumentSeparator === "comma" && index < serialized.args.length - 1 ? "," : ""}`
          ),
          `${indent}${serialized.close}`
        ]
      : [];
  if (nextLines.length === 0) return { status: "unapplied", reason: `要素 ${after.name || after.id} をserializeできません。` };

  const oldLines = sourceStatementLines(compiled.sourceLines, info);
  const oldArgLineByKey = oldArgLineByKeyFor(source, compiled.sourceLines, info.line);
  const mergedLines = mergeStatementComments({ oldLines, oldArgLineByKey, next: serialized, indent });
  if (mergedLines.length === oldLines.length && mergedLines.every((line, index) => line === oldLines[index])) {
    return { status: "noop" };
  }
  return {
    status: "ready",
    splice: { startLine: info.line, endLine: info.endLine, replacementLines: mergedLines }
  };
};

const singleSegment = (span: { segments: readonly { from: number; to: number }[] } | null | undefined) =>
  span?.segments.length === 1 ? span.segments[0] : null;

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
    const value = singleSegment(option.valuePhysicalSpan);
    if (!value) return statementUnapplied("module instance stateのsource spanを解決できません。");
    if (nextActivity !== "visible") {
      return applyCharacterEdits(compiled.sourceLines, owner.statement, [{ from: value.from, to: value.to, replacement: nextActivity }]);
    }
    const options = singleSegment(source.payloadPhysicalSpans?.options);
    if (!options) return statementUnapplied("module instance option listのsource spanを解決できません。");
    const sourceText = compiled.sourceLines.join("\n");
    const open = options.from > 0 && sourceText[options.from - 1] === "(" ? options.from - 1 : -1;
    const close = sourceText[options.to] === ")" ? options.to + 1 : -1;
    if (open < 0 || close < 0) return statementUnapplied("module instance option listの括弧を解決できません。");
    return applyCharacterEdits(compiled.sourceLines, owner.statement, [{ from: open, to: close, replacement: "" }]);
  }
  if (nextActivity === "visible") return { status: "noop" as const };
  const name = singleSegment(source.namePhysicalSpan);
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
      const first = serializeOwnedElement(compiled, existing.owner, existing.before, existing.after, afterDocument.elements);
      const second = serializeOwnedElement(compiled, entry.owner, entry.before, entry.after, afterDocument.elements);
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
    const result = serializeOwnedElement(compiled, entry.owner, entry.before, entry.after, afterDocument.elements);
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
