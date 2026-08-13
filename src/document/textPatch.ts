import {
  layoutElementTree,
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  planPrintLayoutSection,
  serializePaletteColorLine,
  serializePaletteLines,
  withFallbackParentArgs,
  type CompiledDslDocument,
  type DslDocumentData,
  type DslMajorVersion,
  type ElementTreeRow,
  type StatementInfo
} from "../dsl/dslDocument";
import { isElementDslStatement } from "../dsl/dslParser";
import { commonArgSpecs, constructionForElementType } from "../dsl/dslConstructions";
import {
  documentDslRefs,
  serializeActiveViewLine,
  serializeRoleLine,
  serializeViewLine,
  type DslSerializerRefs
} from "../dsl/dslSerializer";
import { serializeElementStatementBlock, serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import type { DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, splitDslComment } from "../dsl/dslTokens";
import { mergeStatementComments } from "./statementCommentMerge";
import type { CadElement, ElementId } from "../types/geometry";
import { getParameterValue } from "../parameters/parameterAccess";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";

// textPatch — モデル差分を「行スプライス」列に変換するパッチ生成器
// (docs/overhaul/plan.md / Phase 1a)。
//
// 設計原則:
// * パッチはスプライスのみ。対象外の行(コメント・空行・無変更の文)は
//   バイト単位で不変。
// * 変更検出は「旧テキストの字面」ではなく「旧文書と新文書のシリアライズ結果の
//   比較」で行う。手書きの非正準な字面は、その文自体が変わらない限り保存される。
// * 要素セクションは layoutElementTree(シリアライザと同一の構造計算)を
//   鏡写しにするため、パッチ結果は常に全体シリアライズと構造的に一致する
//   (非連続親子の parent= フォールバック含む)。
// * 全体再シリアライズのフォールバックは存在しない。表現できない差分は
//   このモジュールの設計バグとして throw する。

export type LineSplice = {
  /** 1-based・両端含む・旧テキスト座標。endLine === startLine - 1 は「startLineの直前へ挿入」。 */
  startLine: number;
  endLine: number;
  replacementLines: string[];
};

export type ElementChange =
  | { kind: "update"; id: ElementId }
  | { kind: "insert"; id: ElementId }
  | { kind: "delete"; id: ElementId; membersKept: boolean }
  | { kind: "move"; id: ElementId };

export type DocumentDiff = {
  elements: ElementChange[];
  palette: boolean;
  visibility: boolean;
  printLayoutIds: { changed: string[]; removed: string[]; added: string[] };
  activePrintLayout: boolean;
  evaluationLimit: boolean;
};

export type TextPatchInput = {
  /** 直前コンパイル結果。document / statementMap が非null であること。 */
  old: CompiledDslDocument;
  newDocument: DslDocumentData;
  /** Module source bridges patch authored element statements separately. */
  skipElements?: boolean;
};

/** A structural patch must never guess where a continuation/comment belongs. */
export class UnappliedTextPatchError extends Error {}

// blockEnd/blockElse/atStop の構造行は必ず単一物理行(layoutElementTreeの
// 構築が保証)。statement行(要素文)は縦型callで複数物理行になり得るため、
// この関数は使わず serializeElementStatementBlock + mergeStatementComments で
// 直接組み立てる(patchElements 内)。
const soleCanonicalLine = (row: ElementTreeRow, elementId: ElementId | undefined): string => {
  if (row.lines.length !== 1) {
    throw new UnappliedTextPatchError(
      `要素 ${elementId ?? "?"} の構造行が複数物理行になっています(想定外)。`
    );
  }
  return row.lines[0];
};

// 文字オフセット(文書全体基準)→ 1-based行番号。
const lineNumberAtOffset = (sourceLines: readonly string[], offset: number): number => {
  let cursor = 0;
  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineLength = sourceLines[index].length;
    if (offset <= cursor + lineLength) return index + 1;
    cursor += lineLength + 1;
  }
  return sourceLines.length;
};

// mergeStatementComments が要求する oldArgLineByKey: 引数キー→ oldLines
// (info.line起点のローカル配列)内の0-based行index。旧statementの各attrの
// 物理span(decorateStatementが既に付与済み)から直接導出する — レンダリング
// 済みテキストは経由しない。
const oldArgLineByKeyFor = (
  oldStatement: DslStatement,
  sourceLines: readonly string[],
  firstLine: number
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const attr of oldStatement.attrs) {
    const offset = attr.physicalSpan?.segments[0]?.from;
    if (offset === undefined) continue;
    map.set(attr.key, lineNumberAtOffset(sourceLines, offset) - firstLine);
  }
  return map;
};

const CONTAINER_TYPES = new Set(["group", "conditionalGroup", "forGroup"]);
const isContainer = (element: CadElement) => CONTAINER_TYPES.has(element.type);

const normalizedBranch = (element: CadElement, byId: Map<ElementId, CadElement>) => {
  const parent = element.parentGroupId ? byId.get(element.parentGroupId) : undefined;
  if (!parent || parent.type !== "conditionalGroup") return undefined;
  return element.conditionalBranch === "else" ? "else" : "then";
};

// 値列の最長増加部分列(strictly increasing)。返り値は残す添字の集合。決定論的。
const longestIncreasingIndexes = (values: readonly number[]): Set<number> => {
  const tails: number[] = [];
  const tailIndexes: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
    previous[index] = low > 0 ? tailIndexes[low - 1] : -1;
    tailIndexes[low] = index;
  });
  const kept = new Set<number>();
  let cursor = tails.length > 0 ? tailIndexes[tails.length - 1] : -1;
  while (cursor >= 0) {
    kept.add(cursor);
    cursor = previous[cursor];
  }
  return kept;
};

// ==== diffDocuments(要素・非要素差分の要約。Phase 1b のログ/assert 用) ====

// 全要素の(id, name, parentGroupId)三つ組が新旧で完全一致するか。一致する場合、
// 文書全体の名前解決結果(namespace所属・曖昧性判定・修飾名)は新旧で不変になる
// (documentDslRefsのtoken()はtargetのname/祖先chainのparentGroupIdのみに依存し、
// 配列順序には依存しない)。これが成り立つとき、オブジェクト同一(=自身のどの
// フィールドも変わっていない)要素の描画テキストは、他要素の改名・移動による
// 参照トークンの変化を含めて絶対に変わらないことが保証できる。挿入・削除・
// 改名・親付け替えのいずれかがあれば必ずfalseになり、下の呼び出し元は
// 各要素毎の全量serialize比較(従来どおりの正確な判定)にフォールバックする。
const namesAndParentsUnchanged = (oldDoc: DslDocumentData, newDoc: DslDocumentData): boolean => {
  if (oldDoc.elements.length !== newDoc.elements.length) return false;
  const oldById = new Map(oldDoc.elements.map((element) => [element.id, element]));
  for (const element of newDoc.elements) {
    const oldElement = oldById.get(element.id);
    if (!oldElement) return false;
    if (oldElement.name !== element.name || oldElement.parentGroupId !== element.parentGroupId) return false;
  }
  return true;
};

