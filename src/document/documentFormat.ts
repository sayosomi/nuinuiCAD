import type { DslDocumentData } from "../dsl/dslDocument";
import { normalizedElementFields } from "../model/elementNormalization";
import {
  normalizeGroupVisibilityRoleIds,
  normalizeVisibilityProfiles,
  normalizeVisibilityRoles
} from "../model/visibilityProfiles";
import { normalizeDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT, normalizePrintLayouts } from "../print/printLayout";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { ElementId, PrintLayout } from "../types/geometry";

export type CadDocumentSelectionSnapshot = {
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
  selectedParameterKey: ParameterKey | null;
};

/** Phase 1c compatibility shape used only at the legacy JSON boundary. */
export type CadDocumentSnapshot = DslDocumentData & CadDocumentSelectionSnapshot & {
  printLayout: PrintLayout;
};

export const docToLegacySnapshot = (
  document: DslDocumentData,
  selection: CadDocumentSelectionSnapshot
): CadDocumentSnapshot => {
  const printLayout =
    document.printLayouts.find((layout) => layout.id === document.activePrintLayoutId) ??
    document.printLayouts[0] ??
    DEFAULT_PRINT_LAYOUT;
  return {
    ...document,
    printLayout,
    ...selection
  };
};

export const CAD_DOCUMENT_APP_ID = "nuinuiCAD";
export const CAD_DOCUMENT_SCHEMA_VERSION = 5;
export const LEGACY_CAD_DOCUMENT_EXTENSION = "nuinui.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const withoutLegacyGroupFold = (element: CadDocumentSnapshot["elements"][number]) => {
  const current = { ...element } as typeof element & {
    expanded?: unknown;
    elseExpanded?: unknown;
  };
  delete current.expanded;
  delete current.elseExpanded;
  return current as CadDocumentSnapshot["elements"][number];
};

const parseDocumentObject = (value: unknown): CadDocumentSnapshot => {
  if (!isRecord(value)) {
    throw new Error("ドキュメント本体が見つかりません。");
  }
  if (!Array.isArray(value.elements)) {
    throw new Error("ドキュメントのelementsが不正です。");
  }

  const rawElements = (value.elements as CadDocumentSnapshot["elements"])
    .map(withoutLegacyGroupFold)
    .map(normalizedElementFields);
  const visibilityRoles = normalizeVisibilityRoles(value.visibilityRoles, rawElements);
  const visibilityProfiles = normalizeVisibilityProfiles({
    profiles: value.visibilityProfiles,
    roles: visibilityRoles
  });
  const activeVisibilityProfileId =
    typeof value.activeVisibilityProfileId === "string" &&
    visibilityProfiles.some((profile) => profile.id === value.activeVisibilityProfileId)
      ? value.activeVisibilityProfileId
      : visibilityProfiles[0].id;
  const elements = rawElements.map((element) =>
    normalizeGroupVisibilityRoleIds(element, visibilityRoles)
  );
  const printLayouts = normalizePrintLayouts({
    printLayouts: value.printLayouts,
    legacyPrintLayout: value.printLayout,
    elements,
    visibilityProfiles,
    preserveDanglingReferences: true
  });
  const activePrintLayoutId =
    typeof value.activePrintLayoutId === "string" &&
    printLayouts.some((layout) => layout.id === value.activePrintLayoutId)
      ? value.activePrintLayoutId
      : printLayouts[0].id;
  const printLayout =
    printLayouts.find((layout) => layout.id === activePrintLayoutId) ?? printLayouts[0];

  return {
    elements,
    palette: normalizeDocumentPalette(value.palette),
    visibilityRoles,
    visibilityProfiles,
    activeVisibilityProfileId,
    printLayouts,
    activePrintLayoutId,
    printLayout,
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
    ![CAD_DOCUMENT_SCHEMA_VERSION, 4, 3].includes(parsed.schemaVersion)
  ) {
    throw new Error(`未対応のドキュメント形式です: schemaVersion ${String(parsed.schemaVersion)}`);
  }

  return parseDocumentObject(parsed.document);
};
