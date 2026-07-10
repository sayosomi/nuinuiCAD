import { serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
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
  const named = elements.map(withoutLegacyUiFields);

  for (let index = 0; index < named.length; index += 1) {
    const element = named[index];
    const name = element.name.trim()
      ? element.name
      : makeUniqueElementName({
          elements: named,
          elementId: element.id,
          requestedName: "",
          fallbackBaseName: fallbackElementName(element.type),
          parentGroupId: element.parentGroupId
        });
    const withName = name === element.name ? element : { ...element, name } as CadElement;
    named[index] = withName.type === "image"
      ? {
          ...withName,
          sourcePath: imagePathForDocument(withName.sourcePath, legacyPath, null)
        }
      : withName;
  }

  return named;
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
  return serializeDocumentToDsl(document);
};
