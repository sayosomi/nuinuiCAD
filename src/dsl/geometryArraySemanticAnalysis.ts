import { isDerivedPointKeyForGeometryCategory } from "../model/pointAnchors";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent } from "./dslParameterSpanScanner";
import type { SourceLexicalLookupWithExternal } from "./sourceLexicalNamespaceIndex";
import { geometryArrayTypeOfModuleParameter, geometryArrayTypeOfTypedDeclaration } from "./geometryArraySourceAnnotations";
import { parseGeometryArrayExpression, type GeometryArrayExpression } from "./geometryArrayExpression";
import { resolveGeometryArrayExpression, type GeometryArraySemanticValue } from "./geometryArraySemantics";
import type { GeometryArrayType } from "./geometryArrayTypes";
import { moduleGeometryInterfaceTypeOf, moduleGeometryInterfaceTypeOfElement, type ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";

export type GeometryArraySourceTarget =
  | { kind: "geometry"; statementId: string; statementIndex: number; interfaceType: ModuleGeometryInterfaceType; pointKey?: string }
  | { kind: "moduleParameter"; definitionStatementId: string; parameterIndex: number; interfaceType: ModuleGeometryInterfaceType; pointKey?: string }
  | { kind: "coordinate"; source: string };

export type GeometryArrayValueSemantic = {
  statementId: string;
  statementIndex: number;
  name: string;
  type: GeometryArrayType;
  ownerModuleDefinitionStatementIndex: number | null;
  exported: boolean;
  value: GeometryArraySemanticValue<GeometryArraySourceTarget> | null;
};

export type GeometryArrayModuleParameterSemantic = {
  definitionStatementId: string;
  definitionStatementIndex: number;
  parameterIndex: number;
  name: string;
  type: GeometryArrayType;
  optional: boolean;
};

export type GeometryArraySemanticAnalysis = {
  values: readonly GeometryArrayValueSemantic[];
  valuesByStatementId: ReadonlyMap<string, GeometryArrayValueSemantic>;
  valuesByStatementIndex: ReadonlyMap<number, GeometryArrayValueSemantic>;
  moduleParameters: readonly GeometryArrayModuleParameterSemantic[];
  moduleParametersBySlot: ReadonlyMap<string, GeometryArrayModuleParameterSemantic>;
  diagnostics: readonly DslDiagnostic[];
};

export type GeometryArraySemanticAnalysisInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  resolvePath: (statementIndex: number, path: ReturnType<typeof parseDslReferenceToken>) => SourceLexicalLookupWithExternal;
};

export const geometryArrayDeferredModuleExportId = (instanceStatementId: string, exportName: string) =>
  JSON.stringify(["module-array-export", instanceStatementId, exportName]);

export const parseGeometryArrayDeferredModuleExportId = (valueId: string): { instanceStatementId: string; exportName: string } | null => {
  try {
    const value = JSON.parse(valueId) as unknown;
    return Array.isArray(value) && value.length === 3 && value[0] === "module-array-export" && typeof value[1] === "string" && typeof value[2] === "string"
      ? { instanceStatementId: value[1], exportName: value[2] }
      : null;
  } catch {
    return null;
  }
};

const projectSpan = (statement: DslStatement, span: DslSpan): DslPhysicalSpan | null => {
  const segments: { from: number; to: number }[] = [];
  let logicalStart = 0;
  for (const segment of statement.physicalSpan.segments) {
    const length = segment.to - segment.from;
    const logicalEnd = logicalStart + length;
    const from = Math.max(span.start, logicalStart);
    const to = Math.min(span.end, logicalEnd);
    if (from < to) {
      segments.push({ from: segment.from + from - logicalStart, to: segment.from + to - logicalStart });
    }
    logicalStart = logicalEnd + 1;
  }
  return segments.length > 0 ? { segments, sourceRevision: statement.sourceRevision } : null;
};

