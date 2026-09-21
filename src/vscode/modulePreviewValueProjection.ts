import type { ModulePreviewInputGroup, ModulePreviewParameterState, ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type {
  VscodeModulePreviewValueDiagnostic,
  VscodeModulePreviewValueGroup,
  VscodeModulePreviewValueParameter,
  VscodeModulePreviewValueSnapshot
} from "./modulePreviewProtocol";

const diagnosticFor = (
  diagnostic: ModulePreviewParameterState["diagnostic"]
): VscodeModulePreviewValueDiagnostic | null => diagnostic
  ? {
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
    }
  : null;

const valueStateFor = (parameter: ModulePreviewParameterState): VscodeModulePreviewValueParameter["valueState"] => {
  if (parameter.diagnostic?.code === "invalid-expression") return "invalid";
  if (parameter.active && parameter.value.trim().length > 0) return "explicit";
  if (parameter.diagnostic?.code === "required-value-missing") return "required-missing";
  return parameter.defaultSourceText === null ? "omitted-optional" : "omitted-defaulted";
};

const groupFor = (group: ModulePreviewInputGroup): VscodeModulePreviewValueGroup => ({
  kind: group.kind,
  definitionStatementIndex: group.definitionStatementIndex,
  name: group.name,
  parameters: group.parameters.map((parameter): VscodeModulePreviewValueParameter => ({
    parameterIndex: parameter.parameterIndex,
    name: parameter.name,
    type: parameter.type,
    ...(parameter.numericTypeOptions ? { numericTypeOptions: { ...parameter.numericTypeOptions } } : {}),
    optional: parameter.optional,
    required: parameter.required,
    defaultSourceText: parameter.defaultSourceText,
    value: parameter.active && parameter.value.trim().length > 0 ? parameter.value : "",
    valueState: valueStateFor(parameter),
    diagnostic: diagnosticFor(parameter.diagnostic)
  }))
});

export const modulePreviewValueSnapshotFor = ({
  snapshot,
  sessionId,
  documentUri,
  documentVersion,
  normalizedSource,
  sessionRevision
}: {
  snapshot: ModulePreviewSessionSnapshot;
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  normalizedSource: string;
  sessionRevision: number;
}): VscodeModulePreviewValueSnapshot => ({
  type: "modulePreviewValueSnapshot",
  sessionId,
  documentUri,
  documentVersion,
  normalizedSource,
  sourceRevision: snapshot.sourceRevision,
  sessionRevision,
  target: {
    definitionStatementIndex: snapshot.target.definitionStatementIndex,
    name: snapshot.target.name
  },
  groups: [
    ...snapshot.ancestorContexts.map(groupFor),
    groupFor(snapshot.parameters)
  ],
  inputDiagnostics: snapshot.inputDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
  })),
  previewStatus: snapshot.preview.kind
});

export type ModulePreviewValueSummaryEntry = {
  groupLabel: "Context" | "Target";
  groupName: string;
  parameterName: string;
  valueLabel: string;
  blockKind: ModulePreviewInputGroup["kind"];
  definitionStatementIndex: number;
  parameterIndex: number;
};

/**
 * Project the exact-current session inputs into the compact status summary.
 * Diagnostics and non-current previews deliberately return no summary so the
 * existing diagnostic/status shell remains the highest-priority presentation.
 */
export const modulePreviewValueSummaryFor = (
  snapshot: ModulePreviewSessionSnapshot | null
): readonly ModulePreviewValueSummaryEntry[] => {
  if (!snapshot || snapshot.preview.kind !== "current" || snapshot.inputDiagnostics.length > 0) return [];
  return [...snapshot.ancestorContexts, snapshot.parameters].flatMap((group) =>
    group.parameters.map((parameter) => ({
      groupLabel: group.kind === "ancestor" ? "Context" : "Target",
      groupName: group.name,
      parameterName: parameter.name,
      valueLabel: parameter.active && parameter.value.trim().length > 0
        ? parameter.value
        : parameter.defaultSourceText === null
          ? "omitted (optional)"
          : `omitted (default: ${parameter.defaultSourceText})`,
      blockKind: group.kind,
      definitionStatementIndex: group.definitionStatementIndex,
      parameterIndex: parameter.parameterIndex
    }))
  );
};
