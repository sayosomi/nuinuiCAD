import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { expectSemanticallyEqualDocuments } from "../dsl/dslDocumentTestUtils";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import { evaluateElements } from "../geometry/evaluate";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { currentDocumentSnapshot, initialCadDocumentState } from "../state/cadDocumentStore";
import { initialCadUiState } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { importLegacyCadDocument } from "./legacyImport";
import qualifiedNegativeExpressionFixture from "./__fixtures__/legacy-qualified-negative-expression.nuinui.json?raw";

const LEGACY_APP_ID = "nuinuiCAD";
const LEGACY_SCHEMA_VERSION = 5;

const legacyContent = () => {
  const base = currentDocumentSnapshot(initialCadDocumentState(), initialCadUiState());
  const unnamed = {
    ...base.elements[0],
    name: "",
    numericParameterSteps: { x: 5 }
  } as CadElement;
  const image: CadElement = {
    id: "legacy-image",
    name: "",
    type: "image",
    visible: true,
    enabled: true,
    sourcePath: "assets/reference.png",
    originPoint: { mode: "coordinate", x: 0, y: 0 },
    naturalWidthPx: 1200,
    naturalHeightPx: 800,
    sourceDpi: 300,
    targetPixelsPerMm: 300 / 25.4,
    scale: 1,
    angleDeg: 0,
    mirrorX: false,
    numericParameterSteps: { scale: 0.1 }
  };
  return JSON.stringify({
    app: LEGACY_APP_ID,
    schemaVersion: LEGACY_SCHEMA_VERSION,
    savedAt: "2026-07-10T00:00:00.000Z",
    document: {
      ...base,
      elements: [unnamed, ...base.elements.slice(1), image],
      selectedElementId: "legacy-image",
      selectedElementIds: ["legacy-image"],
      selectionAnchorElementId: "legacy-image",
      selectedParameterKey: "scale"
    }
  });
};

