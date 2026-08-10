import { recordField, recordRemainder, recordSpans } from "./dslParameterSpanScanner";
import { unquoteDslString } from "./dslTokens";
import type { DslSpan } from "./dslTypes";
import type {
  ModuleBodyStatementSemantic,
  ModuleScalarExpressionSemantic
} from "./moduleSemanticTypes";
import type {
  ModuleGeometryPropertyReferenceResolution,
  ModuleScalarReferenceResolution
} from "./moduleScalarExpression";
import type { ScalarType } from "../scalars/types";
import { elementLocalVariableAtSourceOrder, type ElementLocalVariableNameEntry } from "../scalars/elementLocalRangeIndex";

type AnalyzeExpression = (
  statementIndex: number,
  raw: string,
  span: DslSpan,
  expectedType: ScalarType | null,
  resolver: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
  bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
  geometryPropertyResolver?: (reference: { elementName: string; property: string; span: DslSpan }) => ModuleGeometryPropertyReferenceResolution
) => ModuleScalarExpressionSemantic | null;

export type ElementLocalVariableResolver = (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;

type AddScalar = (
  bodySemantic: ModuleBodyStatementSemantic | null,
  parameterKey: string,
  span: DslSpan,
  expression: ModuleScalarExpressionSemantic | null
) => void;

export const analyzeElementLocalVariables = ({
  source,
  statementIndex,
  valueSpan,
  bodySemantic,
  analyzeExpression,
  addScalar,
  resolveBodyScalar,
  resolveBodyBareScalar,
  resolveBodyGeometryProperty
}: {
  source: string;
  statementIndex: number;
  valueSpan: DslSpan;
  bodySemantic: ModuleBodyStatementSemantic | null;
  analyzeExpression: AnalyzeExpression;
  addScalar: AddScalar;
  resolveBodyScalar: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBodyBareScalar: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveBodyGeometryProperty: (reference: { elementName: string; property: string; span: DslSpan }) => ModuleGeometryPropertyReferenceResolution;
}): ElementLocalVariableResolver | null => {
  const records = recordSpans(source, valueSpan) ?? [];
  const variableEntries: ElementLocalVariableNameEntry[] = records.flatMap((record, variableIndex) => {
      const nameSpan = recordField(source, record, 0);
      return nameSpan
        ? [{ name: unquoteDslString(source.slice(nameSpan.start, nameSpan.end)), variableIndex }]
        : [];
    });
  const variableNames = new Set(variableEntries.map((entry) => entry.name));
  const sourceLocalResolver = (reference: { name: string; span: DslSpan }, visibleCount: number): ModuleScalarReferenceResolution | null => {
    const local = elementLocalVariableAtSourceOrder(variableEntries, reference.name, visibleCount);
    if (local && bodySemantic) {
      return {
        target: {
          kind: "elementLocalVariable",
          statementId: bodySemantic.statementId,
          statementIndex,
          variableIndex: local.variableIndex,
          name: local.name
        },
        type: { kind: "number" },
        resolution: "resolved"
      };
    }
    return null;
  };
  const resolveLocalOrBody: ElementLocalVariableResolver = (reference) =>
    sourceLocalResolver(reference, variableEntries.length) ?? resolveBodyScalar(reference);
  const forwardLocalDiagnostic = (reference: { name: string; span: DslSpan }): ModuleScalarReferenceResolution => ({
    target: null,
    type: null,
    resolution: "forward",
    diagnostic: {
      code: "module-element-local-variable-forward",
      span: reference.span,
      message: `element-local variable「${reference.name}」はこの位置より後で宣言されています。`
    }
  });
  records.forEach((record, variableIndex) => {
    const expressionSpan = recordRemainder(source, record, 1);
    if (!expressionSpan) return;
    const currentName = variableEntries[variableIndex]?.name;
    const resolveVarsReference: ElementLocalVariableResolver = (reference) => {
      const local = sourceLocalResolver(reference, variableIndex);
      if (local) return local;
      // A variable's own name is not visible while its initializer is being
      // checked, even when an outer binding has the same name.
      if (currentName === reference.name) return forwardLocalDiagnostic(reference);
      // A later local does not retroactively shadow an already-visible outer
      // binding. Only turn an unresolved name into a local forward diagnostic
      // after the ordinary module lexical resolver has had its say.
      const bodyResolution = resolveBodyScalar(reference);
      return bodyResolution.resolution === "undefined" && variableNames.has(reference.name)
        ? forwardLocalDiagnostic(reference)
        : bodyResolution;
    };
    const expression = analyzeExpression(
      statementIndex,
      source.slice(expressionSpan.start, expressionSpan.end),
      expressionSpan,
      { kind: "number" },
      resolveVarsReference,
      resolveBodyBareScalar,
      resolveBodyGeometryProperty
    );
    addScalar(bodySemantic, "vars", expressionSpan, expression);
  });
  return bodySemantic ? resolveLocalOrBody : null;
};
