import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
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

  it("loads v3 documents with default print layout", () => {
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
  });
});