const elementUpdateSet = (
  oldDoc: DslDocumentData,
  newDoc: DslDocumentData,
  majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION,
  precomputedRefsNew?: DslSerializerRefs
): Set<ElementId> => {
  const oldById = new Map(oldDoc.elements.map((element) => [element.id, element]));
  const updates = new Set<ElementId>();

  if (namesAndParentsUnchanged(oldDoc, newDoc)) {
    // 高速経路: 名前解決グラフが不変なので、オブジェクト同一の要素は
    // serializeせずスキップできる(証明は上記コメント参照)。identityが
    // 変わった要素は無条件でupdate扱い(従来と同じ、serialize不要)。
    for (const element of newDoc.elements) {
      const oldElement = oldById.get(element.id);
      if (oldElement && oldElement !== element) updates.add(element.id);
    }
    return updates;
  }

  const refsOld = documentDslRefs(oldDoc.elements, majorVersion);
  const refsNew = precomputedRefsNew ?? documentDslRefs(newDoc.elements, majorVersion);
  for (const element of newDoc.elements) {
    const oldElement = oldById.get(element.id);
    if (!oldElement) continue;
    if (
      oldElement !== element ||
      serializeElementStatementLogical(oldElement, refsOld) !== serializeElementStatementLogical(element, refsNew)
    ) {
      updates.add(element.id);
    }
  }
  return updates;
};

// テスト専用: 高速経路を使わない従来の全量serialize比較(挙動の基準として
// textPatch.test.tsの差分テストから直接呼ばれる)。elementUpdateSetの
// 高速経路と結果が常に一致することの検証にのみ使う。
export const elementUpdateSetFullComparisonForTesting = (
  oldDoc: DslDocumentData,
  newDoc: DslDocumentData,
  majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION
): Set<ElementId> => {
  const refsOld = documentDslRefs(oldDoc.elements, majorVersion);
  const refsNew = documentDslRefs(newDoc.elements, majorVersion);
  const oldById = new Map(oldDoc.elements.map((element) => [element.id, element]));
  const updates = new Set<ElementId>();
  for (const element of newDoc.elements) {
    const oldElement = oldById.get(element.id);
    if (!oldElement) continue;
    if (
      oldElement !== element ||
      serializeElementStatementLogical(oldElement, refsOld) !== serializeElementStatementLogical(element, refsNew)
    ) {
      updates.add(element.id);
    }
  }
  return updates;
};

export const elementUpdateSetForTesting = elementUpdateSet;

export const diffDocuments = (oldDoc: DslDocumentData, newDoc: DslDocumentData): DocumentDiff => {
  const oldById = new Map(oldDoc.elements.map((element) => [element.id, element]));
  const newById = new Map(newDoc.elements.map((element) => [element.id, element]));
  const elements: ElementChange[] = [];

  for (const element of oldDoc.elements) {
    if (newById.has(element.id)) continue;
    const membersKept = oldDoc.elements.some(
      (child) => child.parentGroupId === element.id && newById.has(child.id)
    );
    elements.push({ kind: "delete", id: element.id, membersKept });
  }

  // 保持要素の相対順序: 旧順の位置列を新順で並べ、そのLIS外は「移動」。
  const keptNewOrder = newDoc.elements.filter((element) => oldById.has(element.id));
  const oldPositions = new Map(oldDoc.elements.map((element, index) => [element.id, index]));
  const keptLis = longestIncreasingIndexes(keptNewOrder.map((element) => oldPositions.get(element.id)!));
  const updates = elementUpdateSet(oldDoc, newDoc);

  keptNewOrder.forEach((element, index) => {
    const oldElement = oldById.get(element.id)!;
    const moved =
      !keptLis.has(index) ||
      oldElement.parentGroupId !== element.parentGroupId ||
      normalizedBranch(oldElement, oldById) !== normalizedBranch(element, newById);
    if (moved) {
      elements.push({ kind: "move", id: element.id });
    } else if (updates.has(element.id)) {
      elements.push({ kind: "update", id: element.id });
    }
  });

  for (const element of newDoc.elements) {
    if (!oldById.has(element.id)) elements.push({ kind: "insert", id: element.id });
  }

  const oldPlan = planPrintLayoutSection(oldDoc);
  const newPlan = planPrintLayoutSection(newDoc);
  const oldBlockById = new Map(oldPlan.blocks.map((block) => [block.layoutId, block]));
  const newBlockById = new Map(newPlan.blocks.map((block) => [block.layoutId, block]));
  const printLayoutIds = {
    changed: newPlan.blocks
      .filter((block) => {
        const oldBlock = oldBlockById.get(block.layoutId);
        return oldBlock !== undefined && oldBlock.lines.join("\n") !== block.lines.join("\n");
      })
      .map((block) => block.layoutId),
    removed: oldPlan.blocks
      .filter((block) => !newBlockById.has(block.layoutId))
      .map((block) => block.layoutId),
    added: newPlan.blocks
      .filter((block) => !oldBlockById.has(block.layoutId))
      .map((block) => block.layoutId)
  };

  return {
    elements,
    palette: serializePaletteLines(oldDoc.palette).join("\n") !== serializePaletteLines(newDoc.palette).join("\n"),
    visibility:
      [
        ...oldDoc.visibilityRoles.map(serializeRoleLine),
        ...oldDoc.visibilityProfiles.map((profile) => serializeViewLine(profile, oldDoc.visibilityRoles)),
        serializeActiveViewLine(oldDoc.activeVisibilityProfileId)
      ].join("\n") !==
      [
        ...newDoc.visibilityRoles.map(serializeRoleLine),
        ...newDoc.visibilityProfiles.map((profile) => serializeViewLine(profile, newDoc.visibilityRoles)),
        serializeActiveViewLine(newDoc.activeVisibilityProfileId)
      ].join("\n"),
    printLayoutIds,
    activePrintLayout: oldPlan.activePrintLayoutLine !== newPlan.activePrintLayoutLine,
    evaluationLimit: oldDoc.evaluationLimitIndex !== newDoc.evaluationLimitIndex
  };
};

// ==== 行オペレーション収集 ====

type PatchOps = {
  /** 旧行番号 → 置換(文字列)or 削除(null)。 */
  lineOps: Map<number, string | null>;
  /** 「この旧行の直前」への挿入行(呼び出し順に連結)。キーは 1..lastLine+1。 */
  insertsBefore: Map<number, string[]>;
};

const setLineOp = (ops: PatchOps, line: number, op: string | null) => {
  ops.lineOps.set(line, op);
};

const insertBefore = (ops: PatchOps, line: number, lines: string[]) => {
  if (lines.length === 0) return;
  ops.insertsBefore.set(line, [...(ops.insertsBefore.get(line) ?? []), ...lines]);
};

const sameModelValue = (left: unknown, right: unknown) =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);

const changedParameterKeysForSource = (before: CadElement, after: CadElement): string[] => {
  const keys = new Set([
    ...getParameterDefinitions(before).map((definition) => definition.key),
    ...getParameterDefinitions(after).map((definition) => definition.key)
  ]);
  return [...keys].filter((key) => !sameModelValue(getParameterValue(before, key), getParameterValue(after, key)));
};

