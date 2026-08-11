import type { DslSpan } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { parseScalarExpression } from "../scalars/expressionParser";
import { collectScalarExpressionReferences } from "../scalars/expressionReferenceCollector";
import { isChoiceOptionMember, isScalarTypeAssignable } from "../scalars/scalarAssignability";
import { isChoiceScalarType, type ScalarType } from "../scalars/types";
import type {
  ModuleGeometryPropertyReference,
  ModuleGeometryPropertySourceTarget,
  ModuleScalarExpressionSemantic,
  ModuleScalarReference,
  ModuleSourceTarget
} from "./moduleSemanticTypes";

export type ModuleGeometryPropertyReferenceInput = {
  elementName: string;
  property: string;
  elementNameSpan: DslSpan;
  propertySpan: DslSpan;
  span: DslSpan;
};

export type ModuleScalarLocalDiagnostic = {
  code: string;
  span: DslSpan;
  message: string;
  expectedType?: ScalarType;
  actualType?: ScalarType;
};

export type ModuleScalarReferenceResolution = {
  target: ModuleSourceTarget | null;
  type: ScalarType | null;
  resolution: ModuleScalarReference["resolution"];
  diagnostic?: ModuleScalarLocalDiagnostic;
};

export type ModuleGeometryPropertyReferenceResolution = {
  target: ModuleGeometryPropertySourceTarget | null;
  type: ScalarType | null;
  resolution: ModuleGeometryPropertyReference["resolution"];
  diagnostic?: ModuleScalarLocalDiagnostic;
};

const describeType = (type: ScalarType): string =>
  type.kind === "choice" ? `choice(${type.options.join(", ")})` : type.kind;

const localIssue = (code: string, span: DslSpan, message: string, extra: Partial<ModuleScalarLocalDiagnostic> = {}): ModuleScalarLocalDiagnostic => ({
  code,
  span,
  message,
  ...extra
});

const scalarTypeFromTarget = (target: ModuleSourceTarget, resolution: ModuleScalarReferenceResolution): ScalarType | null => {
  if (target.kind === "parameter") return resolution.type;
  return resolution.type;
};

