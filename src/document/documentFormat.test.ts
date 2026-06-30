import { describe, expect, it } from "vitest";
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
      parseCadDocumentFile(JSON.stringify({ app: CAD_DOCUMENT_APP_ID, schemaVersion: 3, document: {} }))
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

  it("migrates v1 documents to Y-up coordinates", () => {
    const content = JSON.stringify({
      app: CAD_DOCUMENT_APP_ID,
      schemaVersion: 1,
      savedAt: "2026-06-29T00:00:00.000Z",
      document: {
        ...snapshot,
        elements: [
          { id: "p", name: "P", type: "freePoint", visible: true, enabled: true, x: 10, y: 20 },
          {
            id: "q",
            name: "Q",
            type: "offsetPoint",
            visible: true,
            enabled: true,
            fromPointId: "p",
            dx: 5,
            dy: { kind: "expression", expression: "p.y + 10" }
          },
          {
            id: "l",
            name: "L",
            type: "line",
            visible: true,
            enabled: true,
            startPoint: { mode: "coordinate", x: 0, y: 30 },
            endPoint: { mode: "reference", pointId: "p" }
          }
        ]
      }
    });

    expect(parseCadDocumentFile(content).elements).toMatchObject([
      { y: -20 },
      { dy: { kind: "expression", expression: "-(p.y + 10)" } },
      { startPoint: { y: -30 } }
    ]);
  });
});
