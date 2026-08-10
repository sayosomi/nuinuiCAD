import {
  bareConstructionFor,
  constructionFor,
  isGeometryDeclarationCategory,
  type DslGeometryDeclarationCategory
} from "./dslConstructions";
import { isElementDslStatement } from "./dslParser";
import { splitDslList, unquoteDslString } from "./dslTokens";
import type { DslSpan, DslStatement } from "./dslTypes";
import { getParameterDefinitions, type ParameterDefinition } from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleSemanticAnalysisInput,
  ResolvedModuleExport
} from "./moduleSemanticTypes";
import type { ModuleScalarLocalDiagnostic, ModuleScalarReferenceResolution } from "./moduleScalarExpression";

export type ModuleBodyDefinition = {
  statement: Extract<DslStatement, { kind: "moduleDefinition" }>;
  statementIndex: number;
  statementId: StatementIdentity;
  bodyStatementIndexes: readonly number[];
};

type AddLocalDiagnostic = (statementIndex: number, diagnostic: ModuleScalarLocalDiagnostic) => void;
type AnalyzeExpression = (
  statementIndex: number,
  raw: string,
  span: DslSpan,
  expectedType: ScalarType | null,
  resolver: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
  bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null
) => ModuleScalarExpressionSemantic | null;
type ResolveGeometry = (
  statementIndex: number,
  ownerIndex: number | null,
  rawValue: string,
  span: DslSpan,
  expected: "point" | "line",
  options?: { allowCoordinate?: boolean; allowNone?: boolean }
) => ModuleGeometryReferenceSemantic;
type ResolvePlainScalarTarget = (
  statementIndex: number,
  ownerIndex: number | null,
  name: string
) => ModuleScalarReferenceResolution;

export type ModuleBodySemanticResult = {
  localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][];
  bodyStatements: ModuleBodyStatementSemantic[];
  exports: ResolvedModuleExport[];
};

const isAllowedModuleBodyStatement = (statement: DslStatement): boolean => {
  if (statement.kind === "typedDeclaration" || statement.kind === "set" || statement.kind === "group") return true;
  if (statement.kind === "moduleDefinition" || statement.kind === "moduleInstance") return true;
  if (!isElementDslStatement(statement) || statement.kind !== "element") return false;
  if (isGeometryDeclarationCategory(statement.category)) return true;
  if (statement.type === "conditionalGroup" || statement.type === "forGroup") return true;
  return statement.category === "mutation" && bareConstructionFor(statement.construction) !== null;
};

const isDirectModuleChild = (statement: DslStatement, moduleIndex: number) =>
  statement.enclosing?.statementIndex === moduleIndex;

const scalarTypeFromParameterDefinition = (definition: ParameterDefinition): ScalarType | null => {
  if (definition.kind === "number") return { kind: "number" };
  if (definition.kind === "boolean") return { kind: "boolean" };
  if (definition.kind === "text") return { kind: "string" };
  if (definition.kind === "choice") return { kind: "choice", options: definition.choiceOptions ?? [] };
  return null;
};

const getParameterDefinitionsForType = (type: string) =>
  // The registry is the source of truth. This object is only a shape carrier;
  // no ID, element, or runtime geometry is created by semantic analysis.
  getParameterDefinitions({ type } as never);

const textParameterSemantic = (raw: string, span: DslSpan): ModuleScalarExpressionSemantic => ({
  ast: { kind: "stringLiteral", span, value: unquoteDslString(raw.trim()) },
  type: { kind: "string" },
  references: []
});

const localTextValue = (input: ModuleSemanticAnalysisInput, statementIndex: number, span: DslSpan, fallback = "") => {
  const text = input.logicalTextByStatementIndex?.get(statementIndex);
  return text ? text.slice(span.start, span.end) : fallback;
};