const sourceNamesAndParentsUnchanged = (before: readonly CadElement[], after: readonly CadElement[]) => {
  if (before.length !== after.length) return false;
  const beforeById = new Map(before.map((element) => [element.id, element]));
  return after.every((element) => {
    const previous = beforeById.get(element.id);
    return previous?.name === element.name && previous?.parentGroupId === element.parentGroupId;
  });
};

/**
 * Preserve authored scalar/reference text when a model edit changes another
 * field on the same statement. The model intentionally stores evaluated
 * values for some legacy scalar fields, so ordinary serialization cannot
 * reconstruct a compound source expression such as `@a && !@b` or
 * `@path.property`. Only unchanged parameters are eligible; an actual edit to
 * the authored field still uses the normal serializer/bridge path.
 */
const preserveUnchangedAuthoredValues = (
  oldElement: CadElement,
  newElement: CadElement,
  oldStatement: DslStatement,
  next: ReturnType<typeof serializeElementStatementBlock>,
  changedKeys: ReadonlySet<string>,
  preserveReferences: boolean
) => {
  if (!preserveReferences) return next;
  const args = [...next.args];
  const specs = [...constructionForElementType(oldElement.type).args, ...commonArgSpecs];
  for (const attribute of oldStatement.attrs) {
    if (!attribute.value.includes("@")) continue;
    const spec = specs.find((candidate) => candidate.arg === attribute.key);
    const parameterKey = spec?.parameterKey ?? spec?.arg;
    if (!parameterKey || changedKeys.has(parameterKey) || parameterKey === "activity") continue;
    if (!sameModelValue(getParameterValue(oldElement, parameterKey), getParameterValue(newElement, parameterKey))) continue;
    const preserved = `${attribute.key}: ${attribute.value}`;
    const existingIndex = args.findIndex((arg) => arg.key === attribute.key);
    if (existingIndex >= 0) args[existingIndex] = { ...args[existingIndex], text: preserved };
    else args.push({ key: attribute.key, text: preserved });
  }
  if (args.length === next.args.length && args.every((arg, index) => arg === next.args[index])) return next;
  if (next.close !== null) return { ...next, args };

  const renderedArgs = args.map((arg, index) =>
    `${arg.text}${next.argumentSeparator === "comma" && index < args.length - 1 ? "," : ""}`
  ).join(" ");
  const close = next.header.lastIndexOf(")");
  if (close >= 0 && next.header.lastIndexOf("(") < close) {
    const open = next.header.lastIndexOf("(");
    const existing = next.header.slice(open + 1, close).trim();
    const separator = existing.length > 0 ? (next.argumentSeparator === "comma" ? ", " : " ") : "";
    return { ...next, header: `${next.header.slice(0, open + 1)}${existing}${separator}${renderedArgs}${next.header.slice(close)}`, args: [] };
  }
  return { ...next, header: `${next.header} (${renderedArgs})`, args: [] };
};

// ==== 要素セクション ====

