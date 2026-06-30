import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import { migrateDocumentToYUp } from "./documentMigration";

export const CAD_DOCUMENT_APP_ID = "nuinuiCAD";
export const CAD_DOCUMENT_SCHEMA_VERSION = 2;
const SUPPORTED_CAD_DOCUMENT_SCHEMA_VERSIONS = [1, CAD_DOCUMENT_SCHEMA_VERSION] as const;
export const CAD_DOCUMENT_EXTENSION = "nuinui.json";

export type CadDocumentFile = {
  schemaVersion: typeof CAD_DOCUMENT_SCHEMA_VERSION;
  app: typeof CAD_DOCUMENT_APP_ID;
  savedAt: string;
  document: CadDocumentSnapshot;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseDocumentObject = (value: unknown): CadDocumentSnapshot => {
  if (!isRecord(value)) {
    throw new Error("ドキュメント本体が見つかりません。");
  }
  if (!Array.isArray(value.elements)) {
    throw new Error("ドキュメントのelementsが不正です。");
  }

  return {
    elements: value.elements as CadDocumentSnapshot["elements"],
    evaluationLimitIndex:
      typeof value.evaluationLimitIndex === "number"
        ? value.evaluationLimitIndex
        : value.elements.length,
    selectedElementId:
      typeof value.selectedElementId === "string" ? value.selectedElementId : null,
    selectedElementIds: Array.isArray(value.selectedElementIds)
      ? value.selectedElementIds.filter((id): id is string => typeof id === "string")
      : [],
    selectionAnchorElementId:
      typeof value.selectionAnchorElementId === "string" ? value.selectionAnchorElementId : null,
    selectedParameterKey: (
      typeof value.selectedParameterKey === "string" ? value.selectedParameterKey : null
    ) as CadDocumentSnapshot["selectedParameterKey"]
  };
};

export const cadDocumentFileFromSnapshot = (
  document: CadDocumentSnapshot,
  savedAt = new Date().toISOString()
): CadDocumentFile => ({
  schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
  app: CAD_DOCUMENT_APP_ID,
  savedAt,
  document
});

export const serializeCadDocumentFile = (
  document: CadDocumentSnapshot,
  savedAt?: string
) => `${JSON.stringify(cadDocumentFileFromSnapshot(document, savedAt), null, 2)}\n`;

export const parseCadDocumentFile = (content: string): CadDocumentSnapshot => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("JSONとして読み込めません。");
  }

  if (!isRecord(parsed)) {
    throw new Error("nuinuiCADドキュメントではありません。");
  }
  if (parsed.app !== CAD_DOCUMENT_APP_ID) {
    throw new Error("nuinuiCADドキュメントではありません。");
  }
  if (
    typeof parsed.schemaVersion !== "number" ||
    !SUPPORTED_CAD_DOCUMENT_SCHEMA_VERSIONS.includes(
      parsed.schemaVersion as (typeof SUPPORTED_CAD_DOCUMENT_SCHEMA_VERSIONS)[number]
    )
  ) {
    throw new Error(`未対応のドキュメント形式です: schemaVersion ${String(parsed.schemaVersion)}`);
  }

  const document = parseDocumentObject(parsed.document);
  return parsed.schemaVersion === 1 ? migrateDocumentToYUp(document) : document;
};

export const ensureCadDocumentFileName = (path: string) =>
  path.endsWith(`.${CAD_DOCUMENT_EXTENSION}`) ? path : `${path}.${CAD_DOCUMENT_EXTENSION}`;

export const fileNameFromPath = (path: string | null) => {
  if (!path) return "未保存";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
};
