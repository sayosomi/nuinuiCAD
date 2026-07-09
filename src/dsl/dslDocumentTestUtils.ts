import { expect } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { parseDslDocument, serializeDocumentToDsl, type DslDocumentData } from "./dslDocument";

// dslDocument系テストの共有ヘルパ(テスト専用。アプリ本体からはimportしない)。

export const emptyDocument = (): DslDocumentData => ({
  elements: [],
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [],
  activePrintLayoutId: "",
  evaluationLimitIndex: 0
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

export const expectSemanticallyEqualDocuments = (a: DslDocumentData, b: DslDocumentData) => {
  expect(normalizeForComparison(a.elements)).toEqual(normalizeForComparison(b.elements));
  expect(a.palette).toEqual(b.palette);
  expect(a.visibilityRoles).toEqual(b.visibilityRoles);
  expect(a.visibilityProfiles).toEqual(b.visibilityProfiles);
  expect(a.evaluationLimitIndex).toBe(b.evaluationLimitIndex);
  expect(a.printLayouts.length).toBe(b.printLayouts.length);
};

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
    evaluationLimitIndex: first.evaluationLimitIndex ?? first.elements.length
  };
  const text = serializeDocumentToDsl(document);
  const parsed = parseDslDocument(text);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return { document, text, parsed: parsed.document! };
};
