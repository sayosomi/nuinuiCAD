import { relativeImagePath } from "../document/imageFilePaths";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultTargetPixelsPerMm, initialImageScale } from "../geometry/imageScale";
import { evaluatedElements } from "../model/evaluationDivider";
import { createCadElement } from "../model/elementFactory";
import { makeUniqueElementName } from "../model/elementNames";
import { getFirstParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";

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
  const { open } = await import("@tauri-apps/plugin-dialog");
  return selectedPath(
    await open({
      filters: [IMAGE_FILTER],
      multiple: false
    })
  );
};

const loadTauriImageMetadata = async (path: string) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ImageMetadata>("read_image_metadata", { path });
};

const creationContext = () => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  const insertionIndex = Math.min(Math.max(evaluationLimitIndex, 0), elements.length);
  return {
    elements,
    insertionIndex,
    referenceElements: evaluatedElements(elements, insertionIndex)
  };
};

const commitCreatedImage = (element: CadElement, elements: CadElement[], insertionIndex: number) => {
  useCadDocumentStore.getState().commitDocumentChange({
    elements: [
      ...elements.slice(0, insertionIndex),
      element,
      ...elements.slice(insertionIndex)
    ],
    evaluationLimitIndex: insertionIndex + 1,
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id,
    selectedParameterKey: getFirstParameterKey(element)
  });
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
  const element = createCadElement("image", elements, { referenceElements });
  if (element.type !== "image") return;

  const imageElement: CadElement = {
    ...element,
    name: makeUniqueElementName({
      elements,
      elementId: element.id,
      requestedName: displayName,
      fallbackBaseName: element.name
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
