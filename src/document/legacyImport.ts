import { LEGACY_IMPORT_DSL_MAJOR_VERSION, serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { CadElement } from "../types/geometry";
import { parseCadDocumentFile } from "./documentFormat";
import { imagePathForDocument } from "./imageFilePaths";

const withoutLegacyUiFields = (element: CadElement): CadElement => {
  const next = { ...element };
  delete next.numericParameterSteps;
  return next;
};

const importedElements = (elements: CadElement[], legacyPath: string): CadElement[] => {
  const imported: CadElement[] = [];

  for (const rawElement of elements) {
    const element = withoutLegacyUiFields(rawElement);
    // 旧JSONはIDで参照するため、同一スコープの重複名を許していた。DSLでは
    // 一意名が必要なので、文書順で先出名を維持し、後出だけを連番改名する。
    const name = makeUniqueElementName({
      elements: imported,
      requestedName: element.name,
      fallbackBaseName: fallbackElementName(element.type),
      parentGroupId: element.parentGroupId
    });
    const withName = name === element.name ? element : { ...element, name } as CadElement;
    imported.push(withName.type === "image"
      ? {
          ...withName,
          sourcePath: imagePathForDocument(withName.sourcePath, legacyPath, null)
        }
      : withName);
  }

  return imported;
};

/** Converts a legacy JSON file into a fresh, unsaved .nui document text. */
export const importLegacyCadDocument = (content: string, legacyPath: string): string => {
  const legacy = parseCadDocumentFile(content);
  const document: DslDocumentData = {
    elements: importedElements(legacy.elements, legacyPath),
    palette: legacy.palette,
    visibilityRoles: legacy.visibilityRoles,
    visibilityProfiles: legacy.visibilityProfiles,
    activeVisibilityProfileId: legacy.activeVisibilityProfileId,
    printLayouts: legacy.printLayouts,
    activePrintLayoutId: legacy.activePrintLayoutId,
    evaluationLimitIndex: legacy.evaluationLimitIndex
  };
  // 旧JSONは親子グループが文書順に連続しているとは限らない。ブロックへ
  // 再配置すると評価順が変わるため、ID/parent 属性で元の順序をそのまま保つ。
  return serializeDocumentToDsl(document, LEGACY_IMPORT_DSL_MAJOR_VERSION, { preserveElementOrder: true });
};
