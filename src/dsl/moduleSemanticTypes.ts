import type { DslGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarType } from "../scalars/types";
import type { BindingId } from "../scalars/bindingCatalog";
import type { StatementIdentity } from "../document/statementIdentity";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  RecordConstructorFieldSemantic,
  RecordDefinitionSemantic,
  RecordFieldIdentity,
  RecordTypeIdentity,
  RecordValueSemantic
} from "./recordSemanticAnalysis";

export type ModuleParameterSlot = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
};

export type ModuleRecordSourceTarget =
  | {
      kind: "recordValue";
      statementId: StatementIdentity;
      statementIndex: number;
      typeIdentity: RecordTypeIdentity;
    }
  | (ModuleParameterSlot & {
      kind: "recordParameter";
      typeIdentity: RecordTypeIdentity;
    })
  | {
      kind: "deferredModuleRecordExport";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      exportedStatementId: StatementIdentity;
      exportedStatementIndex: number;
      typeIdentity: RecordTypeIdentity;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
    };

export type ModuleRecordFieldSourceTarget = {
  kind: "recordField";
  record: ModuleRecordSourceTarget;
  field: RecordFieldIdentity;
  fieldName: string;
  type: ScalarType;
};

export type ModuleScalarSourceTarget =
  | (ModuleParameterSlot & { kind: "parameter" })
  | ModuleRecordFieldSourceTarget
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string }
  | { kind: "moduleLocal"; statementId: StatementIdentity; statementIndex: number }
  | { kind: "documentBinding"; bindingId: BindingId; statementId: StatementIdentity; statementIndex: number }
  | {
      kind: "deferredModuleScalarExport";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      exportedStatementId: StatementIdentity;
      exportedStatementIndex: number;
      declaredType: ScalarType;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
    };

export type ModuleGeometrySourceTarget =
  | (ModuleParameterSlot & { kind: "parameter"; geometryKind: "point" | "line"; pointKey?: string })
  | {
      kind: "sourceGeometry";
      statementId: StatementIdentity;
      statementIndex: number;
      category: DslGeometryDeclarationCategory;
      geometryKind: "point" | "line";
      pointKey?: string;
    }
  | {
      kind: "deferredModuleExport";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      expectedGeometryKind: "point" | "line";
      expectedInterfaceType?: ModuleGeometryInterfaceType;
      pointKey?: string;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
    };

export type ModuleParentSourceTarget = {
  kind: "sourceContainer";
  statementId: StatementIdentity;
  statementIndex: number;
  containerKind: "group" | "conditionalGroup" | "forGroup";
};

export type ModuleParentReferenceSemantic = {
  source: string;
  span: DslSpan;
  /** Exact container identifier token, excluding `@`. */
  nameSpan?: DslSpan;
  target: ModuleParentSourceTarget | null;
  resolution: "resolved" | "undefined" | "forward" | "ambiguous" | "invalid";
};

export type ModuleGeometryPropertySourceTarget =
  | ModuleRecordFieldSourceTarget
  | (ModuleParameterSlot & { kind: "parameterProperty"; geometryKind: "point" | "line"; property: string })
  | {
      kind: "sourceGeometryProperty";
      statementId: StatementIdentity;
      statementIndex: number;
      category: DslGeometryDeclarationCategory;
      property: string;
    }
  | {
      kind: "deferredModuleExportProperty";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      property: string;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
    };

export type ModuleSourceTarget = ModuleScalarSourceTarget | ModuleGeometrySourceTarget | ModuleGeometryPropertySourceTarget;

export type ModuleScalarReference = {
  name: string;
  /** Exact identifier token, excluding `@`, from the scalar AST. */
  nameSpan: DslSpan;
  span: DslSpan;
  target: ModuleSourceTarget | null;
  resolution: "resolved" | "undefined" | "forward" | "outerCapture" | "invalid";
};

export type ModuleScalarExpressionSemantic = {
  ast: ScalarExpressionAst;
  type: ScalarType | null;
  references: readonly ModuleScalarReference[];
  geometryProperties: readonly ModuleGeometryPropertyReference[];
  geometryBuiltinArguments: readonly ModuleGeometryBuiltinArgumentSemantic[];
  /** Validated `hasValue(@parameter)` facts, keyed by intrinsic call span. */
  hasValueParameters: readonly {
    span: DslSpan;
    definitionStatementId: StatementIdentity;
    parameterIndex: number;
  }[];
};