export const analyzeModuleBody = ({
  definition,
  statements,
  stableStatementIdByIndex,
  input,
  addLocal,
  analyzeExpression,
  resolveGeometry,
  resolvePlainScalarTarget,
  resolveBodyScalar,
  resolveBodyBareScalar
}: {
  definition: ModuleBodyDefinition;
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  input: ModuleSemanticAnalysisInput;
  addLocal: AddLocalDiagnostic;
  analyzeExpression: AnalyzeExpression;
  resolveGeometry: ResolveGeometry;
  resolvePlainScalarTarget: ResolvePlainScalarTarget;
  resolveBodyScalar: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBodyBareScalar: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
}): ModuleBodySemanticResult => {
  const localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][] = [];
  const bodyStatements: ModuleBodyStatementSemantic[] = [];
  const exports: ResolvedModuleExport[] = [];

  for (const statementIndex of definition.bodyStatementIndexes) {
    const statement = statements[statementIndex];
    const statementId = stableStatementIdByIndex.get(statementIndex);
    if (!isAllowedModuleBodyStatement(statement)) {
      addLocal(statementIndex, {
        code: "module-forbidden-body-statement",
        span: statement.keywordSpan,
        message: `module body では「${statement.kind}」statementを使用できません。`
      });
    }
    const bodySemantic: ModuleBodyStatementSemantic | null = statementId
      ? { statementId, statementIndex, statementKind: statement.kind, scalarExpressions: [], geometryReferences: [], scalarTarget: null }
      : null;

    if (statement.kind === "typedDeclaration") {
      if (!statementId || !bodySemantic) continue;
      const initializerSpan = statement.payloadSpans.initializer;
      const initializer = initializerSpan
        ? analyzeExpression(statementIndex, statement.initializer, initializerSpan, statement.declaredType, (reference) => resolveBodyScalar(statementIndex, reference))
        : null;
      localScalars.push({ statementId, statementIndex, name: statement.name, type: statement.declaredType, bindingKind: statement.bindingKind, initializer });
      if (initializer && initializerSpan) bodySemantic.scalarExpressions = [{ parameterKey: null, span: initializerSpan, expression: initializer }];
    } else if (statement.kind === "set") {
      const target = resolvePlainScalarTarget(statementIndex, definition.statementIndex, statement.name);
      const expressionSpan = statement.payloadSpans.expression ?? statement.keywordSpan;
      const expression = analyzeExpression(statementIndex, statement.expression, expressionSpan, target.type, (reference) => resolveBodyScalar(statementIndex, reference));
      if (bodySemantic && expression) bodySemantic.scalarExpressions = [{ parameterKey: null, span: expressionSpan, expression }];
      if (bodySemantic) bodySemantic.scalarTarget = target.target?.kind === "sourceGeometry" ? null : target.target;
      if (!target.target || target.resolution !== "resolved") {
        addLocal(statementIndex, target.diagnostic ?? {
          code: "module-invalid-set-target",
          span: statement.nameSpan ?? statement.keywordSpan,
          message: `set target「${statement.name}」を解決できません。`
        });
      }
    } else if (statement.kind === "group" || statement.kind === "element") {
      if (statement.kind === "element" && statement.exported) {
        const category: DslGeometryDeclarationCategory | null = isGeometryDeclarationCategory(statement.category) ? statement.category : null;
        if (!isDirectModuleChild(statement, definition.statementIndex) || !statement.name || !category) {
          addLocal(statementIndex, {
            code: "module-invalid-export",
            span: statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan,
            message: "export は module 直下の名前付き geometry declaration にのみ指定できます。"
          });
        } else if (statementId) {
          exports.push({
            ownerModuleDefinitionStatementId: definition.statementId,
            exportedStatementId: statementId,
            exportedStatementIndex: statementIndex,
            sourceOrder: statementIndex,
            name: statement.name,
            category
          });
        }
      }
      const spec = statement.kind === "group" ? constructionFor("group", "") : constructionFor(statement.category, statement.construction);
      if (spec) {
        const definitionsByArg = new Map(getParameterDefinitionsForType(spec.elementType).map((parameter) => [parameter.key, parameter]));
        for (const arg of spec.args) {
          if (arg.special || !arg.parameterKey && !definitionsByArg.has(arg.arg)) continue;
          const parameterKey = arg.parameterKey ?? arg.arg;
          const parameter = definitionsByArg.get(parameterKey);
          const valueSpan = statement.payloadSpans[arg.arg] ?? statement.payloadSpans[parameterKey];
          if (!parameter || !valueSpan) continue;
          const value = localTextValue(input, statementIndex, valueSpan, statement.attrs.find((attr) => attr.key === arg.arg)?.value ?? "");
          if (["reference", "lineEndpointReference", "lineReference", "lineReferenceList"].includes(parameter.kind)) {
            const expected = parameter.kind === "reference" ? "point" : "line";
            if (parameter.kind === "lineReferenceList") {
              let cursor = 0;
              for (const token of splitDslList(value)) {
                const offset = value.indexOf(token, cursor);
                cursor = offset + token.length;
                const reference = resolveGeometry(statementIndex, definition.statementIndex, token, { start: valueSpan.start + Math.max(0, offset), end: valueSpan.start + Math.max(0, offset) + token.length }, "line");
                if (bodySemantic) bodySemantic.geometryReferences = [...bodySemantic.geometryReferences, { parameterKey, span: reference.span, reference }];
              }
            } else {
              const reference = resolveGeometry(statementIndex, definition.statementIndex, value, valueSpan, expected, {
                allowCoordinate: parameter.allowCoordinate,
                allowNone: parameter.allowNone
              });
              if (bodySemantic) bodySemantic.geometryReferences = [...bodySemantic.geometryReferences, { parameterKey, span: valueSpan, reference }];
            }
          } else {
            const expectedType = scalarTypeFromParameterDefinition(parameter);
            if (!expectedType) continue;
            const expression = parameter.kind === "text" && !value.trim().startsWith("@")
              ? textParameterSemantic(value, valueSpan)
              : analyzeExpression(
                  statementIndex,
                  value,
                  valueSpan,
                  expectedType,
                  (reference) => resolveBodyScalar(statementIndex, reference),
                  (reference) => resolveBodyBareScalar(statementIndex, reference)
                );
            if (bodySemantic && expression) bodySemantic.scalarExpressions = [...bodySemantic.scalarExpressions, { parameterKey, span: valueSpan, expression }];
          }
        }
      }
    }
    if (bodySemantic) bodyStatements.push(bodySemantic);
  }
  return { localScalars, bodyStatements, exports };
};
