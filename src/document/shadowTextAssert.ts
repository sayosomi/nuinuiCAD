import { serializeDocumentToDsl, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { CadElement, ElementId } from "../types/geometry";
import { reconcileStatements } from "./statementReconciler";
import { zipAssignedElementIds } from "./shadowText";

// shadowTextAssert — dev/test 限定の観測用ヘルパ(docs/overhaul/tasks/phase-1b-shadow-text.md)。
//
// prodビルドでは等価再コンパイル(高コスト)を一切実行しない。
// `import.meta.env.DEV` は vite が dev サーバーでも vitest でも true を返す
// (`vite build` でのみ false)ため、「testでは常時有効・devでは有効・prodでは無効」
// という要求をこの1つのフラグで満たせる。

export const shadowAssertEnabled = import.meta.env.DEV;

// 意味的等価 = 正準シリアライズ比較。ID差・字面差・整形差を正規化して吸収する
// (影は常にzip済みなので、無名要素参照の生IDフォールバックも一致する)。
export const assertShadowEquivalent = (afterDoc: DslDocumentData, shadowDocument: DslDocumentData | null): boolean => {
  if (!shadowDocument) {
    console.error("[shadowText] 影テキストの再コンパイルに失敗しました(document=null)。全体再生成します。");
    return false;
  }
  const expected = serializeDocumentToDsl(afterDoc);
  const actual = serializeDocumentToDsl(shadowDocument);
  if (expected === actual) return true;

  console.error("[shadowText] 影テキストとモデルの意味的等価assertに失敗しました。全体再生成します。", {
    expectedPreview: expected.split("\n").slice(0, 10).join("\n"),
    actualPreview: actual.split("\n").slice(0, 10).join("\n")
  });
  return false;
};

const branchOf = (element: CadElement): "then" | "else" => (element.conditionalBranch === "else" ? "else" : "then");

// 「移動」= 他の生存要素との相対順序・親グループ・branchのいずれかが変化したか。
// textPatch.ts の diffDocuments が使う LIS ベースの move/update 分類は、
// 「最小編集列」を作るための非対称な判定であり、2要素が入れ替わった場合に
// 片方だけを「move」とみなすことがある(スワップの対称性が失われる)。
// ここでの目的は逆に「この要素の位置は本当に変わっていないか」を対称に
// 判定することなので、全生存要素ペアの相対順序の逆転を直接調べる。
const computeMovedIds = (
  prevElements: readonly CadElement[],
  afterElements: readonly CadElement[],
  prevById: Map<ElementId, CadElement>,
  afterById: Map<ElementId, CadElement>
): Set<ElementId> => {
  const survivingOldOrder = prevElements.map((element) => element.id).filter((id) => afterById.has(id));
  const survivingNewOrder = afterElements.map((element) => element.id).filter((id) => prevById.has(id));
  const newIndexOf = new Map(survivingNewOrder.map((id, index) => [id, index]));

  const moved = new Set<ElementId>();
  for (let i = 0; i < survivingOldOrder.length; i += 1) {
    const idA = survivingOldOrder[i];
    for (let j = i + 1; j < survivingOldOrder.length; j += 1) {
      const idB = survivingOldOrder[j];
      // survivingOldOrder は既に old 順なので oldIndexOf(idA) < oldIndexOf(idB) は常に真。
      if (newIndexOf.get(idA)! > newIndexOf.get(idB)!) {
        moved.add(idA);
        moved.add(idB);
      }
    }
  }
  for (const id of survivingOldOrder) {
    const prevElement = prevById.get(id)!;
    const afterElement = afterById.get(id)!;
    if (prevElement.parentGroupId !== afterElement.parentGroupId) {
      moved.add(id);
      continue;
    }
    if (prevElement.parentGroupId && branchOf(prevElement) !== branchOf(afterElement)) {
      moved.add(id);
    }
  }
  return moved;
};

// statementReconciler の実戦検証(結果は捨てる。Phase 1c での本番利用に備えた
// 継承率チェックのみ)。
//
// 重要な設計判断:
//
// 1. 「ID継承が仕様上必須の操作」と「対応不能が許容される操作」を区別する。
//    Phase 1a 仕様表(phase-1a-pure-modules.md)により、リネーム+行移動の
//    同時実行・型変更は新規ID(許容制約)になる。よって
//    `createdIds`/`vanishedIds` と before/after のモデルID集合差の完全一致を
//    assert条件にはしない。生存要素(挿入でも削除でもない)のうち、
//    「リネームと移動が同一コミットで同時発生」した場合だけ継承免除とする。
//
// 2. 挿入・削除自体の継承検証は行わない。statementReconciler は文テキストの
//    位置対応でリネームを検出する(段階3)ため、「同じ位置・同じ型」の
//    削除+挿入(例: 末尾要素を消して同種の新規要素を追加する、という
//    ごく普通の操作)は原理的に「リネーム」と区別がつかず、ID を引き継いで
//    しまうことがある。これは reconciler の設計上受け入れている曖昧性であり
//    (Phase 1a 仕様のリネーム判定規則そのもの)、バグではない。よってここで
//    createdIds/vanishedIds を挿入/削除の実モデル差と厳密照合することはしない。
//
// 3. 比較の基準は常に `prevCompiled.document`(影が実際に比較する旧状態)と
//    `afterDoc` にする。ストアの `before`/`after` スナップショットは使わない
//    — テスト等が `setState` で影を経由せずモデルを直接書き換えた場合
//    (drift)、ストアの before/after 差と影の実際の前提が食い違い、
//    偽警告になり得るため。
export const assertReconcileSane = (
  prevCompiled: CompiledDslDocument,
  nextShadowText: string,
  afterDoc: DslDocumentData
): void => {
  if (!prevCompiled.document || !prevCompiled.statementMap) return; // 初回・復旧直後は照合対象がない

  const normalized = nextShadowText.replace(/\r\n/g, "\n");
  const parsedNew = parseDsl(normalized);
  if (parsedNew.diagnostics.some((item) => item.severity === "error")) return; // 影の破損自体はequivalence assertの責務

  const zipped = zipAssignedElementIds(parsedNew.statements, afterDoc.elements);
  if (!zipped) return; // 構造不整合はzip側の自己修復に任せる(ここでは検証しない)

  const prevDoc = prevCompiled.document;
  const result = reconcileStatements({
    oldStatements: prevCompiled.statements,
    oldLines: prevCompiled.sourceLines,
    oldElementIds: prevCompiled.statementMap.elementIdByStatementIndex,
    newStatements: parsedNew.statements,
    newLines: normalized.split("\n")
  });

  const prevById = new Map(prevDoc.elements.map((element) => [element.id, element]));
  const afterById = new Map(afterDoc.elements.map((element) => [element.id, element]));
  const movedIds = computeMovedIds(prevDoc.elements, afterDoc.elements, prevById, afterById);
  const renamedIds = new Set(
    [...prevById.entries()]
      .filter(([id, prevElement]) => afterById.has(id) && afterById.get(id)!.name !== prevElement.name)
      .map(([id]) => id)
  );

  // 生存要素(挿入/削除でない)でリネーム+移動が同時発生していないものはID継承必須。
  const mustInheritIds = [...prevById.keys()].filter((id) => {
    if (!afterById.has(id)) return false;
    return !(renamedIds.has(id) && movedIds.has(id));
  });

  const createdStatementIndexes = new Set(result.createdIds.keys());
  const inheritedIdSet = new Set(
    [...result.assignedIds.entries()]
      .filter(([statementIndex]) => !createdStatementIndexes.has(statementIndex))
      .map(([, id]) => id)
  );
  const missingInheritance = mustInheritIds.filter((id) => !inheritedIdSet.has(id));

  if (missingInheritance.length > 0) {
    console.error("[shadowText] statementReconciler の実戦検証で異常を検出しました(Phase 1cへの引き継ぎ課題)。", {
      missingInheritance
    });
  }
};
