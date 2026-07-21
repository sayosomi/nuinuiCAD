import { expect } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ElementId, PointAnchor, PrintLayout } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import {
  layoutElementTree,
  parseDslDocument,
  serializeDocumentToDsl,
  type DslDocumentData,
  type DslMajorVersion
} from "./dslDocument";
import { documentDslRefs } from "./dslSerializer";

// dslDocument系テストの共有ヘルパ(テスト専用。アプリ本体からはimportしない)。

/**
 * テスト専用の既定major。本番の NEW_DOCUMENT_DSL_MAJOR_VERSION /
 * LEGACY_IMPORT_DSL_MAJOR_VERSION とは意図的に別定義とし、どちらかが将来
 * 変わってもこのファイルのテストが無関係に追従しないようにする。
 */
const TEST_DEFAULT_DSL_MAJOR_VERSION: DslMajorVersion = 2;

export const emptyDocument = (): DslDocumentData => ({
  elements: [],
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [],
  activePrintLayoutId: "",
  evaluationLimitIndex: undefined
});

// 意味的等価比較: IDは再割当てされ得るため無視し、参照はすべて「参照先の
// 文書内インデックス」へ正規化してから比較する。conditionalBranch は
// 実際に conditionalGroup の子である場合のみ意味を持つため、それ以外は
// 無視する。
export const normalizeForComparison = (elements: CadElement[]) => {
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const parentIsConditionalGroup = (id: ElementId | undefined) =>
    id !== undefined && elements.find((element) => element.id === id)?.type === "conditionalGroup";
  const remapId = (id: ElementId | undefined) => (id === undefined ? undefined : indexById.get(id) ?? `unknown:${id}`);
  const remapAnchor = (anchor: PointAnchor | null | undefined) => {
    if (!anchor) return anchor;
    if (anchor.mode === "reference") return { mode: "reference", pointId: remapId(anchor.pointId) };
    if (anchor.mode === "derived") return { mode: "derived", elementId: remapId(anchor.elementId), pointKey: anchor.pointKey };
    return anchor;
  };
  const remapEndpoint = (endpoint: { lineId: ElementId; endpointKey: string } | undefined) =>
    endpoint ? { lineId: remapId(endpoint.lineId), endpointKey: endpoint.endpointKey } : endpoint;

  return elements.map((element) => {
    const rest: Record<string, unknown> = { ...element };
    delete rest.id;
    delete rest.numericParameterSteps;
    // fromPointId は offsetPoint/polarOffsetPoint の廃止予定の補助フィールドで、
    // 生成時の暫定候補が入るだけで評価にもDSL往復にも使われない。
    delete rest.fromPointId;
    if ("parentGroupId" in rest) rest.parentGroupId = remapId(element.parentGroupId);
    if ("conditionalBranch" in rest) {
      rest.conditionalBranch = parentIsConditionalGroup(element.parentGroupId) ? element.conditionalBranch : undefined;
    }
    for (const key of ["startPoint", "endPoint", "centerPoint", "fromPoint", "basePoint", "splitPoint", "point", "point1", "point2", "point3", "axisPoint1", "axisPoint2", "anchor", "originPoint"]) {
      if (key in rest) rest[key] = remapAnchor(rest[key] as PointAnchor | null | undefined);
    }
    for (const key of ["endpoint", "endpoint1", "endpoint2"]) {
      if (key in rest) rest[key] = remapEndpoint(rest[key] as { lineId: ElementId; endpointKey: string } | undefined);
    }
    for (const key of ["line1Id", "line2Id", "baseLineId", "lineId"]) {
      if (key in rest) rest[key] = remapId(rest[key] as ElementId | undefined);
    }
    for (const key of ["baseLineIds"]) {
      if (key in rest) rest[key] = (rest[key] as ElementId[]).map((id) => remapId(id));
    }
    if ("intermediatePoints" in rest) {
      rest.intermediatePoints = (rest.intermediatePoints as Array<Record<string, unknown>>).map((point) => ({
        ...point,
        id: undefined,
        point: remapAnchor(point.point as PointAnchor)
      }));
    }
    return rest;
  });
};