export type ModuleRecordConstructorFieldSemantic = RecordConstructorFieldSemantic & {
  expression: ModuleScalarExpressionSemantic | null;
};

export type ModuleRecordReferenceSemantic = {
  source: string;
  span: DslSpan;
  typeIdentity: RecordTypeIdentity | null;
  target: ModuleRecordSourceTarget | null;
  constructor: {
    name: string;
    nameSpan: DslSpan;
    targetTypeIdentity: RecordTypeIdentity | null;
    fields: readonly ModuleRecordConstructorFieldSemantic[];
  } | null;
  resolution: "resolved" | "undefined" | "forward" | "ambiguous" | "invalid" | "outerCapture";
};

export type ModuleGeometryBuiltinArgumentSemantic = {
  builtinName: string;
  argumentIndex: number;
  span: DslSpan;
  expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
  reference: ModuleGeometryReferenceSemantic;
};

export type ModuleGeometryPropertyReference = {
  geometryName: string;
  property: string;
  /** Exact tokens supplied by the scalar tokenizer. `span` includes `@` && the property path. */
  elementNameSpan: DslSpan;
  propertySpan: DslSpan;
  span: DslSpan;
  target: ModuleGeometryPropertySourceTarget | null;
  type: ScalarType | null;
  resolution: "resolved" | "undefined" | "forward" | "outerCapture" | "invalid" | "deferred";
};

export type ModulePointCoordinateSemantic = {
  kind: "coordinate";
  x: ModuleScalarExpressionSemantic | null;
  y: ModuleScalarExpressionSemantic | null;
};

export type ModuleGeometryReferenceRole =
  | "pointReference"
  | "lineEndpointReference"
  | "lineReference"
  | "lineReferenceList"
  | "coordinatePoint"
  | "derivedPoint";

export type ModuleGeometryReferenceSemantic = {
  source: string;
  span: DslSpan;
  /** Exact base geometry token when the reference has one (excludes @ && point accessor). */
  nameSpan?: DslSpan;
  expectedGeometryKind: "point" | "line";
  role: ModuleGeometryReferenceRole;
  target: ModuleGeometrySourceTarget | null;
  coordinate: ModulePointCoordinateSemantic | null;
  resolution: "resolved" | "undefined" | "forward" | "outerCapture" | "invalid" | "deferred";
};

export type ResolvedModuleParameter = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  optional: boolean;
  required: boolean;
  defaultValue: string | null;
  defaultSpan: DslSpan | null;
  defaultExpression: ModuleScalarExpressionSemantic | null;
};

export type ModuleArgumentSemantic =
  | { kind: "scalar"; expression: ModuleScalarExpressionSemantic }
  | { kind: "geometry"; reference: ModuleGeometryReferenceSemantic }
  | { kind: "record"; reference: ModuleRecordReferenceSemantic };

/** One entry per callee parameter, already in parameter source order. */
export type ResolvedModuleParameterBinding = {
  parameterIndex: number;
  parameterName: string;
  parameterType: DslModuleParameterType | null;
  argumentIndex: number | null;
  argumentLabel: string | null;
  argumentSpan: DslSpan | null;
  usesDefault: boolean;
  state: "requiredSupplied" | "requiredOmitted" | "defaultedOmitted" | "optionalSupplied" | "optionalOmitted";
  value: ModuleArgumentSemantic | null;
};

type ResolvedModuleExportBase = {
  ownerModuleDefinitionStatementId: StatementIdentity;
  exportedStatementId: StatementIdentity;
  exportedStatementIndex: number;
  sourceOrder: number;
  name: string;
};

export type ResolvedModuleGeometryExport = ResolvedModuleExportBase & {
  kind: "geometry";
  category: DslGeometryDeclarationCategory;
};

export type ResolvedModuleScalarExport = ResolvedModuleExportBase & {
  kind: "scalar";
  declaredType: ScalarType;
  bindingKind: "const" | "let";
};

export type ResolvedModuleRecordExport = ResolvedModuleExportBase & {
  kind: "record";
  typeIdentity: RecordTypeIdentity;
  definition: RecordDefinitionSemantic;
  backingTarget: ModuleRecordSourceTarget;
};

export type ResolvedModuleExport = ResolvedModuleGeometryExport | ResolvedModuleScalarExport | ResolvedModuleRecordExport;

