import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { RustPrintOutputPayload, RustSvgOutputPayload } from "../output/outputCore";

export type VscodeOutputPreviewPlaceCoordinatePatch = {
  range: NormalizedSourceRange;
  expectedText: string;
  replacement: string;
};

export type VscodeOutputPreviewPlaceCommit = {
  type: "outputPreviewPlaceCommit";
  documentVersion: number;
  normalizedSourceSnapshot: string;
  statementRange: NormalizedSourceRange;
  patches: readonly VscodeOutputPreviewPlaceCoordinatePatch[];
};

export type VscodeOutputPreviewExportFormat = "pdf" | "svg";

export type VscodeOutputPreviewExportAvailability = {
  type: "outputPreviewExportAvailability";
  documentVersion: number | null;
  outputKey: string | null;
  format: VscodeOutputPreviewExportFormat | null;
};

type VscodeOutputPreviewExportRequestBase = {
  type: "outputPreviewExportRequest";
  requestId: number;
  documentVersion: number;
  outputKey: string;
  outputName: string;
};

export type VscodeOutputPreviewExportRequest =
  | (VscodeOutputPreviewExportRequestBase & {
      format: "pdf";
      payload: RustPrintOutputPayload;
    })
  | (VscodeOutputPreviewExportRequestBase & {
      format: "svg";
      payload: RustSvgOutputPayload;
    });

export type VscodeOutputPreviewExportResult = {
  type: "outputPreviewExportResult";
  requestId: number;
  status: "saved" | "cancelled" | "failed";
};

export type VscodeOutputPreviewRevealFailureReason =
  | "stale"
  | "current-target-unavailable"
  | "no-containing-output"
  | "evaluation-failed";

export type VscodeOutputPreviewRevealRequest = {
  type: "outputPreviewReveal";
  requestId: number;
  documentVersion: number;
  normalizedSourceOffset: number;
};

export type VscodeOutputPreviewRevealResult =
  | {
      type: "outputPreviewRevealResult";
      requestId: number;
      documentVersion: number;
      status: "resolved";
      outputKey: string;
    }
  | {
      type: "outputPreviewRevealResult";
      requestId: number;
      documentVersion: number;
      status: "failed";
      reason: VscodeOutputPreviewRevealFailureReason;
    };

export type VscodeOutputPreviewToExtensionMessage =
  | { type: "outputPreviewFit" }
  | { type: "outputPreviewResetView" }
  | VscodeOutputPreviewExportAvailability
  | VscodeOutputPreviewExportRequest
  | VscodeOutputPreviewRevealResult
  | {
      type: "outputPreviewSourceNavigation";
      documentVersion: number;
      range: NormalizedSourceRange;
    }
  | VscodeOutputPreviewPlaceCommit;

export type VscodeExtensionToOutputPreviewMessage =
  | { type: "outputPreviewOpen"; documentVersion: number; normalizedSourceOffset: number | null }
  | { type: "outputPreviewFit" }
  | { type: "outputPreviewResetView" }
  | { type: "outputPreviewClearFocus" }
  | { type: "outputPreviewExport" }
  | VscodeOutputPreviewRevealRequest
  | VscodeOutputPreviewExportResult;
