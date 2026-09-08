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
import { isScalarExpressionCandidateSource } from "../scalars/expressionParser";
import type { DslSpan, DslStatement } from "./dslTypes";
import { getParameterDefinitions, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceRole,
  ModuleGeometryReferenceSemantic,
  ModuleGeometryConstructionSemantic,
  ModuleGeometryValueSemantic,
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
import { presenceFactsForSemanticFalse, presenceFactsForSemanticTruth } from "./moduleScalarExpression";
import { isDslArrayValueType, isDslGeometryValueType, scalarTypeOfDslValueType } from "./dslValueTypes";
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
  expectedType: ScalarType | null,
  resolver: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
  bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
  geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
  geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver,
  resolveHasValue?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution,
  presenceFacts?: ReadonlySet<string>
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
    expectedInterfaceType?: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType;
    role?: ModuleGeometryReferenceRole;
    scalarResolver?: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
    bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
    presenceFacts?: ReadonlySet<string>;
  }
) => ModuleGeometryReferenceSemantic;
type ResolveGeometryConstruction = (
  statementIndex: number,
  ownerIndex: number | null,
  rawValue: string,
  span: DslSpan,
  expectedInterfaceType: import("./moduleGeometryInterfaces").ModuleGeometryInterfaceType,
  options?: {
    scalarResolver?: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
    bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
    presenceFacts?: ReadonlySet<string>;
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
  geometryBuiltinArguments: [],
  hasValueParameters: []
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
  resolvePlainScalarTarget,
  resolveBodyScalar,
  resolveBodyBareScalar,
  resolveBodyGeometryProperty,
  resolveBodyGeometryBuiltin,
  resolveBodyHasValue,
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
  resolvePlainScalarTarget: ResolvePlainScalarTarget;
  resolveBodyScalar: (statementIndex: number, reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
  resolveBodyBareScalar: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
  resolveBodyGeometryProperty: (statementIndex: number, reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
  resolveBodyGeometryBuiltin: (statementIndex: number, reference: ModuleGeometryBuiltinReferenceInput) => ModuleGeometryReferenceSemantic;
  resolveBodyHasValue: (statementIndex: number, reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
  registerGeometryValue: (value: ModuleGeometryValueSemantic) => void;
}): ModuleBodySemanticResult => {
  const localScalars: NonNullable<ModuleDefinitionSemantic["localScalars"]>[number][] = [];
  const localGeometryValues: ModuleGeometryValueSemantic[] = [];
  const bodyStatements: ModuleBodyStatementSemantic[] = [];
  const exports: ResolvedModuleExport[] = [];
  const exportByName = new Map<string, ResolvedModuleExport>();
  const conditionSemantics = new Map<number, ModuleScalarExpressionSemantic>();

  const presenceFactsForStatement = (statementIndex: number): ReadonlySet<string> => {
    const facts = new Set<string>();
    let enclosing = statements[statementIndex]?.enclosing ?? null;
    while (enclosing) {
      const condition = conditionSemantics.get(enclosing.statementIndex);
      if (condition) {
        const branchFacts = enclosing.branch === "then"
          ? presenceFactsForSemanticTruth(condition)
          : presenceFactsForSemanticFalse(condition);
        for (const fact of branchFacts) facts.add(fact);
      }
      enclosing = statements[enclosing.statementIndex]?.enclosing ?? null;
    }
    return facts;
  };

  const analyzeExpression = (
    statementIndex: number,
    ownerIndex: number | null,
    raw: string,
    span: DslSpan,
    expectedType: ScalarType | null,
    resolver: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution,
    bareResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null,
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
    geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver,
    resolveHasValue?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution
  ) => analyzeSourceExpression(
    statementIndex,
    ownerIndex,
    raw,
    span,
    expectedType,
    resolver,
    bareResolver,
    geometryPropertyResolver,
    geometryBuiltinResolver,
    resolveHasValue ?? ((reference) => resolveBodyHasValue(statementIndex, reference)),
    presenceFactsForStatement(statementIndex)
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
        (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
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
            scalarResolver: (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
            bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
            geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference),
            presenceFacts: presenceFactsForStatement(statementIndex)
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
          (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
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
          scalarResolver: (candidate, presenceFacts) => resolveBodyScalar(statementIndex, candidate, presenceFacts),
          bareScalarResolver: (candidate) => resolveBodyBareScalar(statementIndex, candidate),
          geometryPropertyResolver: (candidate) => resolveBodyGeometryProperty(statementIndex, candidate),
          presenceFacts: presenceFactsForStatement(statementIndex)
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
          scalarTarget: null,
          presenceParameterKeys: [...presenceFactsForStatement(statementIndex)]
        }
      : null;

    if (statement.kind === "typedDeclaration") {
      if (!statementId || !bodySemantic) continue;
      if (isDslGeometryValueType(statement.valueType)) {
        const initializerSpan = statement.payloadSpans.initializer;
        let initializer: ModuleGeometryReferenceSemantic | null = null;
        let construction: ModuleGeometryConstructionSemantic | null = null;
        if (initializerSpan) {
          const isConstruction = /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(statement.initializer.trim());
          if (isConstruction) {
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
                statement.valueType.kind,
                {
                  scalarResolver: (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
                  bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                  geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference),
                  presenceFacts: presenceFactsForStatement(statementIndex)
                }
              );
            }
          } else {
            const parsedReference = parseDslSourceReference(statement.initializer.trim());
            if (parsedReference.kind !== "valid") {
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
                statement.valueType.kind === "point" ? "point" : "line",
                {
                  expectedInterfaceType: statement.valueType.kind,
                  allowCoordinate: false,
                  role: statement.valueType.kind === "point" ? "pointReference" : "lineReference",
                  presenceFacts: presenceFactsForStatement(statementIndex)
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
        } else if (construction?.kind === "segment") {
          addGeometry(bodySemantic, "construction:start", construction.start.span, construction.start);
          addGeometry(bodySemantic, "construction:end", construction.end.span, construction.end);
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
        }
        const value: ModuleGeometryValueSemantic = {
          statementId,
          statementIndex,
          name: statement.name,
          declaredInterfaceType: statement.valueType.kind,
          ownerModuleDefinitionStatementId: definition.statementId,
          ownerModuleDefinitionStatementIndex: definition.statementIndex,
          exported: Boolean(statement.exported),
          initializer,
          construction,
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
          } else if (initializer || construction) {
            registerExport({
              kind: "geometry",
              ownerModuleDefinitionStatementId: definition.statementId,
              exportedStatementId: statementId,
              exportedStatementIndex: statementIndex,
              sourceOrder: statementIndex,
              name: statement.name,
              category: null,
              interfaceType: statement.valueType.kind,
              backingTarget: {
                kind: "geometryValue",
                statementId,
                statementIndex,
                declaredInterfaceType: statement.valueType.kind,
                backingTarget: initializer?.target ?? null,
                ownerModuleDefinitionStatementId: definition.statementId,
                ownerModuleDefinitionStatementIndex: definition.statementIndex
              }
            }, statement.exportSpan ?? statement.nameSpan ?? statement.keywordSpan);
          }
        }
      } else if (!isDslArrayValueType(statement.valueType)) {
        const declaredType = scalarTypeOfDslValueType(statement.valueType);
        const initializerSpan = statement.payloadSpans.initializer;
        const initializer = initializerSpan
          ? analyzeExpression(
              statementIndex,
              definition.statementIndex,
              statement.initializer,
              initializerSpan,
              declaredType,
              (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
              undefined,
              (reference) => resolveBodyGeometryProperty(statementIndex, reference),
              (reference) => resolveBodyGeometryBuiltin(statementIndex, reference)
            )
          : null;
        localScalars.push({ statementId, statementIndex, name: statement.name, type: declaredType, bindingKind: statement.bindingKind, initializer });
        if (initializer && initializerSpan) bodySemantic.scalarExpressions = [{ parameterKey: null, span: initializerSpan, expression: initializer }];
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
              declaredType,
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
        target.type,
        (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
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
                scalarResolver: (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
                bareScalarResolver: (reference) => resolveBodyBareScalar(statementIndex, reference),
                geometryPropertyResolver: (reference) => resolveBodyGeometryProperty(statementIndex, reference),
                presenceFacts: presenceFactsForStatement(statementIndex)
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
                  (reference, presenceFacts) => resolveBodyScalar(statementIndex, reference, presenceFacts),
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
