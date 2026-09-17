import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type {
  VscodeModulePreviewInvocationBlock,
  VscodeModulePreviewInvocationDiagnostic,
  VscodeModulePreviewInvocationParameter,
  VscodeModulePreviewInvocationSnapshot
} from "./modulePreviewProtocol";

const diagnosticFor = (
  diagnostic: ModulePreviewSessionSnapshot["inputDiagnostics"][number] | null
): VscodeModulePreviewInvocationDiagnostic | null => diagnostic
  ? {
      code: diagnostic.code,
      definitionStatementId: diagnostic.definitionStatementId,
      parameterIndex: diagnostic.parameterIndex,
      message: diagnostic.message,
      ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
    }
  : null;

const blockFor = (
  block: ModulePreviewSessionSnapshot["invocation"]["blocks"][number],
  diagnostics: ModulePreviewSessionSnapshot["inputDiagnostics"]
): VscodeModulePreviewInvocationBlock => ({
  kind: block.kind,
  definitionStatementId: block.definitionStatementId,
  definitionStatementIndex: block.definitionStatementIndex,
  name: block.name,
  text: block.text,
  callRange: block.callRange,
  parameters: block.parameters.map((parameter): VscodeModulePreviewInvocationParameter => ({
    definitionStatementId: parameter.definitionStatementId,
    parameterIndex: parameter.parameterIndex,
    name: parameter.name,
    type: parameter.type,
    ...(parameter.numericTypeOptions ? { numericTypeOptions: { ...parameter.numericTypeOptions } } : {}),
    optional: parameter.optional,
    required: parameter.required,
    defaultSourceText: parameter.defaultSourceText,
    value: parameter.value,
    active: parameter.active,
    diagnostic: diagnosticFor(diagnostics.find((candidate) =>
      candidate.definitionStatementId === parameter.definitionStatementId &&
      candidate.parameterIndex === parameter.parameterIndex
    ) ?? null),
    caller: parameter.caller,
    lineRange: parameter.lineRange,
    labelRange: parameter.labelRange,
    valueRange: parameter.valueRange
  }))
});

export const modulePreviewInvocationSnapshotFor = ({
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
}): VscodeModulePreviewInvocationSnapshot => ({
  type: "modulePreviewInvocationSnapshot",
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
  blocks: snapshot.invocation.blocks.map((block) => blockFor(block, snapshot.inputDiagnostics)),
  inputDiagnostics: snapshot.inputDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    definitionStatementId: diagnostic.definitionStatementId,
    parameterIndex: diagnostic.parameterIndex,
    message: diagnostic.message,
    ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {})
  })),
  previewStatus: snapshot.preview.kind
});
