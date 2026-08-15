import { statementTypeOf } from "../dsl/dslCompiler";
import { isElementDslStatement } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { createCadElementId } from "../model/cadIds";
import type { CadElementType, ElementId } from "../types/geometry";
import { createStatementIdentity, type StatementIdentity } from "./statementIdentity";

// statementReconciler — 再パースされたDSL文書の各文へ、直前のコンパイル結果から
// 実行時要素IDを最大限継承させる純粋照合器。
//
// 継承は優先順位付きの6段階で行う。上位段階で対応付いた文は下位段階の対象から
// 除外され、判定はすべて決定論的(曖昧な候補は継承しない)。
//
//  1. 文テキスト(トリム済み生行)配列のLCS差分 — 不変領域はID直接継承。
//  2. 残余の完全キーマッチ「スコープキー+型+名前」 — 属性編集・同一スコープ内の
//     行移動。
//  3. LCS置換ハンク内の位置対応ペアリング(型+スコープキー一致) — リネームと
//     無名⇄有名の遷移。
//  4. 無名残余を「スコープキー+型+相対順序」でマッチ。
//  5. 残余全体で「名前+型」が新旧ちょうど1対1に対応する場合のみ継承 —
//     グループ跨ぎの移動(indent/outdent)・branch切替。
//  6. 残りの追加は新規ID、削除は消滅。リネーム+移動の同時実行と型変更は
//     対応不能で新規ID(許容制約)。
//
// 対象は要素文とsource-level identity-bearing文。typed declaration/set/module文は
// CadElementにはしないが、binding・lexical scope・module namespaceのownerになるため、
// 同じ照合規則でopaque statement identityを継承する。

export type ReconcileInput = {
  oldStatements: readonly DslStatement[];
  /** 旧テキストの行配列(改行正規化済み)。CompiledDslDocument.sourceLines。 */
  oldLines: readonly string[];
  /** 旧文index(全文配列基準)→ 実行時要素ID。statementMap.elementIdByStatementIndex。 */
  oldElementIds: ReadonlyMap<number, ElementId>;
  /** 旧文index→ reconcilerが所有するidentity。typed declarationを含む。 */
  oldStatementIds?: ReadonlyMap<number, StatementIdentity>;
  newStatements: readonly DslStatement[];
  newLines: readonly string[];
};

export type ReconcileStage = 1 | 2 | 3 | 4 | 5 | 6;

export type ReconcileOptions = {
  /** 段階6の新規ID生成器。省略時は createCadElementId。テストでは決定論的生成器を注入する。 */
  createId?: (type: CadElementType) => ElementId;
  /** typed declaration/set/module用のopaque identity生成器。 */
  createStatementId?: (
    kind: "typedDeclaration" | "set" | "moduleDefinition" | "moduleInstance" | "printLayout"
  ) => StatementIdentity;
};

export type ReconcileResult = {
  /** 新文index(全文配列基準)→ ID。compileDslDocument の assignedElementIds へそのまま渡せる。 */
  assignedIds: Map<number, StatementIdentity>;
  /** 段階1〜5で旧IDを継承した文の数。 */
  inheritedCount: number;
  /** 段階6で新規生成されたID(assignedIds の部分集合)。 */
  createdIds: Map<number, StatementIdentity>;
  /** どの新文にも継承されなかった旧ID(旧文書順)。 */
  vanishedIds: StatementIdentity[];
  stageByNewStatementIndex: Map<number, ReconcileStage>;
};

export type DiffHunk = {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
};

export type DiffResult = {
  pairs: Array<[number, number]>;
  hunks: DiffHunk[];
};

// DP LCSを走らせる中央領域サイズの上限。超える場合(実質的な全文置換)は
// 中央全体を1つの置換ハンクとして扱い、キー系段階(2〜5)に解決を委ねる。
const LCS_AREA_LIMIT = 250_000;

