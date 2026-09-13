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
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import { scanTextTemplateLiteral } from "../scalars/textTemplateScan";
import { isScalarExpressionCandidateSource, parseScalarExpression } from "../scalars/expressionParser";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { DslSpan, DslStatement } from "./dslTypes";
import {
  dslValueTypeForParameterDefinition,
  getParameterDefinitions,
  scalarTypeForParameterDefinition
} from "../parameters/parameterDefinitions";
import type { ScalarExpressionType, ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceRole,
  ModuleGeometryReferenceSemantic,
  ModuleGeometryConstructionSemantic,
  ModuleGeometryValueSemantic,
  ModuleGeometryValueExpressionSemantic,
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSourceTarget,
  ModuleSemanticAnalysisInput,
  ModuleTextTemplateHoleSite,
  ResolvedModuleExport
} from "./moduleSemanticTypes";
import type {
  ModuleGeometryBuiltinReferenceInput,
  ModuleGeometryBuiltinReferenceResolver,
  ModuleGeometryPropertyReferenceResolution,
  ModuleGeometryPropertyReferenceInput,
  ModuleScalarLocalDiagnostic,
  ModuleScalarReferenceResolution
} from "./moduleScalarExpression";
import { dslRequiredValueTypeOf, isDslArrayValueType, isDslGeometryValueType, scalarExpressionTypeOfDslValueType, scalarTypeOfDslValueType } from "./dslValueTypes";
import { parseDslSourceReference } from "./dslReferenceTokens";
import { moduleGeometryInterfaceTypeOfElement } from "./moduleGeometryInterfaces";
import { geometryValueConstructionControlFlowUnsupported } from "./geometryValueConstructionScope";

export type ModuleBodyDefinition = {
  statement: Extract<DslStatement, { kind: "moduleDefinition" }>;
  statementIndex: number;
  statementId: StatementIdentity;
  bodyStatementIndexes: readonly number[];
};

type AddLocalDiagnostic = (statementIndex: number, diagnostic: ModuleScalarLocalDiagnostic) => void;
type AnalyzeExpression = (
  statementIndex: number,
  ownerIndex: number | null,
  raw: string,
  span: DslSpan,
  expectedType: ScalarExpressionType | null,
  resolver: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
  bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
  geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
  geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver
) => ModuleScalarExpressionSemantic | null;
type ResolveGeometry = (
  statementIndex: number,
  ownerIndex: number | null,
  rawValue: string,
  span: DslSpan,
  expected: "point" | "line",
  options?: {
    allowCoordinate?: boolean;
    expectedInterfaceType?: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType;
    role?: ModuleGeometryReferenceRole;
    scalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
    bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
    expectedValueType?: import("./dslValueTypes").DslValueType;
    requireOptional?: boolean;
  }
) => ModuleGeometryReferenceSemantic;
type ResolveGeometryConstruction = (
  statementIndex: number,
  ownerIndex: number | null,
  rawValue: string,
  span: DslSpan,
  expectedInterfaceType: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType,
  options?: {
    scalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
    bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  }
) => ModuleGeometryConstructionSemantic | null;
type ResolvePlainScalarTarget = (
  statementIndex: number,
  ownerIndex: number | null,
  name: string
) => ModuleScalarReferenceResolution;
export type ModuleBodySemanticResult = {
  localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][];
  localGeometryValues: ModuleGeometryValueSemantic[];
  bodyStatements: ModuleBodyStatementSemantic[];
  exports: ResolvedModuleExport[];
};

const isAllowedModuleBodyStatement = (statement: DslStatement): boolean => {
  if (statement.kind === "typedDeclaration" || statement.kind === "set" || statement.kind === "group") return true;
  if (statement.kind === "moduleDefinition" || statement.kind === "moduleInstance") return true;
  if (statement.kind === "transformation") return true;
  if (!isElementDslStatement(statement) || statement.kind !== "element") return false;
  if (isGeometryDeclarationCategory(statement.category)) return true;
  if (statement.type === "conditionalGroup" || statement.type === "forGroup") return true;
  return statement.category === "mutation" && bareConstructionFor(statement.construction) !== null;
};

const isDirectModuleChild = (statement: DslStatement, moduleIndex: number) =>
  statement.enclosing?.statementIndex === moduleIndex;

const getParameterDefinitionsForType = (type: string) =>
  // The registry is the source of truth. This object is only a shape carrier;
  // no ID, element, || runtime geometry is created by semantic analysis.
  getParameterDefinitions({ type, intermediatePoints: [] } as never);