const patchElements = (input: TextPatchInput, ops: PatchOps) => {
  const { old, newDocument } = input;
  const oldDocument = old.document!;
  const statementMap = old.statementMap!;
  // `old.majorVersion` is guaranteed non-null alongside `old.document`/`old.statementMap`
  // (see CompiledDslDocument.majorVersion); the fallback below is defensive only.
  const majorVersion = old.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION;
  const refsNew = documentDslRefs(newDocument.elements, majorVersion);
  const layout = layoutElementTree(newDocument.elements, refsNew, newDocument.evaluationLimitIndex);
  const newById = new Map(newDocument.elements.map((element) => [element.id, element]));
  const updates = elementUpdateSet(oldDocument, newDocument, majorVersion, refsNew);
  const preserveAuthoredReferences = sourceNamesAndParentsUnchanged(oldDocument.elements, newDocument.elements);

  // 文の実際の旧終端行(ヘッダ自身のendLineと、旧文書が次行単独 `{` を
  // 使っていた場合のopenBraceLineの大きい方)。v2正準出力はヘッダ行自身に
  // `{` を書くため、次行単独 `{` はこの文が消費する最後の物理行として扱う
  // (別行として残すと、無変更時にbyte同一性が壊れたり、変更時に取り残されて
  // 二重 `{` の原因になる)。
  const effectiveEndLine = (info: StatementInfo) => Math.max(info.endLine, info.openBraceLine ?? 0);

  // 旧テキストの「要素系」行(要素文・そのブロック枠・@stop)。
  type OldElemLine = {
    line: number;
    /** 非マッチ削除時に落とす末尾行(既定はline自身)。複数行文・次行単独`{`を伴うstatement行のみline超え。 */
    endLine: number;
    role: "statement" | "blockEnd" | "blockElse" | "atStop";
    elementId?: ElementId;
    statementIndex: number;
  };
  const oldElemLines: OldElemLine[] = [];
  for (const info of statementMap.statements) {
    const statement = old.statements[info.statementIndex];
    if (statement.kind === "atStop") {
      oldElemLines.push({ line: info.line, endLine: info.line, role: "atStop", statementIndex: info.statementIndex });
      continue;
    }
    if (statement.kind === "blockEnd" || statement.kind === "blockElse") {
      const ownerIndex = statement.enclosing?.statementIndex;
      if (ownerIndex === undefined) continue;
      const ownerId = statementMap.elementIdByStatementIndex.get(ownerIndex);
      if (ownerId === undefined) continue; // printLayout ブロックの枠は別セクションで扱う。
      oldElemLines.push({
        line: info.line,
        endLine: info.line,
        role: statement.kind,
        elementId: ownerId,
        statementIndex: info.statementIndex
      });
      continue;
    }
    if (isElementDslStatement(statement)) {
      const id = statementMap.elementIdByStatementIndex.get(info.statementIndex);
      if (id === undefined) continue;
      oldElemLines.push({
        line: info.line,
        endLine: effectiveEndLine(info),
        role: "statement",
        elementId: id,
        statementIndex: info.statementIndex
      });
    }
  }

  // layout行 → 旧行候補(マッチング・insertBeforeアンカーに使う「先頭」行)。
  const candidates = layout.map((line): number | undefined => {
    if (line.role === "atStop") return statementMap.byKey.get("atStop")?.line;
    const info = line.elementId !== undefined ? statementMap.byElementId.get(line.elementId) : undefined;
    if (!info) return undefined;
    if (line.role === "statement") return info.line;
    if (line.role === "blockEnd") return info.range.endLine > info.line ? info.range.endLine : undefined;
    return info.elseLine;
  });
  // 複数行文(statement行のみ)の実際の終端行。「この行より後ろに挿入」の
  // アンカー計算(lastMatchedOldLine)専用— ヘッダ行だけを見ると、末尾が
  // マッチした複数行文の継続行の途中に新規runを割り込ませてしまう。
  const candidateEndLines = layout.map((line, index): number | undefined => {
    if (line.role !== "statement") return candidates[index];
    const info = line.elementId !== undefined ? statementMap.byElementId.get(line.elementId) : undefined;
    return info ? effectiveEndLine(info) : undefined;
  });

  // 旧行番号が狭義増加になる最大部分列だけをマッチとする(順序が壊れた候補=
  // 移動した要素・移動した @stop は自動的に「削除+挿入」へ落ちる)。
  const withCandidates = layout
    .map((_, layoutIndex) => layoutIndex)
    .filter((layoutIndex) => candidates[layoutIndex] !== undefined);
  const keptPositions = longestIncreasingIndexes(withCandidates.map((layoutIndex) => candidates[layoutIndex]!));
  const matchedOldLineByLayout = new Map<number, number>();
  const matchedOldEndByLayout = new Map<number, number>();
  withCandidates.forEach((layoutIndex, position) => {
    if (keptPositions.has(position)) {
      matchedOldLineByLayout.set(layoutIndex, candidates[layoutIndex]!);
      matchedOldEndByLayout.set(layoutIndex, candidateEndLines[layoutIndex] ?? candidates[layoutIndex]!);
    }
  });
  const matchedOldLines = new Set(matchedOldLineByLayout.values());

  // 非マッチの旧要素系行は削除(複数行文はline..endLine全範囲を落とす。
  // 継続行だけを取り残すと孤立した物理行がそのまま残ってしまう)。
  for (const oldLine of oldElemLines) {
    if (matchedOldLines.has(oldLine.line)) continue;
    for (let l = oldLine.line; l <= oldLine.endLine; l += 1) setLineOp(ops, l, null);
  }

  // サブツリーごと消えたコンテナは、範囲内のコメント・空行も一緒に削除する
  // (生存する子孫が1つでもいれば残す=ungroup系はコメントを保存)。
  const survivesSomewhere = (rootId: ElementId): boolean => {
    const stack = oldDocument.elements.filter((element) => element.parentGroupId === rootId);
    while (stack.length > 0) {
      const element = stack.pop()!;
      if (newById.has(element.id)) return true;
      stack.push(...oldDocument.elements.filter((item) => item.parentGroupId === element.id));
    }
    return false;
  };
  for (const element of oldDocument.elements) {
    if (newById.has(element.id) || !isContainer(element)) continue;
    const info = statementMap.byElementId.get(element.id);
    if (!info || info.range.endLine <= info.line) continue;
    if (survivesSomewhere(element.id)) continue;
    for (let line = info.range.startLine; line <= info.range.endLine; line += 1) {
      setLineOp(ops, line, null);
    }
  }

  // マッチ行: 変更があれば正準行(+旧行の行末コメント)へ置換、無ければ不変。
  for (const [layoutIndex, oldLineNumber] of matchedOldLineByLayout) {
    const layoutLine = layout[layoutIndex];
    const rawOldLine = old.sourceLines[oldLineNumber - 1] ?? "";
    const comment = splitDslComment(rawOldLine).comment;

    if (layoutLine.role === "statement") {
      const elementId = layoutLine.elementId!;
      const info = statementMap.byElementId.get(elementId)!;
      const oldStatement = old.statements[info.statementIndex];
      const newElement = newById.get(elementId)!;
      const oldFallback = oldStatement.attrs.some((attr) => attr.key === "parent");
      const newOpens = !layoutLine.fallback && isContainer(newElement);
      const structureChanged =
        info.indentDepth !== layoutLine.depth ||
        oldFallback !== Boolean(layoutLine.fallback) ||
        oldStatement.opensBlock !== newOpens;
      if (updates.has(elementId) || structureChanged) {
        const indent = DSL_INDENT.repeat(layoutLine.depth);
        const endLine = effectiveEndLine(info);
        const oldLines = old.sourceLines.slice(info.line - 1, endLine);
        // next はP5の未加工構造化出力(header/args/close)を直接使う。
        // layoutLine.lines(物理行化・インデント・brace装飾済みの表示用出力)
        // からは再構築しない — 構造とレンダリングを混ぜない。
        let next = serializeElementStatementBlock(newElement, refsNew);
        const oldElement = oldDocument.elements.find((candidate) => candidate.id === elementId);
        if (oldElement) {
          const changedKeys = new Set(changedParameterKeysForSource(oldElement, newElement));
          if (oldElement.activity !== newElement.activity) changedKeys.add("activity");
          next = preserveUnchangedAuthoredValues(oldElement, newElement, oldStatement, next, changedKeys, preserveAuthoredReferences);
        }
        if (layoutLine.fallback) {
          const parentToken = refsNew.token(newElement.parentGroupId!, newElement);
          const branch: "then" | "else" = newElement.conditionalBranch === "else" ? "else" : "then";
          next = withFallbackParentArgs(next, parentToken, branch);
        } else if (newOpens) {
          next = { ...next, header: `${next.header} {` };
        }
        const oldArgLineByKey = oldArgLineByKeyFor(oldStatement, old.sourceLines, info.line);
        const mergedLines = mergeStatementComments({ oldLines, oldArgLineByKey, next, indent });
        const unchanged =
          mergedLines.length === oldLines.length && mergedLines.every((line, index) => line === oldLines[index]);
        if (!unchanged) {
          // The first line keeps going through setLineOp (not insertBefore) at
          // info.line, so a run inserted immediately before this same anchor
          // (e.g. a brand-new enclosing group's header/`{`, handled above)
          // always sorts ahead of this statement's own content —
          // buildSplicesFromOps only guarantees that ordering
          // (insertsBefore(cursor) before lineOps(cursor)) when the
          // statement's own content is the lineOps entry at that cursor.
          // Remaining merged lines go through insertBefore(info.line + 1, …)
          // and every other old physical line in range is cleared, so the
          // collapsed splice reassembles the full merged content in order
          // regardless of how the old/new physical line counts compare.
          const [headerLine, ...rest] = mergedLines;
          setLineOp(ops, info.line, headerLine);
          if (rest.length > 0) insertBefore(ops, info.line + 1, rest);
          for (let l = info.line + 1; l <= endLine; l += 1) setLineOp(ops, l, null);
        }
      }
      continue;
    }

    // Structural rows and @stop only change for indentation changes.
    // (blockEnd/blockElse の正準深さは対応する開き文の深さに等しい。)
    const info =
      layoutLine.role === "atStop"
        ? statementMap.byKey.get("atStop")!
        : statementMap.byElementId.get(layoutLine.elementId!)!;
    if (info.indentDepth !== layoutLine.depth) {
      const replacement = `${soleCanonicalLine(layoutLine, layoutLine.elementId)}${comment}`;
      if (replacement !== rawOldLine) setLineOp(ops, oldLineNumber, replacement);
    }
  }

  // 非マッチのlayout行 → 連続runごとに挿入。アンカーは「次のマッチ行の直前」、
  // 無ければ「最後のマッチ行の直後」、マッチが皆無なら要素セクションの新設。
  // マッチ行の置換処理より後に実行する: 両方とも同じ旧行番号をinsertBeforeの
  // アンカーに使うことがある。v2の縦型call出力は変更されたマッチ行自身が
  // `info.line + 1` へ自分の残り引数行をinsertBeforeで追加し得るため(1行から
  // 複数行へ育つケース)、そのアンカーがrunのアンカー(次のマッチ行の直前、また
  // は最後のマッチ行の直後)と一致することがある。insertBeforeは呼び出し順で
  // 連結されるため、マッチ行側を先に走らせないと、そのマッチ行自身の続き引数行
  // より前に(あるいは新規コンテナの閉じ`}`が、末尾statementの続き引数行の
  // 途中に)runの内容が割り込んでしまう。マッチ行の`setLineOp(info.line, …)`は
  // 別行(cursor)への操作であり、run側のinsertBeforeとは衝突しないため、この
  // 順序変更で「新規コンテナのヘッダより前に子statementの内容が来てしまう」
  // という当初の懸念(ヘッダ行はinsertBeforeでなくsetLineOpを使うため無関係)は
  // 発生しない。
  const runs: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  layout.forEach((_, layoutIndex) => {
    if (matchedOldLineByLayout.has(layoutIndex)) {
      if (runStart >= 0) runs.push({ start: runStart, end: layoutIndex });
      runStart = -1;
    } else if (runStart < 0) {
      runStart = layoutIndex;
    }
  });
  if (runStart >= 0) runs.push({ start: runStart, end: layout.length });

  // 複数行文の継続行の途中へ挿入されないよう、末尾は実際のendLine基準で計算する。
  const lastMatchedOldLine = Math.max(0, ...matchedOldEndByLayout.values());
  for (const run of runs) {
    const texts = layout.slice(run.start, run.end).flatMap((line) => line.lines);
    let nextMatched: number | undefined;
    for (let layoutIndex = run.end; layoutIndex < layout.length; layoutIndex += 1) {
      const matched = matchedOldLineByLayout.get(layoutIndex);
      if (matched !== undefined) {
        nextMatched = matched;
        break;
      }
    }
    if (nextMatched !== undefined) {
      insertBefore(ops, nextMatched, texts);
    } else if (matchedOldLineByLayout.size > 0) {
      insertBefore(ops, lastMatchedOldLine + 1, texts);
    } else {
      // 旧テキストに要素セクションが無い(または全消し後の全新規)。
      // printLayoutはcanonicalに常にelementsより後なので、その手前にanchorする。
      const { sectionEnds } = statementMap;
      const anchor =
        sectionEnds.visibility ?? sectionEnds.palette ?? sectionEnds.version ?? 0;
      insertBefore(ops, anchor + 1, anchor > 0 ? ["", ...texts] : texts);
    }
  }
};

