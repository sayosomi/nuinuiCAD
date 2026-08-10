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
  const variableNames = new Set(
    records.flatMap((record) => {
      const nameSpan = recordField(source, record, 0);
      return nameSpan ? [unquoteDslString(source.slice(nameSpan.start, nameSpan.end))] : [];
    })
  );
  const visibleVariables = new Map<string, { variableIndex: number; name: string }>();
  const resolveLocalOrBody: ElementLocalVariableResolver = (reference) => {
    const local = visibleVariables.get(reference.name);
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
    if (variableNames.has(reference.name)) {
      return {
        target: null,
        type: null,
        resolution: "forward",
        diagnostic: {
          code: "module-element-local-variable-forward",
          span: reference.span,
          message: `element-local variable「${reference.name}」はこの位置より後で宣言されています。`
        }
      };
    }
    return resolveBodyScalar(reference);
  };
  records.forEach((record, variableIndex) => {
    const expressionSpan = recordRemainder(source, record, 1);
    if (!expressionSpan) return;
    const expression = analyzeExpression(
      statementIndex,
      source.slice(expressionSpan.start, expressionSpan.end),
      expressionSpan,
      { kind: "number" },
      resolveLocalOrBody,
      resolveBodyBareScalar,
      resolveBodyGeometryProperty
    );
    addScalar(bodySemantic, "vars", expressionSpan, expression);
    const nameSpan = recordField(source, record, 0);
    if (nameSpan) {
      const name = unquoteDslString(source.slice(nameSpan.start, nameSpan.end));
      if (name) visibleVariables.set(name, { variableIndex, name });
    }
  });
  return bodySemantic ? resolveLocalOrBody : null;
};
