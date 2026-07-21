import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { DslDocumentData } from "../dsl/dslDocument";
import type { CadElement } from "../types/geometry";
import { parseCadDocumentFile } from "./documentFormat";
import { ensureNuiDocumentFileName, fileNameFromPath } from "./nuiFormat";

const LEGACY_APP_ID = "nuinuiCAD";
const LEGACY_SCHEMA_VERSION = 5;

type LegacyDocumentFixture = DslDocumentData & { printLayout?: unknown };

const snapshot: LegacyDocumentFixture = {
  elements: sampleElements,
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [DEFAULT_PRINT_LAYOUT],
  activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
  evaluationLimitIndex: sampleElements.length
};

const legacyFileContent = (document: LegacyDocumentFixture = snapshot) => JSON.stringify({
  app: LEGACY_APP_ID,
  schemaVersion: LEGACY_SCHEMA_VERSION,
  savedAt: "2026-06-29T00:00:00.000Z",
  document
});

describe("documentFormat", () => {
  it("parses a legacy nuinuiCAD document file for the importer", () => {
    expect(parseCadDocumentFile(legacyFileContent())).toEqual(snapshot);
  });

  it("silently ignores legacy JSON fold fields", () => {
    const content = legacyFileContent({
      ...snapshot,
      elements: [{
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      } as CadElement]
    });

    expect(parseCadDocumentFile(content).elements[0]).not.toHaveProperty("expanded");
  });

  it("rejects malformed or unsupported files without returning a document", () => {
    expect(() => parseCadDocumentFile("{")).toThrow("JSONとして読み込めません");
    expect(() => parseCadDocumentFile(JSON.stringify({ app: "other", schemaVersion: 1 }))).toThrow(
      "nuinuiCADドキュメントではありません"
    );
    expect(() =>
      parseCadDocumentFile(JSON.stringify({ app: LEGACY_APP_ID, schemaVersion: 2, document: {} }))
    ).toThrow("未対応のドキュメント形式です");
    expect(() =>
      parseCadDocumentFile(
        JSON.stringify({ app: LEGACY_APP_ID, schemaVersion: LEGACY_SCHEMA_VERSION })
      )
    ).toThrow("ドキュメント本体が見つかりません");
    expect(() =>
      parseCadDocumentFile(
        JSON.stringify({
          app: LEGACY_APP_ID,
          schemaVersion: LEGACY_SCHEMA_VERSION,
          document: {}
        })
      )
    ).toThrow("ドキュメントのelementsが不正です");
  });

  // 05: DivisionPlacement union. Legacy `.nuinui.json` files predate the `placement`
  // union and store distance/ratio as flat placementMode/distance/ratio sibling
  // fields (see elementNormalization.ts::withDivisionPlacement). If the file claims
  // a mode but is missing that mode's value, that's data loss -- not something to
  // default away silently.
  it("throws when a legacy divisionPoint is missing its active distance value", () => {
    const elements = [
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      {
        id: "division",
        name: "分点",
        type: "divisionPoint",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" },
        placementMode: "distance",
        ratio: 0.5
      }
    ];

    expect(() =>
      parseCadDocumentFile(
        legacyFileContent({ ...snapshot, elements: elements as unknown as CadElement[] })
      )
    ).toThrow("分点 の距離の値が見つかりません。");
  });

  it("throws when a legacy lineDivisionPoint is missing its active ratio value (ratio or unrecognized mode)", () => {
    const elements = [
      {
        id: "line",
        name: "線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "division",
        name: "線上分点",
        type: "lineDivisionPoint",
        visible: true,
        enabled: true,
        endpoint: { lineId: "line", endpointKey: "start" },
        distance: 5
      }
    ];

    expect(() =>
      parseCadDocumentFile(
        legacyFileContent({ ...snapshot, elements: elements as unknown as CadElement[] })
      )
    ).toThrow("線上分点 の割合の値が見つかりません。");
  });

  it("normalizes document file names and extracts basenames", () => {
    expect(ensureNuiDocumentFileName("/tmp/pattern")).toBe("/tmp/pattern.nui");
    expect(ensureNuiDocumentFileName("/tmp/pattern.nui")).toBe("/tmp/pattern.nui");
    expect(fileNameFromPath("/tmp/pattern.nui")).toBe("pattern.nui");
    expect(fileNameFromPath("C:\\tmp\\pattern.nui")).toBe("pattern.nui");
    expect(fileNameFromPath(null)).toBe("未保存");
  });

  it("serializes and parses palette data", () => {
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        palette: {
          defaultColorId: "red",
          colors: [{ id: "red", name: "Red", hex: "#aa0000" }]
        },
        elements: [{ ...sampleElements[0], colorId: "red" }]
      }
    });

    expect(parseCadDocumentFile(content)).toMatchObject({
      palette: {
        defaultColorId: "red",
        colors: [{ id: "red", name: "Red", hex: "#aa0000" }]
      },
      elements: [{ colorId: "red" }]
    });
  });

  it("normalizes invalid palette data in v3 documents", () => {
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        palette: {
          defaultColorId: "missing",
          colors: [{ id: "ink", name: "", hex: "nope" }]
        }
      }
    });

    expect(parseCadDocumentFile(content).palette).toMatchObject({
      defaultColorId: "ink",
      colors: [{ id: "ink", hex: "#31322f" }]
    });
  });

  it("loads v3 documents with default print layouts", () => {
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: 3,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        printLayout: undefined
      }
    });

    expect(parseCadDocumentFile(content).printLayouts).toEqual([DEFAULT_PRINT_LAYOUT]);
  });

  it("loads v4 documents with a legacy single print layout", () => {
    const legacyLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      id: undefined,
      name: undefined,
      columns: 3
    };
    const content = JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: 4,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        printLayouts: undefined,
        activePrintLayoutId: undefined,
        printLayout: legacyLayout
      }
    });

    expect(parseCadDocumentFile(content).printLayouts).toEqual([
      {
        ...DEFAULT_PRINT_LAYOUT,
        columns: 3
      }
    ]);
  });

  it("preserves representable dangling print references at the JSON boundary", () => {
    const danglingLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      visibilityProfileId: "missing-profile",
      placements: [{
        id: "dangling-placement",
        groupId: "missing-group",
        x: 1,
        y: 2,
        angleDeg: 0,
        mirrorX: false
      }]
    };
    const parsed = parseCadDocumentFile(JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-07-10T00:00:00.000Z",
      document: {
        ...snapshot,
        printLayouts: [danglingLayout],
        printLayout: danglingLayout
      }
    }));

    expect(parsed.printLayouts[0].visibilityProfileId).toBe("missing-profile");
    expect(parsed.printLayouts[0].placements).toEqual(danglingLayout.placements);
  });
});
