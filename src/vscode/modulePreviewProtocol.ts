import type { StatementIdentity } from "../document/statementIdentity";
import type { DslModuleParameterType } from "../dsl/dslTypes";
import type { DslNumericTypeOptions } from "../dsl/dslNumericTypeOptions";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import type { LineSplice } from "../document/textPatch";

export type VscodeModulePreviewTarget = {
  type: "modulePreviewTarget";
  documentVersion: number;
  normalizedSourceOffset: number;
};

export type VscodeModulePreviewTargetUnavailable = {
  type: "modulePreviewTargetUnavailable";
  documentVersion: number;
};

export type VscodeModulePreviewSession = {
  type: "modulePreviewSession";
  sessionId: string;
  documentUri: string;
};

export type VscodeModulePreviewParameterDiagnostic = {
  code: "required-value-missing" | "invalid-expression";
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  message: string;
};

export type VscodeModulePreviewParameter = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  numericTypeOptions?: DslNumericTypeOptions;
  optional: boolean;
  required: boolean;
  defaultSourceText: string | null;
  value: string;
  diagnostic: VscodeModulePreviewParameterDiagnostic | null;
};

export type VscodeModulePreviewParameterGroup = {
  kind: "ancestor" | "target";
  definitionStatementId: StatementIdentity;
  name: string;
  parameters: readonly VscodeModulePreviewParameter[];
};

export type VscodeModulePreviewParameterSnapshot = {
  type: "modulePreviewParameterSnapshot";
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sourceRevision: number;
  sessionRevision: number;
  target: {
    definitionStatementId: StatementIdentity;
    definitionStatementIndex: number;
    name: string;
  };
  ancestorContexts: readonly VscodeModulePreviewParameterGroup[];
  parameters: VscodeModulePreviewParameterGroup;
  inputDiagnostics: readonly VscodeModulePreviewParameterDiagnostic[];
  previewStatus: "current" | "lastGood" | "noValidPreview";
};

export type VscodeModulePreviewParametersUnavailable = {
  type: "modulePreviewParametersUnavailable";
  sessionId: string | null;
  documentUri: string | null;
  documentVersion: number | null;
  sourceRevision: number | null;
  sessionRevision: number;
  targetDefinitionStatementId: StatementIdentity | null;
  reason: "no-session" | "not-ready" | "source-stale" | "target-unavailable" | "disposed";
};

export type VscodeModulePreviewParameterActionProof = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sourceRevision: number;
  sessionRevision: number;
  targetDefinitionStatementId: StatementIdentity;
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
};

export type VscodeModulePreviewParameterReferencePickStartRequest =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewParameterReferencePickStart";
  };

export type VscodeModulePreviewReferencePickProof =
  VscodeModulePreviewParameterActionProof & {
    expectedGeometryInterface: "point" | "line" | "path";
    role: "geometry";
    multiplicity: "single";
  };

export type VscodeModulePreviewReferencePickStartRequest =
  VscodeModulePreviewReferencePickProof & {
    type: "modulePreviewReferencePickStartRequest";
    requestId: number;
  };

export type VscodeModulePreviewReferencePickCancelRequest = {
  type: "modulePreviewReferencePickCancelRequest";
  requestId: number;
  sessionId: string;
  documentUri: string;
  documentVersion: number;
};

type VscodeModulePreviewReferencePickResultBase =
  VscodeModulePreviewReferencePickProof & {
    type: "modulePreviewReferencePickResult";
    requestId: number;
  };

export type VscodeModulePreviewReferencePickStartedResult =
  VscodeModulePreviewReferencePickResultBase & {
    status: "started";
    candidateReferences: readonly CanonicalGeometrySourceReference[];
  };

export type VscodeModulePreviewReferencePickConfirmedResult =
  VscodeModulePreviewReferencePickResultBase & {
    status: "confirmed";
    resultKind: "geometry";
    references: readonly [CanonicalGeometrySourceReference];
  };

export type VscodeModulePreviewReferencePickTerminalResult =
  VscodeModulePreviewReferencePickResultBase & {
    status: "canceled" | "stale" | "rejected";
  };

export type VscodeModulePreviewReferencePickResult =
  | VscodeModulePreviewReferencePickStartedResult
  | VscodeModulePreviewReferencePickConfirmedResult
  | VscodeModulePreviewReferencePickTerminalResult;

export type VscodeModulePreviewParameterValueFocus =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewParameterValueFocus";
    value: string;
    selectionStart: number;
    selectionEnd: number;
    focusGeneration: number;
  };

export type VscodeModulePreviewParameterValueBlur =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewParameterValueBlur";
    focusGeneration: number;
  };

export type VscodeModulePreviewParameterSetValueRequest =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewParameterSetValue";
    expression: string;
  };

export type VscodeModulePreviewParameterUseDefaultRequest =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewParameterUseDefault";
  };

export type VscodeModulePreviewParameterValueSelectionRestore =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewRestoreParameterValueSelection";
    value: string;
    selectionStart: number;
    selectionEnd: number;
    focusGeneration: number;
  };

export type VscodeModulePreviewParameterSetValue =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewSetValue";
    expression: string;
  };

export type VscodeModulePreviewParameterUseDefault =
  VscodeModulePreviewParameterActionProof & {
    type: "modulePreviewUseDefault";
  };

/** A proof-carrying, source-preserving geometry edit from Module Preview. */
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
  runtimeElementId: string;
  sourceStatementId: StatementIdentity;
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

export type VscodeModulePreviewParameterViewMessage =
  | { type: "modulePreviewParametersViewReady" }
  | VscodeModulePreviewParameterSetValueRequest
  | VscodeModulePreviewParameterUseDefaultRequest
  | VscodeModulePreviewParameterReferencePickStartRequest
  | VscodeModulePreviewParameterValueFocus
  | VscodeModulePreviewParameterValueBlur;

export type VscodeExtensionToModulePreviewMessage =
  | VscodeModulePreviewTarget
  | VscodeModulePreviewTargetUnavailable
  | VscodeModulePreviewSession
  | VscodeModulePreviewParameterSnapshot
  | VscodeModulePreviewParametersUnavailable
  | VscodeModulePreviewParameterSetValue
  | VscodeModulePreviewParameterUseDefault
  | VscodeModulePreviewParameterValueSelectionRestore
  | VscodeModulePreviewReferencePickStartRequest
  | VscodeModulePreviewReferencePickCancelRequest
  | VscodeModulePreviewModelPatchResult;

export type VscodeModulePreviewToExtensionMessage =
  | VscodeModulePreviewReferencePickResult
  | VscodeModulePreviewModelPatchRequest;
