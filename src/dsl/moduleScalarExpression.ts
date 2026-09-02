import type { DslSpan } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { parseScalarExpression } from "../scalars/expressionParser";
import { typecheckScalarExpression } from "../scalars/expressionTypecheck";
import { getBuiltinFunctionDefinition, type BuiltinFunctionName } from "../scalars/builtinFunctions";
import type {
  ScalarExpressionResolvedGeometryProperty,
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedReference
} from "../scalars/typedExpressionAst";
import type { ScalarType } from "../scalars/types";
import type { DslDiagnosticPresentation } from "./dslTypes";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  ModuleGeometryBuiltinArgumentSemantic,
  ModuleGeometryPropertyReference,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
  ModuleRecordFieldSourceTarget,
  ModuleScalarExpressionSemantic,
  ModuleScalarReference,
  ModuleSourceTarget
} from "./moduleSemanticTypes";

export const moduleParameterPresenceKey = (definitionStatementId: string, parameterIndex: number) =>
  `${definitionStatementId}:${parameterIndex}`;

type PresenceFactBranch = "truth" | "false";

const unionPresenceFacts = (...factSets: readonly ReadonlySet<string>[]): ReadonlySet<string> =>
  new Set(factSets.flatMap((facts) => [...facts]));

const intersectPresenceFacts = (left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> =>
  new Set([...left].filter((fact) => right.has(fact)));

const presenceFactsForResolvedAst = (
  ast: ScalarExpressionAst,
  hasValueKeyBySpan: ReadonlyMap<number, string>,
  branch: PresenceFactBranch
): ReadonlySet<string> => {
  const intrinsicKey = (ast.kind === "booleanLiteral" || (ast.kind === "call" && ast.name === "hasValue"))
    ? hasValueKeyBySpan.get(ast.span.start)
    : undefined;
  if (intrinsicKey) return branch === "truth" ? new Set([intrinsicKey]) : new Set();
  if (ast.kind === "group") return presenceFactsForResolvedAst(ast.expression, hasValueKeyBySpan, branch);
  if (ast.kind === "call" && ast.name === "hasValue") {
    const key = hasValueKeyBySpan.get(ast.span.start);
    return key && branch === "truth" ? new Set([key]) : new Set();
  }
  if (ast.kind === "unary" && ast.operator === "!") {
    return presenceFactsForResolvedAst(ast.operand, hasValueKeyBySpan, branch === "truth" ? "false" : "truth");
  }
  if (ast.kind === "binary" && ast.operator === "&&") {
    const leftTruth = presenceFactsForResolvedAst(ast.left, hasValueKeyBySpan, "truth");
    const leftFalse = presenceFactsForResolvedAst(ast.left, hasValueKeyBySpan, "false");
    const rightTruth = presenceFactsForResolvedAst(ast.right, hasValueKeyBySpan, "truth");
    const rightFalse = presenceFactsForResolvedAst(ast.right, hasValueKeyBySpan, "false");
    return branch === "truth"
      ? unionPresenceFacts(leftTruth, rightTruth)
      : intersectPresenceFacts(leftFalse, unionPresenceFacts(leftTruth, rightFalse));
  }
  if (ast.kind === "binary" && ast.operator === "||") {
    const leftTruth = presenceFactsForResolvedAst(ast.left, hasValueKeyBySpan, "truth");
    const leftFalse = presenceFactsForResolvedAst(ast.left, hasValueKeyBySpan, "false");
    const rightTruth = presenceFactsForResolvedAst(ast.right, hasValueKeyBySpan, "truth");
    const rightFalse = presenceFactsForResolvedAst(ast.right, hasValueKeyBySpan, "false");
    return branch === "false"
      ? unionPresenceFacts(leftFalse, rightFalse)
      : intersectPresenceFacts(leftTruth, unionPresenceFacts(leftFalse, rightTruth));
  }
  return new Set();
};

const emptyPresenceFactKeys = new Map<number, string>();

export const presenceFactsForTruth = (ast: ScalarExpressionAst): ReadonlySet<string> =>
  presenceFactsForResolvedAst(ast, emptyPresenceFactKeys, "truth");

export const presenceFactsForFalse = (ast: ScalarExpressionAst): ReadonlySet<string> =>
  presenceFactsForResolvedAst(ast, emptyPresenceFactKeys, "false");

export const presenceFactsForSemanticTruth = (semantic: ModuleScalarExpressionSemantic): ReadonlySet<string> =>
  presenceFactsForResolvedAst(
    semantic.ast,
    new Map(semantic.hasValueParameters.map((entry) => [entry.span.start, moduleParameterPresenceKey(entry.definitionStatementId, entry.parameterIndex)])),
    "truth"
  );

export const presenceFactsForSemanticFalse = (semantic: ModuleScalarExpressionSemantic): ReadonlySet<string> =>
  presenceFactsForResolvedAst(
    semantic.ast,
    new Map(semantic.hasValueParameters.map((entry) => [entry.span.start, moduleParameterPresenceKey(entry.definitionStatementId, entry.parameterIndex)])),
    "false"
  );

export type ModuleGeometryPropertyReferenceInput = {
  elementName: string;
  property: string;
  elementNameSpan: DslSpan;
  propertySpan: DslSpan;
  span: DslSpan;
  presenceFacts?: ReadonlySet<string>;
};

export type ModuleScalarLocalDiagnostic = {
  code: string;
  span: DslSpan;
  message: string;
  presentation?: DslDiagnosticPresentation;
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
  target: ModuleGeometryPropertySourceTarget | ModuleRecordFieldSourceTarget | null;
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
  presenceFacts?: ReadonlySet<string>;
};

export type ModuleGeometryBuiltinReferenceResolver = (
  reference: ModuleGeometryBuiltinReferenceInput
) => ModuleGeometryReferenceSemantic;

const localIssue = (code: string, span: DslSpan, message: string, extra: Partial<ModuleScalarLocalDiagnostic> = {}): ModuleScalarLocalDiagnostic => ({
  code,
  span,
  message,
  presentation: { key: `diagnostic.${code}` },
  ...extra
});

const scalarTypeFromTarget = (target: ModuleSourceTarget, resolution: ModuleScalarReferenceResolution): ScalarType | null => {
  if (target.kind === "parameter") return resolution.type;
  return resolution.type;
};

const geometryPropertyMetadataFor = (
  target: ModuleGeometryPropertySourceTarget,
  type: ScalarType
): ScalarExpressionResolvedGeometryProperty => {
  if (target.kind === "sourceGeometryProperty") {
    return { elementId: target.statementId, property: target.property, targetSourceOrder: target.statementIndex, type };
  }
  if (target.kind === "deferredModuleExportProperty") {
    return { elementId: target.instanceStatementId, property: target.property, targetSourceOrder: target.instanceStatementIndex, type };
  }
  if (target.kind === "recordField") {
    throw new Error("moduleScalarExpression: record field properties are lowered as scalar references");
  }
  return { elementId: target.definitionStatementId, property: target.property, targetSourceOrder: -1, type };
};

const isBuiltinGeometryParameterType = (
  type: unknown
): type is Extract<ModuleGeometryInterfaceType, "point" | "line"> => type === "point" || type === "line";

const resolveAndTypecheck = ({
  ast,
  expectedType,
  resolveReference,
  resolveHasValue,
  resolveBareReference,
  resolveGeometryProperty,
  resolveGeometryBuiltin,
  presenceFacts: initialPresenceFacts = new Set()
}: {
  ast: ScalarExpressionAst;
  expectedType: ScalarType | null;
  resolveReference: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
  resolveHasValue?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBareReference?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveGeometryProperty?: (reference: {
    elementName: string;
    property: string;
    elementNameSpan: DslSpan;
    propertySpan: DslSpan;
    span: DslSpan;
    presenceFacts?: ReadonlySet<string>;
  }) => ModuleGeometryPropertyReferenceResolution;
  resolveGeometryBuiltin?: ModuleGeometryBuiltinReferenceResolver;
  presenceFacts?: ReadonlySet<string>;
}): { semantic: ModuleScalarExpressionSemantic; diagnostics: ModuleScalarLocalDiagnostic[] } => {
  const diagnostics: ModuleScalarLocalDiagnostic[] = [];
  const resolvedReferences: ModuleScalarReference[] = [];
  const geometryProperties: ModuleGeometryPropertyReference[] = [];
  const geometryBuiltinArguments: ModuleGeometryBuiltinArgumentSemantic[] = [];
  const geometryPropertyReferences = new Map<number, ScalarExpressionResolvedGeometryProperty | null>();
  const resolvedTypes: ScalarExpressionResolvedReference[] = [];
  const resolvedChoiceTypes = new Map<number, ScalarType>();
  const hasValueParameters: { span: DslSpan; definitionStatementId: string; parameterIndex: number }[] = [];
  let invalidGeometryProperty = false;

  const resolveNodeReference = (node: Extract<ScalarExpressionAst, { kind: "reference" }>, presenceFacts: ReadonlySet<string>): ScalarType | null => {
    const found = { name: node.name, span: node.span };
    const resolution = resolveReference(found, presenceFacts);
    resolvedReferences.push({ ...found, nameSpan: node.nameSpan, target: resolution.target, resolution: resolution.resolution });
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
    resolvedTypes.push({ kind: "resolvedType", bindingId: null, type: resolution.target ? scalarTypeFromTarget(resolution.target, resolution) : null });
    return resolution.target ? scalarTypeFromTarget(resolution.target, resolution) : null;
  };

  const presenceFactsFor = (node: ScalarExpressionAst, branch: "truth" | "false"): ReadonlySet<string> =>
    presenceFactsForResolvedAst(node, new Map(hasValueParameters.map((entry) => [entry.span.start, moduleParameterPresenceKey(entry.definitionStatementId, entry.parameterIndex)])), branch);

  const resolve = (node: ScalarExpressionAst, presenceFacts: ReadonlySet<string> = new Set()): ScalarExpressionAst => {
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
        resolveNodeReference(node, presenceFacts);
        return node;
      case "call": {
        if (node.name === "hasValue" && resolveHasValue) {
          const argument = node.args.length === 1 && node.args[0]?.kind === "positional" ? node.args[0].expression : null;
          if (argument?.kind === "reference") {
            const resolution = resolveHasValue({ name: argument.name, span: argument.span });
            resolvedReferences.push({ name: argument.name, span: argument.span, nameSpan: argument.nameSpan, target: resolution.target, resolution: resolution.resolution });
            if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
            const target = resolution.target;
            if (target?.kind === "parameter" && !resolution.diagnostic) {
              hasValueParameters.push({ span: node.span, definitionStatementId: target.definitionStatementId, parameterIndex: target.parameterIndex });
              return { kind: "booleanLiteral", span: node.span, value: false };
            }
            return { kind: "booleanLiteral", span: node.span, value: false };
          } else {
            diagnostics.push(localIssue("module-has-value-argument", node.span, "hasValue は optional module parameter の参照を1つだけ受け取ります。"));
            return { kind: "booleanLiteral", span: node.span, value: false };
          }
        }
        const definition = getBuiltinFunctionDefinition(node.name);
        const signature = definition?.signatures.find((candidate) =>
          candidate.callingStyle === "positional" &&
          candidate.parameters.length === node.args.length &&
          node.args.every((argument) => argument.kind === "positional")
        );
        return {
          ...node,
          args: node.args.map((argument, argumentIndex) => {
            const parameterType = signature?.parameters[argumentIndex]?.type;
            const sourceArgument = argument.expression;
            if (
              definition &&
              signature &&
              parameterType !== undefined &&
              isBuiltinGeometryParameterType(parameterType) &&
              (sourceArgument.kind === "reference" || sourceArgument.kind === "geometryProperty") &&
              resolveGeometryBuiltin
            ) {
              const reference = resolveGeometryBuiltin({
                builtinName: definition.name,
                argumentIndex,
                name: sourceArgument.kind === "reference" ? sourceArgument.name : `${sourceArgument.elementName}.${sourceArgument.property}`,
                span: sourceArgument.span,
                expectedGeometryType: parameterType,
                presenceFacts
              });
              geometryBuiltinArguments.push({
                builtinName: definition.name,
                argumentIndex,
                span: sourceArgument.span,
                expectedGeometryType: parameterType,
                reference
              });
              if (sourceArgument.kind === "reference") {
                resolvedTypes.push({
                  kind: "resolvedGeometry",
                  target: typecheckGeometryTarget(reference, parameterType)
                });
              }
              return argument;
            }
            return { ...argument, expression: resolve(sourceArgument, presenceFacts) };
          })
        };
      }
      case "geometryProperty":
        if (!resolveGeometryProperty) {
          diagnostics.push(localIssue("module-geometry-property-reference", node.span, "module の scalar expression では geometry property を解決できません。"));
          geometryProperties.push({ geometryName: node.elementName, property: node.property, elementNameSpan: node.elementNameSpan, propertySpan: node.propertySpan, span: node.span, target: null, type: null, resolution: "invalid" });
          geometryPropertyReferences.set(node.span.start, null);
          invalidGeometryProperty = true;
          return node;
        }
        {
          const resolution = resolveGeometryProperty({
            elementName: node.elementName,
            property: node.property,
            elementNameSpan: node.elementNameSpan,
            propertySpan: node.propertySpan,
            span: node.span,
            presenceFacts
          });
          geometryProperties.push({
            geometryName: node.elementName,
            property: node.property,
            elementNameSpan: node.elementNameSpan,
            propertySpan: node.propertySpan,
            span: node.span,
            target: resolution.target,
            type: resolution.type,
            resolution: resolution.resolution
          });
          if (resolution.target?.kind === "recordField") {
            const recordReference = {
              name: `${node.elementName}.${node.property}`,
              nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
              span: node.span,
              target: resolution.target,
              resolution: resolution.resolution === "resolved" ? "resolved" as const : "invalid" as const
            };
            resolvedReferences.push(recordReference);
            resolvedTypes.push({ kind: "resolvedType", bindingId: null, type: resolution.type });
            if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
            return {
              kind: "reference",
              span: node.span,
              nameSpan: recordReference.nameSpan,
              name: recordReference.name
            };
          }
          geometryPropertyReferences.set(
            node.span.start,
            resolution.target && resolution.type
              ? geometryPropertyMetadataFor(resolution.target, resolution.type)
              : null
          );
          if (resolution.diagnostic) diagnostics.push(resolution.diagnostic);
          if (!resolution.target) invalidGeometryProperty = true;
          return node;
        }
      case "group": return { ...node, expression: resolve(node.expression, presenceFacts) };
      case "unary": return { ...node, operand: resolve(node.operand, presenceFacts) };
      case "binary": {
        const left = resolve(node.left, presenceFacts);
        const leftFacts = node.operator === "&&" ? presenceFactsFor(left, "truth") : node.operator === "||" ? presenceFactsFor(left, "false") : new Set<string>();
        return { ...node, left, right: resolve(node.right, new Set([...presenceFacts, ...leftFacts])) };
      }
    }
  };

  const resolvedAst = resolve(ast, initialPresenceFacts);
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
    geometryPropertyReferences,
    resolveChoiceLiteral: (_raw, _expected, span) => resolvedChoiceTypes.get(span.start)
  });
  for (const diagnostic of checked.diagnostics) {
    const code = diagnostic.code === "invalid-choice-literal"
      ? "module-invalid-choice-literal"
      : diagnostic.code === "unknown-function"
        ? "module-unknown-function"
      : diagnostic.code === "function-arity-mismatch"
        ? "module-function-arity-mismatch"
        : diagnostic.code === "function-call-style-mismatch"
          ? "module-function-call-style-mismatch"
          : diagnostic.code === "unknown-function-argument"
            ? "module-unknown-function-argument"
            : diagnostic.code === "duplicate-function-argument"
              ? "module-duplicate-function-argument"
              : diagnostic.code === "missing-function-argument"
                ? "module-missing-function-argument"
          : "module-scalar-type-mismatch";
    diagnostics.push(localIssue(
      code,
      diagnostic.span,
      diagnostic.message,
      { expectedType: diagnostic.expectedType, actualType: diagnostic.actualType }
    ));
  }
  const type = diagnostics.length === 0 && !invalidGeometryProperty ? checked.type : null;
  return { semantic: { ast, type, references: resolvedReferences, geometryProperties, geometryBuiltinArguments, hasValueParameters }, diagnostics };
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
  resolveHasValue,
  resolveBareReference,
  resolveGeometryProperty,
  resolveGeometryBuiltin,
  presenceFacts,
  diagnostics
}: {
  raw: string;
  span: DslSpan;
  expectedType: ScalarType | null;
  resolveReference: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
  resolveHasValue?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBareReference?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveGeometryProperty?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  resolveGeometryBuiltin?: ModuleGeometryBuiltinReferenceResolver;
  presenceFacts?: ReadonlySet<string>;
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
    resolveHasValue,
    resolveBareReference,
    resolveGeometryProperty,
    resolveGeometryBuiltin,
    presenceFacts
  });
  diagnostics.push(...checked.diagnostics);
  return checked.semantic;
};