export const diffTexts = (oldTexts: readonly string[], newTexts: readonly string[]): DiffResult => {
  const n = oldTexts.length;
  const m = newTexts.length;
  let prefix = 0;
  while (prefix < n && prefix < m && oldTexts[prefix] === newTexts[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    oldTexts[n - 1 - suffix] === newTexts[m - 1 - suffix]
  ) {
    suffix += 1;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < prefix; i += 1) pairs.push([i, i]);

  const midN = n - suffix - prefix;
  const midM = m - suffix - prefix;
  if (midN > 0 && midM > 0 && midN * midM <= LCS_AREA_LIMIT) {
    // 逆向きDP + 前向きバックトラック(タイは旧側前進を優先=決定論)。
    const width = midM + 1;
    const dp = new Int32Array((midN + 1) * width);
    for (let i = midN - 1; i >= 0; i -= 1) {
      for (let j = midM - 1; j >= 0; j -= 1) {
        dp[i * width + j] =
          oldTexts[prefix + i] === newTexts[prefix + j]
            ? dp[(i + 1) * width + j + 1] + 1
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midN && j < midM) {
      if (oldTexts[prefix + i] === newTexts[prefix + j]) {
        pairs.push([prefix + i, prefix + j]);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }

  for (let s = 0; s < suffix; s += 1) pairs.push([n - suffix + s, m - suffix + s]);

  const hunks: DiffHunk[] = [];
  let prevOld = -1;
  let prevNew = -1;
  for (const [oldIndex, newIndex] of [...pairs, [n, m] as [number, number]]) {
    if (oldIndex - prevOld > 1 || newIndex - prevNew > 1) {
      hunks.push({
        oldStart: prevOld + 1,
        oldEnd: oldIndex,
        newStart: prevNew + 1,
        newEnd: newIndex
      });
    }
    prevOld = oldIndex;
    prevNew = newIndex;
  }
  return { pairs, hunks };
};

const statementText = (statements: readonly DslStatement[], lines: readonly string[]) =>
  statements.map((statement) =>
    lines
      .slice(statement.line - 1, statement.endLine)
      .map((line) => line.trim())
      .join(" ")
  );

export const reconcileStatements = (
  input: ReconcileInput,
  options: ReconcileOptions = {}
): ReconcileResult => {
  const { oldStatements, oldLines, oldElementIds, oldStatementIds = oldElementIds, newStatements, newLines } = input;
  const createId = options.createId ?? createCadElementId;
  const createStatementId = options.createStatementId ?? createStatementIdentity;

  const oldTexts = statementText(oldStatements, oldLines);
  const newTexts = statementText(newStatements, newLines);
  const { pairs, hunks } = diffTexts(oldTexts, newTexts);

  const assignedIds = new Map<number, StatementIdentity>();
  const stageByNewStatementIndex = new Map<number, ReconcileStage>();
  const createdIds = new Map<number, StatementIdentity>();

  const isIdentityStatement = (statement: DslStatement) =>
    isElementDslStatement(statement) ||
    statement.kind === "typedDeclaration" ||
    statement.kind === "set" ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance" ||
    statement.kind === "printLayout";
  const identityKindOf = (statement: DslStatement) =>
    statement.kind === "typedDeclaration" ||
    statement.kind === "set" ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance" ||
    statement.kind === "printLayout"
      ? statement.kind
      : statementTypeOf(statement);

  // 残余(未対応のidentity-bearing文index)。
  const oldResidue = new Set<number>();
  oldStatements.forEach((statement, index) => {
    if (isIdentityStatement(statement) && oldStatementIds.has(index)) oldResidue.add(index);
  });
  const newResidue = new Set<number>();
  newStatements.forEach((statement, index) => {
    if (isIdentityStatement(statement)) newResidue.add(index);
  });

  // ブロック対応: 旧開き文index → マッチ済みフラグ / 新開き文index → 旧開き文index。
  const matchedOldBlocks = new Set<number>();
  const oldBlockByNewBlock = new Map<number, number>();

  const match = (oldIndex: number, newIndex: number, stage: ReconcileStage) => {
    const id = oldStatementIds.get(oldIndex);
    if (id === undefined) return;
    assignedIds.set(newIndex, id);
    stageByNewStatementIndex.set(newIndex, stage);
    oldResidue.delete(oldIndex);
    newResidue.delete(newIndex);
    if (oldStatements[oldIndex].opensBlock && newStatements[newIndex].opensBlock) {
      matchedOldBlocks.add(oldIndex);
      oldBlockByNewBlock.set(newIndex, oldIndex);
    }
  };

  // ==== 段階1: LCS一致領域 ====
  for (const [oldIndex, newIndex] of pairs) {
    const oldStatement = oldStatements[oldIndex];
    const newStatement = newStatements[newIndex];
    if (oldStatement.opensBlock && newStatement.opensBlock) {
      // 非要素ブロック(printLayout)もスコープキーには影響しないが、記録は無害。
      matchedOldBlocks.add(oldIndex);
      oldBlockByNewBlock.set(newIndex, oldIndex);
    }
    if (!isIdentityStatement(newStatement)) continue;
    if (!oldResidue.has(oldIndex) || !newResidue.has(newIndex)) continue;
    match(oldIndex, newIndex, 1);
  }
  // ==== スコープキー(段階が進むと blk: 対応が増えるため都度計算) ====
  const scopeKey = (side: "old" | "new", index: number): string => {
    const statements = side === "old" ? oldStatements : newStatements;
    const enclosing = statements[index].enclosing;
    if (!enclosing) return "root";
    const parentIndex = enclosing.statementIndex;
    const parent = statements[parentIndex];
    const branchSuffix =
      isElementDslStatement(parent) && statementTypeOf(parent) === "conditionalGroup"
        ? `#${enclosing.branch}`
        : "";
    const pairedOldIndex =
      side === "old"
        ? matchedOldBlocks.has(parentIndex)
          ? parentIndex
          : undefined
        : oldBlockByNewBlock.get(parentIndex);
    if (pairedOldIndex !== undefined) return `blk:${pairedOldIndex}${branchSuffix}`;
    if (parent.name) {
      const parentType = isElementDslStatement(parent) ? statementTypeOf(parent) : parent.kind;
      return `${scopeKey(side, parentIndex)}/name:${parentType}:${parent.name}${branchSuffix}`;
    }
    // 無名・未対応の親ブロック配下はキー系マッチに参加できない(一意センチネル)。
    return `⊥${side}:${parentIndex}${branchSuffix}`;
  };

  const residueList = (residue: Set<number>) => [...residue].sort((a, b) => a - b);

  // ==== 段階2: 完全キーマッチ(名前付き、両側とも候補が1つの場合のみ) ====
  // 親ブロックのマッチが同段階内で子のキーを変えるため、不動点まで反復する。
  const runExactKeyStage = () => {
    let progress = true;
    while (progress) {
      progress = false;
      const oldByKey = new Map<string, number[]>();
      for (const index of residueList(oldResidue)) {
        const statement = oldStatements[index];
        if (!statement.name) continue;
        const key = `${scopeKey("old", index)}|${identityKindOf(statement)}|${statement.name}`;
        oldByKey.set(key, [...(oldByKey.get(key) ?? []), index]);
      }
      const newByKey = new Map<string, number[]>();
      for (const index of residueList(newResidue)) {
        const statement = newStatements[index];
        if (!statement.name) continue;
        const key = `${scopeKey("new", index)}|${identityKindOf(statement)}|${statement.name}`;
        newByKey.set(key, [...(newByKey.get(key) ?? []), index]);
      }
      for (const [key, newIndexes] of newByKey) {
        const oldIndexes = oldByKey.get(key);
        if (!oldIndexes || oldIndexes.length !== 1 || newIndexes.length !== 1) continue;
        if (!oldResidue.has(oldIndexes[0]) || !newResidue.has(newIndexes[0])) continue;
        match(oldIndexes[0], newIndexes[0], 2);
        progress = true;
      }
    }
  };
  runExactKeyStage();

  // ==== 段階3: 置換ハンク内の位置対応ペアリング(型+スコープキー一致) ====
  const replaceHunks = hunks.filter(
    (hunk) => hunk.oldEnd > hunk.oldStart && hunk.newEnd > hunk.newStart
  );
  {
    let progress = true;
    while (progress) {
      progress = false;
      for (const hunk of replaceHunks) {
        const oldGroups = new Map<string, number[]>();
        for (const index of residueList(oldResidue)) {
          if (index < hunk.oldStart || index >= hunk.oldEnd) continue;
          const key = `${identityKindOf(oldStatements[index])}|${scopeKey("old", index)}`;
          oldGroups.set(key, [...(oldGroups.get(key) ?? []), index]);
        }
        const newGroups = new Map<string, number[]>();
        for (const index of residueList(newResidue)) {
          if (index < hunk.newStart || index >= hunk.newEnd) continue;
          const key = `${identityKindOf(newStatements[index])}|${scopeKey("new", index)}`;
          newGroups.set(key, [...(newGroups.get(key) ?? []), index]);
        }
        for (const [key, newIndexes] of newGroups) {
          const oldIndexes = oldGroups.get(key);
          if (!oldIndexes) continue;
          const count = Math.min(oldIndexes.length, newIndexes.length);
          for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
            match(oldIndexes[pairIndex], newIndexes[pairIndex], 3);
            progress = true;
          }
        }
      }
    }
  }

  // ==== 段階4: 無名残余を「スコープキー+型+相対順序」で zip ====
  {
    let progress = true;
    while (progress) {
      progress = false;
      const oldGroups = new Map<string, number[]>();
      for (const index of residueList(oldResidue)) {
        const statement = oldStatements[index];
        if (statement.name) continue;
        const key = `${scopeKey("old", index)}|${identityKindOf(statement)}`;
        oldGroups.set(key, [...(oldGroups.get(key) ?? []), index]);
      }
      const newGroups = new Map<string, number[]>();
      for (const index of residueList(newResidue)) {
        const statement = newStatements[index];
        if (statement.name) continue;
        const key = `${scopeKey("new", index)}|${identityKindOf(statement)}`;
        newGroups.set(key, [...(newGroups.get(key) ?? []), index]);
      }
      for (const [key, newIndexes] of newGroups) {
        const oldIndexes = oldGroups.get(key);
        if (!oldIndexes) continue;
        const count = Math.min(oldIndexes.length, newIndexes.length);
        for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
          match(oldIndexes[pairIndex], newIndexes[pairIndex], 4);
          progress = true;
        }
      }
    }
  }

  // ==== 段階5: 残余全体で「名前+型」が新旧1対1のときのみ継承(スコープ非依存) ====
  // グループ跨ぎの移動(indent/outdent)・branch切替をここで救済する(ユーザー承認済みの拡張)。
  {
    const oldByKey = new Map<string, number[]>();
    for (const index of residueList(oldResidue)) {
      const statement = oldStatements[index];
      const key = `${statement.name}|${identityKindOf(statement)}`;
      oldByKey.set(key, [...(oldByKey.get(key) ?? []), index]);
    }
    const newByKey = new Map<string, number[]>();
    for (const index of residueList(newResidue)) {
      const statement = newStatements[index];
      const key = `${statement.name}|${identityKindOf(statement)}`;
      newByKey.set(key, [...(newByKey.get(key) ?? []), index]);
    }
    for (const [key, newIndexes] of newByKey) {
      const oldIndexes = oldByKey.get(key);
      if (!oldIndexes || oldIndexes.length !== 1 || newIndexes.length !== 1) continue;
      match(oldIndexes[0], newIndexes[0], 5);
    }
  }

  const inheritedCount = assignedIds.size;

  // ==== 段階6: 新規ID / 消滅 ====
  for (const index of residueList(newResidue)) {
    const statement = newStatements[index];
    const id = statement.kind === "typedDeclaration" ||
      statement.kind === "set" ||
      statement.kind === "moduleDefinition" ||
      statement.kind === "moduleInstance" ||
      statement.kind === "printLayout"
      ? createStatementId(statement.kind)
      : createId(statementTypeOf(statement));
    assignedIds.set(index, id);
    createdIds.set(index, id);
    stageByNewStatementIndex.set(index, 6);
  }
  const vanishedIds = residueList(oldResidue)
    .map((index) => oldStatementIds.get(index))
    .filter((id): id is StatementIdentity => id !== undefined);

  return { assignedIds, inheritedCount, createdIds, vanishedIds, stageByNewStatementIndex };
};
