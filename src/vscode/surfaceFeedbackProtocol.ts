import type { VscodeOutputPreviewGraphAuthority } from "./multiDocumentGraphTransport";

export type VscodeSurfaceFeedbackDiagnostic = {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string;
};

export type VscodeCanvasFeedbackGraphIdentity = {
  hostDocumentUri: string;
  graphRevision: number;
  sourceRevision: number;
};

export type VscodeCanvasFrameIdentity = {
  documentVersion: number;
  updateGeneration: number;
  sourceRevision: number;
  graphIdentity?: VscodeCanvasFeedbackGraphIdentity;
  evaluationRevision: number;
  evaluationRequestRevision: number;
};

export type VscodeCanvasUpdateProgressStart = {
  type: "canvasUpdateProgress";
  documentVersion: number;
  generation: number;
};

export type VscodeCanvasFrameDrawn = VscodeCanvasFrameIdentity & {
  type: "canvasFrameDrawn";
};

export type VscodeSurfaceDiagnosticsPublication = {
  type: "surfaceDiagnosticsPublication";
  surface: "canvas" | "outputPreview";
  documentVersion: number;
  presentationId: number;
  graphIdentity?: VscodeCanvasFeedbackGraphIdentity;
  graphAuthority?: VscodeOutputPreviewGraphAuthority;
  canvasUpdate?: {
    generation: number;
    outcome?: "terminal";
    frameIdentity?: VscodeCanvasFrameIdentity;
  };
  outputIdentity?: {
    outputKey: string | null;
    kind?: "print" | "svg";
    outputId?: string;
    layoutId?: string;
  };
  diagnostics: readonly VscodeSurfaceFeedbackDiagnostic[];
};

export type VscodeSurfaceOperationFailure = {
  type: "surfaceOperationFailure";
  documentVersion: number;
  eventId: number;
  message: string;
};

export type VscodeSurfaceFeedbackToExtensionMessage =
  | VscodeSurfaceDiagnosticsPublication
  | VscodeSurfaceOperationFailure
  | VscodeCanvasFrameDrawn;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && value >= 0;

const isGraphIdentity = (value: unknown): value is VscodeCanvasFeedbackGraphIdentity =>
  isRecord(value) && typeof value.hostDocumentUri === "string" && value.hostDocumentUri.length > 0 &&
  isNonNegativeSafeInteger(value.graphRevision) && isNonNegativeSafeInteger(value.sourceRevision);

const isCanvasFrameIdentity = (value: unknown): value is VscodeCanvasFrameIdentity =>
  isRecord(value) && isNonNegativeSafeInteger(value.documentVersion) &&
  isNonNegativeSafeInteger(value.updateGeneration) && value.updateGeneration > 0 &&
  isNonNegativeSafeInteger(value.sourceRevision) &&
  (value.graphIdentity === undefined || isGraphIdentity(value.graphIdentity)) &&
  isNonNegativeSafeInteger(value.evaluationRevision) &&
  isNonNegativeSafeInteger(value.evaluationRequestRevision);

export const isVscodeCanvasFrameDrawn = (value: unknown): value is VscodeCanvasFrameDrawn =>
  isRecord(value) && value.type === "canvasFrameDrawn" && isCanvasFrameIdentity(value);

export const isVscodeCanvasUpdateProgressStart = (value: unknown): value is VscodeCanvasUpdateProgressStart =>
  isRecord(value) && value.type === "canvasUpdateProgress" &&
  isNonNegativeSafeInteger(value.documentVersion) && isNonNegativeSafeInteger(value.generation) && value.generation > 0;

const isGraphAuthority = (value: unknown): value is VscodeOutputPreviewGraphAuthority => {
  if (!isRecord(value)) return false;
  return typeof value.hostDocumentUri === "string" &&
    isSafeInteger(value.documentVersion) &&
    isSafeInteger(value.graphRevision) &&
    isSafeInteger(value.rootSourceRevision);
};

export const isVscodeSurfaceDiagnosticsPublication = (
  value: unknown
): value is VscodeSurfaceDiagnosticsPublication => {
  if (!isRecord(value) || value.type !== "surfaceDiagnosticsPublication" ||
      (value.surface !== "canvas" && value.surface !== "outputPreview") ||
      !isSafeInteger(value.documentVersion) || !isSafeInteger(value.presentationId) ||
      !Array.isArray(value.diagnostics)) return false;
  if (value.canvasUpdate !== undefined) {
    const update = value.canvasUpdate;
    if (!isRecord(update) || !isNonNegativeSafeInteger(update.generation) || update.generation === 0 ||
        (update.outcome !== undefined && update.outcome !== "terminal") ||
        (update.frameIdentity !== undefined && !isCanvasFrameIdentity(update.frameIdentity)) ||
        (update.outcome === "terminal" && update.frameIdentity !== undefined) ||
        (update.frameIdentity !== undefined &&
          (update.frameIdentity.documentVersion !== value.documentVersion ||
           update.frameIdentity.updateGeneration !== update.generation))) return false;
  }
  if (value.graphIdentity !== undefined) {
    if (!isGraphIdentity(value.graphIdentity)) return false;
  }
  if (value.graphAuthority !== undefined && !isGraphAuthority(value.graphAuthority)) return false;
  if (value.outputIdentity !== undefined) {
    const identity = value.outputIdentity;
    if (!isRecord(identity) || (identity.outputKey !== null && typeof identity.outputKey !== "string") ||
        (identity.kind !== undefined && identity.kind !== "print" && identity.kind !== "svg") ||
        (identity.outputId !== undefined && typeof identity.outputId !== "string") ||
        (identity.layoutId !== undefined && typeof identity.layoutId !== "string")) return false;
  }
  return value.diagnostics.every((diagnostic) => isRecord(diagnostic) &&
    typeof diagnostic.id === "string" && diagnostic.id.length > 0 &&
    (diagnostic.severity === "error" || diagnostic.severity === "warning" || diagnostic.severity === "info") &&
    typeof diagnostic.message === "string" && diagnostic.message.length > 0 &&
    (diagnostic.elementId === undefined || typeof diagnostic.elementId === "string"));
};

export const isVscodeSurfaceOperationFailure = (value: unknown): value is VscodeSurfaceOperationFailure =>
  isRecord(value) && value.type === "surfaceOperationFailure" &&
  isSafeInteger(value.documentVersion) && isSafeInteger(value.eventId) &&
  typeof value.message === "string" && value.message.length > 0;
