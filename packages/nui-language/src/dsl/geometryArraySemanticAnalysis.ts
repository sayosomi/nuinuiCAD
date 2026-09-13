import { isDerivedPointKeyForGeometryCategory } from "../model/pointAnchors";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent } from "./dslParameterSpanScanner";
import type { SourceLexicalLookupWithExternal } from "./sourceLexicalNamespaceIndex";
import { geometryArrayTypeOfModuleParameter } from "./geometryArraySourceAnnotations";
import { parseGeometryArrayExpression, type GeometryArrayExpression } from "./geometryArrayExpression";
import {
  resolveDslArrayExpression,
  resolveGeometryArrayExpression,
  type DslArraySemanticValue,
  type DslArrayMemberResolution,
  type GeometryArrayMemberResolution,
  type GeometryArraySemanticValue
} from "./geometryArraySemantics";
import type { DslArrayMappedValue, GeometryArrayMappedValue } from "./geometryArraySemantics";
import { geometryArrayTypeName, isDslNonArrayValueTypeAssignable, type GeometryArrayType } from "./geometryArrayTypes";
import { moduleGeometryInterfaceTypeOf, moduleGeometryInterfaceTypeOfElement, type ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import {
  isDslArrayValueType,
  dslRequiredValueTypeOf,
  isDslGeometryValueType,
  isDslOptionalValueType,
  isDslScalarValueType,
  recordTypeReferenceOfDslValueType,
  scalarTypeOfDslValueType,
  type DslArrayValueType,
  type DslNonArrayValueType,
  type DslValueType
} from "./dslValueTypes";
import type { RecordSemanticAnalysis } from "./recordSemanticAnalysis";
import { scanScalarLiteral } from "../scalars/literalScanner";
import { isChoiceOptionMember } from "../scalars/scalarAssignability";

export type GeometryArraySourceTarget =
  | { kind: "geometry"; statementId: string; statementIndex: number; interfaceType: ModuleGeometryInterfaceType; pointKey?: string }
  | { kind: "geometryValue"; statementId: string; statementIndex: number; interfaceType: ModuleGeometryInterfaceType; pointKey?: string }
  | { kind: "moduleParameter"; definitionStatementId: string; parameterIndex: number; interfaceType: ModuleGeometryInterfaceType; pointKey?: string }
  | { kind: "coordinate"; source: string };

export type GenericArraySourceTarget =
  | GeometryArraySourceTarget
  | { kind: "scalarValue"; statementId: string; statementIndex: number }
  | { kind: "recordValue"; statementId: string; statementIndex: number }
  | { kind: "moduleParameterValue"; definitionStatementId: string; parameterIndex: number };

export type GenericArrayValueSemantic = {
  statementId: string;
  statementIndex: number;
  name: string;
  valueType: DslArrayValueType;
  declaredValueType: DslValueType;
  ownerModuleDefinitionStatementIndex: number | null;
  exported: boolean;
  value: DslArraySemanticValue<GenericArraySourceTarget> | null;
};

export type GenericArrayModuleParameterSemantic = {
  definitionStatementId: string;
  definitionStatementIndex: number;
  parameterIndex: number;
  name: string;
  valueType: DslArrayValueType;
  optional: boolean;
};

export type GeometryArrayValueSemantic = {
  statementId: string;
  statementIndex: number;
  name: string;
  type: GeometryArrayType;
  declaredValueType: DslValueType;
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
  /** Generic non-geometry arrays share this owner; geometry entries remain in
   * the compatibility projection above for existing runtime consumers. */
  genericValues: readonly GenericArrayValueSemantic[];
  genericValuesByStatementId: ReadonlyMap<string, GenericArrayValueSemantic>;
  genericValuesByStatementIndex: ReadonlyMap<number, GenericArrayValueSemantic>;
  genericModuleParameters: readonly GenericArrayModuleParameterSemantic[];
  genericModuleParametersBySlot: ReadonlyMap<string, GenericArrayModuleParameterSemantic>;
  diagnostics: readonly DslDiagnostic[];
};

/** The shared declaration-backed view used by scalar property consumers. The
 * historical geometry projection and the generalized collection projection
 * remain separate for their existing runtime clients, but cardinality reads
 * use this one owner. */
export type DslCollectionValueSemantic =
  | GenericArrayValueSemantic
  | GeometryArrayValueSemantic;

export const collectionValueSemanticForStatement = (
  analysis: GeometryArraySemanticAnalysis,
  statementIndex: number
): DslCollectionValueSemantic | null =>
  analysis.genericValuesByStatementIndex.get(statementIndex) ??
  analysis.valuesByStatementIndex.get(statementIndex) ??
  null;

/** Resolve only statically-known literal/alias cardinality. Module parameter
 * and deferred export identities deliberately remain unresolved here; the
 * Module runtime supplies those values from the materialized argument. */
export const collectionLengthForValueId = (
  analysis: GeometryArraySemanticAnalysis,
  valueId: string,
  seen: ReadonlySet<string> = new Set()
): number | null => {
  if (seen.has(valueId)) return null;
  const value = analysis.genericValuesByStatementId.get(valueId) ?? analysis.valuesByStatementId.get(valueId);
  if (!value?.value) return null;
  if (value.value.kind === "literal") return value.value.members.length;
  if (value.value.kind === "none" || value.value.kind === "if" || value.value.kind === "match" || value.value.kind === "coalesce") return null;
  if (value.value.kind === "map") return collectionLengthForValueId(analysis, value.value.sourceValueId, new Set([...seen, valueId]));
  return collectionLengthForValueId(analysis, value.value.targetValueId, new Set([...seen, valueId]));
};

export type GeometryArraySemanticAnalysisInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  resolvePath: (statementIndex: number, path: ReturnType<typeof parseDslReferenceToken>) => SourceLexicalLookupWithExternal;
  recordSemanticAnalysis?: RecordSemanticAnalysis;
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

const diagnostic = (
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  presentation?: DslDiagnostic["presentation"]
): DslDiagnostic => {
  const physicalSpan = projectSpan(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: presentation ?? { key: `diagnostic.${code}` },
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
  expression.kind === "none"
    ? { ...expression, span: { start: expression.span.start + offset, end: expression.span.end + offset } }
    : expression.kind === "reference"
    ? { ...expression, span: { start: expression.span.start + offset, end: expression.span.end + offset } }
    : expression.kind === "valueFor"
      ? {
          ...expression,
          span: { start: expression.span.start + offset, end: expression.span.end + offset },
          binderSpan: { start: expression.binderSpan.start + offset, end: expression.binderSpan.end + offset },
          sourceSpan: { start: expression.sourceSpan.start + offset, end: expression.sourceSpan.end + offset },
          bodySpan: { start: expression.bodySpan.start + offset, end: expression.bodySpan.end + offset }
        }
    : expression.kind === "if"
      ? {
          ...expression,
          span: { start: expression.span.start + offset, end: expression.span.end + offset },
          conditionSpan: { start: expression.conditionSpan.start + offset, end: expression.conditionSpan.end + offset },
          thenBranch: offsetExpression(expression.thenBranch, offset),
          elseBranch: expression.elseBranch ? offsetExpression(expression.elseBranch, offset) : null
        }
      : expression.kind === "match"
        ? {
            ...expression,
            span: { start: expression.span.start + offset, end: expression.span.end + offset },
            scrutineeSpan: { start: expression.scrutineeSpan.start + offset, end: expression.scrutineeSpan.end + offset },
            arms: expression.arms.map((arm) => ({
              ...arm,
              labelSpan: { start: arm.labelSpan.start + offset, end: arm.labelSpan.end + offset },
              expression: offsetExpression(arm.expression, offset)
            }))
          }
        : expression.kind === "coalesce"
          ? {
              ...expression,
              span: { start: expression.span.start + offset, end: expression.span.end + offset },
              left: offsetExpression(expression.left, offset),
              right: offsetExpression(expression.right, offset)
            }
        : {
        ...expression,
        span: { start: expression.span.start + offset, end: expression.span.end + offset },
        members: expression.members.map((member) => ({
          ...member,
          span: { start: member.span.start + offset, end: member.span.end + offset }
        }))
        };

export const moduleParameterByName = (
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

const scalarLiteralType = (kind: "number" | "string" | "boolean"): DslNonArrayValueType => ({ kind });

const recordTypeWithIdentity = (type: DslNonArrayValueType, identity: string | null): DslNonArrayValueType =>
  type.kind === "record" && identity ? { ...type, identity } : type;

const recordIdentityForType = (
  type: DslNonArrayValueType,
  statementIndex: number,
  recordSemanticAnalysis: RecordSemanticAnalysis | undefined,
  resolvePath: GeometryArraySemanticAnalysisInput["resolvePath"]
): string | null => {
  if (type.kind !== "record") return null;
  const lookup = resolvePath(statementIndex, parseDslReferenceToken(type.name));
  if (lookup.kind === "resolved" && lookup.declaration.kind === "recordDefinition") {
    return recordSemanticAnalysis?.definitionsByStatementIndex.get(lookup.declaration.statementIndex)?.statementId ?? null;
  }
  return null;
};

const collectionMemberDiagnostic = (code: string, message: string, span: DslSpan): DslArrayMemberResolution<GenericArraySourceTarget> => ({
  kind: "invalid",
  diagnostic: { code, message, span, presentation: { key: `diagnostic.${code}` } }
});

const arrayValueTypeOfParameter = (parameter: Extract<DslStatement, { kind: "moduleDefinition" }>["parameters"][number]): DslArrayValueType | null =>
  isDslArrayValueType(dslRequiredValueTypeOf(parameter.valueType)) && !isDslGeometryValueType((dslRequiredValueTypeOf(parameter.valueType) as DslArrayValueType).elementType)
    ? dslRequiredValueTypeOf(parameter.valueType) as DslArrayValueType
    : null;

export const analyzeGeometryArraySemantics = (input: GeometryArraySemanticAnalysisInput): GeometryArraySemanticAnalysis => {
  const { statements, stableStatementIdByIndex } = input;
  const diagnostics: DslDiagnostic[] = [];
  const values: GeometryArrayValueSemantic[] = [];
  const valuesByStatementId = new Map<string, GeometryArrayValueSemantic>();
  const valuesByStatementIndex = new Map<number, GeometryArrayValueSemantic>();
  const moduleParameters: GeometryArrayModuleParameterSemantic[] = [];
  const moduleParametersBySlot = new Map<string, GeometryArrayModuleParameterSemantic>();
  const genericValues: GenericArrayValueSemantic[] = [];
  const genericValuesByStatementId = new Map<string, GenericArrayValueSemantic>();
  const genericValuesByStatementIndex = new Map<number, GenericArrayValueSemantic>();
  const genericModuleParameters: GenericArrayModuleParameterSemantic[] = [];
  const genericModuleParametersBySlot = new Map<string, GenericArrayModuleParameterSemantic>();

  const resolvedArrayRecordIdentity = (
    type: DslNonArrayValueType,
    statementIndex: number,
    statement: DslStatement,
    span: DslSpan
  ): string | null => {
    if (type.kind !== "record") return null;
    const lookup = input.resolvePath(statementIndex, parseDslReferenceToken(type.name));
    if (lookup.kind === "resolved" && lookup.declaration.kind === "recordDefinition") {
      return input.recordSemanticAnalysis?.definitionsByStatementIndex.get(lookup.declaration.statementIndex)?.statementId ?? null;
    }
    const code = lookup.kind === "forward"
      ? "record-type-forward-reference"
      : lookup.kind === "ambiguous"
        ? "record-type-ambiguous"
        : lookup.kind === "resolved"
          ? "record-type-not-record"
          : "record-type-undefined";
    const message = code === "record-type-forward-reference"
      ? `record 型「${type.name}」はこの位置より後で宣言されているため、まだ参照できません。`
      : code === "record-type-ambiguous"
        ? `record 型「${type.name}」は複数の宣言と一致するため一意に解決できません。`
        : code === "record-type-not-record"
          ? `型名「${type.name}」は record definition を参照していません。`
          : `未定義の record 型「${type.name}」を参照しています。`;
    diagnostics.push(diagnostic(statement, span, code, message, { key: `diagnostic.${code}`, parameters: { name: type.name } }));
    return null;
  };

  // Register the generalized collection namespace before resolving any
  // initializer, preserving source-order lookup while allowing later aliases
  // to resolve only through the existing lexical resolver.
  for (const [definitionStatementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleDefinition") continue;
    const definitionStatementId = statementIdAt(stableStatementIdByIndex, definitionStatementIndex, "module definition");
    statement.parameters.forEach((parameter, parameterIndex) => {
      const valueType = arrayValueTypeOfParameter(parameter);
      if (!valueType) return;
      const recordIdentity = valueType.elementType.kind === "record"
        ? input.recordSemanticAnalysis?.moduleParameters.find((candidate) => candidate.definitionStatementId === definitionStatementId && candidate.parameterIndex === parameterIndex)?.typeIdentity
          ?? resolvedArrayRecordIdentity(valueType.elementType, definitionStatementIndex, statement, parameter.typeSpan ?? statement.keywordSpan)
        : null;
      const enrichedValueType: DslArrayValueType = {
        ...valueType,
        elementType: recordTypeWithIdentity(valueType.elementType, recordIdentity)
      };
      const semantic: GenericArrayModuleParameterSemantic = {
        definitionStatementId,
        definitionStatementIndex,
        parameterIndex,
        name: parameter.name,
        valueType: enrichedValueType,
        optional: isDslOptionalValueType(parameter.valueType)
      };
      genericModuleParameters.push(semantic);
      genericModuleParametersBySlot.set(`${definitionStatementId}:${parameterIndex}`, semantic);
      if (parameter.defaultValue !== null) {
        diagnostics.push(diagnostic(
          statement,
          parameter.defaultSpan ?? parameter.typeSpan ?? statement.keywordSpan,
          "array-parameter-default",
          "array 型 Module parameter に default は指定できません。"
        ));
      }
    });
  }

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "typedDeclaration") continue;
    const declaredValueType = statement.valueType;
    if (!declaredValueType) continue;
    const requiredValueType = dslRequiredValueTypeOf(declaredValueType);
    if (!requiredValueType || !isDslArrayValueType(requiredValueType) || isDslGeometryValueType(requiredValueType.elementType)) continue;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex, "array declaration");
    const semantic: GenericArrayValueSemantic = {
      statementId,
      statementIndex,
      name: statement.name,
      valueType: {
        ...requiredValueType,
        elementType: recordTypeWithIdentity(
          requiredValueType.elementType,
          requiredValueType.elementType.kind === "record"
            ? recordIdentityForType(requiredValueType.elementType, statementIndex, input.recordSemanticAnalysis, input.resolvePath)
            ?? resolvedArrayRecordIdentity(requiredValueType.elementType, statementIndex, statement, statement.payloadSpans.type ?? statement.nameSpan ?? statement.keywordSpan)
            : null
        )
      },
      declaredValueType,
      ownerModuleDefinitionStatementIndex: moduleOwnerIndexOf(statements, statementIndex),
      exported: Boolean(statement.exported),
      value: null
    };
    genericValues.push(semantic);
    genericValuesByStatementId.set(statementId, semantic);
    genericValuesByStatementIndex.set(statementIndex, semantic);
  }

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
        optional: isDslOptionalValueType(parameter.valueType)
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
    const declaredValueType = statement.valueType;
    if (!declaredValueType) continue;
    const requiredValueType = dslRequiredValueTypeOf(declaredValueType);
    const type = requiredValueType && isDslArrayValueType(requiredValueType) && isDslGeometryValueType(requiredValueType.elementType)
      ? { kind: "geometryArray" as const, elementType: requiredValueType.elementType.kind as ModuleGeometryInterfaceType }
      : null;
    if (!type) continue;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex, "geometry-array declaration");
    const initializerSpan = statement.payloadSpans.initializer;
    const ownerModuleDefinitionStatementIndex = moduleOwnerIndexOf(statements, statementIndex);
    const semantic: GeometryArrayValueSemantic = {
      statementId,
      statementIndex,
      name: statement.name,
      type,
      declaredValueType,
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
      expectedValueType: semantic.declaredValueType,
      expression,
      resolveMember: (member): GeometryArrayMemberResolution<GeometryArraySourceTarget> => {
        const coordinate = coordinateMember(member.text);
        if (coordinate) {
          if (type.elementType !== "point") {
            return {
              kind: "invalid",
              diagnostic: {
                code: "geometry-array-member-type-mismatch",
                message: "coordinate point は point[] の member としてのみ使用できます。",
                presentation: {
                  key: "diagnostic.geometry-array-member-type-mismatch",
                  parameters: { member: member.text, expected: geometryArrayTypeName(type), actual: "point[]" }
                },
                span: member.span
              }
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
            diagnostic: {
              code: "geometry-array-member-type-mismatch",
              message: "derived point reference は point[] の member としてのみ使用できます。",
              presentation: {
                key: "diagnostic.geometry-array-member-type-mismatch",
                parameters: { member: member.text, expected: geometryArrayTypeName(type), actual: "point[]" }
              },
              span: member.span
            }
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
                    diagnostic: {
                      code: "geometry-array-member-type-mismatch",
                      message: `geometry parameter「${path.segments[0]}」の derived point「${pointKey}」を point[] member として解決できません。`,
                      presentation: {
                        key: "diagnostic.geometry-array-member-type-mismatch",
                        parameters: { member: path.segments[0]!, expected: "point[]", actual: `${interfaceType}.${pointKey}` }
                      },
                      span: member.span
                    }
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
          return {
            kind: "invalid",
            diagnostic: {
              code: `geometry-array-member-${lookup.kind}`,
              message,
              presentation: {
                key: `diagnostic.geometry-array-member-${lookup.kind}`,
                parameters: { member: member.text }
              },
              span: member.span
            }
          };
        }
        if (lookup.declaration.statement.kind === "typedDeclaration" && isDslGeometryValueType(lookup.declaration.statement.valueType)) {
          const declaredInterfaceType = lookup.declaration.statement.valueType.kind;
          if (pointKey && (declaredInterfaceType === "point" || !isLineEndpointPointKey(pointKey))) {
            return {
              kind: "invalid",
              diagnostic: {
                code: "geometry-array-member-type-mismatch",
                message: `geometry value「${sourceReference.pathText}」の derived point「${pointKey}」を解決できません。`,
                presentation: { key: "diagnostic.geometry-array-member-type-mismatch", parameters: { member: member.text, expected: "point[]", actual: `${declaredInterfaceType}.${pointKey}` } },
                span: member.span
              }
            };
          }
          return {
            kind: "resolved",
            value: {
              interfaceType: pointKey ? "point" : declaredInterfaceType,
              target: {
                kind: "geometryValue",
                statementId: lookup.declaration.statementId,
                statementIndex: lookup.declaration.statementIndex,
                interfaceType: declaredInterfaceType,
                ...(pointKey ? { pointKey } : {})
              }
            }
          };
        }
        const baseInterfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
        if (!baseInterfaceType) {
          return {
            kind: "invalid",
            diagnostic: {
              code: "geometry-array-member-not-geometry",
              message: `参照先「${member.text}」は geometry value ではありません。`,
              presentation: { key: "diagnostic.geometry-array-member-not-geometry", parameters: { member: member.text } },
              span: member.span
            }
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
              diagnostic: {
                code: "geometry-array-member-type-mismatch",
                message: `derived point「${pointKey}」を参照先「${sourceReference.pathText}」から解決できません。`,
                presentation: {
                  key: "diagnostic.geometry-array-member-type-mismatch",
                  parameters: { member: sourceReference.pathText, expected: "point[]", actual: `derived point ${pointKey}` }
                },
                span: member.span
              }
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
              const valueType = { kind: "array" as const, elementType: { kind: parameterType.elementType as "point" | "line" | "path" } };
              return {
                kind: "resolved",
                targetValueId: `${moduleParameter.definitionStatementId}:parameter:${moduleParameter.parameterIndex}`,
                type: parameterType,
                valueType: isDslOptionalValueType(moduleParameter.parameter.valueType)
                  ? { kind: "optional", valueType }
                  : valueType
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
          return {
            kind: "invalid",
            diagnostic: {
              code: `geometry-array-reference-${lookup.kind}`,
              message,
              presentation: {
                key: `diagnostic.geometry-array-reference-${lookup.kind}`,
                parameters: { reference: sourceText }
              },
              span: sourceSpan
            }
          };
        }
        const target = valuesByStatementIndex.get(lookup.declaration.statementIndex);
        if (!target) {
          return {
            kind: "invalid",
            diagnostic: {
              code: "geometry-array-reference-not-array",
              message: `参照先「${sourceText}」は geometry array ではありません。`,
              presentation: { key: "diagnostic.geometry-array-reference-not-array", parameters: { reference: sourceText } },
              span: sourceSpan
            }
          };
        }
        return { kind: "resolved", targetValueId: target.statementId, type: target.type, valueType: target.declaredValueType };
      },
      resolveValueFor: (valueFor) => {
        const sourcePath = referencePath(valueFor.sourceText);
        if (!sourcePath || sourcePath.segments.length === 0) {
          return { kind: "invalid", diagnostic: { code: "geometry-array-value-for-source-invalid", message: "value-for の source には whole-value geometry collection reference が必要です。", span: valueFor.sourceSpan } };
        }
        let sourceValueId: string | null = null;
        let sourceType: GeometryArrayType | null = null;
        if (sourcePath.segments.length === 1 && !sourcePath.absolute) {
          const parameter = moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, sourcePath.segments[0]!);
          if (parameter) {
            sourceType = geometryArrayTypeOfModuleParameter(parameter.parameter);
            sourceValueId = sourceType ? `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}` : null;
          }
        }
        const lookup = sourceType ? null : input.resolvePath(statementIndex, sourcePath);
        if (!sourceType && lookup?.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && sourcePath.segments.length === 2 && lookup.segmentIndex === 1) {
          const definitionLookup = input.resolvePath(lookup.declaration.statementIndex, parseDslReferenceToken(lookup.declaration.statement.kind === "moduleInstance" ? lookup.declaration.statement.moduleName : ""));
          if (definitionLookup.kind === "resolved" && definitionLookup.declaration.statement.kind === "moduleDefinition") {
            const exportedIndex = statements.findIndex((candidate) =>
              candidate.kind === "typedDeclaration" && candidate.exported && candidate.name === sourcePath.segments[1] &&
              candidate.enclosing?.statementIndex === definitionLookup.declaration.statementIndex
            );
            const exported = exportedIndex >= 0 ? valuesByStatementIndex.get(exportedIndex) : null;
            sourceType = exported?.type ?? null;
            sourceValueId = geometryArrayDeferredModuleExportId(lookup.declaration.statementId, sourcePath.segments[1]!);
          }
        }
        if (!sourceType && lookup?.kind === "resolved") {
          const target = valuesByStatementIndex.get(lookup.declaration.statementIndex);
          sourceType = target?.type ?? null;
          sourceValueId = target?.statementId ?? null;
        }
        if (!sourceType || !sourceValueId) {
          const code = lookup?.kind === "forward" ? "geometry-array-value-for-source-forward" : "geometry-array-value-for-source-invalid";
          return { kind: "invalid", diagnostic: { code, message: `value-for source「${valueFor.sourceText}」は解決できない geometry collection です。`, span: valueFor.sourceSpan } };
        }
        const mapped: GeometryArrayMappedValue = {
          kind: "map",
          type,
          sourceValueId,
          sourceElementType: sourceType.elementType,
          resultElementType: type.elementType,
          binderId: `geometry-value-for-binder:${semantic.statementId}`,
          binder: valueFor.binder,
          binderSpan: valueFor.binderSpan,
          sourceSpan: valueFor.sourceSpan,
          bodySpan: valueFor.bodySpan,
          sourceOrder: semantic.statementIndex
        };
        return { kind: "resolved", value: mapped };
      }
    });

    for (const issue of resolved.diagnostics) diagnostics.push(diagnostic(statement, issue.span, issue.code, issue.message, issue.presentation));
    semantic.value = resolved.value;
  }

  for (const semantic of genericValues) {
    const statement = statements[semantic.statementIndex];
    if (!statement || statement.kind !== "typedDeclaration") continue;
    const initializerSpan = statement.payloadSpans.initializer;
    if (!initializerSpan) continue;
    const parsed = parseGeometryArrayExpression(statement.initializer);
    for (const issue of parsed.diagnostics) {
      const span = { start: issue.span.start + initializerSpan.start, end: issue.span.end + initializerSpan.start };
      diagnostics.push(diagnostic(statement, span, issue.code.replace(/^geometry-array/, "array"), issue.message));
    }
    if (!parsed.expression || parsed.diagnostics.length > 0) continue;
    const expression = offsetExpression(parsed.expression, initializerSpan.start);
    const expectedType = semantic.valueType;
    const enrichedExpectedType: DslArrayValueType = {
      ...expectedType,
      elementType: recordTypeWithIdentity(
        expectedType.elementType,
        recordIdentityForType(expectedType.elementType, semantic.statementIndex, input.recordSemanticAnalysis, input.resolvePath)
      )
    };
    const resolved = resolveDslArrayExpression<GenericArraySourceTarget>({
      expectedType: enrichedExpectedType,
      expectedValueType: semantic.declaredValueType,
      expression,
      resolveMember: (member) => {
        const expectedElement = enrichedExpectedType.elementType;
        const token = scanScalarLiteral(member.text, { start: 0, end: member.text.length });
        if (token.kind !== "error" && token.span.start === 0 && token.span.end === member.text.length) {
          if (expectedElement.kind === "choice") {
            if (token.kind === "choice" && isChoiceOptionMember(expectedElement, token.raw)) {
              return { kind: "resolved", value: { elementType: expectedElement, target: { kind: "scalarValue", statementId: semantic.statementId, statementIndex: semantic.statementIndex } } };
            }
            return collectionMemberDiagnostic("array-member-type-mismatch", `choice literal「${member.text}」は宣言された choice の option ではありません。`, member.span);
          }
          if (isDslScalarValueType(expectedElement) && token.kind === expectedElement.kind) {
            return { kind: "resolved", value: { elementType: scalarLiteralType(token.kind), target: { kind: "scalarValue", statementId: semantic.statementId, statementIndex: semantic.statementIndex } } };
          }
          return collectionMemberDiagnostic("array-member-type-mismatch", `array member「${member.text}」の型が宣言型と一致しません。`, member.span);
        }

        const sourceReference = parsedSourceReference(member.text);
        if (!sourceReference) return collectionMemberDiagnostic("array-invalid-member", "array member は scalar/geometry/record reference または scalar literal で指定してください。", member.span);
        const path = parseDslReferenceToken(sourceReference.pathText);
        if (path.segments.length === 0) return collectionMemberDiagnostic("array-invalid-member", "array member の参照が不正です。", member.span);
        if (path.segments.length === 1 && !path.absolute) {
          const moduleParameter = moduleParameterByName(statements, stableStatementIdByIndex, semantic.statementIndex, path.segments[0]!);
          if (moduleParameter) {
            if (isDslArrayValueType(moduleParameter.parameter.valueType)) return collectionMemberDiagnostic("nested-array-member", "配列を array literal member として入れ子にすることはできません。", member.span);
            if (moduleParameter.parameter.valueType) {
              const actual = recordTypeWithIdentity(
                moduleParameter.parameter.valueType,
                moduleParameter.parameter.valueType.kind === "record"
                  ? input.recordSemanticAnalysis?.moduleParameters.find((candidate) => candidate.definitionStatementId === moduleParameter.definitionStatementId && candidate.parameterIndex === moduleParameter.parameterIndex)?.typeIdentity ?? null
                  : null
              );
              return { kind: "resolved", value: { elementType: actual, target: { kind: "moduleParameterValue", definitionStatementId: moduleParameter.definitionStatementId, parameterIndex: moduleParameter.parameterIndex } } };
            }
          }
        }
        const lookup = input.resolvePath(semantic.statementIndex, path);
        if (lookup.kind !== "resolved") {
          const message = lookup.kind === "forward"
            ? `array member「${member.text}」はこの位置より後で宣言されています。`
            : lookup.kind === "ambiguous"
              ? `array member 参照が曖昧です: ${member.text}`
              : `未解決の array member です: ${member.text}`;
          return collectionMemberDiagnostic(`array-member-${lookup.kind}`, message, member.span);
        }
        const target = lookup.declaration;
        if (target.statement.kind === "typedDeclaration") {
          if (isDslArrayValueType(target.statement.valueType)) return collectionMemberDiagnostic("nested-array-member", "配列を array literal member として入れ子にすることはできません。", member.span);
          if (!target.statement.valueType) return collectionMemberDiagnostic("array-member-invalid-type", `参照先「${member.text}」の型を解決できません。`, member.span);
          const actual = recordTypeWithIdentity(
            target.statement.valueType,
            target.statement.valueType.kind === "record" ? input.recordSemanticAnalysis?.valuesByStatementIndex.get(target.statementIndex)?.typeIdentity ?? null : null
          );
          const targetKind = actual.kind === "record" ? "recordValue" : isDslGeometryValueType(actual) ? "geometryValue" : "scalarValue";
          const targetValue = targetKind === "recordValue"
            ? { kind: "recordValue" as const, statementId: target.statementId, statementIndex: target.statementIndex }
            : targetKind === "geometryValue"
              ? { kind: "geometryValue" as const, statementId: target.statementId, statementIndex: target.statementIndex, interfaceType: actual.kind as ModuleGeometryInterfaceType }
              : { kind: "scalarValue" as const, statementId: target.statementId, statementIndex: target.statementIndex };
          return { kind: "resolved", value: { elementType: actual, target: targetValue } };
        }
        const interfaceType = moduleGeometryInterfaceTypeOfElement(target.statement);
        if (interfaceType) {
          const geometryType: DslNonArrayValueType = { kind: interfaceType };
          return { kind: "resolved", value: { elementType: geometryType, target: { kind: "geometry", statementId: target.statementId, statementIndex: target.statementIndex, interfaceType } } };
        }
        const recordValue = input.recordSemanticAnalysis?.valuesByStatementIndex.get(target.statementIndex);
        if (recordValue?.typeIdentity) {
          const recordType: DslNonArrayValueType = { kind: "record", name: recordValue.typeReference.sourceName, identity: recordValue.typeIdentity };
          return { kind: "resolved", value: { elementType: recordType, target: { kind: "recordValue", statementId: target.statementId, statementIndex: target.statementIndex } } };
        }
        return collectionMemberDiagnostic("array-member-not-value", `参照先「${member.text}」は array member に使用できる value ではありません。`, member.span);
      },
      resolveArrayReference: (sourceText, sourceSpan) => {
        const path = referencePath(sourceText);
        if (!path || path.segments.length === 0) return { kind: "invalid", diagnostic: { code: "array-invalid-reference", message: "array alias の参照が不正です。", span: sourceSpan } };
        if (path.segments.length === 1 && !path.absolute) {
          const parameter = moduleParameterByName(statements, stableStatementIdByIndex, semantic.statementIndex, path.segments[0]!);
          const parameterType = parameter
            ? genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType ?? null
            : null;
          if (parameter && parameterType) {
            const valueType = isDslOptionalValueType(parameter.parameter.valueType)
              ? { kind: "optional" as const, valueType: parameterType }
              : parameterType;
            return { kind: "resolved", targetValueId: `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`, valueType };
          }
        }
        const lookup = input.resolvePath(semantic.statementIndex, path);
        if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2 && lookup.segmentIndex === 1) {
          const instance = lookup.declaration.statement.kind === "moduleInstance" ? lookup.declaration.statement : null;
          if (!instance) return { kind: "deferred", targetValueId: geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!) };
          const definitionLookup = input.resolvePath(lookup.declaration.statementIndex, parseDslReferenceToken(instance.moduleName));
          if (definitionLookup.kind === "resolved" && definitionLookup.declaration.statement.kind === "moduleDefinition") {
            const exportedIndex = statements.findIndex((candidate) =>
              candidate.kind === "typedDeclaration" &&
              candidate.exported &&
              candidate.name === path.segments[1] &&
              candidate.enclosing?.statementIndex === definitionLookup.declaration.statementIndex
            );
            const exportedType = exportedIndex >= 0 ? genericValuesByStatementIndex.get(exportedIndex)?.valueType : null;
            if (exportedType) {
              return {
                kind: "resolved",
                targetValueId: geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!),
                valueType: exportedType
              };
            }
          }
          return { kind: "deferred", targetValueId: geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!) };
        }
        if (lookup.kind !== "resolved") {
          const message = lookup.kind === "forward"
            ? `array「${sourceText}」はこの位置より後で宣言されています。`
            : lookup.kind === "ambiguous"
              ? `array 参照が曖昧です: ${sourceText}`
              : `未解決の array 参照です: ${sourceText}`;
          return { kind: "invalid", diagnostic: { code: `array-reference-${lookup.kind}`, message, span: sourceSpan } };
        }
        const target = genericValuesByStatementIndex.get(lookup.declaration.statementIndex);
        if (!target) return { kind: "invalid", diagnostic: { code: "array-reference-not-array", message: `参照先「${sourceText}」はこの collection 型と互換性のある array ではありません。`, span: sourceSpan } };
        return { kind: "resolved", targetValueId: target.statementId, valueType: target.declaredValueType };
      },
      resolveValueFor: (valueFor) => {
        const sourcePath = referencePath(valueFor.sourceText);
        if (!sourcePath || sourcePath.segments.length === 0) {
          return { kind: "invalid", diagnostic: { code: "array-value-for-source-invalid", message: "value-for の source には whole-value collection reference が必要です。", span: valueFor.sourceSpan } };
        }
        let sourceValueId: string | null = null;
        let sourceValueType: DslArrayValueType | null = null;
        if (sourcePath.segments.length === 1 && !sourcePath.absolute) {
          const parameter = moduleParameterByName(statements, stableStatementIdByIndex, semantic.statementIndex, sourcePath.segments[0]!);
          if (parameter) {
            sourceValueType = genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType ?? null;
            sourceValueId = sourceValueType ? `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}` : null;
          }
        }
        const lookup = sourceValueType ? null : input.resolvePath(semantic.statementIndex, sourcePath);
        if (!sourceValueType && lookup?.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && sourcePath.segments.length === 2 && lookup.segmentIndex === 1) {
          const definitionLookup = input.resolvePath(lookup.declaration.statementIndex, parseDslReferenceToken(lookup.declaration.statement.kind === "moduleInstance" ? lookup.declaration.statement.moduleName : ""));
          if (definitionLookup.kind === "resolved" && definitionLookup.declaration.statement.kind === "moduleDefinition") {
            const exportedIndex = statements.findIndex((candidate) =>
              candidate.kind === "typedDeclaration" && candidate.exported && candidate.name === sourcePath.segments[1] &&
              candidate.enclosing?.statementIndex === definitionLookup.declaration.statementIndex
            );
            sourceValueType = exportedIndex >= 0 ? genericValuesByStatementIndex.get(exportedIndex)?.valueType ?? null : null;
            sourceValueId = geometryArrayDeferredModuleExportId(lookup.declaration.statementId, sourcePath.segments[1]!);
          }
        }
        if (!sourceValueType && lookup?.kind === "resolved") {
          const target = genericValuesByStatementIndex.get(lookup.declaration.statementIndex);
          sourceValueType = target?.valueType ?? null;
          sourceValueId = target?.statementId ?? null;
        }
        if (!sourceValueType || !sourceValueId) {
          const code = lookup?.kind === "forward" ? "array-value-for-source-forward" : "array-value-for-source-invalid";
          return { kind: "invalid", diagnostic: { code, message: `value-for source「${valueFor.sourceText}」は解決できない collection です。`, span: valueFor.sourceSpan } };
        }
        const sourceElementType = scalarTypeOfDslValueType(sourceValueType.elementType)
          ?? recordTypeReferenceOfDslValueType(sourceValueType.elementType);
        const resultElementType = scalarTypeOfDslValueType(enrichedExpectedType.elementType)
          ?? recordTypeReferenceOfDslValueType(enrichedExpectedType.elementType);
        if (!sourceElementType || !resultElementType) {
          return { kind: "invalid", diagnostic: { code: "array-value-for-source-unsupported", message: "この value-for の source/result は scalar、choice、または nominal-record collection である必要があります。", span: valueFor.span } };
        }
        if ((sourceElementType.kind === "record") !== (resultElementType.kind === "record")) {
          return { kind: "invalid", diagnostic: { code: "array-value-for-source-unsupported", message: "nominal-record value-for は nominal-record collection 同士でのみ使用できます。", span: valueFor.span } };
        }
        const mapped: DslArrayMappedValue = {
          kind: "map",
          valueType: enrichedExpectedType,
          sourceValueId,
          sourceElementType,
          resultElementType,
          binderId: `value-for-binder:${semantic.statementId}`,
          binder: valueFor.binder,
          binderSpan: valueFor.binderSpan,
          sourceSpan: valueFor.sourceSpan,
          bodySpan: valueFor.bodySpan,
          sourceOrder: semantic.statementIndex
        };
        return { kind: "resolved", value: mapped };
      }
    });
    for (const issue of resolved.diagnostics) diagnostics.push(diagnostic(statement, issue.span, issue.code, issue.message, issue.presentation));
    semantic.value = resolved.value;
  }

  // Module array parameters use the same source-level collection contract.
  // The Module semantic pass owns ordinary argument binding; this narrow
  // collection check supplies the missing value-type comparison without
  // introducing a Module-only collection resolver.
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleInstance") continue;
    const calleeLookup = input.resolvePath(statementIndex, parseDslReferenceToken(statement.moduleName));
    if (calleeLookup.kind !== "resolved" || calleeLookup.declaration.statement.kind !== "moduleDefinition") continue;
    const parameters = calleeLookup.declaration.statement.parameters;
    const positional = statement.arguments.filter((argument) => argument.label === null);
    let positionalIndex = 0;
    for (const parameter of parameters) {
      const argument = statement.arguments.find((candidate) => candidate.label === parameter.name) ?? positional[positionalIndex++];
      if (!arrayValueTypeOfParameter(parameter)) continue;
      if (!argument) continue;
      const reference = referencePath(argument.value);
      if (!reference) {
        diagnostics.push(diagnostic(statement, argument.valueSpan, "array-argument-invalid", `array parameter「${parameter.name}」には compatible な whole-value collection reference が必要です。`));
        continue;
      }
      const lookup = input.resolvePath(statementIndex, reference);
      if (lookup.kind !== "resolved") continue;
      const actual = genericValuesByStatementIndex.get(lookup.declaration.statementIndex)?.valueType;
      const expected = genericModuleParametersBySlot.get(`${calleeLookup.declaration.statementId}:${parameters.indexOf(parameter)}`)?.valueType
        ?? arrayValueTypeOfParameter(parameter);
      if (!actual || !expected || !isDslNonArrayValueTypeAssignable(actual.elementType, expected.elementType)) {
        diagnostics.push(diagnostic(statement, argument.valueSpan, "array-argument-type-mismatch", `array argument「${argument.value}」の型が parameter「${parameter.name}」と一致しません。`));
      }
    }
  }

  return {
    values,
    valuesByStatementId,
    valuesByStatementIndex,
    moduleParameters,
    moduleParametersBySlot,
    genericValues,
    genericValuesByStatementId,
    genericValuesByStatementIndex,
    genericModuleParameters,
    genericModuleParametersBySlot,
    diagnostics
  };
};