// ==== パレットセクション ====

const patchPalette = (input: TextPatchInput, ops: PatchOps) => {
  const { old, newDocument } = input;
  const oldDocument = old.document!;
  const statementMap = old.statementMap!;
  const oldLines = serializePaletteLines(oldDocument.palette);
  const newLines = serializePaletteLines(newDocument.palette);
  if (oldLines.join("\n") === newLines.join("\n")) return;

  const oldColorStatements = statementMap.statements
    .filter((info) => info.kind === "color")
    .map((info) => ({ info, id: old.statements[info.statementIndex].name }));
  const oldColorLineById = new Map(oldColorStatements.map((item) => [item.id, item.info.line]));
  const newColorIds = newDocument.palette.colors.map((color) => color.id);
  const newColorById = new Map(newDocument.palette.colors.map((color) => [color.id, color]));
  const oldColorById = new Map(oldDocument.palette.colors.map((color) => [color.id, color]));

  if (oldColorStatements.length === 0) {
    // セクション新設(旧文書はフォールバックの既定パレットだった)。
    const anchor = statementMap.sectionEnds.version ?? 0;
    insertBefore(ops, anchor + 1, anchor > 0 ? ["", ...newLines] : newLines);
    return;
  }

  // 保持色の相対順序が変わった場合はセクション単位で書き直す(稀なパス)。
  const keptOldOrder = oldColorStatements.map((item) => item.id).filter((id) => newColorById.has(id));
  const keptNewOrder = newColorIds.filter((id) => oldColorLineById.has(id));
  if (keptOldOrder.join(" ") !== keptNewOrder.join(" ")) {
    for (const item of oldColorStatements) setLineOp(ops, item.info.line, null);
    insertBefore(ops, oldColorStatements[0].info.line, newLines);
    return;
  }

  for (const item of oldColorStatements) {
    const newColor = newColorById.get(item.id);
    const rawOldLine = old.sourceLines[item.info.line - 1] ?? "";
    if (!newColor) {
      setLineOp(ops, item.info.line, null);
      continue;
    }
    const oldColor = oldColorById.get(item.id);
    const desired = serializePaletteColorLine(newColor, newDocument.palette.defaultColorId);
    const previous = oldColor
      ? serializePaletteColorLine(oldColor, oldDocument.palette.defaultColorId)
      : undefined;
    if (previous === desired) continue;
    const replacement = `${desired}${splitDslComment(rawOldLine).comment}`;
    if (replacement !== rawOldLine) setLineOp(ops, item.info.line, replacement);
  }

  // 追加色: 新配列順で、直後にくる既存色の行の直前へ挿入(無ければ末尾へ)。
  const lastColorLine = Math.max(...oldColorStatements.map((item) => item.info.line));
  newColorIds.forEach((id, index) => {
    if (oldColorLineById.has(id)) return;
    const desired = serializePaletteColorLine(newColorById.get(id)!, newDocument.palette.defaultColorId);
    let anchorLine: number | undefined;
    for (let after = index + 1; after < newColorIds.length; after += 1) {
      const existing = oldColorLineById.get(newColorIds[after]);
      if (existing !== undefined) {
        anchorLine = existing;
        break;
      }
    }
    insertBefore(ops, anchorLine ?? lastColorLine + 1, [desired]);
  });
};

// ==== 表示ロール・プロファイルセクション ====