export type ModuleRecordValueSemantic = {
  value: RecordValueSemantic;
  target: ModuleRecordSourceTarget | null;
  fields: readonly ModuleRecordConstructorFieldSemantic[];
  /** Optional Module parameters proven present at this declaration site. */
  presenceParameterKeys: readonly string[];
};

export type ModuleScalarExpressionSite = {
  parameterKey: string | null;
  span: DslSpan;
  expression: ModuleScalarExpressionSemantic;
};

export type ModuleTextTemplateHoleSite = {
  span: DslSpan;
  contentSpan: DslSpan;
  expression: ModuleScalarExpressionSemantic;
};

export type ModuleGeometryReferenceSite = {
  parameterKey: string | null;
  span: DslSpan;
  reference: ModuleGeometryReferenceSemantic;
};

export type ModuleParentReferenceSite = {
  parameterKey: "parent";
  span: DslSpan;
  reference: ModuleParentReferenceSemantic;
};

/** Resolved source references attached to one statement in a module body. */
export type ModuleBodyStatementSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  statementKind: DslStatement["kind"];
  scalarExpressions: readonly ModuleScalarExpressionSite[];
  geometryReferences: readonly ModuleGeometryReferenceSite[];
  textTemplateHoles: readonly ModuleTextTemplateHoleSite[];
  scalarTarget: ModuleScalarSourceTarget | null;
  /** Optional module parameters proven present at this statement's lexical site. */
  presenceParameterKeys: readonly string[];
};

export type ResolvedModuleCallee = {
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  name: string;
};

export type ModuleDefinitionSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  name: string;
  /** Scope containing the module definition statement itself. */
  declarationScopeId: ScopeId;
  /** Synthetic lexical scope containing the module body && its parameters. */
  bodyScopeId: ScopeId;
  /** @deprecated Use declarationScopeId/bodyScopeId explicitly. */
  scopeId: ScopeId;
  parameters: readonly ResolvedModuleParameter[];
  localScalars: readonly {
    statementId: StatementIdentity;
    statementIndex: number;
    name: string;
    type: ScalarType | null;
    bindingKind: "const" | "let";
    initializer: ModuleScalarExpressionSemantic | null;
  }[];
  recordValues: readonly ModuleRecordValueSemantic[];
  bodyStatements: readonly ModuleBodyStatementSemantic[];
  exports: readonly ResolvedModuleExport[];
  bodyStatementIds: readonly StatementIdentity[];
};

export type ModuleInstanceSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  name: string;
  callerModuleDefinitionStatementId: StatementIdentity | null;
  callee: ResolvedModuleCallee | null;
  calleeResolution: "resolved" | "undefined" | "forward" | "notModule" | "ambiguous";
  parameterBindings: readonly ResolvedModuleParameterBinding[];
};

export type ModuleCallEdge = {
  callerModuleDefinitionStatementId: StatementIdentity;
  calleeModuleDefinitionStatementId: StatementIdentity;
  instanceStatementId: StatementIdentity;
};

export type ModuleSemanticAnalysis = {
  definitions: readonly ModuleDefinitionSemantic[];
  instances: readonly ModuleInstanceSemantic[];
  definitionsByStatementId: ReadonlyMap<StatementIdentity, ModuleDefinitionSemantic>;
  instancesByStatementId: ReadonlyMap<StatementIdentity, ModuleInstanceSemantic>;
  callEdges: readonly ModuleCallEdge[];
  /** Source-only qualified scalar references in root typed declarations. */
  rootScalarExpressionsByStatementId: ReadonlyMap<StatementIdentity, ModuleScalarExpressionSite>;
  /** Source-only qualified geometry references in the root document. */
  rootGeometryReferencesByStatementId: ReadonlyMap<StatementIdentity, readonly ModuleGeometryReferenceSite[]>;
  /** Source-only parent container references in the root document. */
  rootParentReferencesByStatementId: ReadonlyMap<StatementIdentity, ModuleParentReferenceSite>;
  diagnostics: readonly DslDiagnostic[];
};

export type ModuleSemanticAnalysisInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  sourceNamespace: import("./sourceLexicalNamespaceIndex").SourceLexicalNamespaceIndex;
  spans: import("./dslDiagnosticSpan").DiagnosticSpanContext;
  logicalTextByStatementIndex?: ReadonlyMap<number, string>;
  documentScalarBindings?: ReadonlyMap<number, { bindingId: BindingId; statementId: StatementIdentity }>;
};