const typecheck = ({
  ast,
  references,
  expectedType,
  resolveReference,
  resolveBareReference,
  resolveGeometryProperty
}: {
  ast: ScalarExpressionAst;
  references: readonly { name: string; span: DslSpan }[];
  expectedType: ScalarType | null;
  resolveReference: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBareReference?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveGeometryProperty?: (reference: {
    elementName: string;
    property: string;
    elementNameSpan: DslSpan;
    propertySpan: DslSpan;
    span: DslSpan;
  }) => ModuleGeometryPropertyReferenceResolution;
}): { semantic: ModuleScalarExpressionSemantic; diagnostics: ModuleScalarLocalDiagnostic[] } => {
  const diagnostics: ModuleScalarLocalDiagnostic[] = [];
  const resolvedReferences: ModuleScalarReference[] = [];
  const geometryProperties: ModuleGeometryPropertyReference[] = [];
  const referenceByStart = new Map(references.map((reference) => [reference.span.start, reference]));
  const resolveNodeReference = (node: Extract<ScalarExpressionAst, { kind: "reference" }>): ScalarType | null => {
    const found = referenceByStart.get(node.span.start) ?? { name: node.name, span: node.span };
    const resolution = resolveReference(found);
    resolvedReferences.push({ ...found, nameSpan: node.nameSpan, target: resolution.target, resolution: resolution.resolution });
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
    return resolution.target ? scalarTypeFromTarget(resolution.target, resolution) : null;
  };

  const check = (node: ScalarExpressionAst, expected: ScalarType | null): ScalarType | null => {
    switch (node.kind) {
      case "numberLiteral": return { kind: "number" };
      case "stringLiteral": return { kind: "string" };
      case "booleanLiteral": return { kind: "boolean" };
      case "unresolvedChoiceLiteral": {
        const bareReference = resolveBareReference?.({ name: node.raw, span: node.span });
        if (bareReference?.diagnostic) diagnostics.push(bareReference.diagnostic);
        if (bareReference?.target && bareReference.type) {
          resolvedReferences.push({ name: node.raw, nameSpan: node.span, span: node.span, target: bareReference.target, resolution: bareReference.resolution });
          return bareReference.type;
        }
        if (bareReference) return null;
        if (expected && isChoiceScalarType(expected) && isChoiceOptionMember(expected, node.raw)) return expected;
        diagnostics.push(localIssue(
          "module-invalid-choice-literal",
          node.span,
          expected && isChoiceScalarType(expected)
            ? `choice literal「${node.raw}」は${describeType(expected)}の要素ではありません。`
            : `choice literal「${node.raw}」を解決できるchoice型の文脈がありません。`,
          expected && isChoiceScalarType(expected) ? { expectedType: expected } : {}
        ));
        return null;
      }
      case "reference": return resolveNodeReference(node);
      case "geometryProperty":
        if (!resolveGeometryProperty) {
          diagnostics.push(localIssue("module-geometry-property-reference", node.span, "module の scalar expression では geometry property を解決できません。"));
          geometryProperties.push({ geometryName: node.elementName, property: node.property, elementNameSpan: node.elementNameSpan, propertySpan: node.propertySpan, span: node.span, target: null, resolution: "invalid" });
          return null;
        }
        {
          const resolution = resolveGeometryProperty({
            elementName: node.elementName,
            property: node.property,
            elementNameSpan: node.elementNameSpan,
            propertySpan: node.propertySpan,
            span: node.span
          });
          geometryProperties.push({
            geometryName: node.elementName,
            property: node.property,
            elementNameSpan: node.elementNameSpan,
            propertySpan: node.propertySpan,
            span: node.span,
            target: resolution.target,
            resolution: resolution.resolution
          });
          if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
          return resolution.target ? resolution.type : null;
        }
      case "group": return check(node.expression, expected);
      case "unary": {
        const required: ScalarType = node.operator === "!" ? { kind: "boolean" } : { kind: "number" };
        const operand = check(node.operand, null);
        if (operand && !isScalarTypeAssignable(operand, required)) {
          diagnostics.push(localIssue("module-scalar-type-mismatch", node.operand.span, `型が一致しません(期待: ${describeType(required)}、実際: ${describeType(operand)})。`, { expectedType: required, actualType: operand }));
          return null;
        }
        return operand ? required : null;
      }
      case "binary": {
        if (node.operator === "==" || node.operator === "!=") {
          const left = check(node.left, null);
          const right = check(node.right, left?.kind === "choice" ? left : null);
          if (left && right && !isScalarTypeAssignable(left, right)) {
            diagnostics.push(localIssue("module-scalar-type-mismatch", node.span, `equality演算子の両辺の型が一致しません(${describeType(left)} vs ${describeType(right)})。`, { expectedType: left, actualType: right }));
            return null;
          }
          return left && right ? { kind: "boolean" } : null;
        }
        const required: ScalarType = ["&&", "||"].includes(node.operator) ? { kind: "boolean" } : { kind: "number" };
        const result: ScalarType = ["<", "<=", ">", ">="].includes(node.operator)
          ? { kind: "boolean" }
          : required;
        const left = check(node.left, null);
        const right = check(node.right, null);
        let valid = true;
        for (const operand of [left, right]) {
          if (!operand) valid = false;
          else if (!isScalarTypeAssignable(operand, required)) {
            diagnostics.push(localIssue("module-scalar-type-mismatch", node.span, `型が一致しません(期待: ${describeType(required)}、実際: ${describeType(operand)})。`, { expectedType: required, actualType: operand }));
            valid = false;
          }
        }
        return valid ? result : null;
      }
    }
  };

  let type = check(ast, expectedType);
  if (type && expectedType && !isScalarTypeAssignable(type, expectedType)) {
    diagnostics.push(localIssue("module-scalar-type-mismatch", ast.span, `宣言された型と一致しません(期待: ${describeType(expectedType)}、実際: ${describeType(type)})。`, { expectedType, actualType: type }));
    type = null;
  }
  return { semantic: { ast, type, references: resolvedReferences, geometryProperties }, diagnostics };
};

export const parseAndCheckModuleScalarExpression = ({
  raw,
  span,
  expectedType,
  resolveReference,
  resolveBareReference,
  resolveGeometryProperty,
  diagnostics
}: {
  raw: string;
  span: DslSpan;
  expectedType: ScalarType | null;
  resolveReference: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBareReference?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveGeometryProperty?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  diagnostics: ModuleScalarLocalDiagnostic[];
}): ModuleScalarExpressionSemantic | null => {
  const parsed = parseScalarExpression(`${" ".repeat(span.start)}${raw}`, span);
  if (!parsed.ast) {
    diagnostics.push(...parsed.diagnostics.map((item) => localIssue(`module-${item.code}`, item.span, item.message)));
    return null;
  }
  const checked = typecheck({
    ast: parsed.ast,
    references: collectScalarExpressionReferences(parsed.ast),
    expectedType,
    resolveReference,
    resolveBareReference,
    resolveGeometryProperty
  });
  diagnostics.push(...checked.diagnostics);
  return checked.semantic;
};