const patchVisibility = (input: TextPatchInput, ops: PatchOps) => {
  const { old, newDocument } = input;
  const oldDocument = old.document!;
  const statementMap = old.statementMap!;

  const oldSection = [
    ...oldDocument.visibilityRoles.map(serializeRoleLine),
    ...oldDocument.visibilityProfiles.map((profile) => serializeViewLine(profile, oldDocument.visibilityRoles)),
    serializeActiveViewLine(oldDocument.activeVisibilityProfileId)
  ].join("\n");
  const newSection = [
    ...newDocument.visibilityRoles.map(serializeRoleLine),
    ...newDocument.visibilityProfiles.map((profile) => serializeViewLine(profile, newDocument.visibilityRoles)),
    serializeActiveViewLine(newDocument.activeVisibilityProfileId)
  ].join("\n");
  if (oldSection === newSection) return;

  const attrOf = (statementIndex: number, key: string) =>
    old.statements[statementIndex].attrs.find((attr) => attr.key === key)?.value;
  const roleStatements = statementMap.statements
    .filter((info) => info.kind === "role")
    .map((info) => ({ info, id: attrOf(info.statementIndex, "id") ?? old.statements[info.statementIndex].name }));
  const viewStatements = statementMap.statements
    .filter((info) => info.kind === "view")
    .map((info) => ({ info, id: attrOf(info.statementIndex, "id") ?? old.statements[info.statementIndex].name }));
  const activeViewInfo = statementMap.byKey.get("activeView");

  const newRoleLines = newDocument.visibilityRoles.map(serializeRoleLine);
  const newViewLines = newDocument.visibilityProfiles.map((profile) =>
    serializeViewLine(profile, newDocument.visibilityRoles)
  );
  const newActiveLine = serializeActiveViewLine(newDocument.activeVisibilityProfileId);

  if (roleStatements.length === 0 && viewStatements.length === 0 && !activeViewInfo) {
    const { sectionEnds } = statementMap;
    const anchor = sectionEnds.palette ?? sectionEnds.version ?? 0;
    const lines = [...newRoleLines, ...newViewLines, newActiveLine];
    insertBefore(ops, anchor + 1, anchor > 0 ? ["", ...lines] : lines);
    return;
  }

  // 保持ロール/ビューの順序が変わったらセクション書き直し(稀なパス)。
  const oldRoleById = new Map(oldDocument.visibilityRoles.map((role) => [role.id, role]));
  const oldProfileById = new Map(oldDocument.visibilityProfiles.map((profile) => [profile.id, profile]));
  const newRoleById = new Map(newDocument.visibilityRoles.map((role) => [role.id, role]));
  const newProfileById = new Map(newDocument.visibilityProfiles.map((profile) => [profile.id, profile]));
  const keptRolesOldOrder = roleStatements.map((item) => item.id).filter((id) => newRoleById.has(id));
  const keptRolesNewOrder = newDocument.visibilityRoles.map((role) => role.id).filter((id) =>
    roleStatements.some((item) => item.id === id)
  );
  const keptViewsOldOrder = viewStatements.map((item) => item.id).filter((id) => newProfileById.has(id));
  const keptViewsNewOrder = newDocument.visibilityProfiles.map((profile) => profile.id).filter((id) =>
    viewStatements.some((item) => item.id === id)
  );
  if (
    keptRolesOldOrder.join(" ") !== keptRolesNewOrder.join(" ") ||
    keptViewsOldOrder.join(" ") !== keptViewsNewOrder.join(" ")
  ) {
    const sectionLines = [
      ...roleStatements.map((item) => item.info.line),
      ...viewStatements.map((item) => item.info.line),
      ...(activeViewInfo ? [activeViewInfo.line] : [])
    ];
    for (const line of sectionLines) setLineOp(ops, line, null);
    insertBefore(ops, Math.min(...sectionLines), [...newRoleLines, ...newViewLines, newActiveLine]);
    return;
  }

  const replaceOrKeep = (line: number, previous: string | undefined, desired: string | undefined) => {
    const rawOldLine = old.sourceLines[line - 1] ?? "";
    if (desired === undefined) {
      setLineOp(ops, line, null);
      return;
    }
    if (previous === desired) return;
    const replacement = `${desired}${splitDslComment(rawOldLine).comment}`;
    if (replacement !== rawOldLine) setLineOp(ops, line, replacement);
  };

  for (const item of roleStatements) {
    const oldRole = oldRoleById.get(item.id);
    const newRole = newRoleById.get(item.id);
    replaceOrKeep(
      item.info.line,
      oldRole ? serializeRoleLine(oldRole) : undefined,
      newRole ? serializeRoleLine(newRole) : undefined
    );
  }
  for (const item of viewStatements) {
    const oldProfile = oldProfileById.get(item.id);
    const newProfile = newProfileById.get(item.id);
    replaceOrKeep(
      item.info.line,
      oldProfile ? serializeViewLine(oldProfile, oldDocument.visibilityRoles) : undefined,
      newProfile ? serializeViewLine(newProfile, newDocument.visibilityRoles) : undefined
    );
  }

  // 追加ロール/ビュー。ロールは既存ロール行の末尾(無ければ先頭ビュー行の直前)、
  // ビューは既存ビュー行の末尾(無ければ activeView 行の直前)へ。
  const lastRoleLine = roleStatements.length > 0 ? Math.max(...roleStatements.map((item) => item.info.line)) : undefined;
  const firstViewLine = viewStatements.length > 0 ? Math.min(...viewStatements.map((item) => item.info.line)) : undefined;
  const lastViewLine = viewStatements.length > 0 ? Math.max(...viewStatements.map((item) => item.info.line)) : undefined;
  for (const role of newDocument.visibilityRoles) {
    if (roleStatements.some((item) => item.id === role.id)) continue;
    const anchor = lastRoleLine !== undefined ? lastRoleLine + 1 : firstViewLine ?? (activeViewInfo ? activeViewInfo.line : 0);
    insertBefore(ops, anchor, [serializeRoleLine(role)]);
  }
  for (const profile of newDocument.visibilityProfiles) {
    if (viewStatements.some((item) => item.id === profile.id)) continue;
    const anchor =
      lastViewLine !== undefined
        ? lastViewLine + 1
        : activeViewInfo
          ? activeViewInfo.line
          : lastRoleLine !== undefined
            ? lastRoleLine + 1
            : 0;
    insertBefore(ops, anchor, [serializeViewLine(profile, newDocument.visibilityRoles)]);
  }

  if (activeViewInfo) {
    replaceOrKeep(activeViewInfo.line, serializeActiveViewLine(oldDocument.activeVisibilityProfileId), newActiveLine);
  } else {
    const anchor = lastViewLine !== undefined ? lastViewLine + 1 : lastRoleLine !== undefined ? lastRoleLine + 1 : 0;
    insertBefore(ops, anchor, [newActiveLine]);
  }
};

// ==== 印刷レイアウトセクション ====

const replaceLineRange = (
  ops: PatchOps,
  startLine: number,
  endLine: number,
  replacementLines: readonly string[]
) => {
  if (startLine > endLine || startLine < 1) {
    throw new UnappliedTextPatchError(`印刷レイアウトの行範囲が不正です (${startLine}..${endLine})。`);
  }
  if (replacementLines.length === 0) {
    for (let line = startLine; line <= endLine; line += 1) setLineOp(ops, line, null);
    return;
  }
  setLineOp(ops, startLine, replacementLines[0]);
  if (replacementLines.length > 1) insertBefore(ops, startLine + 1, [...replacementLines].slice(1));
  for (let line = startLine + 1; line <= endLine; line += 1) setLineOp(ops, line, null);
};

const directPrintLayoutSourceChildren = (
  statements: readonly DslStatement[],
  layoutStatementIndex: number
) => statements.filter((statement) =>
  (statement.kind === "typedDeclaration" || statement.kind === "set") &&
  statement.enclosing?.statementIndex === layoutStatementIndex
);

