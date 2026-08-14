import type { DslSpan } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { parseScalarExpression } from "../scalars/expressionParser";
import { typecheckScalarExpression } from "../scalars/expressionTypecheck";
import { getBuiltinFunctionDefinition, type BuiltinFunctionName } from "../scalars/builtinFunctions";
import type { ScalarExpressionResolvedGeometryTarget, ScalarExpressionResolvedReference } from "../scalars/typedExpressionAst";
import type { ScalarType } from "../scalars/types";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  ModuleGeometryBuiltinArgumentSemantic,
  ModuleGeometryPropertyReference,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
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

export type ModuleGeometryBuiltinReferenceInput = {
  builtinName: BuiltinFunctionName;
  argumentIndex: number;
  name: string;
  span: DslSpan;
  expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
};

export type ModuleGeometryBuiltinReferenceResolver = (
  reference: ModuleGeometryBuiltinReferenceInput
) => ModuleGeometryReferenceSemantic;

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

const isBuiltinGeometryParameterType = (
  type: string | ScalarType
): type is Extract<ModuleGeometryInterfaceType, "point" | "line"> => type === "point" || type === "line";

const resolveAndTypecheck = ({
  ast,
  expectedType,
  resolveReference,
  resolveBareReference,
  resolveGeometryProperty,
  resolveGeometryBuiltin
}: {
  ast: ScalarExpressionAst;
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
  resolveGeometryBuiltin?: ModuleGeometryBuiltinReferenceResolver;
}): { semantic: ModuleScalarExpressionSemantic; diagnostics: ModuleScalarLocalDiagnostic[] } => {
  const diagnostics: ModuleScalarLocalDiagnostic[] = [];
  const resolvedReferences: ModuleScalarReference[] = [];
  const geometryProperties: ModuleGeometryPropertyReference[] = [];
  const geometryBuiltinArguments: ModuleGeometryBuiltinArgumentSemantic[] = [];
  const resolvedTypes: ScalarExpressionResolvedReference[] = [];
  const resolvedChoiceTypes = new Map<number, ScalarType>();
  let invalidGeometryProperty = false;

  const resolveNodeReference = (node: Extract<ScalarExpressionAst, { kind: "reference" }>): ScalarType | null => {
    const found = { name: node.name, span: node.span };
    const resolution = resolveReference(found);
    resolvedReferences.push({ ...found, nameSpan: node.nameSpan, target: resolution.target, resolution: resolution.resolution });
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
    resolvedTypes.push({ kind: "resolvedType", bindingId: null, type: resolution.target ? scalarTypeFromTarget(resolution.target, resolution) : null });
    return resolution.target ? scalarTypeFromTarget(resolution.target, resolution) : null;
  };

  const resolve = (node: ScalarExpressionAst): ScalarExpressionAst => {
    switch (node.kind) {
      case "numberLiteral":
      case "stringLiteral":
      case "booleanLiteral":
        return node;
      case "unresolvedChoiceLiteral": {
        const bareReference = resolveBareReference?.({ name: node.raw, span: node.span });
        if (bareReference?.diagnostic) diagnostics.push(bareReference.diagnostic);
        if (bareReference?.target && bareReference.type) {
          resolvedReferences.push({ name: node.raw, nameSpan: node.span, span: node.span, target: bareReference.target, resolution: bareReference.resolution });
          resolvedChoiceTypes.set(node.span.start, bareReference.type);
          if (bareReference.type.kind === "number") return { kind: "numberLiteral", span: node.span, value: 0 };
          if (bareReference.type.kind === "string") return { kind: "stringLiteral", span: node.span, value: "" };
          if (bareReference.type.kind === "boolean") return { kind: "booleanLiteral", span: node.span, value: false };
          return node;
        }
        return node;
      }
      case "reference":
        resolveNodeReference(node);
        return node;
      case "call": {
        const definition = getBuiltinFunctionDefinition(node.name);
        const signature = definition?.signatures.find((candidate) => candidate.argumentTypes.length === node.args.length);
        return {
          ...node,
          args: node.args.map((argument, argumentIndex) => {
            const parameterType = signature?.argumentTypes[argumentIndex];
            if (
              definition &&
              signature &&
              parameterType !== undefined &&
              isBuiltinGeometryParameterType(parameterType) &&
              (argument.kind === "reference" || argument.kind === "geometryProperty") &&
              resolveGeometryBuiltin
            ) {
              const reference = resolveGeometryBuiltin({
                builtinName: definition.name,
                argumentIndex,
                name: argument.kind === "reference" ? argument.name : `${argument.elementName}.${argument.property}`,
                span: argument.span,
                expectedGeometryType: parameterType
              });
              geometryBuiltinArguments.push({
                builtinName: definition.name,
                argumentIndex,
                span: argument.span,
                expectedGeometryType: parameterType,
                reference
              });
              if (argument.kind === "reference") {
                resolvedTypes.push({
                  kind: "resolvedGeometry",
                  target: typecheckGeometryTarget(reference, parameterType)
                });
              }
              return argument;
            }
            return resolve(argument);
          })
        };
      }
      case "geometryProperty":
        if (!resolveGeometryProperty) {
          diagnostics.push(localIssue("module-geometry-property-reference", node.span, "module の scalar expression では geometry property を解決できません。"));
          geometryProperties.push({ geometryName: node.elementName, property: node.property, elementNameSpan: node.elementNameSpan, propertySpan: node.propertySpan, span: node.span, target: null, resolution: "invalid" });
          invalidGeometryProperty = true;
          return node;
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
          if (!resolution.target) invalidGeometryProperty = true;
          return node;
        }
      case "group": return { ...node, expression: resolve(node.expression) };
      case "unary": return { ...node, operand: resolve(node.operand) };
      case "binary": return { ...node, left: resolve(node.left), right: resolve(node.right) };
    }
  };

  const resolvedAst = resolve(ast);
  const geometryBuiltinArgumentTargets = new Map<number, ScalarExpressionResolvedGeometryTarget | null>();
  for (const occurrence of geometryBuiltinArguments) {
    geometryBuiltinArgumentTargets.set(
      occurrence.span.start,
      typecheckGeometryTarget(occurrence.reference, occurrence.expectedGeometryType)
    );
  }
  const checked = typecheckScalarExpression(resolvedAst, {
    expectedType,
    references: resolvedTypes,
    geometryBuiltinArguments: geometryBuiltinArgumentTargets,
    resolveChoiceLiteral: (_raw, _expected, span) => resolvedChoiceTypes.get(span.start)
  });
  for (const diagnostic of checked.diagnostics) {
    const code = diagnostic.code === "invalid-choice-literal"
      ? "module-invalid-choice-literal"
      : diagnostic.code === "unknown-function"
        ? "module-unknown-function"
        : diagnostic.code === "function-arity-mismatch"
          ? "module-function-arity-mismatch"
          : "module-scalar-type-mismatch";
    diagnostics.push(localIssue(
      code,
      diagnostic.span,
      diagnostic.message,
      { expectedType: diagnostic.expectedType, actualType: diagnostic.actualType }
    ));
  }
  const type = diagnostics.length === 0 && !invalidGeometryProperty ? checked.type : null;
  return { semantic: { ast, type, references: resolvedReferences, geometryProperties, geometryBuiltinArguments }, diagnostics };
};

