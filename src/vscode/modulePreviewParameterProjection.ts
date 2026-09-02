import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type {
  VscodeModulePreviewParameter,
  VscodeModulePreviewParameterDiagnostic,
  VscodeModulePreviewParameterGroup,
  VscodeModulePreviewParameterSnapshot
} from "./modulePreviewProtocol";

const parameterTypeFor = (parameter: ModulePreviewSessionSnapshot["parameters"]["parameters"][number]) => {
  if (!parameter.type) return null;
  return parameter.type.kind === "choice"
    ? { kind: "choice" as const, options: [...parameter.type.options] }
    : { kind: parameter.type.kind };
};

const diagnosticFor = (
  diagnostic: ModulePreviewSessionSnapshot["inputDiagnostics"][number] | null
): VscodeModulePreviewParameterDiagnostic | null => diagnostic
  ? {
      code: diagnostic.code,
      definitionStatementId: diagnostic.definitionStatementId,
      parameterIndex: diagnostic.parameterIndex,
      message: diagnostic.message,
      ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
    }
  : null;

const groupFor = (
  group: ModulePreviewSessionSnapshot["parameters"]
): VscodeModulePreviewParameterGroup => ({
  kind: group.kind,
  definitionStatementId: group.definitionStatementId,
  name: group.name,
  parameters: group.parameters.map((parameter): VscodeModulePreviewParameter => ({
    definitionStatementId: parameter.definitionStatementId,
    parameterIndex: parameter.parameterIndex,
    name: parameter.name,
    type: parameterTypeFor(parameter),
    ...(parameter.numericTypeOptions ? { numericTypeOptions: { ...parameter.numericTypeOptions } } : {}),
    optional: parameter.optional,
    required: parameter.required,
    defaultSourceText: parameter.defaultSourceText,
    value: parameter.value,
    diagnostic: diagnosticFor(parameter.diagnostic)
  }))
});

export const modulePreviewParameterSnapshotFor = ({
  snapshot,
  sessionId,
  documentUri,
  documentVersion,
  sessionRevision
}: {
  snapshot: ModulePreviewSessionSnapshot;
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sessionRevision: number;
}): VscodeModulePreviewParameterSnapshot => ({
  type: "modulePreviewParameterSnapshot",
  sessionId,
  documentUri,
  documentVersion,
  sourceRevision: snapshot.sourceRevision,
  sessionRevision,
  target: {
    definitionStatementId: snapshot.target.definitionStatementId,
    definitionStatementIndex: snapshot.target.definitionStatementIndex,
    name: snapshot.target.name
  },
  ancestorContexts: snapshot.ancestorContexts.map(groupFor),
  parameters: groupFor(snapshot.parameters),
  inputDiagnostics: snapshot.inputDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    definitionStatementId: diagnostic.definitionStatementId,
    parameterIndex: diagnostic.parameterIndex,
    message: diagnostic.message,
    ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
  })),
  previewStatus: snapshot.preview.kind
});
