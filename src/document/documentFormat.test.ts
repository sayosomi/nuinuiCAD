import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import {
  CAD_DOCUMENT_APP_ID,
  CAD_DOCUMENT_SCHEMA_VERSION,
  ensureCadDocumentFileName,
  fileNameFromPath,
  parseCadDocumentFile,
  serializeCadDocumentFile
} from "./documentFormat";

const snapshot: CadDocumentSnapshot = {
  elements: sampleElements,
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [DEFAULT_PRINT_LAYOUT],
  activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
  printLayout: DEFAULT_PRINT_LAYOUT,
  evaluationLimitIndex: sampleElements.length,
  selectedElementId: sampleElements[0].id,
  selectedElementIds: [sampleElements[0].id],
  selectionAnchorElementId: sampleElements[0].id,
  selectedParameterKey: "name"
};

describe("documentFormat", () => {
  it("serializes and parses a nuinuiCAD document file", () => {
    const content = serializeCadDocumentFile(snapshot, "2026-06-29T00:00:00.000Z");
    const parsedFile = JSON.parse(content);

    expect(parsedFile).toMatchObject({
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
      savedAt: "2026-06-29T00:00:00.000Z"
    });
    expect(parseCadDocumentFile(content)).toEqual(snapshot);
  });

  it("silently ignores legacy JSON fold fields", () => {
    const content = serializeCadDocumentFile({
      ...snapshot,
      elements: [{
        id: "group",
        name: "身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: true
      } as unknown as CadDocumentSnapshot["elements"][number]]
    });

    expect(parseCadDocumentFile(content).elements[0]).not.toHaveProperty("expanded");
  });

  it("rejects malformed or unsupported files without returning a document", () => {
    expect(() => parseCadDocumentFile("{")).toThrow("JSONとして読み込めません");
    expect(() => parseCadDocumentFile(JSON.stringify({ app: "other", schemaVersion: 1 }))).toThrow(
      "nuinuiCADドキュメントではありません"
    );
    expect(() =>
      parseCadDocumentFile(JSON.stringify({ app: CAD_DOCUMENT_APP_ID, schemaVersion: 2, document: {} }))
    ).toThrow("未対応のドキュメント形式です");
    expect(() =>
      parseCadDocumentFile(
        JSON.stringify({ app: CAD_DOCUMENT_APP_ID, schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION })
      )
    ).toThrow("ドキュメント本体が見つかりません");
    expect(() =>
      parseCadDocumentFile(
        JSON.stringify({
          app: CAD_DOCUMENT_APP_ID,
          schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
          document: {}
        })
      )
    ).toThrow("ドキュメントのelementsが不正です");
  });

  it("normalizes document file names and extracts basenames", () => {
    expect(ensureCadDocumentFileName("/tmp/pattern")).toBe("/tmp/pattern.nuinui.json");
    expect(ensureCadDocumentFileName("/tmp/pattern.nuinui.json")).toBe("/tmp/pattern.nuinui.json");
    expect(fileNameFromPath("/tmp/pattern.nuinui.json")).toBe("pattern.nuinui.json");
    expect(fileNameFromPath("C:\\tmp\\pattern.nuinui.json")).toBe("pattern.nuinui.json");
    expect(fileNameFromPath(null)).toBe("未保存");
  });

  it("serializes and parses palette data", () => {
    const content = JSON.stringify({
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
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
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
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
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: 3,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        printLayout: undefined
      }
    });

    expect(parseCadDocumentFile(content).printLayout).toEqual(DEFAULT_PRINT_LAYOUT);
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
      app: CAD_DOCUMENT_APP_ID,
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
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
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