const textParameterSemantic = (raw: string, span: DslSpan): ModuleScalarExpressionSemantic => ({
  ast: { kind: "stringLiteral", span, value: unquoteDslString(raw.trim()) },
  type: { kind: "string" },
  references: [],
  geometryProperties: [],
  geometryBuiltinArguments: []
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
  analyzeExpression: analyzeSourceExpression,
  resolveGeometry,
  resolveGeometryConstruction,
  parseGeometryValueExpression,
  resolvePlainScalarTarget,
  resolveBodyScalar,
  resolveBodyBareScalar,
  resolveBodyGeometryProperty,
  resolveBodyGeometryBuiltin,
  registerGeometryValue
}: {
  definition: ModuleBodyDefinition;
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  input: ModuleSemanticAnalysisInput;
  addLocal: AddLocalDiagnostic;
  analyzeExpression: AnalyzeExpression;
  resolveGeometry: ResolveGeometry;
  resolveGeometryConstruction: ResolveGeometryConstruction;
  parseGeometryValueExpression: (args: {
    statementIndex: number;
    ownerIndex: number | null;
    source: string;
    node: ScalarExpressionAst;
    expectedInterfaceType: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType;
    expectedValueType?: import("./dslValueTypes").DslValueType;
    analyzeScalar: (raw: string, span: DslSpan, expectedType: ScalarType | null) => ModuleScalarExpressionSemantic | null;
    resolveReference: (raw: string, span: DslSpan, options?: { expectedValueType?: import("./dslValueTypes").DslValueType; requireOptional?: boolean }) => ModuleGeometryReferenceSemantic;
    parseConstruction: (raw: string, span: DslSpan, expectedInterfaceType: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType) => ModuleGeometryConstructionSemantic | null;
    addDiagnostic: (diagnostic: ModuleScalarLocalDiagnostic) => void;
  }) => ModuleGeometryValueExpressionSemantic | null;
  resolvePlainScalarTarget: ResolvePlainScalarTarget;
  resolveBodyScalar: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  resolveBodyBareScalar: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveBodyGeometryProperty: (statementIndex: number, reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  resolveBodyGeometryBuiltin: (statementIndex: number, reference: ModuleGeometryBuiltinReferenceInput) => ModuleGeometryReferenceSemantic;
  registerGeometryValue: (value: ModuleGeometryValueSemantic) => void;
}): ModuleBodySemanticResult => {
  const localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][] = [];
  const localGeometryValues: ModuleGeometryValueSemantic[] = [];
  const bodyStatements: ModuleBodyStatementSemantic[] = [];
  const exports: ResolvedModuleExport[] = [];
  const exportByName = new Map<string, ResolvedModuleExport>();
  const conditionSemantics = new Map<number, ModuleScalarExpressionSemantic>();

  const analyzeExpression = (
    statementIndex: number,
    ownerIndex: number | null,
    raw: string,
    span: DslSpan,
    expectedType: ScalarExpressionType | null,
    resolver: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
    bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
    geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver
  ) => analyzeSourceExpression(
    statementIndex,
    ownerIndex,
    raw,
    span,
    expectedType,
    resolver,
    bareResolver,
    geometryPropertyResolver,
    geometryBuiltinResolver
  );

  const registerExport = (entry: ResolvedModuleExport, span: DslSpan) => {
    if (exportByName.has(entry.name)) {
      addLocal(entry.exportedStatementIndex, {
        code: "module-duplicate-export",
        span,
        message: `module export「${entry.name}」が重複しています。`,
        presentation: { key: "diagnostic.module-duplicate-export", parameters: { name: entry.name } }
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
    expression: ModuleScalarExpressionSemantic | null
  ) => {
    if (!bodySemantic || !expression) return;
    bodySemantic.scalarExpressions = [
      ...bodySemantic.scalarExpressions,
      {
        parameterKey,
        span,
        expression
      }
    ];
  };

  const addGeometry = (
    bodySemantic: ModuleBodyStatementSemantic | null,
    parameterKey: string | null,
    span: DslSpan,
    reference: ModuleGeometryReferenceSemantic
  ) => {
    if (!bodySemantic) return;
    bodySemantic.geometryReferences = [...bodySemantic.geometryReferences, { parameterKey, span, reference }];
    // Coordinate anchors are still ordinary numeric fields at runtime. Keep
    // their typed scalar sites on the existing `<anchorKey>:x/y` path so the
    // normal numeric binding runtime can materialize them.
    if (reference.coordinate && (parameterKey === null || !parameterKey.startsWith("intermediates:"))) {
      if (reference.coordinate.x) addScalar(bodySemantic, `${parameterKey}:x`, reference.coordinate.x.ast.span, reference.coordinate.x);
      if (reference.coordinate.y) addScalar(bodySemantic, `${parameterKey}:y`, reference.coordinate.y.ast.span, reference.coordinate.y);
    }
  };

  const addConstructionSites = (
    bodySemantic: ModuleBodyStatementSemantic,
    construction: ModuleGeometryConstructionSemantic,
    prefix: string
  ) => {
    const visit = (value: unknown, key: string): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${key}:${index}`));
        return;
      }
      if ("expectedGeometryKind" in value && "resolution" in value && "span" in value) {
        addGeometry(bodySemantic, `${prefix}:${key}`, value.span as DslSpan, value as ModuleGeometryReferenceSemantic);
        return;
      }
      if ("ast" in value && "type" in value) {
        const expression = value as ModuleScalarExpressionSemantic;
        addScalar(bodySemantic, `${prefix}:${key}`, expression.ast.span, expression);
        return;
      }
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === "span" || childKey === "kind" || childKey === "source") continue;
        visit(child, key ? `${key}:${childKey}` : childKey);
      }
    };
    for (const [key, value] of Object.entries(construction)) {
      if (key === "span" || key === "kind") continue;
      visit(value, key);
    }
  };

  const addGeometryValueExpressionSites = (
    bodySemantic: ModuleBodyStatementSemantic,
    expression: ModuleGeometryValueExpressionSemantic,
    prefix = "value"
  ): void => {
    switch (expression.kind) {
      case "reference":
        addGeometry(bodySemantic, prefix, expression.reference.span, expression.reference);
        return;
      case "construction":
        addConstructionSites(bodySemantic, expression.construction, prefix);
        return;
      case "if":
        if (expression.condition) addScalar(bodySemantic, `${prefix}:condition`, expression.condition.ast.span, expression.condition);
        if (expression.thenBranch) addGeometryValueExpressionSites(bodySemantic, expression.thenBranch, `${prefix}:then`);
        if (expression.elseBranch) addGeometryValueExpressionSites(bodySemantic, expression.elseBranch, `${prefix}:else`);
        return;
      case "match":
        if (expression.scrutinee) addScalar(bodySemantic, `${prefix}:scrutinee`, expression.scrutinee.ast.span, expression.scrutinee);
        expression.arms.forEach((arm) => {
          if (arm.expression) addGeometryValueExpressionSites(bodySemantic, arm.expression, `${prefix}:case:${arm.label}`);
        });
        return;
    }
  };

  const analyzeTextTemplate = (
    statementIndex: number,
    bodySemantic: ModuleBodyStatementSemantic | null,
    valueSpan: DslSpan
  ): boolean => {
    const source = sourceTextFor(statementIndex);
    const raw = source.slice(valueSpan.start, valueSpan.end);
    if (!raw.startsWith("\"") && !raw.startsWith("'")) return false;
    if (!raw.includes("{")) return false;
    const scanned = scanTextTemplateLiteral(source, valueSpan);
    if (scanned.kind === "error") {
      addLocal(statementIndex, {
        code: `module-${scanned.issueCode}`,
        span: scanned.span,
        message: scanned.message,
        presentation: { key: `diagnostic.module-${scanned.issueCode}` }
      });
      return true;
    }
    for (const hole of scanned.segments.filter((segment): segment is Extract<typeof segment, { kind: "hole" }> => segment.kind === "hole")) {
      const expression = analyzeExpression(
        statementIndex,
        definition.statementIndex,
        source.slice(hole.contentSpan.start, hole.contentSpan.end),
        hole.contentSpan,
        null,
        (reference) => resolveBodyScalar(statementIndex, reference),
        (reference) => resolveBodyBareScalar(statementIndex, reference),
        (reference) => resolveBodyGeometryProperty(statementIndex, reference),
        (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
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
    valueSpan: DslSpan
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
            scalarResolver: (reference) => resolveBodyScalar(statementIndex, reference),
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
          definition.statementIndex,
          source.slice(fieldSpan.start, fieldSpan.end),
          fieldSpan,
          { kind: "number" },
          (reference) => resolveBodyScalar(statementIndex, reference),
          (reference) => resolveBodyBareScalar(statementIndex, reference),
          (reference) => resolveBodyGeometryProperty(statementIndex, reference),
          (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
        );
        addScalar(bodySemantic, parameterKey, fieldSpan, expression);
      }
    }
  };

  const analyzePointArray = (
    statementIndex: number,
    bodySemantic: ModuleBodyStatementSemantic | null,
    valueSpan: DslSpan
  ) => {
    const source = sourceTextFor(statementIndex);
    const raw = source.slice(valueSpan.start, valueSpan.end);
    const parsed = parseGeometryArrayExpression(raw);
    if (!bodySemantic || !parsed.expression || parsed.diagnostics.length || parsed.expression.kind !== "literal") return;
    for (const member of parsed.expression.members) {
      const span = {
        start: valueSpan.start + member.span.start,
        end: valueSpan.start + member.span.end
      };
      const reference = resolveGeometry(
        statementIndex,
        definition.statementIndex,
        member.text,
        span,
        "point",
        {
          allowCoordinate: true,
          role: "pointReference",
          scalarResolver: (candidate) => resolveBodyScalar(statementIndex, candidate),
          bareScalarResolver: (candidate) => resolveBodyBareScalar(statementIndex, candidate),
          geometryPropertyResolver: (candidate) => resolveBodyGeometryProperty(statementIndex, candidate)
        }
      );
      addGeometry(bodySemantic, "points", span, reference);
    }
  };

  for (const statementIndex of definition.bodyStatementIndexes) {
    const statement = statements[statementIndex];
    const statementId = stableStatementIdByIndex.get(statementIndex);
    if (!isAllowedModuleBodyStatement(statement)) {
      addLocal(statementIndex, {
        code: "module-forbidden-body-statement",
        span: statement.keywordSpan,
        message: `module body では「${statement.kind}」statementを使用できません。`,
        presentation: {
          key: "diagnostic.module-forbidden-body-statement",
          parameters: { statement: statement.kind }
        }
      });
    }
    const bodySemantic: ModuleBodyStatementSemantic | null = statementId
      ? {
          statementId,
          statementIndex,
          statementKind: statement.kind,
          scalarExpressions: [],
          geometryReferences: [],
          textTemplateHoles: [],
          scalarTarget: null
        }
      : null;

    if (statement.kind === "typedDeclaration") {
      if (!statementId || !bodySemantic) continue;
      const requiredValueType = dslRequiredValueTypeOf(statement.valueType);
      if (isDslGeometryValueType(requiredValueType)) {
        const geometryInterfaceType = requiredValueType.kind as import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType;
        const optionalGeometry = statement.valueType?.kind === "optional";
        const initializerSpan = statement.payloadSpans.initializer;
        let initializer: ModuleGeometryReferenceSemantic | null = null;
        let construction: ModuleGeometryConstructionSemantic | null = null;
        let valueExpression: ModuleGeometryValueExpressionSemantic | null = null;
        if (initializerSpan) {
          const source = sourceTextFor(statementIndex) || statement.initializer;
          const initializerSource = source.slice(initializerSpan.start, initializerSpan.end).trim();
          const dynamicCandidate = optionalGeometry || /^(?:if\s*\(|match\b)/.test(initializerSource) || initializerSource.includes("??");
          const parsedExpression = dynamicCandidate
            ? parseScalarExpression(source, initializerSpan, { allowOpaqueNamedCalls: true })
            : { ast: null, diagnostics: [] };
          if (dynamicCandidate) {
            for (const diagnostic of parsedExpression.diagnostics) {
              addLocal(statementIndex, {
                code: diagnostic.code,
                span: diagnostic.span,
                message: diagnostic.message
              });
            }
          }
          const dynamicExpression = parsedExpression.ast && (parsedExpression.ast.kind === "reference" || parsedExpression.ast.kind === "noneLiteral" || parsedExpression.ast.kind === "binary" || parsedExpression.ast.kind === "valueIf" || parsedExpression.ast.kind === "valueMatch")
            ? parsedExpression.ast
            : null;
          const isConstruction = /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(statement.initializer.trim());
          const containsConstruction = (node: ScalarExpressionAst): boolean => {
            switch (node.kind) {
              case "call": return true;
              case "valueIf": return containsConstruction(node.thenBranch) || (node.elseBranch ? containsConstruction(node.elseBranch) : false);
              case "valueMatch": return node.arms.some((arm) => containsConstruction(arm.expression));
              default: return false;
            }
          };
          if (dynamicExpression) {
            if (containsConstruction(dynamicExpression) && geometryValueConstructionControlFlowUnsupported(input.sourceNamespace.scopeIndex, statementIndex)) {
              addLocal(statementIndex, {
                code: "geometry-value-construction-control-flow-unsupported",
                span: initializerSpan,
                message: "control flow 内の geometry construction value はこのSliceでは未対応です。",
                presentation: { key: "diagnostic.geometry-value-construction-control-flow-unsupported" }
              });
            } else {
              valueExpression = parseGeometryValueExpression({
                statementIndex,
                ownerIndex: definition.statementIndex,
                source,
                node: dynamicExpression,
                expectedInterfaceType: geometryInterfaceType,
                expectedValueType: statement.valueType ?? undefined,
                analyzeScalar: (raw, span, expectedType) => analyzeSourceExpression(
                  statementIndex,
                  definition.statementIndex,
                  raw,
                  span,
                  expectedType,
                  (reference) => resolveBodyScalar(statementIndex, reference),
                  (reference) => resolveBodyBareScalar(statementIndex, reference),
                  (reference) => resolveBodyGeometryProperty(statementIndex, reference),
                  (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
                ),
                resolveReference: (raw, span, referenceOptions) => resolveGeometry(
                  statementIndex,
                  definition.statementIndex,
                  raw,
                  span,
                  geometryInterfaceType === "point" ? "point" : "line",
                  {
                    expectedInterfaceType: geometryInterfaceType,
                    allowCoordinate: false,
                    expectedValueType: statement.valueType ?? undefined,
                    requireOptional: referenceOptions?.requireOptional,
                    role: geometryInterfaceType === "point" ? "pointReference" : "lineReference"
                  }
                ),
                parseConstruction: (raw, span, expectedInterfaceType) => resolveGeometryConstruction(
                  statementIndex,
                  definition.statementIndex,
                  raw,
                  span,
                  expectedInterfaceType,
                  {
                    scalarResolver: (reference) => resolveBodyScalar(statementIndex, reference),
                    bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                    geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
                  }
                ),
                addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
              });
            }
          } else if (isConstruction) {
            if (geometryValueConstructionControlFlowUnsupported(input.sourceNamespace.scopeIndex, statementIndex)) {
              addLocal(statementIndex, {
                code: "geometry-value-construction-control-flow-unsupported",
                span: initializerSpan,
                message: "control flow 内の geometry construction value はこのSliceでは未対応です。",
                presentation: { key: "diagnostic.geometry-value-construction-control-flow-unsupported" }
              });
            } else {
              construction = resolveGeometryConstruction(
                statementIndex,
                definition.statementIndex,
                statement.initializer,
                initializerSpan,
                geometryInterfaceType,
                {
                  scalarResolver: (reference) => resolveBodyScalar(statementIndex, reference),
                  bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                  geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
                }
              );
            }
          } else {
            const parsedReference = parseDslSourceReference(statement.initializer.trim());
            const parsedCollectionIndex = parseScalarExpression(`${" ".repeat(initializerSpan.start)}${statement.initializer}`, initializerSpan).ast?.kind === "collectionIndex";
            if (parsedReference.kind !== "valid" && !parsedCollectionIndex) {
            addLocal(statementIndex, {
              code: "geometry-value-reference-required",
              span: initializerSpan,
              message: "geometry value の初期化には既存の @geometry reference を指定してください。",
              presentation: { key: "diagnostic.geometry-value-reference-required" }
            });
            } else {
              initializer = resolveGeometry(
                statementIndex,
                definition.statementIndex,
                statement.initializer,
                initializerSpan,
                geometryInterfaceType === "point" ? "point" : "line",
                {
                  expectedInterfaceType: geometryInterfaceType,
                  allowCoordinate: false,
                  expectedValueType: statement.valueType ?? undefined,
                  role: geometryInterfaceType === "point" ? "pointReference" : "lineReference"
                }
              );
            }
          }
        }
        if (initializer && initializerSpan) addGeometry(bodySemantic, null, initializerSpan, initializer);
        if (construction?.kind === "coordinate") {
          if (construction.x) addScalar(bodySemantic, "construction:x", construction.x.ast.span, construction.x);
          if (construction.y) addScalar(bodySemantic, "construction:y", construction.y.ast.span, construction.y);
        } else if (construction?.kind === "offsetPoint") {
          addGeometry(bodySemantic, "construction:from", construction.from.span, construction.from);
          if (construction.dx) addScalar(bodySemantic, "construction:dx", construction.dx.ast.span, construction.dx);
          if (construction.dy) addScalar(bodySemantic, "construction:dy", construction.dy.ast.span, construction.dy);
        } else if (construction?.kind === "polarPoint") {
          addGeometry(bodySemantic, "construction:from", construction.from.span, construction.from);
          if (construction.angle) addScalar(bodySemantic, "construction:angle", construction.angle.ast.span, construction.angle);
          if (construction.distance) addScalar(bodySemantic, "construction:distance", construction.distance.ast.span, construction.distance);
        } else if (construction?.kind === "between") {
          addGeometry(bodySemantic, "construction:start", construction.start.span, construction.start);
          addGeometry(bodySemantic, "construction:end", construction.end.span, construction.end);
          addScalar(bodySemantic, `construction:${construction.placement.kind}`, construction.placement.value.ast.span, construction.placement.value);
        } else if (construction?.kind === "onLine") {
          addGeometry(bodySemantic, "construction:from", construction.from.span, construction.from);
          addScalar(bodySemantic, `construction:${construction.placement.kind}`, construction.placement.value.ast.span, construction.placement.value);
        } else if (construction?.kind === "intersection") {
          addGeometry(bodySemantic, "construction:line1", construction.line1.span, construction.line1);
          addGeometry(bodySemantic, "construction:line2", construction.line2.span, construction.line2);
          if (construction.index) addScalar(bodySemantic, "construction:index", construction.index.ast.span, construction.index);
          if (construction.extensions) addScalar(bodySemantic, "construction:extensions", construction.extensions.ast.span, construction.extensions);
        } else if (construction?.kind === "commonTangent") {
          addGeometry(bodySemantic, "construction:first", construction.first.span, construction.first);
          addGeometry(bodySemantic, "construction:second", construction.second.span, construction.second);
          if (construction.tangentKind) addScalar(bodySemantic, "construction:kind", construction.tangentKind.ast.span, construction.tangentKind);
          if (construction.side) addScalar(bodySemantic, "construction:side", construction.side.ast.span, construction.side);
        } else if (construction?.kind === "tangentOffset") {
          addGeometry(bodySemantic, "construction:line", construction.line.span, construction.line);
          addGeometry(bodySemantic, "construction:base", construction.base.span, construction.base);
          if (construction.angle) addScalar(bodySemantic, "construction:angle", construction.angle.ast.span, construction.angle);
          if (construction.curveSide) addScalar(bodySemantic, "construction:curveSide", construction.curveSide.ast.span, construction.curveSide);
          if (construction.distance) addScalar(bodySemantic, "construction:distance", construction.distance.ast.span, construction.distance);
        } else if (construction?.kind === "bezierExtremePoint") {
          addGeometry(bodySemantic, "construction:source", construction.source.span, construction.source);
          if (construction.segmentIndex) addScalar(bodySemantic, "construction:segmentIndex", construction.segmentIndex.ast.span, construction.segmentIndex);
          if (construction.direction) addScalar(bodySemantic, "construction:direction", construction.direction.ast.span, construction.direction);
        } else if (construction?.kind === "bezierBulgePoint") {
          addGeometry(bodySemantic, "construction:source", construction.source.span, construction.source);
          if (construction.segmentIndex) addScalar(bodySemantic, "construction:segmentIndex", construction.segmentIndex.ast.span, construction.segmentIndex);
        } else if (construction?.kind === "segment") {
          addGeometry(bodySemantic, "construction:start", construction.start.span, construction.start);
          addGeometry(bodySemantic, "construction:end", construction.end.span, construction.end);
        } else if (construction?.kind === "polarLine") {
          addGeometry(bodySemantic, "construction:start", construction.start.span, construction.start);
          if (construction.angle) addScalar(bodySemantic, "construction:angle", construction.angle.ast.span, construction.angle);
          if (construction.length) addScalar(bodySemantic, "construction:length", construction.length.ast.span, construction.length);
        } else if (construction?.kind === "arc") {
          addGeometry(bodySemantic, "construction:center", construction.center.span, construction.center);
          if (construction.radius) addScalar(bodySemantic, "construction:radius", construction.radius.ast.span, construction.radius);
          if (construction.start) addScalar(bodySemantic, "construction:start", construction.start.ast.span, construction.start);
          if (construction.end) addScalar(bodySemantic, "construction:end", construction.end.ast.span, construction.end);
          if (construction.direction) addScalar(bodySemantic, "construction:direction", construction.direction.ast.span, construction.direction);
        } else if (construction?.kind === "through") {
          addGeometry(bodySemantic, "construction:point1", construction.point1.span, construction.point1);
          addGeometry(bodySemantic, "construction:point2", construction.point2.span, construction.point2);
          addGeometry(bodySemantic, "construction:point3", construction.point3.span, construction.point3);
          if (construction.start) addScalar(bodySemantic, "construction:start", construction.start.ast.span, construction.start);
          if (construction.end) addScalar(bodySemantic, "construction:end", construction.end.ast.span, construction.end);
        } else if (construction?.kind === "bezier") {
          addGeometry(bodySemantic, "construction:start", construction.start.span, construction.start);
          addGeometry(bodySemantic, "construction:end", construction.end.span, construction.end);
          if (construction.startAngle) addScalar(bodySemantic, "construction:startAngle", construction.startAngle.ast.span, construction.startAngle);
          if (construction.startLength) addScalar(bodySemantic, "construction:startLength", construction.startLength.ast.span, construction.startLength);
          if (construction.endAngle) addScalar(bodySemantic, "construction:endAngle", construction.endAngle.ast.span, construction.endAngle);
          if (construction.endLength) addScalar(bodySemantic, "construction:endLength", construction.endLength.ast.span, construction.endLength);
          construction.intermediates.forEach((intermediate, index) => {
            addGeometry(bodySemantic, `construction:intermediates:${index}:point`, intermediate.point.span, intermediate.point);
            if (intermediate.angle) addScalar(bodySemantic, `construction:intermediates:${index}:angle`, intermediate.angle.ast.span, intermediate.angle);
            if (intermediate.incomingLength) addScalar(bodySemantic, `construction:intermediates:${index}:incomingLength`, intermediate.incomingLength.ast.span, intermediate.incomingLength);
            if (intermediate.outgoingLength) addScalar(bodySemantic, `construction:intermediates:${index}:outgoingLength`, intermediate.outgoingLength.ast.span, intermediate.outgoingLength);
          });
        } else if (construction?.kind === "polyline") {
          construction.points.forEach((point, index) => {
            addGeometry(bodySemantic, `construction:points:${index}`, point.span, point);
          });
          if (construction.closed) addScalar(bodySemantic, "construction:closed", construction.closed.ast.span, construction.closed);
        } else if (construction?.kind === "offsetPath") {
          construction.sources.forEach((source, index) => {
            addGeometry(bodySemantic, `construction:sources:${index}`, source.span, source);
          });
          if (construction.distance) addScalar(bodySemantic, "construction:distance", construction.distance.ast.span, construction.distance);
          if (construction.side) addScalar(bodySemantic, "construction:side", construction.side.ast.span, construction.side);
          if (construction.closed) addScalar(bodySemantic, "construction:closed", construction.closed.ast.span, construction.closed);
          if (construction.suppressTrimWarnings) addScalar(bodySemantic, "construction:suppressTrimWarnings", construction.suppressTrimWarnings.ast.span, construction.suppressTrimWarnings);
        } else if (construction?.kind === "joinedPath") {
          construction.paths.forEach((path, index) => {
            addGeometry(bodySemantic, `construction:paths:${index}`, path.span, path);
          });
          if (construction.closed) addScalar(bodySemantic, "construction:closed", construction.closed.ast.span, construction.closed);
        } else if (construction?.kind === "transformCopy") {
          addGeometry(bodySemantic, "construction:startPoint", construction.startPoint.span, construction.startPoint);
          addGeometry(bodySemantic, "construction:endPoint", construction.endPoint.span, construction.endPoint);
          construction.baseLines.forEach((source, index) => {
            addGeometry(bodySemantic, `construction:baseLines:${index}`, source.span, source);
          });
          if (construction.scale) addScalar(bodySemantic, "construction:scale", construction.scale.ast.span, construction.scale);
          if (construction.angleDeg) addScalar(bodySemantic, "construction:angleDeg", construction.angleDeg.ast.span, construction.angleDeg);
          if (construction.mirrorX) addScalar(bodySemantic, "construction:mirrorX", construction.mirrorX.ast.span, construction.mirrorX);
        } else if (construction?.kind === "mirrorCopy") {
          addGeometry(bodySemantic, "construction:axis1", construction.axis1.span, construction.axis1);
          addGeometry(bodySemantic, "construction:axis2", construction.axis2.span, construction.axis2);
          construction.baseLines.forEach((source, index) => {
            addGeometry(bodySemantic, `construction:baseLines:${index}`, source.span, source);
          });
        }
        if (valueExpression) addGeometryValueExpressionSites(bodySemantic, valueExpression);
        const value: ModuleGeometryValueSemantic = {
          statementId,
          statementIndex,
          name: statement.name,
          declaredInterfaceType: geometryInterfaceType,
          declaredValueType: statement.valueType ?? undefined,
          ownerModuleDefinitionStatementId: definition.statementId,
          ownerModuleDefinitionStatementIndex: definition.statementIndex,
          exported: Boolean(statement.exported),
          initializer,
          construction,
          valueExpression,
          backingTarget: initializer?.target ?? null
        };
        localGeometryValues.push(value);
        registerGeometryValue(value);
        if (statement.exported) {
          if (!isDirectModuleChild(statement, definition.statementIndex) || !statement.name) {
            addLocal(statementIndex, {
              code: "module-invalid-export",
              span: statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan,
              message: "export は module 直下の名前付き geometry または scalar declaration にのみ指定できます。",
              presentation: { key: "diagnostic.module-invalid-export" }
            });
          } else if (initializer || construction || valueExpression) {
            registerExport({
              kind: "geometry",
              ownerModuleDefinitionStatementId: definition.statementId,
              exportedStatementId: statementId,
              exportedStatementIndex: statementIndex,
              sourceOrder: statementIndex,
              name: statement.name,
              category: null,
              interfaceType: geometryInterfaceType,
              backingTarget: {
                kind: "geometryValue",
                statementId,
                statementIndex,
                declaredInterfaceType: geometryInterfaceType,
                backingTarget: initializer?.target ?? null,
                ownerModuleDefinitionStatementId: definition.statementId,
                ownerModuleDefinitionStatementIndex: definition.statementIndex
              }
            }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
          }
        }
      } else if (!isDslArrayValueType(requiredValueType)) {
        const declaredType = scalarExpressionTypeOfDslValueType(statement.valueType);
        const initializerSpan = statement.payloadSpans.initializer;
        const initializer = initializerSpan
          ? analyzeExpression(
              statementIndex,
              definition.statementIndex,
              statement.initializer,
              initializerSpan,
              declaredType,
              (reference) => resolveBodyScalar(statementIndex, reference),
              undefined,
              (reference) => resolveBodyGeometryProperty(statementIndex, reference),
              (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
            )
          : null;
        localScalars.push({ statementId, statementIndex, name: statement.name, type: declaredType, bindingKind: statement.bindingKind, initializer });
        if (initializer && initializerSpan) bodySemantic.scalarExpressions = [{ parameterKey: null, span: initializerSpan, expression: initializer }];
        const exportedDeclaredType = scalarTypeOfDslValueType(dslRequiredValueTypeOf(statement.valueType));
        if (statement.exported) {
          if (!isDirectModuleChild(statement, definition.statementIndex) || !statement.name || !declaredType) {
            addLocal(statementIndex, {
              code: "module-invalid-export",
              span: statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan,
              message: "export は module 直下の名前付き geometry または scalar declaration にのみ指定できます。",
              presentation: { key: "diagnostic.module-invalid-export" }
            });
          } else if (statementId) {
            registerExport({
              kind: "scalar",
              ownerModuleDefinitionStatementId: definition.statementId,
              exportedStatementId: statementId,
              exportedStatementIndex: statementIndex,
              sourceOrder: statementIndex,
              name: statement.name,
              declaredType: exportedDeclaredType!,
              bindingKind: statement.bindingKind
            }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
          }
        }
      }
    } else if (statement.kind === "set") {
      const target = resolvePlainScalarTarget(statementIndex, definition.statementIndex, statement.name);
      const expressionSpan = statement.payloadSpans.expression ?? statement.keywordSpan;
      const expression = analyzeExpression(
        statementIndex,
        definition.statementIndex,
        statement.expression,
        expressionSpan,
        target.type?.kind === "optional" ? null : target.type,
              (reference) => resolveBodyScalar(statementIndex, reference),
        undefined,
        (reference) => resolveBodyGeometryProperty(statementIndex, reference),
        (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
      );
      if (bodySemantic && expression) bodySemantic.scalarExpressions = [{ parameterKey: null, span: expressionSpan, expression }];
      if (bodySemantic) bodySemantic.scalarTarget = isModuleScalarTarget(target.target) ? target.target : null;
      if (!target.target || target.resolution !== "resolved") {
        addLocal(statementIndex, target.diagnostic ?? {
          code: "module-invalid-set-target",
          span: statement.nameSpan ?? statement.keywordSpan,
          message: `set target「${statement.name}」を解決できません。`,
          presentation: {
            key: "diagnostic.module-invalid-set-target",
            parameters: { target: statement.name }
          }
        });
      }
    } else if (statement.kind === "group" || statement.kind === "element") {
      if (statement.kind === "element" && statement.exported) {
        const category: DslGeometryDeclarationCategory | null = isGeometryDeclarationCategory(statement.category) ? statement.category : null;
        if (!isDirectModuleChild(statement, definition.statementIndex) || !statement.name || !category) {
          addLocal(statementIndex, {
            code: "module-invalid-export",
            span: statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan,
            message: "export は module 直下の名前付き geometry または scalar declaration にのみ指定できます。",
            presentation: { key: "diagnostic.module-invalid-export" }
          });
        } else if (statementId) {
          registerExport({
            kind: "geometry",
            ownerModuleDefinitionStatementId: definition.statementId,
            exportedStatementId: statementId,
            exportedStatementIndex: statementIndex,
            sourceOrder: statementIndex,
            name: statement.name,
            category,
            interfaceType: moduleGeometryInterfaceTypeOfElement(statement)
              ?? (category === "point" ? "point" : "path")
          }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
        }
      }
      const spec = statement.kind === "group" ? constructionFor("group", "") : constructionFor(statement.category, statement.construction);
      if (spec) {
        const specialArgs = [...(spec.args ?? []), ...commonArgSpecs].filter((arg) => arg.special);
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
              const listValueType = dslValueTypeForParameterDefinition(parameter);
              const memberValueType = isDslArrayValueType(listValueType) ? listValueType.elementType : listValueType;
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
                  {
                    allowCoordinate: parameter.allowCoordinate === true,
                    expectedValueType: memberValueType ?? undefined,
                    role: "lineReferenceList"
                  }
                );
                addGeometry(bodySemantic, parameterKey, reference.span, reference);
              }
            } else {
                const reference = resolveGeometry(statementIndex, definition.statementIndex, value, valueSpan, expected, {
                allowCoordinate: parameter.allowCoordinate === true,
                expectedValueType: dslValueTypeForParameterDefinition(parameter) ?? undefined,
                role: parameter.kind === "reference" ? "pointReference" : parameter.kind === "lineEndpointReference" ? "lineEndpointReference" : "lineReference",
                scalarResolver: (reference) => resolveBodyScalar(statementIndex, reference),
                bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference)
              });
              addGeometry(bodySemantic, parameterKey, valueSpan, reference);
            }
          } else {
            const expectedType = statement.kind === "element" && statement.type === "conditionalGroup" && parameterKey === "condition"
              ? ({ kind: "boolean" } as const)
              : scalarTypeForParameterDefinition(parameter);
            if (!expectedType) continue;
            const template = parameter.kind === "text" ? analyzeTextTemplate(statementIndex, bodySemantic, valueSpan) : false;
            const expression = template
              ? null
              : parameter.kind === "text" && !isScalarExpressionCandidateSource(value)
                ? textParameterSemantic(value, valueSpan)
                : analyzeExpression(
                  statementIndex,
                  definition.statementIndex,
                  value,
                  valueSpan,
                  expectedType,
                  (reference) => resolveBodyScalar(statementIndex, reference),
                  (reference) => resolveBodyBareScalar(statementIndex, reference),
                  (reference) => resolveBodyGeometryProperty(statementIndex, reference),
                  (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
                );
            if (bodySemantic && expression && !template) bodySemantic.scalarExpressions = [...bodySemantic.scalarExpressions, { parameterKey, span: valueSpan, expression }];
          }
        }
        for (const arg of specialArgs) {
          if (arg.special !== "intermediates") continue;
          const valueSpan = statement.payloadSpans[arg.arg];
          if (valueSpan) analyzeIntermediates(statementIndex, bodySemantic, valueSpan);
        }
        for (const arg of specialArgs) {
          if (arg.special !== "points") continue;
          const valueSpan = statement.payloadSpans[arg.arg];
          if (valueSpan) analyzePointArray(statementIndex, bodySemantic, valueSpan);
        }
        if (bodySemantic) bodySemantic.scalarExpressions = [...bodySemantic.scalarExpressions].sort((left, right) => left.span.start - right.span.start);
      }
    }
    const condition = bodySemantic?.scalarExpressions.find((site) => site.parameterKey === "condition")?.expression;
    if (statement.kind === "element" && statement.type === "conditionalGroup" && condition) {
      conditionSemantics.set(statementIndex, condition);
    }
    if (bodySemantic) bodyStatements.push(bodySemantic);
  }
  return { localScalars, localGeometryValues, bodyStatements, exports };
};