const patchPrintLayoutWithSourceChildren = ({
  ops,
  oldLayout,
  newLayout,
  newBlock,
  layoutInfo,
  statementMap,
  oldStatements
}: {
  ops: PatchOps;
  oldLayout: DslDocumentData["printLayouts"][number];
  newLayout: DslDocumentData["printLayouts"][number];
  newBlock: { layoutId: string; lines: string[] };
  layoutInfo: StatementInfo;
  statementMap: NonNullable<CompiledDslDocument["statementMap"]>;
  oldStatements: readonly DslStatement[];
}) => {
  const headerEndIndex = newBlock.lines.findIndex((line) => line.trim().endsWith(") {"));
  if (headerEndIndex < 0 || newBlock.lines.at(-1) !== "}") {
    throw new UnappliedTextPatchError(`printLayout ${newLayout.id} の正準ブロック範囲を特定できません。`);
  }
  const headerLines = newBlock.lines.slice(0, headerEndIndex + 1);
  const placeLines = newBlock.lines.slice(headerEndIndex + 1, -1);
  if (placeLines.length !== newLayout.placements.length) {
    throw new UnappliedTextPatchError(`printLayout ${newLayout.id} のplace文数とモデルの配置数が一致しません。`);
  }

  const oldPlaceInfos = statementMap.statements
    .filter((info) =>
      info.kind === "place" && info.enclosing?.statementIndex === layoutInfo.statementIndex
    )
    .sort((left, right) => left.statementIndex - right.statementIndex);
  if (oldPlaceInfos.length !== oldLayout.placements.length) {
    throw new UnappliedTextPatchError(`printLayout ${oldLayout.id} のplace文位置をモデル配置へ対応付けられません。`);
  }
  if (directPrintLayoutSourceChildren(oldStatements, layoutInfo.statementIndex).length === 0) {
    throw new UnappliedTextPatchError(`printLayout ${oldLayout.id} にbody-local scalar文がありません。`);
  }

  const oldPlacementIds = oldLayout.placements.map((placement) => placement.id);
  const newPlacementIds = newLayout.placements.map((placement) => placement.id);
  const oldPlacementIdSet = new Set(oldPlacementIds);
  if (oldPlacementIdSet.size !== oldPlacementIds.length || new Set(newPlacementIds).size !== newPlacementIds.length) {
    throw new UnappliedTextPatchError(`printLayout ${newLayout.id} の配置identityが一意ではありません。`);
  }
  const retainedOldIds = oldPlacementIds.filter((id) => newPlacementIds.includes(id));
  const retainedNewIds = newPlacementIds.filter((id) => oldPlacementIdSet.has(id));
  if (retainedOldIds.join("\0") !== retainedNewIds.join("\0")) {
    throw new UnappliedTextPatchError(
      `printLayout ${newLayout.id} のplace順序変更はbody-local scalar文を保ったまま適用できません。`
    );
  }
  const lastRetainedNewIndex = Math.max(
    -1,
    ...retainedNewIds.map((id) => newPlacementIds.indexOf(id))
  );
  if (newPlacementIds.some((id, index) => !oldPlacementIdSet.has(id) && index < lastRetainedNewIndex)) {
    throw new UnappliedTextPatchError(
      `printLayout ${newLayout.id} の新規placeをbody-local scalar文の相対位置なしに挿入できません。`
    );
  }

  const headerEndLine = Math.max(layoutInfo.endLine, layoutInfo.openBraceLine ?? 0);
  replaceLineRange(ops, layoutInfo.line, headerEndLine, headerLines);

  oldPlacementIds.forEach((placementId, oldIndex) => {
    const oldPlaceInfo = oldPlaceInfos[oldIndex];
    const newIndex = newPlacementIds.indexOf(placementId);
    const oldPlaceEndLine = Math.max(oldPlaceInfo.line, oldPlaceInfo.endLine);
    if (newIndex < 0) {
      replaceLineRange(ops, oldPlaceInfo.line, oldPlaceEndLine, []);
      return;
    }
    replaceLineRange(ops, oldPlaceInfo.line, oldPlaceEndLine, [placeLines[newIndex]]);
  });

  const addedPlaceLines = newPlacementIds
    .map((placementId, index) => oldPlacementIdSet.has(placementId) ? undefined : placeLines[index])
    .filter((line): line is string => line !== undefined);
  if (addedPlaceLines.length > 0) {
    const closeLine = layoutInfo.closeBraceLine ?? layoutInfo.range.endLine;
    insertBefore(ops, closeLine, addedPlaceLines);
  }
};

const patchPrintLayouts = (input: TextPatchInput, ops: PatchOps) => {
  const { old, newDocument } = input;
  const oldDocument = old.document!;
  const statementMap = old.statementMap!;
  const oldPlan = planPrintLayoutSection(oldDocument);
  const newPlan = planPrintLayoutSection(newDocument);
  const planEqual =
    oldPlan.activePrintLayoutLine === newPlan.activePrintLayoutLine &&
    oldPlan.blocks.length === newPlan.blocks.length &&
    oldPlan.blocks.every(
      (block, index) =>
        block.layoutId === newPlan.blocks[index].layoutId &&
        block.lines.join("\n") === newPlan.blocks[index].lines.join("\n")
    );
  if (planEqual) return;

  const oldBlockById = new Map(oldPlan.blocks.map((block) => [block.layoutId, block]));
  const infoById = new Map(
    oldPlan.blocks
      .map((block) => [block.layoutId, statementMap.byKey.get(`printLayout:${block.layoutId}`)] as const)
      .filter((entry): entry is readonly [string, StatementInfo] => entry[1] !== undefined)
  );
  const activeInfo = statementMap.byKey.get("activePrintLayout");
  const sourceOnlyLayoutIds = new Set(
    [...infoById.entries()]
      .filter(([, info]) => directPrintLayoutSourceChildren(old.statements, info.statementIndex).length > 0)
      .map(([layoutId]) => layoutId)
  );

  if (infoById.size === 0) {
    // セクション新設。printLayoutはcanonicalに常にelementsより後。
    const { sectionEnds } = statementMap;
    const anchor = sectionEnds.elements ?? sectionEnds.visibility ?? sectionEnds.palette ?? sectionEnds.version ?? 0;
    const lines = [
      ...newPlan.blocks.flatMap((block) => block.lines),
      ...(newPlan.activePrintLayoutLine ? [newPlan.activePrintLayoutLine] : [])
    ];
    if (lines.length > 0) insertBefore(ops, anchor + 1, anchor > 0 ? ["", ...lines] : lines);
    return;
  }

  const dropRange = (layoutId: string) => {
    const info = infoById.get(layoutId);
    if (!info) return;
    for (let line = info.range.startLine; line <= info.range.endLine; line += 1) setLineOp(ops, line, null);
  };

  // 保持レイアウトの順序が変わったらセクション書き直し(稀なパス)。
  const keptOldOrder = oldPlan.blocks
    .map((block) => block.layoutId)
    .filter((id) => newPlan.blocks.some((block) => block.layoutId === id));
  const keptNewOrder = newPlan.blocks
    .map((block) => block.layoutId)
    .filter((id) => oldBlockById.has(id));
  if (keptOldOrder.some((layoutId, index) => keptNewOrder[index] !== layoutId) &&
    keptOldOrder.some((layoutId) => sourceOnlyLayoutIds.has(layoutId))) {
    throw new UnappliedTextPatchError(
      "body-local scalar文を含むprintLayoutの順序変更は、source orderを保ったまま適用できません。"
    );
  }
  if (keptOldOrder.join(" ") !== keptNewOrder.join(" ")) {
    const firstLine = Math.min(...[...infoById.values()].map((info) => info.range.startLine));
    for (const block of oldPlan.blocks) dropRange(block.layoutId);
    if (activeInfo) setLineOp(ops, activeInfo.line, null);
    insertBefore(ops, firstLine, [
      ...newPlan.blocks.flatMap((block) => block.lines),
      ...(newPlan.activePrintLayoutLine ? [newPlan.activePrintLayoutLine] : [])
    ]);
    return;
  }

  const lastBlockEnd = Math.max(...[...infoById.values()].map((info) => info.range.endLine));

  for (const block of oldPlan.blocks) {
    const newBlock = newPlan.blocks.find((item) => item.layoutId === block.layoutId);
    if (!newBlock) {
      dropRange(block.layoutId);
      continue;
    }
    if (newBlock.lines.join("\n") === block.lines.join("\n")) continue;
    const info = infoById.get(block.layoutId);
    if (!info) continue;
    const oldLayout = oldDocument.printLayouts.find((layout) => layout.id === block.layoutId);
    const newLayout = newDocument.printLayouts.find((layout) => layout.id === block.layoutId);
    if (!oldLayout || !newLayout) {
      throw new UnappliedTextPatchError(`printLayout ${block.layoutId} のモデル対応を特定できません。`);
    }
    if (sourceOnlyLayoutIds.has(block.layoutId)) {
      patchPrintLayoutWithSourceChildren({
        ops,
        oldLayout,
        newLayout,
        newBlock,
        layoutInfo: info,
        statementMap,
        oldStatements: old.statements
      });
    } else {
      dropRange(block.layoutId);
      insertBefore(ops, info.range.startLine, newBlock.lines);
    }
  }

  // 追加レイアウト: 新配列順で、直後の既存レイアウトのブロック先頭の直前へ
  // (無ければ最終ブロックの直後へ)。
  newPlan.blocks.forEach((block, index) => {
    if (oldBlockById.has(block.layoutId)) return;
    let anchorLine: number | undefined;
    for (let after = index + 1; after < newPlan.blocks.length; after += 1) {
      const info = infoById.get(newPlan.blocks[after].layoutId);
      if (info) {
        anchorLine = info.range.startLine;
        break;
      }
    }
    insertBefore(ops, anchorLine ?? lastBlockEnd + 1, block.lines);
  });

  if (activeInfo) {
    const rawOldLine = old.sourceLines[activeInfo.line - 1] ?? "";
    if (newPlan.activePrintLayoutLine === null) {
      setLineOp(ops, activeInfo.line, null);
    } else if (oldPlan.activePrintLayoutLine !== newPlan.activePrintLayoutLine) {
      const replacement = `${newPlan.activePrintLayoutLine}${splitDslComment(rawOldLine).comment}`;
      if (replacement !== rawOldLine) setLineOp(ops, activeInfo.line, replacement);
    }
  } else if (newPlan.activePrintLayoutLine !== null && oldPlan.activePrintLayoutLine !== newPlan.activePrintLayoutLine) {
    insertBefore(ops, lastBlockEnd + 1, [newPlan.activePrintLayoutLine]);
  }
};

