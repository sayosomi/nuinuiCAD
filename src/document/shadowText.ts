import {
  compileDslDocument,
  serializeDocumentToDsl,
  type CompiledDslDocument,
  type DslDocumentData,
  type DslMajorVersion
} from "../dsl/dslDocument";
import { isElementDslStatement, parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import type {
  CadElement,
  DocumentPalette,
  ElementId,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { applyLineSplices, buildTextPatch } from "./textPatch";

// shadowText — モデル更新後も canonical DSL text とコンパイル結果を
// 同期させる影テキスト維持機構。
//
// 正準は DSL テキストとその最後に成功したコンパイル結果である。ここで維持する `ShadowState`
// は観測専用の派生データで、`textPatch` と `compileDslDocument` の結果を
// 実ユーザー操作の全経路で検証するために存在する。
//
// 核心の設計: 影の statementMap は必ず「店(モデル)の実行時ID」でキーする。
// `layoutElementTree` は `elements` 配列順に1要素1文を出力し、textPatch は
// その構造を鏡写しにするため、パッチ後テキストの要素文列は必ず
// `afterDoc.elements` と同順・1対1になる。この位置対応(zip)で
// `assignedElementIds` を組み `compileDslDocument` に注入することで、
// 影の要素IDを店のIDに一致させる(statementReconciler の照合結果は使わない
// — 影の再コンパイルでは document 順の1対1対応を使う)。

export type ShadowState = {
  text: string;
  compiled: CompiledDslDocument;
};

// ストアの状態全体には依存しない(循環import回避 +
// 影機構自体の純粋性維持)。読むフィールドだけを構造的に受け取る。
export type ModelSnapshotForShadow = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  evaluationLimitIndex: number | undefined;
};

export const snapshotToDslData = (snapshot: ModelSnapshotForShadow): DslDocumentData => ({
  elements: snapshot.elements,
  palette: snapshot.palette,
  visibilityRoles: snapshot.visibilityRoles,
  visibilityProfiles: snapshot.visibilityProfiles,
  activeVisibilityProfileId: snapshot.activeVisibilityProfileId,
  printLayouts: snapshot.printLayouts,
  activePrintLayoutId: snapshot.activePrintLayoutId,
  evaluationLimitIndex: snapshot.evaluationLimitIndex
});

// 新パース結果の要素文(document順)を `elements` 配列(同じくdocument順)と
// 1:1で位置対応させ、`compileDslDocument` へ渡す `assignedElementIds` を組む。
// 個数不一致は呼び出し側が自己修復(全体再生成)する判断材料として null を返す。
export const zipAssignedElementIds = (
  statements: readonly DslStatement[],
  elements: readonly CadElement[]
): Map<number, ElementId> | null => {
  const elementStatementIndexes: number[] = [];
  statements.forEach((statement, index) => {
    if (isElementDslStatement(statement)) elementStatementIndexes.push(index);
  });
  if (elementStatementIndexes.length !== elements.length) return null;
  const assigned = new Map<number, ElementId>();
  elementStatementIndexes.forEach((statementIndex, position) => {
    assigned.set(statementIndex, elements[position].id);
  });
  return assigned;
};

export type ShadowCompileFailure = {
  reason: string;
};

type ShadowCompileResult = { ok: true; compiled: CompiledDslDocument } | ({ ok: false } & ShadowCompileFailure);

// テキストを zip 済み `assignedElementIds` でコンパイルし、以下2つの不変条件を
// 明示的に検証する(不一致は黙ってzipを続行しない):
//  * 要素文数 === elements.length
//  * コンパイル後の要素ID列(document順) === elements のID列
const compileWithZippedIds = (text: string, elements: readonly CadElement[]): ShadowCompileResult => {
  const normalized = text.replace(/\r\n/g, "\n");
  const preParsed = parseDsl(normalized);
  if (preParsed.diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, reason: "影テキストの構文解析に失敗しました。" };
  }

  const assignedElementIds = zipAssignedElementIds(preParsed.statements, elements);
  if (!assignedElementIds) {
    const statementCount = preParsed.statements.filter(isElementDslStatement).length;
    return {
      ok: false,
      reason: `要素文数(${statementCount})が afterDoc.elements(${elements.length})と一致しません。`
    };
  }

  const compiled = compileDslDocument(normalized, {
    assignedElementIds,
    preparsed: preParsed
  });
  if (!compiled.document || !compiled.statementMap) {
    return { ok: false, reason: "影テキストの再コンパイルに失敗しました(診断エラーあり)。" };
  }

  const compiledIds = compiled.document.elements.map((element) => element.id);
  const expectedIds = elements.map((element) => element.id);
  const idsMatch =
    compiledIds.length === expectedIds.length && compiledIds.every((id, index) => id === expectedIds[index]);
  if (!idsMatch) {
    return { ok: false, reason: "zip後の要素ID列がafterDoc.elementsの順序と一致しません。" };
  }

  return { ok: true, compiled };
};

