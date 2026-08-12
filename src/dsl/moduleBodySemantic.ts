import {
  bareConstructionFor,
  commonArgSpecs,
  constructionFor,
  isGeometryDeclarationCategory,
  type DslGeometryDeclarationCategory
} from "./dslConstructions";
import { isElementDslStatement } from "./dslParser";
import { splitDslList, unquoteDslString } from "./dslTokens";
import { recordField, recordSpans } from "./dslParameterSpanScanner";
import { scanTextTemplateLiteral } from "../scalars/textTemplateScan";
import { analyzeElementLocalVariables, type ElementLocalVariableResolver } from "./moduleElementLocalVariableSemantic";
import type { DslSpan, DslStatement } from "./dslTypes";
import { getParameterDefinitions, type ParameterDefinition } from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceRole,
  ModuleGeometryReferenceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSourceTarget,
  ModuleSemanticAnalysisInput,
  ModuleTextTemplateHoleSite,
  ResolvedModuleExport
} from "./moduleSemanticTypes";
import type {
  ModuleGeometryPropertyReferenceResolution,
  ModuleGeometryPropertyReferenceInput,
  ModuleScalarLocalDiagnostic,
  ModuleScalarReferenceResolution
} from "./moduleScalarExpression";

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
  bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
  geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution
) => ModuleScalarExpressionSemantic | null;
type ResolveGeometry = (
  statementIndex: number,
  ownerIndex: number | null,
  rawValue: string,
  span: DslSpan,
  expected: "point" | "line",
  options?: {
    allowCoordinate?: boolean;
    allowNone?: boolean;
    role?: ModuleGeometryReferenceRole;
    scalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
    bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  }
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
  getParameterDefinitions({ type, intermediatePoints: [] } as never);

const textParameterSemantic = (raw: string, span: DslSpan): ModuleScalarExpressionSemantic => ({
  ast: { kind: "stringLiteral", span, value: unquoteDslString(raw.trim()) },
  type: { kind: "string" },
  references: [],
  geometryProperties: []
});

const isModuleScalarTarget = (target: ModuleSourceTarget | null): target is ModuleScalarSourceTarget =>
  target !== null && ["parameter", "iteration", "moduleLocal", "documentBinding"].includes(target.kind);

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
  resolveBodyBareScalar,
  resolveBodyGeometryProperty
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
  resolveBodyGeometryProperty: (statementIndex: number, reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
}): ModuleBodySemanticResult => {
  const localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][] = [];
  const bodyStatements: ModuleBodyStatementSemantic[] = [];
  const exports: ResolvedModuleExport[] = [];
  const exportByName = new Map<string, ResolvedModuleExport>();

  const registerExport = (entry: ResolvedModuleExport, span: DslSpan) => {
    if (exportByName.has(entry.name)) {
      addLocal(entry.exportedStatementIndex, {
        code: "module-duplicate-export",
        span,
        message: `module export「${entry.name}」が重複しています。`
      });
      return;
    }
    exportByName.set(entry.name, entry);
    exports.push(entry);
  };

  const sourceTextFor = (statementIndex: number) => input.logicalTextByStatementIndex?.get(statementIndex) ?? "";
  const addScalar = (
    bodySemantic: ModuleBodyStatementSemantic | null,
    parameterKey: string,
    span: DslSpan,
    expression: ModuleScalarExpressionSemantic | null,
    elementLocalVariableIndex?: number
  ) => {
    if (!bodySemantic || !expression) return;
    bodySemantic.scalarExpressions = [
      ...bodySemantic.scalarExpressions,
      {
        parameterKey,
        span,
        expression,
        ...(elementLocalVariableIndex === undefined ? {} : { elementLocalVariableIndex })
      }
    ];
  };

  const addGeometry = (
    bodySemantic: ModuleBodyStatementSemantic | null,
    parameterKey: string,
    span: DslSpan,
    reference: ModuleGeometryReferenceSemantic
  ) => {
    if (!bodySemantic) return;
    bodySemantic.geometryReferences = [...bodySemantic.geometryReferences, { parameterKey, span, reference }];
    // Coordinate anchors are still ordinary numeric fields at runtime. Keep
    // their typed scalar sites on the existing `<anchorKey>:x/y` path so the
    // normal numeric binding runtime can materialize them.
    if (reference.coordinate && !parameterKey.startsWith("intermediates:")) {
      if (reference.coordinate.x) addScalar(bodySemantic, `${parameterKey}:x`, reference.coordinate.x.ast.span, reference.coordinate.x);
      if (reference.coordinate.y) addScalar(bodySemantic, `${parameterKey}:y`, reference.coordinate.y.ast.span, reference.coordinate.y);
    }
  };

  const analyzeTextTemplate = (
    statementIndex: number,
    bodySemantic: ModuleBodyStatementSemantic | null,
    valueSpan: DslSpan,
    localResolver: ElementLocalVariableResolver | null
  ): boolean => {
    const source = sourceTextFor(statementIndex);
    const raw = source.slice(valueSpan.start, valueSpan.end);
    if (!raw.startsWith("\"") && !raw.startsWith("'")) return false;
    if (!raw.includes("{")) return false;
    const scanned = scanTextTemplateLiteral(source, valueSpan);
    if (scanned.kind === "error") {
      addLocal(statementIndex, { code: `module-${scanned.issueCode}`, span: scanned.span, message: scanned.message });
      return true;
    }
    for (const hole of scanned.segments.filter((segment): segment is Extract<typeof segment, { kind: "hole" }> => segment.kind === "hole")) {
      const expression = analyzeExpression(
        statementIndex,
        source.slice(hole.contentSpan.start, hole.contentSpan.end),
        hole.contentSpan,
        null,
        localResolver ?? ((reference) => resolveBodyScalar(statementIndex, reference)),
        (reference) => resolveBodyBareScalar(statementIndex, reference),
        (reference) => resolveBodyGeometryProperty(statementIndex, reference)
      );
      if (bodySemantic && expression) {
        const site: ModuleTextTemplateHoleSite = { span: hole.span, contentSpan: hole.contentSpan, expression };
        bodySemantic.textTemplateHoles = [...bodySemantic.textTemplateHoles, site];
      }
    }
    return true;
  };

  const analyzeIntermediates = (
    statementIndex: number,
    bodySemantic: ModuleBodyStatementSemantic | null,
    valueSpan: DslSpan,
    localResolver: ElementLocalVariableResolver | null
  ) => {
    const source = sourceTextFor(statementIndex);
    for (const record of recordSpans(source, valueSpan) ?? []) {
      const pointSpan = recordField(source, record, 0);
      if (pointSpan) {
        const reference = resolveGeometry(
          statementIndex,
          definition.statementIndex,
          source.slice(pointSpan.start, pointSpan.end),
          pointSpan,
          "point",
          {
            allowCoordinate: true,
            role: "pointReference",
            scalarResolver: localResolver ?? ((reference) => resolveBodyScalar(statementIndex, reference)),
            bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
            geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
          }
        );
        addGeometry(bodySemantic, "intermediates:point", pointSpan, reference);
      }
      for (const [fieldIndex, parameterKey] of [[1, "intermediates:handleAngleDeg"], [2, "intermediates:incomingHandleLength"], [3, "intermediates:outgoingHandleLength"]] as const) {
        const fieldSpan = recordField(source, record, fieldIndex);
        if (!fieldSpan) continue;
        const expression = analyzeExpression(
          statementIndex,
          source.slice(fieldSpan.start, fieldSpan.end),
          fieldSpan,
          { kind: "number" },
          localResolver ?? ((reference) => resolveBodyScalar(statementIndex, reference)),
          (reference) => resolveBodyBareScalar(statementIndex, reference),
          (reference) => resolveBodyGeometryProperty(statementIndex, reference)
        );
        addScalar(bodySemantic, parameterKey, fieldSpan, expression);
      }
    }
  };

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
      ? { statementId, statementIndex, statementKind: statement.kind, scalarExpressions: [], geometryReferences: [], textTemplateHoles: [], scalarTarget: null }
      : null;

    if (statement.kind === "typedDeclaration") {
      if (!statementId || !bodySemantic) continue;
      const initializerSpan = statement.payloadSpans.initializer;
      const initializer = initializerSpan
        ? analyzeExpression(
            statementIndex,
            statement.initializer,
            initializerSpan,
            statement.declaredType,
            (reference) => resolveBodyScalar(statementIndex, reference),
            undefined,
            (reference) => resolveBodyGeometryProperty(statementIndex, reference)
          )
        : null;
      localScalars.push({ statementId, statementIndex, name: statement.name, type: statement.declaredType, bindingKind: statement.bindingKind, initializer });
      if (initializer && initializerSpan) bodySemantic.scalarExpressions = [{ parameterKey: null, span: initializerSpan, expression: initializer }];
      if (statement.exported) {
        if (!isDirectModuleChild(statement, definition.statementIndex) || !statement.name || !statement.declaredType) {
          addLocal(statementIndex, {
            code: "module-invalid-export",
            span: statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan,
            message: "export は module 直下の名前付き geometry または scalar declaration にのみ指定できます。"
          });
        } else if (statementId) {
          registerExport({
            kind: "scalar",
            ownerModuleDefinitionStatementId: definition.statementId,
            exportedStatementId: statementId,
            exportedStatementIndex: statementIndex,
            sourceOrder: statementIndex,
            name: statement.name,
            declaredType: statement.declaredType,
            bindingKind: statement.bindingKind
          }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
        }
      }
    } else if (statement.kind === "set") {
      const target = resolvePlainScalarTarget(statementIndex, definition.statementIndex, statement.name);
      const expressionSpan = statement.payloadSpans.expression ?? statement.keywordSpan;
      const expression = analyzeExpression(
        statementIndex,
        statement.expression,
        expressionSpan,
        target.type,
        (reference) => resolveBodyScalar(statementIndex, reference),
        undefined,
        (reference) => resolveBodyGeometryProperty(statementIndex, reference)
      );
      if (bodySemantic && expression) bodySemantic.scalarExpressions = [{ parameterKey: null, span: expressionSpan, expression }];
      if (bodySemantic) bodySemantic.scalarTarget = isModuleScalarTarget(target.target) ? target.target : null;
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
            message: "export は module 直下の名前付き geometry または scalar declaration にのみ指定できます。"
          });
        } else if (statementId) {
          registerExport({
            kind: "geometry",
            ownerModuleDefinitionStatementId: definition.statementId,
            exportedStatementId: statementId,
            exportedStatementIndex: statementIndex,
            sourceOrder: statementIndex,
            name: statement.name,
            category
          }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
        }
      }
      const spec = statement.kind === "group" ? constructionFor("group", "") : constructionFor(statement.category, statement.construction);
      if (spec) {
        const specialArgs = [...(spec.args ?? []), ...commonArgSpecs].filter((arg) => arg.special);
        const varsArg = specialArgs.find((arg) => arg.special === "vars");
        const localResolver = varsArg && statement.payloadSpans[varsArg.arg]
          ? analyzeElementLocalVariables({
              source: sourceTextFor(statementIndex),
              statementIndex,
              valueSpan: statement.payloadSpans[varsArg.arg],
              bodySemantic,
              analyzeExpression,
              addScalar,
              resolveBodyScalar: (reference) => resolveBodyScalar(statementIndex, reference),
              resolveBodyBareScalar: (reference) => resolveBodyBareScalar(statementIndex, reference),
              resolveBodyGeometryProperty: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
            })
          : null;
        const definitionsByArg = new Map(getParameterDefinitionsForType(spec.elementType).map((parameter) => [parameter.key, parameter]));
        for (const arg of spec.args) {
          if (arg.special || !arg.parameterKey && !definitionsByArg.has(arg.arg)) continue;
          const parameterKey = arg.parameterKey ?? arg.arg;
          const parameter = definitionsByArg.get(parameterKey);
          const valueSpan = statement.payloadSpans[arg.arg] ?? statement.payloadSpans[parameterKey];
          if (!parameter || !valueSpan) continue;
          const value = localTextValue(input, statementIndex, valueSpan, statement.attrs.find((attr) => attr.key === arg.arg)?.value ?? "");
          if (["reference", "lineEndpointReference", "lineReference", "lineReferenceList"].includes(parameter.kind)) {
            const expected = parameter.kind === "reference" || parameter.kind === "lineEndpointReference" ? "point" : "line";
            if (parameter.kind === "lineReferenceList") {
              let cursor = 0;
              for (const token of splitDslList(value)) {
                const offset = value.indexOf(token, cursor);
                cursor = offset + token.length;
                const reference = resolveGeometry(
                  statementIndex,
                  definition.statementIndex,
                  token,
                  { start: valueSpan.start + Math.max(0, offset), end: valueSpan.start + Math.max(0, offset) + token.length },
                  "line",
                  { allowCoordinate: parameter.allowCoordinate === true, role: "lineReferenceList" }
                );
                addGeometry(bodySemantic, parameterKey, reference.span, reference);
              }
            } else {
              const reference = resolveGeometry(statementIndex, definition.statementIndex, value, valueSpan, expected, {
                allowCoordinate: parameter.allowCoordinate === true,
                allowNone: parameter.allowNone,
                role: parameter.kind === "reference" ? "pointReference" : parameter.kind === "lineEndpointReference" ? "lineEndpointReference" : "lineReference",
                scalarResolver: localResolver ?? ((reference) => resolveBodyScalar(statementIndex, reference)),
                bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
              });
              addGeometry(bodySemantic, parameterKey, valueSpan, reference);
            }
          } else {
            const expectedType = statement.kind === "element" && statement.type === "conditionalGroup" && parameterKey === "condition"
              ? ({ kind: "boolean" } as const)
              : scalarTypeFromParameterDefinition(parameter);
            if (!expectedType) continue;
            const template = parameter.kind === "text" ? analyzeTextTemplate(statementIndex, bodySemantic, valueSpan, localResolver) : false;
            const expression = template
              ? null
              : parameter.kind === "text" && !value.trim().startsWith("@")
                ? textParameterSemantic(value, valueSpan)
                : analyzeExpression(
                  statementIndex,
                  value,
                  valueSpan,
                  expectedType,
                  localResolver ?? ((reference) => resolveBodyScalar(statementIndex, reference)),
                  (reference) => resolveBodyBareScalar(statementIndex, reference),
                  (reference) => resolveBodyGeometryProperty(statementIndex, reference)
                );
            if (bodySemantic && expression && !template) bodySemantic.scalarExpressions = [...bodySemantic.scalarExpressions, { parameterKey, span: valueSpan, expression }];
          }
        }
        for (const arg of specialArgs) {
          if (arg.special !== "intermediates") continue;
          const valueSpan = statement.payloadSpans[arg.arg];
          if (valueSpan) analyzeIntermediates(statementIndex, bodySemantic, valueSpan, localResolver);
        }
        if (bodySemantic) bodySemantic.scalarExpressions = [...bodySemantic.scalarExpressions].sort((left, right) => left.span.start - right.span.start);
      }
    }
    if (bodySemantic) bodyStatements.push(bodySemantic);
  }
  return { localScalars, bodyStatements, exports };
};