// PrintLayoutの実行時IDを除いて意味比較する。placeのgroup参照は要素IDではなく
// 文書内インデックスへ正規化し、layoutVarはnumericVariablesとして比較する。
export const comparableLayouts = (layouts: readonly PrintLayout[] | undefined, elements: readonly CadElement[]) => {
  const index = new Map(elements.map((element, position) => [element.id, position]));
  return (layouts ?? []).map((layout) => ({
    name: layout.name, outputKind: layout.outputKind, visibilityProfileId: layout.visibilityProfileId,
    paperSizeId: layout.paperSizeId, orientation: layout.orientation, columns: layout.columns, rows: layout.rows,
    overlapMm: layout.overlapMm, scale: layout.scale, svgCanvasWidthMm: layout.svgCanvasWidthMm, svgCanvasHeightMm: layout.svgCanvasHeightMm,
    numericVariables: (layout.numericVariables ?? []).map((variable) => ({ name: variable.name, value: variable.value })),
    placements: layout.placements.map((placement) => ({ x: placement.x, y: placement.y, angleDeg: placement.angleDeg, mirrorX: placement.mirrorX, groupId: index.get(placement.groupId) ?? `unknown:${placement.groupId}` }))
  }));
};

export const expectSemanticallyEqualDocuments = (a: DslDocumentData, b: DslDocumentData) => {
  expect(normalizeForComparison(a.elements)).toEqual(normalizeForComparison(b.elements));
  expect(a.palette).toEqual(b.palette);
  expect(a.visibilityRoles).toEqual(b.visibilityRoles);
  expect(a.visibilityProfiles).toEqual(b.visibilityProfiles);
  expect(a.evaluationLimitIndex).toBe(b.evaluationLimitIndex);
  expect(a.printLayouts.length).toBe(b.printLayouts.length);
};

// 要素配列 → DSL本文行(パレット/可視性/印刷レイアウトの定型セクションを含まない、
// 要素ツリー部分のみ)。グループ/if/forのブロック構造・インデントは
// layoutElementTree が処理するため、parentGroupId で紐付いたネスト要素もそのまま渡せる。
// evaluationLimitIndex省略時は全要素を評価対象とする(@stopなし)。テストが
// @stopマーカーの位置を検証したい場合のみ明示的に渡す。
export const dslLinesForElements = (elements: CadElement[], evaluationLimitIndex?: number): string[] => {
  const refs = documentDslRefs(elements);
  return layoutElementTree(elements, refs, evaluationLimitIndex).flatMap((row) => row.lines);
};

// 要素配列 → `nui 1` ヘッダ付きのDSL本文全体(パレット/可視性設定なし)。
// テストが「有効などこかの要素を含む文書」だけを必要とし、v1構文自体は
// 検証対象でない場合の入力生成に使う。
export const dslTextForElements = (elements: CadElement[], evaluationLimitIndex?: number): string =>
  [`nui ${TEST_DEFAULT_DSL_MAJOR_VERSION}`, ...dslLinesForElements(elements, evaluationLimitIndex)].join("\n");

// 要素配列 → `nui 1` ヘッダ付きのDSL本文全体、id=/parent=/branch=を明示出力する
// flat(非ネスト)モード。id保持の往復(reconciler/rename系のテストが対象
// element の id を明示的に固定したい場合)に使う。documentDslRefs による
// 名前解決トークンではなく生IDトークンで参照を書くため、通常の
// dslTextForElements より非user-facingだが、id= 属性の構文自体を手書きせずに
// 生成できる。
export const dslFlatTextForElements = (elements: CadElement[]): string =>
  serializeDocumentToDsl(
    {
      ...emptyDocument(),
      elements,
      palette: { colors: [], defaultColorId: "" },
      visibilityProfiles: [],
      activeVisibilityProfileId: ""
    },
    TEST_DEFAULT_DSL_MAJOR_VERSION,
    { preserveElementOrder: true }
  );

export const roundTrip = (source: string) => {
  const first = compileDslToElements(source, { elements: [], mode: "document" });
  expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const document: DslDocumentData = {
    elements: first.elements,
    palette: first.palette ?? defaultDocumentPalette(),
    visibilityRoles: first.visibilityRoles ?? [],
    visibilityProfiles: first.visibilityProfiles?.length ? first.visibilityProfiles : [defaultVisibilityProfile()],
    activeVisibilityProfileId: first.activeVisibilityProfileId ?? defaultVisibilityProfile().id,
    printLayouts: first.printLayouts ?? [],
    activePrintLayoutId: first.activePrintLayoutId ?? first.printLayouts?.[0]?.id ?? "",
    evaluationLimitIndex: first.evaluationLimitIndex
  };
  const text = serializeDocumentToDsl(document, TEST_DEFAULT_DSL_MAJOR_VERSION);
  const parsed = parseDslDocument(text);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return { document, text, parsed: parsed.document! };
};
