import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { relativeImagePath } from "../document/imageFilePaths";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultTargetPixelsPerMm, initialImageScale } from "../geometry/imageScale";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { createCadElement } from "../model/elementFactory";
import { makeUniqueElementName } from "../model/elementNames";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { finishCreatedElementInteraction } from "./nameEntryAfterCreation";

type ImageMetadata = {
  widthPx: number;
  heightPx: number;
  dpi?: number | null;
};

const IMAGE_FILTER = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "webp"]
};

const selectedPath = (value: string | string[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value;

const fileNameFromPath = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;

const imageMetadataFromBrowserFile = (file: File): Promise<ImageMetadata & { sourcePath: string }> =>
  new Promise((resolve, reject) => {
    const sourcePath = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        sourcePath,
        widthPx: image.naturalWidth,
        heightPx: image.naturalHeight,
        dpi: null
      });
    image.onerror = () => {
      URL.revokeObjectURL(sourcePath);
      reject(new Error("画像を読み込めません。"));
    };
    image.src = sourcePath;
  });

const pickBrowserImageFile = () =>
  new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });

const pickTauriImagePath = async () => {
  return selectedPath(
    await open({
      filters: [IMAGE_FILTER],
      multiple: false
    })
  );
};

const loadTauriImageMetadata = async (path: string) => {
  return invoke<ImageMetadata>("read_image_metadata", { path });
};

const creationContext = () => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  return {
    elements,
    ...creationPlacementForEvaluationLimit(
      elements,
      evaluationLimitIndex,
      useCadUiStore.getState().groupFoldById
    )
  };
};

const commitCreatedImage = (
  element: CadElement,
  elements: CadElement[],
  insertionIndex: number
) => {
  const placedElement = applyCreationPlacement(
    element,
    creationPlacementForEvaluationLimit(
      elements,
      insertionIndex,
      useCadUiStore.getState().groupFoldById
    )
  );
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [
      ...elements.slice(0, insertionIndex),
      placedElement,
      ...elements.slice(insertionIndex)
    ],
    evaluationLimitIndex: insertionIndex + 1,
    selectedElementId: placedElement.id,
    selectedElementIds: [placedElement.id],
    selectionAnchorElementId: placedElement.id
  });
  finishCreatedElementInteraction();
};

export const commitPendingImageImport = ({
  sourcePath,
  displayName,
  naturalWidthPx,
  naturalHeightPx,
  sourceDpi,
  targetPixelsPerMm
}: {
  sourcePath: string;
  displayName: string;
  naturalWidthPx: number;
  naturalHeightPx: number;
  sourceDpi: number;
  targetPixelsPerMm: number;
}) => {
  const { elements, insertionIndex, referenceElements } = creationContext();
  const placement = creationPlacementForEvaluationLimit(
    elements,
    insertionIndex,
    useCadUiStore.getState().groupFoldById
  );
  const element = createCadElement("image", elements, { referenceElements });
  if (element.type !== "image") return;

  const imageElement: CadElement = {
    ...element,
    ...(placement.parentGroupId ? { parentGroupId: placement.parentGroupId } : {}),
    ...(placement.conditionalBranch ? { conditionalBranch: placement.conditionalBranch } : {}),
    name: makeUniqueElementName({
      elements,
      elementId: element.id,
      requestedName: displayName,
      fallbackBaseName: element.name,
      parentGroupId: placement.parentGroupId
    }),
    sourcePath,
    naturalWidthPx,
    naturalHeightPx,
    sourceDpi,
    targetPixelsPerMm,
    scale: initialImageScale(sourceDpi, targetPixelsPerMm)
  };
  commitCreatedImage(imageElement, elements, insertionIndex);
};

const metadataErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "画像を読み込めません。";

export const addImage = async () => {
  try {
    let metadata: ImageMetadata;
    let sourcePath: string;
    let displayName: string;

    if (isTauriRuntime()) {
      const path = await pickTauriImagePath();
      if (!path) return;
      metadata = await loadTauriImageMetadata(path);
      sourcePath = relativeImagePath(path, useCadDocumentStore.getState().currentFilePath);
      displayName = fileNameFromPath(path);
    } else {
      const file = await pickBrowserImageFile();
      if (!file) return;
      const browserMetadata = await imageMetadataFromBrowserFile(file);
      metadata = browserMetadata;
      sourcePath = browserMetadata.sourcePath;
      displayName = file.name;
    }

    const sourceDpi = metadata.dpi && metadata.dpi > 0 ? metadata.dpi : 300;
    useCadUiStore.setState({
      pendingImageImport: {
        sourcePath,
        displayName,
        naturalWidthPx: metadata.widthPx,
        naturalHeightPx: metadata.heightPx,
        detectedDpi: metadata.dpi && metadata.dpi > 0 ? metadata.dpi : null,
        sourceDpi,
        targetPixelsPerMm: defaultTargetPixelsPerMm(metadata.dpi),
        error: null
      },
      imageImportError: null,
      showCommandPalette: false
    });
  } catch (error) {
    useCadUiStore.getState().setImageImportError(metadataErrorMessage(error));
    useCadUiStore.getState().setPendingImageImport(null);
    console.error("Failed to add image.", error);
  }
};