describe("legacy JSON import", () => {
  it("quotes negative qualified expressions in numeric attributes without truncating them", () => {
    const importedText = importLegacyCadDocument(
      qualifiedNegativeExpressionFixture,
      "/legacy/qualified-negative-expression.nuinui.json"
    );
    const compiled = compileDslDocument(importedText);

    expect(importedText).toContain('distance="- (@notch-height / 5)"');
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const tail = compiled.document!.elements.find((element) => element.name === "しっぽ");
    expect(tail).toMatchObject({
      type: "lineTangentOffsetPoint",
      distance: { kind: "expression" }
    });
    expect(evaluateElements(compiled.document!.elements).errors).toEqual([]);
  });

  it("preserves legacy local-variable IDs referenced by the owning variable expression", () => {
    const elements = compileDslToElements([
      "point A = (0, 0) id=point-a",
      "point B = (100, 0) id=point-b",
      "line AB = A -> B id=line-ab",
      "var 比率 = 0 id=ratio point1=A point2=B vars=[前:20;後ろ:30]"
    ].join("\n"), { elements: [] }).elements.map((element) =>
      element.type === "variable"
        ? {
            ...element,
            expression: { kind: "expression" as const, expression: "@legacy-front / (@legacy-front + @legacy-back)" },
            numericVariables: [
              { id: "legacy-front", name: "前", value: 20 },
              { id: "legacy-back", name: "後ろ", value: 30 }
            ]
          }
        : element
    );
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      document: { elements, evaluationLimitIndex: elements.length }
    });
    const imported = compileDslDocument(importLegacyCadDocument(content, "/legacy/local-ids.nuinui.json"));

    expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(imported.document).not.toBeNull();
    expect(evaluateElements(imported.document!.elements).errors).toEqual([]);
  });

  it("creates deterministic .nui text, assigns names, drops legacy UI steps, and preserves image resolution", () => {
    const content = legacyContent();
    const first = importLegacyCadDocument(content, "/legacy/pattern.nuinui.json");
    const second = importLegacyCadDocument(content, "/legacy/pattern.nuinui.json");
    const compiled = compileDslDocument(first);

    expect(first).toBe(second);
    expect(first).not.toContain("steps=");
    expect(first).not.toContain("selectedElementId");
    expect(first).not.toContain("printLayout\":");
    expect(first).toContain('sourcePath="/legacy/assets/reference.png"');
    expect(compiled.document).not.toBeNull();
    expect(compiled.document!.elements.every((element) => element.name.trim().length > 0)).toBe(true);
    expect(compiled.document!.elements.find((element) => element.type === "image")).toMatchObject({
      naturalWidthPx: 1200,
      naturalHeightPx: 800,
      sourceDpi: 300
    });
  });

  it("keeps the first existing duplicate name and renames later siblings without merging their children", () => {
    const group = (id: string, name: string, parentGroupId?: string) => ({
      id,
      name,
      type: "group" as const,
      visible: true,
      enabled: true,
      parentGroupId,
      printEnabled: false,
      printAnchor: { mode: "coordinate" as const, x: 0, y: 0 }
    }) as CadElement;
    const point = (id: string, parentGroupId: string) => ({
      id,
      name: "頂点",
      type: "freePoint" as const,
      visible: true,
      enabled: true,
      parentGroupId,
      x: 0,
      y: 0
    }) as CadElement;
    const outer = group("outer", "本体");
    const first = group("notch-1", "凸ノッチ", outer.id);
    const second = group("notch-2", "凸ノッチ", outer.id);
    const layout = {
      ...DEFAULT_PRINT_LAYOUT,
      placements: [{
        id: "placed-second-notch",
        groupId: second.id,
        x: 0,
        y: 0,
        angleDeg: 0,
        mirrorX: false
      }]
    };
    const document = {
      elements: [outer, first, point("first-tip", first.id), second, point("second-tip", second.id)],
      palette: defaultDocumentPalette(),
      visibilityRoles: [],
      visibilityProfiles: [defaultVisibilityProfile()],
      activeVisibilityProfileId: defaultVisibilityProfile().id,
      printLayouts: [layout],
      activePrintLayoutId: layout.id,
      printLayout: layout,
      evaluationLimitIndex: 5,
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null,
      selectedParameterKey: null
    };
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-07-11T00:00:00.000Z",
      document
    });

    const imported = compileDslDocument(importLegacyCadDocument(content, "/legacy/duplicate-names.nuinui.json"));

    expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(imported.document).not.toBeNull();
    const importedGroups = imported.document!.elements.filter((element) => element.type === "group");
    expect(importedGroups.map((element) => element.name)).toEqual(["本体", "凸ノッチ", "凸ノッチ 2"]);
    const secondNotch = importedGroups.find((element) => element.name === "凸ノッチ 2");
    expect(secondNotch).toBeDefined();
    expect(imported.document!.elements.filter((element) => element.name === "頂点")).toHaveLength(2);
    expect(imported.document!.printLayouts[0].placements[0].groupId).toBe(secondNotch?.id);
  });

  it("preserves order, non-contiguous group membership, image paths, and print layouts together", () => {
    const group = (id: string, name: string, parentGroupId?: string) => ({
      id,
      name,
      type: "group" as const,
      visible: true,
      enabled: true,
      parentGroupId,
      printEnabled: false,
      printAnchor: { mode: "coordinate" as const, x: 0, y: 0 }
    }) as CadElement;
    const point = (id: string, name: string, parentGroupId: string) => ({
      id,
      name,
      type: "freePoint" as const,
      visible: true,
      enabled: true,
      parentGroupId,
      x: 0,
      y: 0
    }) as CadElement;
    const outer = group("outer", "本体");
    const firstNotch = group("notch-1", "凸ノッチ", outer.id);
    const secondNotch = group("notch-2", "凸ノッチ", outer.id);
    const firstLayout = { ...DEFAULT_PRINT_LAYOUT, id: "layout-1", name: "印刷 1" };
    const secondLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      id: "layout-2",
      name: "印刷 2",
      placements: [{
        id: "place-second-notch",
        groupId: secondNotch.id,
        x: 12,
        y: 34,
        angleDeg: 0,
        mirrorX: false
      }]
    };
    const document = {
      elements: [
        outer,
        firstNotch,
        point("first-tip", "先端", firstNotch.id),
        point("outer-guide", "ガイド", outer.id),
        secondNotch,
        point("second-tip", "先端", secondNotch.id),
        {
          id: "image",
          name: "下絵",
          type: "image" as const,
          visible: true,
          enabled: true,
          sourcePath: "assets/reference.png",
          originPoint: { mode: "coordinate" as const, x: 0, y: 0 },
          naturalWidthPx: 1200,
          naturalHeightPx: 800,
          sourceDpi: 300,
          targetPixelsPerMm: 300 / 25.4,
          scale: 1,
          angleDeg: 0,
          mirrorX: false
        } as CadElement
      ],
      palette: defaultDocumentPalette(),
      visibilityRoles: [],
      visibilityProfiles: [defaultVisibilityProfile()],
      activeVisibilityProfileId: defaultVisibilityProfile().id,
      printLayouts: [firstLayout, secondLayout],
      activePrintLayoutId: secondLayout.id,
      evaluationLimitIndex: 7
    };
    const importedText = importLegacyCadDocument(JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      document: { ...document, printLayout: secondLayout }
    }), "/legacy/non-contiguous.nuinui.json");
    const parsed = parseDsl(importedText);
    const imported = compileDslDocument(importedText);

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(imported.document).not.toBeNull();
    expect(imported.document!.elements.map(({ name }) => name)).toEqual([
      "本体", "凸ノッチ", "先端", "ガイド", "凸ノッチ 2", "先端", "下絵"
    ]);

    const importedFirstNotch = imported.document!.elements.find((element) => element.name === "凸ノッチ");
    const importedSecondNotch = imported.document!.elements.find((element) => element.name === "凸ノッチ 2");
    expect(importedFirstNotch).toMatchObject({ type: "group", parentGroupId: outer.id });
    expect(importedSecondNotch).toMatchObject({ type: "group", parentGroupId: outer.id });
    expect(imported.document!.elements.find((element) => element.name === "ガイド")?.parentGroupId).toBe(outer.id);
    expect(imported.document!.elements.find((element) => element.id === "first-tip")?.parentGroupId).toBe(
      importedFirstNotch?.id
    );
    expect(imported.document!.elements.find((element) => element.id === "second-tip")?.parentGroupId).toBe(
      importedSecondNotch?.id
    );
    expect(imported.document!.elements.find((element) => element.type === "image")).toMatchObject({
      sourcePath: "/legacy/assets/reference.png"
    });
    expect(imported.document!.printLayouts.map((layout) => layout.name)).toEqual(["印刷 1", "印刷 2"]);
    expect(
      imported.document!.printLayouts.find((layout) => layout.id === imported.document!.activePrintLayoutId)?.name
    ).toBe("印刷 2");
    expect(imported.document!.printLayouts[1].placements[0]?.groupId).toBe(importedSecondNotch?.id);
  });

  it("preserves every current element type semantically through legacy JSON conversion", () => {
    const elements = compileDslToElements([
      "group G id=g1",
      "var V = 840 id=v1",
      "point A = (0, 0) id=p1",
      "point B = offset A dx=10 dy=5 id=p2",
      "point C = polar A angle=45 distance=30 id=p3",
      "line AB = A -> B id=l1",
      "line L = from A angle=0 length=100 id=l2",
      "arc Arc center=A radius=30 start=0 end=90 id=a1",
      "point D = between A B ratio=0.5 id=p4",
      "point E = on AB.end distance=10 id=p5",
      "point X = intersection AB L index=0 extensions=false id=p6",
      "point T = tangentOffset Arc base=A angle=0 distance=5 id=p7",
      "arc Corner = corner AB.end L.start radius=5 index=0 id=a2",
      "element Edge type=edge endpoint1=AB.start endpoint2=L.end intersectionIndex=0 id=e1",
      "line Trim = extend L.end to=E id=l3",
      "curve Curve = A -> B startAngle=0 startLength=10 endAngle=180 endLength=10 id=c1",
      "line Offset = offset [AB] distance=3 side=left closed=false id=l4",
      "line Split = split Arc at=D id=l5",
      "element Copy type=copyLine startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB] id=e2",
      "element SymCopy type=symmetricCopyLine axisPoint1=A axisPoint2=B baseLineIds=[AB] id=e3",
      "element Move type=move startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB] id=e4",
      "element SymMove type=symmetricMove axisPoint1=A axisPoint2=B baseLineIds=[AB] id=e5",
      "arc Three = through A B C start=0 end=180 id=a3",
      "element If type=conditionalGroup condition=1 id=e6",
      "element For type=forGroup variableName=i start=0 count=2 step=1 showGenerated=false id=e7",
      "element Img type=image sourcePath=\"asset.png\" originPoint=A naturalWidthPx=120 naturalHeightPx=80 sourceDpi=300 targetPixelsPerMm=11.811023622047244 scale=1 angleDeg=0 mirrorX=false id=e8",
      "text Label = \"label\" at=A size=3 id=t1"
    ].join("\n"), { elements: [] }).elements;
    const legacyDocument = {
      elements,
      palette: defaultDocumentPalette(),
      visibilityRoles: [],
      visibilityProfiles: [defaultVisibilityProfile()],
      activeVisibilityProfileId: defaultVisibilityProfile().id,
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      evaluationLimitIndex: elements.length
    };
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-07-10T00:00:00.000Z",
      document: { ...legacyDocument, printLayout: DEFAULT_PRINT_LAYOUT }
    });
    const expected = {
      ...legacyDocument,
      elements: elements.map((element) => element.type === "image"
        ? { ...element, sourcePath: "/legacy/asset.png" }
        : element)
    };

    const imported = compileDslDocument(importLegacyCadDocument(content, "/legacy/all.nuinui.json"));

    expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(imported.document).not.toBeNull();
    expectSemanticallyEqualDocuments(expected, imported.document!);
  });
});