// ==== スプライス組み立て・適用 ====

const buildSplicesFromOps = (lastLine: number, ops: PatchOps): LineSplice[] => {
  const splices: LineSplice[] = [];
  let line = 1;
  while (line <= lastLine + 1) {
    const inserted = ops.insertsBefore.get(line) ?? [];
    if (line <= lastLine && ops.lineOps.has(line)) {
      // 汚れた行の連続領域を1スプライスに畳む(行直前の挿入は位置どおり連結)。
      const start = line;
      const replacement: string[] = [];
      let cursor = line;
      while (cursor <= lastLine && ops.lineOps.has(cursor)) {
        replacement.push(...(ops.insertsBefore.get(cursor) ?? []));
        const op = ops.lineOps.get(cursor)!;
        if (op !== null) replacement.push(op);
        cursor += 1;
      }
      splices.push({ startLine: start, endLine: cursor - 1, replacementLines: replacement });
      line = cursor;
      continue;
    }
    if (inserted.length > 0) {
      splices.push({ startLine: line, endLine: line - 1, replacementLines: inserted });
    }
    line += 1;
  }
  return splices;
};

export const buildTextPatch = (input: TextPatchInput): LineSplice[] => {
  if (!input.old.document || !input.old.statementMap) {
    throw new Error("buildTextPatch: 旧コンパイル結果が不完全です(document/statementMapがnull)。");
  }
  const ops: PatchOps = { lineOps: new Map(), insertsBefore: new Map() };
  if (!input.skipElements) patchElements(input, ops);
  patchPalette(input, ops);
  patchVisibility(input, ops);
  patchPrintLayouts(input, ops);
  return buildSplicesFromOps(input.old.sourceLines.length, ops);
};

export const applyLineSplices = (text: string, splices: readonly LineSplice[]): string => {
  // 無編集のsourceTextはdocumentFileが直接保存する。ここでは行単位codecを
  // 導入せず、未変更の文字列断片を再結合しない。これによりmixed改行文書でも
  // モデルパッチに触れない行の改行は保持される。
  const separators = [...text.matchAll(/\r?\n/g)].map((match) => match[0]);
  const newline = separators.length > 0 && separators.every((value) => value === "\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let previousEnd = 0;
  let previousStart = 0;
  for (const splice of splices) {
    if (splice.endLine < splice.startLine - 1) {
      throw new Error(`applyLineSplices: 不正な範囲です (${splice.startLine}..${splice.endLine})`);
    }
    if (splice.startLine < previousStart || splice.startLine <= previousEnd) {
      throw new Error(
        `applyLineSplices: スプライスが未ソートまたは重複しています (${splice.startLine}..${splice.endLine})`
      );
    }
    if (splice.startLine < 1 || splice.endLine > lines.length) {
      throw new Error(`applyLineSplices: 行範囲が文書外です (${splice.startLine}..${splice.endLine})`);
    }
    previousStart = splice.startLine;
    previousEnd = Math.max(previousEnd, splice.endLine);
  }
  const starts = [0];
  const separatorLengths: number[] = [];
  for (const match of text.matchAll(/\r?\n/g)) {
    starts.push((match.index ?? 0) + match[0].length);
    separatorLengths.push(match[0].length);
  }
  let patched = text;
  for (let index = splices.length - 1; index >= 0; index -= 1) {
    const splice = splices[index];
    const startIndex = splice.startLine - 1;
    const deletesLines = splice.endLine >= splice.startLine;
    const replacement = splice.replacementLines.join(newline);
    let from: number;
    let to: number;
    let insert: string;

    if (!deletesLines) {
      from = startIndex < lines.length ? starts[startIndex] : text.length;
      to = from;
      insert = splice.replacementLines.length > 0
        ? startIndex < lines.length
          ? `${replacement}${newline}`
          : `${lines.length > 0 ? newline : ""}${replacement}`
        : "";
    } else if (splice.endLine < lines.length) {
      from = starts[startIndex];
      to = starts[splice.endLine];
      insert = splice.replacementLines.length > 0 ? `${replacement}${newline}` : "";
    } else if (startIndex === 0) {
      from = 0;
      to = text.length;
      insert = replacement;
    } else {
      from = starts[startIndex] - separatorLengths[startIndex - 1];
      to = text.length;
      insert = splice.replacementLines.length > 0 ? `${newline}${replacement}` : "";
    }
    patched = `${patched.slice(0, from)}${insert}${patched.slice(to)}`;
  }
  return patched;
};