// 全体再生成(モデル→シリアライズ→zip→コンパイル)。初期状態・
// replaceDocument・undo/redo・自己修復のみで使う正当な経路。
//
// Dangling dependencies are recoverable warnings && must pass this path while
// retaining their source tokens. A failure here therefore indicates an
// unexpected serializer/parser/compiler invariant break; the safe wrapper is
// retained as the final defense for that class of failure.
export const generateShadowFromModel = (afterDoc: DslDocumentData, majorVersion: DslMajorVersion): ShadowState => {
  const text = serializeDocumentToDsl(afterDoc, majorVersion);
  const result = compileWithZippedIds(text, afterDoc.elements);
  if (!result.ok) {
    throw new Error(`shadowText: 全体再生成に失敗しました: ${result.reason}`);
  }
  return { text, compiled: result.compiled };
};

const MINIMAL_SHADOW_TEXT = "nui 4";

// generateShadowFromModel の最終防衛版。予期しない parser/serializer/compiler
// 失敗が初期化・ファイル読込・undo/redoを止めないよう、最小文書へ後退する。
// Dangling reference は通常経路で成功するため、このfallback理由にはならない。
export const safeGenerateShadowFromModel = (
  afterDoc: DslDocumentData,
  majorVersion: DslMajorVersion,
  onFailure?: (reason: string) => void
): ShadowState => {
  try {
    return generateShadowFromModel(afterDoc, majorVersion);
  } catch (error) {
    onFailure?.(error instanceof Error ? error.message : String(error));
    return { text: MINIMAL_SHADOW_TEXT, compiled: compileDslDocument(MINIMAL_SHADOW_TEXT) };
  }
};

export type AdvanceShadowOptions = {
  /** 復旧発生時の通知(console.error 呼び出しは呼び出し側=shadowTextAssert.ts のdev判定に委ねる)。 */
  onSelfHeal?: (reason: string) => void;
};

// 1コミット分の影更新。行パッチ→zipでのID注入→コンパイルを試み、
// 表現できない差分・zip不一致・例外はすべて全体再生成(自己修復)へ倒す。
// ユーザー操作を止めないことが最優先のため、この関数は例外を投げない
// (全体再生成自体が失敗した場合のみ、直前の影をそのまま維持する)。
export const advanceShadow = (
  prev: ShadowState,
  afterDoc: DslDocumentData,
  majorVersion: DslMajorVersion,
  options: AdvanceShadowOptions = {}
): ShadowState => {
  try {
    if (!prev.compiled.document || !prev.compiled.statementMap) {
      return generateShadowFromModel(afterDoc, majorVersion);
    }
    const splices = buildTextPatch({ old: prev.compiled, newDocument: afterDoc });
    const patchedText = applyLineSplices(prev.text, splices);
    const result = compileWithZippedIds(patchedText, afterDoc.elements);
    if (!result.ok) {
      options.onSelfHeal?.(result.reason);
      return generateShadowFromModel(afterDoc, majorVersion);
    }
    return { text: patchedText, compiled: result.compiled };
  } catch (error) {
    options.onSelfHeal?.(error instanceof Error ? error.message : String(error));
    try {
      return generateShadowFromModel(afterDoc, majorVersion);
    } catch {
      // 全体再生成自体が失敗する最終防衛線: 直前の影を維持しユーザー操作は止めない。
      return prev;
    }
  }
};