const typecheckGeometryTarget = (
  reference: ModuleGeometryReferenceSemantic,
  expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
): ScalarExpressionResolvedGeometryTarget | null => {
  if (!reference.target || (reference.resolution !== "resolved" && reference.resolution !== "deferred")) return null;
  const target = reference.target;
  if (target.kind === "parameter") {
    return {
      statementId: target.definitionStatementId,
      statementIndex: -1,
      geometryType: expectedGeometryType,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  if (target.kind === "sourceGeometry") {
    return {
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      geometryType: expectedGeometryType,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  return {
    statementId: target.instanceStatementId,
    statementIndex: target.instanceStatementIndex,
    geometryType: expectedGeometryType,
    ...(target.pointKey ? { pointKey: target.pointKey } : {})
  };
};

export const parseAndCheckModuleScalarExpression = ({
  raw,
  span,
  expectedType,
  resolveReference,
  resolveBareReference,
  resolveGeometryProperty,
  resolveGeometryBuiltin,
  diagnostics
}: {
  raw: string;
  span: DslSpan;
  expectedType: ScalarType | null;
  resolveReference: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBareReference?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveGeometryProperty?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  resolveGeometryBuiltin?: ModuleGeometryBuiltinReferenceResolver;
  diagnostics: ModuleScalarLocalDiagnostic[];
}): ModuleScalarExpressionSemantic | null => {
  const parsed = parseScalarExpression(`${" ".repeat(span.start)}${raw}`, span);
  if (!parsed.ast) {
    diagnostics.push(...parsed.diagnostics.map((item) => localIssue(`module-${item.code}`, item.span, item.message)));
    return null;
  }
  const checked = resolveAndTypecheck({
    ast: parsed.ast,
    expectedType,
    resolveReference,
    resolveBareReference,
    resolveGeometryProperty,
    resolveGeometryBuiltin
  });
  diagnostics.push(...checked.diagnostics);
  return checked.semantic;
};
