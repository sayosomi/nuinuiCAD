import { defaultTargetPixelsPerMm, initialImageScale } from "../geometry/imageScale";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit,
  creationPlacementForTarget
} from "../model/elementCreationPlacement";
import { createCadElement } from "../model/elementFactory";
import { makeUniqueElementName } from "../model/elementNames";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { focusCanvasAfterCreation } from "./postCreationFocus";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import { commitSourceCreationInsertion } from "./sourceCreationCommit";
import {
  resolveSourceCreationInsertion,
  sourceCreationInsertionIsCurrent,
  sourceCreationInsertionUnsafeError,
  type SourceCreationInsertion
} from "./sourceCreationInsertion";

type ImageMetadata = {
  widthPx: number;
  heightPx: number;
  dpi?: number | null;
};

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

const creationContext = (sourceInsertion: SourceCreationInsertion | null) => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  return {
    elements,
    ...(sourceInsertion
      ? creationPlacementForTarget(elements, sourceInsertion.insertionTarget, evaluationLimitIndex)
      : creationPlacementForEvaluationLimit(elements, evaluationLimitIndex))
  };
};

const commitCreatedImage = (
  element: CadElement,
  elements: CadElement[],
  insertionIndex: number,
  evaluationLimitIndex: number | undefined,
  sourceInsertion: SourceCreationInsertion | null
) => {
  if (sourceInsertion) {
    const sourceCommit = commitSourceCreationInsertion({
      elements,
      insertionIndex,
      insertedElements: [element],
      sourceInsertionLine: sourceInsertion.sourceInsertionLine
    });
    if (sourceCommit.result.status !== "applied" || !sourceCommit.selectedElementId) return false;
    useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, {
      selectedElementId: sourceCommit.selectedElementId,
      selectedElementIds: sourceCommit.insertedElementIds,
      selectionAnchorElementId: sourceCommit.selectedElementId
    });
    return true;
  }
  const placedElement = applyCreationPlacement(
    element,
    creationPlacementForEvaluationLimit(
      elements,
      insertionIndex
    )
  );
  commitDocumentChangeAndSelect({
    elements: [
      ...elements.slice(0, insertionIndex),
      placedElement,
      ...elements.slice(insertionIndex)
    ],
    evaluationLimitIndex: adjustEvaluationLimitForInsertion({
      elements,
      evaluationLimitIndex,
      insertionIndex,
      insertedCount: 1
    })
  }, {
    selectedElementId: placedElement.id,
    selectedElementIds: [placedElement.id],
    selectionAnchorElementId: placedElement.id
  });
  focusCanvasAfterCreation();
  return true;
};

export const commitPendingImageImport = ({
  sourcePath,
  displayName,
  naturalWidthPx,
  naturalHeightPx,
  sourceDpi,
  targetPixelsPerMm,
  sourceInsertion
}: {
  sourcePath: string;
  displayName: string;
  naturalWidthPx: number;
  naturalHeightPx: number;
  sourceDpi: number;
  targetPixelsPerMm: number;
  sourceInsertion: SourceCreationInsertion | null;
}) => {
  const document = useCadDocumentStore.getState();
  if (sourceInsertion && !sourceCreationInsertionIsCurrent(sourceInsertion, document.sourceRevision)) {
    useCadUiStore.setState({
      pendingImageImport: null,
      imageImportError: "文書が変更されたため、画像の追加を中止しました。もう一度実行してください。"
    });
    return false;
  }
  const { elements, insertionIndex, referenceElements } = creationContext(sourceInsertion);
  const { evaluationLimitIndex } = document;
  const placement = sourceInsertion
    ? creationPlacementForTarget(elements, sourceInsertion.insertionTarget, evaluationLimitIndex)
    : creationPlacementForEvaluationLimit(elements, insertionIndex);
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
  return commitCreatedImage(imageElement, elements, insertionIndex, evaluationLimitIndex, sourceInsertion);
};

const metadataErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "画像を読み込めません。";

export const addImage = async (context?: CommandContext) => {
  const document = useCadDocumentStore.getState();
  const sourceResolution = resolveSourceCreationInsertion({
    cursor: context?.currentSourceCursor?.() ?? null,
    sourceRevision: document.sourceRevision,
    elements: document.elements,
    statementMap: document.doc.statementMap
  });
  if (sourceResolution.kind === "unsafe") {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  const sourceInsertion = sourceResolution.kind === "safe" ? sourceResolution.insertion : null;
  try {
    const file = await pickBrowserImageFile();
    if (!file) return;
    const metadata = await imageMetadataFromBrowserFile(file);
    const sourceDpi = metadata.dpi && metadata.dpi > 0 ? metadata.dpi : 300;
    useCadUiStore.setState({
      pendingImageImport: {
        sourcePath: metadata.sourcePath,
        displayName: file.name,
        naturalWidthPx: metadata.widthPx,
        naturalHeightPx: metadata.heightPx,
        detectedDpi: metadata.dpi && metadata.dpi > 0 ? metadata.dpi : null,
        sourceDpi,
        targetPixelsPerMm: defaultTargetPixelsPerMm(metadata.dpi),
        sourceInsertion,
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
