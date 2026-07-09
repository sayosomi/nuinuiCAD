import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import { createDefaultPrintLayout } from "../print/printLayout";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { parseDslDocument, serializeDocumentToDsl, type DslDocumentData } from "./dslDocument";
import sampleFixture from "./__fixtures__/sample.nui?raw";

const emptyDocument = (): DslDocumentData => ({
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
const normalizeForComparison = (elements: CadElement[]) => {
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

const expectSemanticallyEqualDocuments = (a: DslDocumentData, b: DslDocumentData) => {
  expect(normalizeForComparison(a.elements)).toEqual(normalizeForComparison(b.elements));
  expect(a.palette).toEqual(b.palette);
  expect(a.visibilityRoles).toEqual(b.visibilityRoles);
  expect(a.visibilityProfiles).toEqual(b.visibilityProfiles);
  expect(a.evaluationLimitIndex).toBe(b.evaluationLimitIndex);
  expect(a.printLayouts.length).toBe(b.printLayouts.length);
};

const roundTrip = (source: string) => {
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

describe("dslDocument round-trip matrix", () => {
  it("round-trips freePoint via coordinate literal", () => {
    const { document, parsed } = roundTrip("point A = (12.5, -30)");
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetPoint via name reference and expression", () => {
    const { document, parsed } = roundTrip(["var d = 12", "point A = (0, 0)", "point B = offset A dx=d dy=-(d * 2)"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips polarOffsetPoint", () => {
    const { document, parsed } = roundTrip(["point A = (0, 0)", "point B = polar A angle=45 distance=10"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips divisionPoint by ratio and by distance", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "point M1 = between A B ratio=0.5", "point M2 = between A B distance=30"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineDivisionPoint via derived endpoint anchor", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "line AB = A -> B", "point M = on AB.end distance=10"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips intersectionPoint by qualified line ids", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (0, 100)",
        "point D = (100, 100)",
        "line AB = A -> B",
        "line CD = C -> D",
        "point X = intersection AB CD index=0 extensions=true"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineTangentOffsetPoint", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "arc c center=A radius=50 start=0 end=180", "point H = tangentOffset c base=A angle=30 distance=5"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips line via -> and angleLengthLine via from/angle/length", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "line AB = A -> B", "line shoulder = from A angle=-12 length=130"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips arcLine, threePointArcLine, cornerRadiusArcLine", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (50, 50)",
        "point C = (100, 0)",
        "line AB = A -> B",
        "line BC = B -> C",
        "arc simple center=A radius=30 start=0 end=90",
        "arc three = through A B C start=0 end=180",
        "arc corner = corner AB.end BC.start radius=10 index=0"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips edge and extendTrim", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (150, 0)",
        "line AB = A -> B",
        "line BC = B -> C",
        "element e1 type=edge endpoint1=AB.end endpoint2=BC.start intersectionIndex=0",
        "line extended = extend AB.end to=C"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips bezierCurve with intermediate points", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 30)",
        "curve neckline = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[C:45:20:25]"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetLine, splitLine", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 0)",
        "line AB = A -> B",
        "line seam = offset [AB] distance=10 side=left closed=false",
        "line lower = split AB at=C"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips copyLine, symmetricCopyLine, move, symmetricMove via generic element syntax", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "line AB = A -> B",
        "element cp type=copyLine startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB]",
        "element sym type=symmetricCopyLine axisPoint1=A axisPoint2=B baseLineIds=[AB]",
        "element mv type=move startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB]",
        "element smv type=symmetricMove axisPoint1=A axisPoint2=B baseLineIds=[AB]"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips image via generic element syntax", () => {
    const { document, parsed } = roundTrip(
      "element img type=image sourcePath=\"assets/ref.png\" originPoint=(0,0) scale=1 angleDeg=0 mirrorX=false"
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text with quoted body and derived anchor", () => {
    const { document, parsed } = roundTrip(["point A = (0, 0)", "text label = \"前中心\" at=A size=4"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips variable with expression mode and with pointDistance mode", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (10, 0)",
        "var bust = 840",
        "var d = 0 mode=pointDistance point1=A point2=B scope=group"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument nesting", () => {
  it("round-trips nested groups", () => {
    const source = [
      "group 前身頃 {",
      "  point A = (0, 0)",
      "  group 襟 {",
      "    point B = (1, 1)",
      "  }",
      "  point C = (2, 2)",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(parsed.elements.map((element) => element.type)).toEqual(["group", "freePoint", "group", "freePoint", "freePoint"]);
  });

  it("round-trips if/else branches", () => {
    const source = ["if 分岐 condition=1 {", "  point A = (0, 0)", "} else {", "  point B = (1, 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips for blocks", () => {
    const source = ["for 繰返し i start=0 count=3 step=1 {", "  point P = (i * 10, 0)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips deeply nested group/if/for combinations", () => {
    const source = [
      "group 外 {",
      "  if 内分岐 condition=1 {",
      "    for 内繰返し i start=0 count=2 step=1 {",
      "      point P = (i, 0)",
      "    }",
      "  } else {",
      "    point Q = (0, 0)",
      "  }",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument unnamed elements", () => {
  it("round-trips unnamed elements at the root", () => {
    const source = ["point = (0, 0)", "point = (5, 5)"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(parsed.elements.map((element) => element.name)).toEqual(["", ""]);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips unnamed group blocks", () => {
    const source = ["group {", "  point A = (0, 0)", "}"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.elements[0].name).toBe("");
    expect(parsed.elements[1].parentGroupId).toBe(parsed.elements[0].id);
  });
});

describe("dslDocument palette", () => {
  it("round-trips palette colors and defaultColorId", () => {
    const source = [
      "nui 1",
      "",
      "color main \"#112233\" name=\"本体\"",
      "color accent \"#445566\" name=\"アクセント\" default"
    ].join("\n");
    const parsed = parseDslDocument(source);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document?.palette).toEqual({
      colors: [
        { id: "main", name: "本体", hex: "#112233" },
        { id: "accent", name: "アクセント", hex: "#445566" }
      ],
      defaultColorId: "accent"
    });
    const reserialized = serializeDocumentToDsl(parsed.document!);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.document?.palette).toEqual(parsed.document?.palette);
  });

  it("falls back to the default palette when no color statements are present", () => {
    const parsed = parseDslDocument("nui 1\n\npoint A = (0, 0)");
    expect(parsed.document?.palette).toEqual(defaultDocumentPalette());
  });
});

describe("dslDocument printLayout and activePrintLayout", () => {
  it("round-trips a full print layout block", () => {
    const source = [
      "nui 1",
      "",
      "role seam name=\"縫い代\"",
      "view 印刷 default=true seam=true",
      "",
      "printLayout A4 output=svg view=印刷 paper=a3 orientation=landscape columns=3 rows=4 overlap=15 scale=0.5 canvas=(500, 700) {",
      "  layoutVar margin = 20",
      "  place 前身頃 at=(10, margin) angle=90 mirrorX=true",
      "}",
      "",
      "group 前身頃 {",
      "  point A = (0, 0)",
      "}"
    ].join("\n");
    const parsed = parseDslDocument(source);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const layout = parsed.document!.printLayouts[0];
    expect(layout).toMatchObject({
      name: "A4",
      outputKind: "svg",
      paperSizeId: "a3",
      orientation: "landscape",
      columns: 3,
      rows: 4,
      overlapMm: 15,
      scale: 0.5,
      svgCanvasWidthMm: 500,
      svgCanvasHeightMm: 700
    });
    expect(layout.placements).toHaveLength(1);
    expect(layout.numericVariables).toHaveLength(1);

    const reserialized = serializeDocumentToDsl(parsed.document!);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reparsed.document!.printLayouts[0]).toMatchObject({
      name: "A4",
      outputKind: "svg",
      paperSizeId: "a3",
      orientation: "landscape"
    });
  });

  it("omits the activePrintLayout statement when the active layout is first", () => {
    const document: DslDocumentData = {
      ...emptyDocument(),
      printLayouts: [createDefaultPrintLayout([]), createDefaultPrintLayout([{ id: "print-layout-1" }])].map((layout, index) => ({
        ...layout,
        name: `layout-${index}`
      })),
      activePrintLayoutId: undefined as unknown as string
    };
    document.activePrintLayoutId = document.printLayouts[0].id;
    const text = serializeDocumentToDsl(document);
    expect(text).not.toContain("activePrintLayout");
  });

  it("promotes a deterministic name for an unnamed non-first active print layout", () => {
    const first = { ...createDefaultPrintLayout([]), id: "layout-1", name: "先頭" };
    const second = { ...createDefaultPrintLayout([first]), id: "layout-2", name: "" };
    const document: DslDocumentData = {
      ...emptyDocument(),
      printLayouts: [first, second],
      activePrintLayoutId: second.id
    };
    const text = serializeDocumentToDsl(document);
    expect(text).toContain("activePrintLayout レイアウト1");
    expect(text).toContain("printLayout レイアウト1");

    const reparsed = parseDslDocument(text);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reparsed.document!.printLayouts[1].name).toBe("レイアウト1");
    expect(reparsed.document!.activePrintLayoutId).toBe(reparsed.document!.printLayouts[1].id);
  });
});

describe("dslDocument @stop / evaluationLimitIndex", () => {
  it("round-trips a mid-document @stop", () => {
    const source = ["point A = (0, 0)", "point B = (1, 1)", "@stop", "point C = (2, 2)"].join("\n");
    const { document, parsed, text } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text).toContain("@stop");
  });

  it("omits @stop entirely when the whole document evaluates", () => {
    const source = ["point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const { text, parsed } = roundTrip(source);
    expect(text).not.toContain("@stop");
    expect(parsed.evaluationLimitIndex).toBe(2);
  });

  it("places @stop before the first element when evaluationLimitIndex is 0", () => {
    const source = ["@stop", "point A = (0, 0)"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.evaluationLimitIndex).toBe(0);
  });

  it("keeps @stop working when nested inside a group", () => {
    const source = ["group G {", "  point A = (0, 0)", "  @stop", "  point B = (1, 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
  });
});

describe("dslDocument idempotence", () => {
  it("is a fixed point for a rich hand-written document", () => {
    const first = parseDslDocument(sampleFixture);
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const canonical = serializeDocumentToDsl(first.document!);
    const second = parseDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const reserialized = serializeDocumentToDsl(second.document!);
    expect(reserialized).toBe(canonical);
  });

  it("is a fixed point for an empty document", () => {
    const canonical = serializeDocumentToDsl(emptyDocument());
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!)).toBe(canonical);
  });

  it("is a fixed point for a document with non-contiguous group children (parent= fallback)", () => {
    const g1 = compileDslToElements("group G id=g1", { elements: [] }).elements[0];
    let elements: CadElement[] = [g1];
    elements = compileDslToElements("point A = (0, 0) id=pa parent=g1", { elements }).elements;
    elements = compileDslToElements("point R = (1, 1) id=pr", { elements }).elements;
    elements = compileDslToElements("point B = (2, 2) id=pb parent=g1", { elements }).elements;

    const document: DslDocumentData = { ...emptyDocument(), elements, evaluationLimitIndex: elements.length };
    const canonical = serializeDocumentToDsl(document);
    expect(canonical).toContain("parent=G");
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!)).toBe(canonical);

    const b = parsed.document!.elements.find((element) => element.name === "B");
    const g = parsed.document!.elements.find((element) => element.name === "G");
    expect(b?.parentGroupId).toBe(g?.id);
  });
});

describe("dslDocument version handling", () => {
  it("rejects a missing nui header", () => {
    const parsed = parseDslDocument("point A = (0, 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("nui"))).toBe(true);
  });

  it("rejects an empty document", () => {
    const parsed = parseDslDocument("");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("rejects an unknown major version", () => {
    const parsed = parseDslDocument("nui 2\npoint A = (0, 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("未対応のDSLバージョン"))).toBe(true);
  });

  it("rejects a non-numeric version", () => {
    const parsed = parseDslDocument("nui abc");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("不正なDSLバージョン"))).toBe(true);
  });

  it("rejects a duplicate nui statement", () => {
    const parsed = parseDslDocument(["nui 1", "nui 1", "point A = (0, 0)"].join("\n"));
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("先頭に1つだけ"))).toBe(true);
  });

  it("accepts a valid nui 1 header with a leading comment", () => {
    const parsed = parseDslDocument(["# comment before header is not allowed to precede nui", "nui 1", "point A = (0, 0)"].join("\n"));
    // comments do not produce statements, so nui 1 is still the first statement
    expect(parsed.document).not.toBeNull();
  });
});

describe("dslDocument golden fixture", () => {
  it("parses the sample fixture without diagnostics and preserves key structure", () => {
    const parsed = parseDslDocument(sampleFixture);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const document = parsed.document!;
    expect(document.palette.colors.map((color) => color.id)).toEqual(["pattern-black", "cut-red"]);
    expect(document.palette.defaultColorId).toBe("pattern-black");
    expect(document.visibilityRoles).toEqual([{ id: "seam", name: "縫い代" }]);
    expect(document.printLayouts).toHaveLength(1);
    expect(document.printLayouts[0].placements).toHaveLength(1);
    expect(document.elements.some((element) => element.name === "前身頃" && element.type === "group")).toBe(true);
    expect(document.evaluationLimitIndex).toBeLessThan(document.elements.length);
  });
});
