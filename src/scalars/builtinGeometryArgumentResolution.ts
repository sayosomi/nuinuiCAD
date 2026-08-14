import type { ScalarExpressionAst, ScalarSpan } from "./expressionAst";
import type { BindingResolution } from "./bindingResolution";
import { getBuiltinFunctionDefinition, isScalarBuiltinParameterType } from "./builtinFunctions";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import type { SourceLexicalDeclaration } from "../dsl/sourceLexicalNamespaceIndex";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedReference
} from "./typedExpressionAst";

export type BuiltinGeometryArgumentResolutionIssueCode =
  | "builtin-geometry-argument-invalid"
  | "builtin-geometry-type-mismatch";

export type BuiltinGeometryArgumentResolutionIssue = {
  readonly code: BuiltinGeometryArgumentResolutionIssueCode;
  readonly span: ScalarSpan;
  readonly message: string;
  readonly occurrenceIndex: number | null;
  readonly expectedGeometryType?: ModuleGeometryInterfaceType;
  readonly actualGeometryType?: ModuleGeometryInterfaceType;
};

export type ResolveBuiltinGeometryArgumentsInput = {
  readonly ast: ScalarExpressionAst;
  readonly statementIndex: number;
  readonly scalarReferenceResolutions: readonly BindingResolution[];
  readonly sourceDeclarationsByStatementId: ReadonlyMap<string, SourceLexicalDeclaration>;
};

export type ResolveBuiltinGeometryArgumentsResult = {
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  readonly claimedReferenceOccurrenceIndexes: ReadonlySet<number>;
  readonly issues: readonly BuiltinGeometryArgumentResolutionIssue[];
};

const invalidDirectArgumentMessage = (name: string, expected: ModuleGeometryInterfaceType): string =>
  `組み込み関数「${name}」のgeometry引数は、${expected}の直接参照である必要があります。`;

const invalidReferenceMessage = (name: string, resolution: BindingResolution): string => {
  if (resolution.kind === "undefined") return `geometry引数の参照「@${name}」は未定義です。`;
  if (resolution.kind === "forward") return `geometry引数の参照「@${name}」はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution.kind === "self") return `geometry引数の参照「@${name}」は自身の宣言を参照しています。`;
  if (resolution.kind === "duplicate") return `geometry引数の参照「@${name}」は複数の宣言と一致するため一意に解決できません。`;
  if (resolution.kind === "resolvedLocal") return `geometry引数の参照「@${name}」はelement-local scalarです。`;
  if (resolution.kind === "resolved") return `geometry引数の参照「@${name}」はgeometryではありません。`;
  if (resolution.reason === "forward") return `geometry引数の参照「@${name}」はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution.reason === "ambiguous") return `geometry引数の参照「@${name}」は複数の宣言と一致するため一意に解決できません。`;
  if (resolution.reason === "invalidTraversal") return `geometry引数の参照「@${name}」のqualified pathを解決できません。`;
  if (resolution.reason === "private") return `geometry引数の参照「@${name}」はprivateなmodule memberです。`;
  return `geometry引数の参照「@${name}」はgeometryではありません。`;
};

const typeMismatchMessage = (
  expected: ModuleGeometryInterfaceType,
  actual: ModuleGeometryInterfaceType
): string => `geometry引数の型が一致しません(期待: ${expected}, 実際: ${actual})。`;

export const resolveBuiltinGeometryArguments = ({
  ast,
  statementIndex,
  scalarReferenceResolutions,
  sourceDeclarationsByStatementId
}: ResolveBuiltinGeometryArgumentsInput): ResolveBuiltinGeometryArgumentsResult => {
  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [...scalarReferenceResolutions];
  const claimedReferenceOccurrenceIndexes = new Set<number>();
  const issues: BuiltinGeometryArgumentResolutionIssue[] = [];
  let referenceCursor = 0;

  const nextReference = (name: string, span: ScalarSpan): { occurrenceIndex: number; resolution: BindingResolution } => {
    if (referenceCursor >= scalarReferenceResolutions.length) {
      throw new Error(`builtinGeometryArgumentResolution: no BindingResolution supplied for reference "@${name}" at offset ${span.start}`);
    }
    const occurrenceIndex = referenceCursor;
    referenceCursor += 1;
    return { occurrenceIndex, resolution: scalarReferenceResolutions[occurrenceIndex] };
  };

  const resolveDirectGeometryReference = (
    node: Extract<ScalarExpressionAst, { kind: "reference" }>,
    expectedGeometryType: ModuleGeometryInterfaceType
  ): void => {
    const { occurrenceIndex, resolution } = nextReference(node.name, node.span);
    claimedReferenceOccurrenceIndexes.add(occurrenceIndex);

    let target: ScalarExpressionResolvedGeometryTarget | null = null;
    if (
      resolution.kind === "namespace" &&
      resolution.reason === "incompatible" &&
      resolution.declarationKind === "geometry" &&
      resolution.statementId !== undefined
    ) {
      const declaration = sourceDeclarationsByStatementId.get(resolution.statementId);
      const geometryType = moduleGeometryInterfaceTypeOfElement(declaration?.statement);
      if (declaration?.kind === "geometry" && geometryType !== null && declaration.statementIndex < statementIndex) {
        target = {
          statementId: declaration.statementId,
          statementIndex: declaration.statementIndex,
          geometryType
        };
      }
    }

    references[occurrenceIndex] = { kind: "resolvedGeometry", target };
    if (target === null) {
      issues.push({
        code: "builtin-geometry-argument-invalid",
        span: node.span,
        message: invalidReferenceMessage(node.name, resolution),
        occurrenceIndex
      });
      return;
    }
    if (!isModuleGeometryInterfaceAssignable(target.geometryType, expectedGeometryType)) {
      issues.push({
        code: "builtin-geometry-type-mismatch",
        span: node.span,
        message: typeMismatchMessage(expectedGeometryType, target.geometryType),
        occurrenceIndex,
        expectedGeometryType,
        actualGeometryType: target.geometryType
      });
    }
  };

  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "reference":
        nextReference(node.name, node.span);
        return;
      case "geometryProperty":
      case "numberLiteral":
      case "stringLiteral":
      case "booleanLiteral":
      case "unresolvedChoiceLiteral":
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "group":
        visit(node.expression);
        return;
      case "call": {
        const definition = getBuiltinFunctionDefinition(node.name);
        const signature = definition?.signatures.find((candidate) => candidate.argumentTypes.length === node.args.length);
        if (signature === undefined) {
          node.args.forEach(visit);
          return;
        }
        node.args.forEach((argument, index) => {
          const parameterType = signature.argumentTypes[index];
          if (parameterType !== undefined && !isScalarBuiltinParameterType(parameterType)) {
            if (argument.kind === "reference") {
              resolveDirectGeometryReference(argument, parameterType);
            } else {
              visit(argument);
              issues.push({
                code: "builtin-geometry-argument-invalid",
                span: argument.span,
                message: invalidDirectArgumentMessage(node.name, parameterType),
                occurrenceIndex: null
              });
            }
            return;
          }
          visit(argument);
        });
        return;
      }
    }
  };

  visit(ast);
  if (referenceCursor !== scalarReferenceResolutions.length) {
    throw new Error(
      `builtinGeometryArgumentResolution: ${scalarReferenceResolutions.length - referenceCursor} unconsumed reference resolution(s)`
    );
  }
  return { references, claimedReferenceOccurrenceIndexes, issues };
};
