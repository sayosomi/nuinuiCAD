import type { DslDiagnosticPresentation, DslModuleParameterType, DslNumericTypeOptions } from "@nuinuicad/nui-language";
import type { StatementIdentity, LineSplice } from "@nuinuicad/nui-language/document";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";

export type VscodeModulePreviewTarget = { type: "modulePreviewTarget"; documentVersion: number; normalizedSourceOffset: number };
export type VscodeModulePreviewTargetUnavailable = { type: "modulePreviewTargetUnavailable"; documentVersion: number };
export type VscodeModulePreviewSession = { type: "modulePreviewSession"; sessionId: string; documentUri: string };

export type VscodeModulePreviewInvocationDiagnostic = {
  code: "required-value-missing" | "invalid-expression";
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  message: string;
  presentation?: DslDiagnosticPresentation;
};

export type VscodeModulePreviewInvocationParameter = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  numericTypeOptions?: DslNumericTypeOptions;
  optional: boolean;
  required: boolean;
  defaultSourceText: string | null;
  value: string;
  active: boolean;
  diagnostic: VscodeModulePreviewInvocationDiagnostic | null;
  caller: { statementIndex: number; scopeId: string; sourceOrderIndex: number };
  lineRange: { from: number; to: number };
  labelRange: { from: number; to: number };
  valueRange: { from: number; to: number };
};

export type VscodeModulePreviewInvocationBlock = {
  kind: "ancestor" | "target";
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  name: string;
  text: string;
  callRange: { from: number; to: number };
  parameters: readonly VscodeModulePreviewInvocationParameter[];
};

/** JSON-safe semantic/editor proof retained by the Extension Host. */
export type VscodeModulePreviewInvocationSnapshot = {
  type: "modulePreviewInvocationSnapshot";
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sourceRevision: number;
  sessionRevision: number;
  target: { definitionStatementId: StatementIdentity; definitionStatementIndex: number; name: string };
  blocks: readonly VscodeModulePreviewInvocationBlock[];
  inputDiagnostics: readonly VscodeModulePreviewInvocationDiagnostic[];
  previewStatus: "current" | "lastGood" | "noValidPreview";
};

export type VscodeModulePreviewInvocationUnavailable = {
  type: "modulePreviewInvocationUnavailable";
  sessionId: string | null;
  documentUri: string | null;
  documentVersion: number | null;
  sourceRevision: number | null;
  sessionRevision: number;
  targetDefinitionStatementId: StatementIdentity | null;
  reason: "no-session" | "not-ready" | "source-stale" | "target-unavailable" | "disposed";
};

export type VscodeModulePreviewInvocationSiteProof = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sourceRevision: number;
  sessionRevision: number;
  targetDefinitionStatementId: StatementIdentity;
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  invocationText: string;
  selectionStart: number;
  selectionEnd: number;
};

export type VscodeModulePreviewInvocationSiteFocus = VscodeModulePreviewInvocationSiteProof & {
  type: "modulePreviewInvocationSiteFocus";
  focusGeneration: number;
};
export type VscodeModulePreviewInvocationSiteBlur = VscodeModulePreviewInvocationSiteProof & {
  type: "modulePreviewInvocationSiteBlur";
  focusGeneration: number;
};
export type VscodeModulePreviewInvocationReferencePickStart = VscodeModulePreviewInvocationSiteProof & {
  type: "modulePreviewInvocationReferencePickStart";
  expectedGeometryInterface?: "point" | "line" | "path";
};

export type VscodeModulePreviewReferencePickProof = VscodeModulePreviewInvocationSiteProof & {
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

export type VscodeModulePreviewInvocationValueEdit = VscodeModulePreviewInvocationSiteProof & {
  type: "modulePreviewInvocationValueEdit";
  expression: string;
  resultSelectionStart: number;
  resultSelectionEnd: number;
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

export type VscodeExtensionToModulePreviewMessage =
  | VscodeModulePreviewTarget
  | VscodeModulePreviewTargetUnavailable
  | VscodeModulePreviewSession
  | VscodeModulePreviewInvocationSnapshot
  | VscodeModulePreviewInvocationUnavailable
  | VscodeModulePreviewInvocationValueEdit
  | VscodeModulePreviewReferencePickStartRequest
  | VscodeModulePreviewReferencePickCancelRequest
  | VscodeModulePreviewModelPatchResult;

export type VscodeModulePreviewToExtensionMessage =
  | VscodeModulePreviewReferencePickResult
  | VscodeModulePreviewInvocationReferencePickStart
  | VscodeModulePreviewInvocationSiteFocus
  | VscodeModulePreviewInvocationSiteBlur
  | VscodeModulePreviewModelPatchRequest;
