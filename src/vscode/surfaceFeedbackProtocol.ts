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

export type VscodeSurfaceDiagnosticsPublication = {
  type: "surfaceDiagnosticsPublication";
  surface: "canvas" | "outputPreview";
  documentVersion: number;
  presentationId: number;
  graphIdentity?: VscodeCanvasFeedbackGraphIdentity;
  graphAuthority?: VscodeOutputPreviewGraphAuthority;
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
  | VscodeSurfaceOperationFailure;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

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
  if (value.graphIdentity !== undefined) {
    const identity = value.graphIdentity;
    if (!isRecord(identity) || typeof identity.hostDocumentUri !== "string" ||
        !isSafeInteger(identity.graphRevision) || !isSafeInteger(identity.sourceRevision)) return false;
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
