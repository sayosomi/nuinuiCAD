import type { NormalizedSourceRange } from "@nuinuicad/nui-language";
import type { OutputPlan, RustPrintOutputPayload, RustSvgOutputPayload } from "../output/outputCore";
import type { OutputPreviewRevealTarget } from "../output/outputPreviewReveal";
import type { VscodeOutputPreviewGraphAuthority } from "./multiDocumentGraphTransport";

type GraphBoundOutputPreviewAction = {
  graphAuthority?: VscodeOutputPreviewGraphAuthority;
};

export type VscodeOutputPreviewPlanRequest = {
  type: "outputPreviewPlanRequest";
  requestId: number;
  graphAuthority: VscodeOutputPreviewGraphAuthority;
  outputKey: string;
};

export type VscodeOutputPreviewPlanResult = {
  type: "outputPreviewPlanResult";
  requestId: number;
  graphAuthority: VscodeOutputPreviewGraphAuthority;
} & ({ plan: OutputPlan } | { error: string });

export type VscodeOutputPreviewPlaceCoordinatePatch = {
  range: NormalizedSourceRange;
  expectedText: string;
  replacement: string;
};

export type VscodeOutputPreviewPlaceCommit = GraphBoundOutputPreviewAction & {
  type: "outputPreviewPlaceCommit";
  documentVersion: number;
  normalizedSourceSnapshot: string;
  statementRange: NormalizedSourceRange;
  patches: readonly VscodeOutputPreviewPlaceCoordinatePatch[];
};

export type VscodeOutputPreviewExportFormat = "pdf" | "svg";

export type VscodeOutputPreviewExportAvailability = GraphBoundOutputPreviewAction & {
  type: "outputPreviewExportAvailability";
  documentVersion: number | null;
  outputKey: string | null;
  format: VscodeOutputPreviewExportFormat | null;
};

type VscodeOutputPreviewExportRequestBase = GraphBoundOutputPreviewAction & {
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

export type VscodeOutputPreviewRevealRequest = GraphBoundOutputPreviewAction & {
  type: "outputPreviewReveal";
  requestId: number;
  documentVersion: number;
  normalizedSourceOffset: number;
  runtimeTarget?: OutputPreviewRevealTarget;
};

export type VscodeOutputPreviewRevealResult = GraphBoundOutputPreviewAction & (
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
    }
);

export type VscodeOutputPreviewToExtensionMessage =
  | { type: "outputPreviewFit" }
  | { type: "outputPreviewResetView" }
  | (GraphBoundOutputPreviewAction & { type: "outputPreviewInsertTemplate"; documentVersion: number })
  | VscodeOutputPreviewPlanRequest
  | VscodeOutputPreviewExportAvailability
  | VscodeOutputPreviewExportRequest
  | VscodeOutputPreviewRevealResult
  | (GraphBoundOutputPreviewAction & {
      type: "outputPreviewSourceNavigation";
      documentVersion: number;
      range: NormalizedSourceRange;
    })
  | VscodeOutputPreviewPlaceCommit;

export type VscodeExtensionToOutputPreviewMessage =
  | { type: "outputPreviewOpen"; documentVersion: number; normalizedSourceOffset: number | null }
  | { type: "outputPreviewFit" }
  | { type: "outputPreviewResetView" }
  | { type: "outputPreviewClearFocus" }
  | { type: "outputPreviewExport" }
  | VscodeOutputPreviewRevealRequest
  | VscodeOutputPreviewPlanResult
  | VscodeOutputPreviewExportResult;
