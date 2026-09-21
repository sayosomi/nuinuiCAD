import type { DslDiagnosticPresentation, DslModuleParameterType, DslNumericTypeOptions } from "@nuinuicad/nui-language";
import type { StatementIdentity, LineSplice } from "@nuinuicad/nui-language/document";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";

export type VscodeModulePreviewBootstrap = {
  type: "modulePreviewBootstrap";
  sessionId: string;
  sessionGeneration: number;
  documentUri: string;
  documentVersion: number;
  sourceText: string;
};

export type VscodeModulePreviewBootstrapAcknowledged = {
  type: "modulePreviewBootstrapAcknowledged";
  sessionId: string;
  sessionGeneration: number;
  documentUri: string;
  documentVersion: number;
};

export type VscodeModulePreviewTarget = {
  type: "modulePreviewTarget";
  sessionId: string;
  sessionGeneration: number;
  documentUri: string;
  documentVersion: number;
  normalizedSourceOffset: number;
};

export type VscodeModulePreviewTargetUnavailable = {
  type: "modulePreviewTargetUnavailable";
  sessionId: string;
  sessionGeneration: number;
  documentUri: string;
  documentVersion: number;
};

export type VscodeModulePreviewValueDiagnostic = {
  code: "required-value-missing" | "invalid-expression";
  message: string;
  presentation?: DslDiagnosticPresentation;
};

export type VscodeModulePreviewValueParameter = {
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  numericTypeOptions?: DslNumericTypeOptions;
  optional: boolean;
  required: boolean;
  defaultSourceText: string | null;
  value: string;
  valueState: "explicit" | "omitted-defaulted" | "omitted-optional" | "required-missing" | "invalid";
  diagnostic: VscodeModulePreviewValueDiagnostic | null;
};

export type VscodeModulePreviewValueGroup = {
  kind: "ancestor" | "target";
  definitionStatementIndex: number;
  name: string;
  parameters: readonly VscodeModulePreviewValueParameter[];
};

/** Exact-current Preview value authority projected from the Webview session. */
export type VscodeModulePreviewValueSnapshot = {
  type: "modulePreviewValueSnapshot";
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  sessionRevision: number;
  target: { definitionStatementIndex: number; name: string };
  groups: readonly VscodeModulePreviewValueGroup[];
  inputDiagnostics: readonly VscodeModulePreviewValueDiagnostic[];
  previewStatus: "current" | "lastGood" | "noValidPreview";
};

export type VscodeModulePreviewValueUnavailable = {
  type: "modulePreviewValueUnavailable";
  sessionId: string | null;
  documentUri: string | null;
  documentVersion: number | null;
  sourceRevision: number | null;
  sessionRevision: number;
  target: { definitionStatementIndex: number; name: string } | null;
  reason: "no-session" | "not-ready" | "source-stale" | "target-unavailable" | "disposed";
};

/** Stable exact-current proof for one projected Preview parameter site. */
export type VscodeModulePreviewValueSiteProof = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  sessionRevision: number;
  targetDefinitionStatementIndex: number;
  targetName: string;
  definitionStatementIndex: number;
  definitionName: string;
  blockKind: "ancestor" | "target";
  parameterIndex: number;
  parameterName: string;
};

export type VscodeModulePreviewValueReferencePickStart = VscodeModulePreviewValueSiteProof & {
  type: "modulePreviewValueReferencePickStart";
  expectedGeometryInterface?: "point" | "line" | "path";
};

export type VscodeModulePreviewReferencePickProof = VscodeModulePreviewValueSiteProof & {
  expectedGeometryInterface: "point" | "line" | "path";
  role: "geometry";
  multiplicity: "single";
};
export type VscodeModulePreviewReferencePickStartRequest = VscodeModulePreviewReferencePickProof & { type: "modulePreviewReferencePickStartRequest"; requestId: number };
export type VscodeModulePreviewReferencePickCancelRequest = { type: "modulePreviewReferencePickCancelRequest"; requestId: number; sessionId: string; documentUri: string; documentVersion: number };
type VscodeModulePreviewReferencePickResultBase = VscodeModulePreviewReferencePickProof & { type: "modulePreviewReferencePickResult"; requestId: number };
export type VscodeModulePreviewReferencePickStartedResult = VscodeModulePreviewReferencePickResultBase & { status: "started"; candidateReferences: readonly CanonicalGeometrySourceReference[] };
export type VscodeModulePreviewReferencePickConfirmedResult = VscodeModulePreviewReferencePickResultBase & { status: "confirmed"; resultKind: "geometry"; references: readonly [CanonicalGeometrySourceReference] };
export type VscodeModulePreviewReferencePickTerminalResult = VscodeModulePreviewReferencePickResultBase & { status: "canceled" | "stale" | "rejected" };
export type VscodeModulePreviewReferencePickResult = VscodeModulePreviewReferencePickStartedResult | VscodeModulePreviewReferencePickConfirmedResult | VscodeModulePreviewReferencePickTerminalResult;

export type VscodeModulePreviewValueEdit = VscodeModulePreviewValueSiteProof & {
  type: "modulePreviewValueEdit";
  expression: string | null;
};

export type VscodeModulePreviewValueSiteEditRequest = VscodeModulePreviewValueSiteProof & {
  type: "modulePreviewValueSiteEdit";
};

export type VscodeModulePreviewModelPatchRequest = {
  type: "modulePreviewModelPatch";
  operationId: number;
  sessionId: string;
  documentUri: string;
  expectedDocumentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  targetDefinitionStatementId: StatementIdentity;
  previewRevision: number;
  sourceOwners: readonly { runtimeElementId: string; sourceStatementId: StatementIdentity }[];
  splices: readonly LineSplice[];
  expectedPatchedSource: string;
};
export type VscodeModulePreviewModelPatchResult = {
  type: "modulePreviewModelPatchResult";
  operationId: number;
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  status: "applied" | "stale" | "rejected";
  reason?: string;
};

export type VscodeModulePreviewInsertInstanceRequest = {
  type: "modulePreviewInsertInstance";
};

export type VscodeExtensionToModulePreviewMessage =
  | VscodeModulePreviewBootstrap
  | VscodeModulePreviewTarget
  | VscodeModulePreviewTargetUnavailable
  | VscodeModulePreviewValueSnapshot
  | VscodeModulePreviewValueUnavailable
  | VscodeModulePreviewValueEdit
  | VscodeModulePreviewReferencePickStartRequest
  | VscodeModulePreviewReferencePickCancelRequest
  | VscodeModulePreviewModelPatchResult;

export type VscodeModulePreviewToExtensionMessage =
  | VscodeModulePreviewBootstrapAcknowledged
  | VscodeModulePreviewValueSnapshot
  | VscodeModulePreviewValueUnavailable
  | VscodeModulePreviewValueSiteEditRequest
  | VscodeModulePreviewReferencePickResult
  | VscodeModulePreviewValueReferencePickStart
  | VscodeModulePreviewModelPatchRequest
  | VscodeModulePreviewInsertInstanceRequest;