const diagnostic = (statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = projectSpan(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: { key: `diagnostic.${code}` },
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

const statementIdAt = (ids: ReadonlyMap<number, string>, statementIndex: number, owner: string) => {
  const id = ids.get(statementIndex);
  if (id === undefined) throw new Error(`geometryArraySemanticAnalysis: no stable statement identity for ${owner} at index ${statementIndex}`);
  return id;
};

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const offsetExpression = (expression: GeometryArrayExpression, offset: number): GeometryArrayExpression =>
  expression.kind === "reference"
    ? { ...expression, span: { start: expression.span.start + offset, end: expression.span.end + offset } }
    : {
        ...expression,
        span: { start: expression.span.start + offset, end: expression.span.end + offset },
        members: expression.members.map((member) => ({
          ...member,
          span: { start: member.span.start + offset, end: member.span.end + offset }
        }))
      };

const moduleParameterByName = (
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, string>,
  statementIndex: number,
  name: string
): { definitionStatementId: string; parameterIndex: number; parameter: Extract<DslStatement, { kind: "moduleDefinition" }>["parameters"][number] } | null => {
  const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
  if (ownerIndex === null) return null;
  const owner = statements[ownerIndex];
  if (owner?.kind !== "moduleDefinition") return null;
  const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === name);
  if (parameterIndex < 0) return null;
  return {
    definitionStatementId: statementIdAt(stableStatementIdByIndex, ownerIndex, "module definition"),
    parameterIndex,
    parameter: owner.parameters[parameterIndex]!
  };
};

const parsedSourceReference = (text: string) => {
  const parsed = parseDslSourceReference(text);
  return parsed.kind === "valid" ? parsed.reference : null;
};

const referencePath = (text: string) => {
  const reference = parsedSourceReference(text);
  if (!reference || reference.property) return null;
  return parseDslReferenceToken(reference.pathText);
};

const coordinateMember = (text: string) => {
  const span = { start: 0, end: text.length };
  return coordinateComponent(text, span, "x") && coordinateComponent(text, span, "y") ? text.trim() : null;
};

const isLineEndpointPointKey = (value: string) => value === "start" || value === "end";

export const analyzeGeometryArraySemantics = (input: GeometryArraySemanticAnalysisInput): GeometryArraySemanticAnalysis => {
  const { statements, stableStatementIdByIndex } = input;
  const diagnostics: DslDiagnostic[] = [];
  const values: GeometryArrayValueSemantic[] = [];
  const valuesByStatementId = new Map<string, GeometryArrayValueSemantic>();
  const valuesByStatementIndex = new Map<number, GeometryArrayValueSemantic>();
  const moduleParameters: GeometryArrayModuleParameterSemantic[] = [];
  const moduleParametersBySlot = new Map<string, GeometryArrayModuleParameterSemantic>();

  for (const [definitionStatementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleDefinition") continue;
    const definitionStatementId = statementIdAt(stableStatementIdByIndex, definitionStatementIndex, "module definition");
    statement.parameters.forEach((parameter, parameterIndex) => {
      const type = geometryArrayTypeOfModuleParameter(parameter);
      if (!type) return;
      const semantic: GeometryArrayModuleParameterSemantic = {
        definitionStatementId,
        definitionStatementIndex,
        parameterIndex,
        name: parameter.name,
        type,
        optional: parameter.optional
      };
      moduleParameters.push(semantic);
      moduleParametersBySlot.set(`${definitionStatementId}:${parameterIndex}`, semantic);
      if (parameter.defaultValue !== null) {
        diagnostics.push(diagnostic(
          statement,
          parameter.defaultSpan ?? parameter.typeSpan ?? statement.keywordSpan,
          "geometry-array-parameter-default",
          "geometry array 型 Module parameter に default は指定できません。"
        ));
      }
    });
  }

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "typedDeclaration") continue;
    const type = geometryArrayTypeOfTypedDeclaration(statement);
    if (!type) continue;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex, "geometry-array declaration");
    const initializerSpan = statement.payloadSpans.initializer;
    const ownerModuleDefinitionStatementIndex = moduleOwnerIndexOf(statements, statementIndex);
    const semantic: GeometryArrayValueSemantic = {
      statementId,
      statementIndex,
      name: statement.name,
      type,
      ownerModuleDefinitionStatementIndex,
      exported: statement.exported,
      value: null
    };
    values.push(semantic);
    valuesByStatementId.set(statementId, semantic);
    valuesByStatementIndex.set(statementIndex, semantic);
    if (!initializerSpan) continue;

    const parsed = parseGeometryArrayExpression(statement.initializer);
    for (const issue of parsed.diagnostics) {
      const span = { start: issue.span.start + initializerSpan.start, end: issue.span.end + initializerSpan.start };
      diagnostics.push(diagnostic(statement, span, issue.code, issue.message));
    }
    if (!parsed.expression || parsed.diagnostics.length > 0) continue;
    const expression = offsetExpression(parsed.expression, initializerSpan.start);

    const resolved = resolveGeometryArrayExpression<GeometryArraySourceTarget>({
      expectedType: type,
      expression,
      resolveMember: (member) => {
        const coordinate = coordinateMember(member.text);
        if (coordinate) {
          if (type.elementType !== "point") {
            return {
              kind: "invalid",
              diagnostic: { code: "geometry-array-member-type-mismatch", message: "coordinate point は point[] の member としてのみ使用できます。", span: member.span }
            };
          }
          return { kind: "resolved", value: { interfaceType: "point", target: { kind: "coordinate", source: coordinate } } };
        }

        const sourceReference = parsedSourceReference(member.text);
        if (!sourceReference) {
          return {
            kind: "invalid",
            diagnostic: { code: "geometry-array-invalid-member", message: "geometry array member は geometry reference または coordinate point で指定してください。", span: member.span }
          };
        }
        const path = parseDslReferenceToken(sourceReference.pathText);
        if (path.segments.length === 0) {
          return {
            kind: "invalid",
            diagnostic: { code: "geometry-array-invalid-member", message: "geometry array member の参照が不正です。", span: member.span }
          };
        }
        const pointKey = sourceReference.property;
        if (pointKey && type.elementType !== "point") {
          return {
            kind: "invalid",
            diagnostic: { code: "geometry-array-member-type-mismatch", message: "derived point reference は point[] の member としてのみ使用できます。", span: member.span }
          };
        }

        if (path.segments.length === 1 && !path.absolute) {
          const moduleParameter = moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!);
          if (moduleParameter) {
            const arrayType = geometryArrayTypeOfModuleParameter(moduleParameter.parameter);
            if (arrayType) {
              return {
                kind: "invalid",
                diagnostic: { code: "geometry-array-nested-array", message: "geometry array を literal member として入れ子にすることはできません。", span: member.span }
              };
            }
            const interfaceType = moduleGeometryInterfaceTypeOf(moduleParameter.parameter.type);
            if (interfaceType) {
              if (pointKey) {
                if ((interfaceType !== "line" && interfaceType !== "path") || !isLineEndpointPointKey(pointKey)) {
                  return {
                    kind: "invalid",
                    diagnostic: { code: "geometry-array-member-type-mismatch", message: `geometry parameter「${path.segments[0]}」の derived point「${pointKey}」を point[] member として解決できません。`, span: member.span }
                  };
                }
                return {
                  kind: "resolved",
                  value: {
                    interfaceType: "point",
                    target: {
                      kind: "moduleParameter",
                      definitionStatementId: moduleParameter.definitionStatementId,
                      parameterIndex: moduleParameter.parameterIndex,
                      interfaceType,
                      pointKey
                    }
                  }
                };
              }
              return {
                kind: "resolved",
                value: {
                  interfaceType,
                  target: {
                    kind: "moduleParameter",
                    definitionStatementId: moduleParameter.definitionStatementId,
                    parameterIndex: moduleParameter.parameterIndex,
                    interfaceType
                  }
                }
              };
            }
          }
        }

        const lookup = input.resolvePath(statementIndex, path);
        if (lookup.kind !== "resolved") {
          const message = lookup.kind === "forward"
            ? `geometry array member「${member.text}」はこの位置より後で宣言されています。`
            : lookup.kind === "ambiguous"
              ? `geometry array member 参照が曖昧です: ${member.text}`
              : `未解決の geometry array member です: ${member.text}`;
          return { kind: "invalid", diagnostic: { code: `geometry-array-member-${lookup.kind}`, message, span: member.span } };
        }
        const baseInterfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
        if (!baseInterfaceType) {
          return {
            kind: "invalid",
            diagnostic: { code: "geometry-array-member-not-geometry", message: `参照先「${member.text}」は geometry value ではありません。`, span: member.span }
          };
        }
        if (pointKey) {
          const targetStatement = lookup.declaration.statement;
          if (
            targetStatement.kind !== "element" ||
            !isGeometryDeclarationCategory(targetStatement.category) ||
            !isDerivedPointKeyForGeometryCategory(targetStatement.category, pointKey)
          ) {
            return {
              kind: "invalid",
              diagnostic: { code: "geometry-array-member-type-mismatch", message: `derived point「${pointKey}」を参照先「${sourceReference.pathText}」から解決できません。`, span: member.span }
            };
          }
          return {
            kind: "resolved",
            value: {
              interfaceType: "point",
              target: {
                kind: "geometry",
                statementId: lookup.declaration.statementId,
                statementIndex: lookup.declaration.statementIndex,
                interfaceType: baseInterfaceType,
                pointKey
              }
            }
          };
        }
        return {
          kind: "resolved",
          value: {
            interfaceType: baseInterfaceType,
            target: {
              kind: "geometry",
              statementId: lookup.declaration.statementId,
              statementIndex: lookup.declaration.statementIndex,
              interfaceType: baseInterfaceType
            }
          }
        };
      },
      resolveArrayReference: (sourceText, sourceSpan) => {
        const path = referencePath(sourceText);
        if (!path || path.segments.length === 0) {
          return { kind: "invalid", diagnostic: { code: "geometry-array-invalid-reference", message: "geometry array alias の参照が不正です。", span: sourceSpan } };
        }
        if (path.segments.length === 1 && !path.absolute) {
          const moduleParameter = moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!);
          if (moduleParameter) {
            const parameterType = geometryArrayTypeOfModuleParameter(moduleParameter.parameter);
            if (parameterType) {
              return {
                kind: "resolved",
                targetValueId: `${moduleParameter.definitionStatementId}:parameter:${moduleParameter.parameterIndex}`,
                type: parameterType
              };
            }
          }
        }
        const lookup = input.resolvePath(statementIndex, path);
        if (
          lookup.kind === "invalidTraversal" &&
          lookup.declaration.kind === "moduleInstance" &&
          path.segments.length === 2 &&
          lookup.segmentIndex === 1
        ) {
          return {
            kind: "deferred",
            targetValueId: geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!)
          };
        }
        if (lookup.kind !== "resolved") {
          const message = lookup.kind === "forward"
            ? `geometry array「${sourceText}」はこの位置より後で宣言されています。`
            : lookup.kind === "ambiguous"
              ? `geometry array 参照が曖昧です: ${sourceText}`
              : `未解決の geometry array 参照です: ${sourceText}`;
          return { kind: "invalid", diagnostic: { code: `geometry-array-reference-${lookup.kind}`, message, span: sourceSpan } };
        }
        const target = valuesByStatementIndex.get(lookup.declaration.statementIndex);
        if (!target) {
          return { kind: "invalid", diagnostic: { code: "geometry-array-reference-not-array", message: `参照先「${sourceText}」は geometry array ではありません。`, span: sourceSpan } };
        }
        return { kind: "resolved", targetValueId: target.statementId, type: target.type };
      }
    });

    for (const issue of resolved.diagnostics) diagnostics.push(diagnostic(statement, issue.span, issue.code, issue.message));
    semantic.value = resolved.value;
  }

  return {
    values,
    valuesByStatementId,
    valuesByStatementIndex,
    moduleParameters,
    moduleParametersBySlot,
    diagnostics
  };
};
