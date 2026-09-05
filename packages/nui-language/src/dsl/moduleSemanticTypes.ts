import type { DslGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarType } from "../scalars/types";
import type { BindingId } from "../scalars/bindingCatalog";
import type { StatementIdentity } from "../document/statementIdentity";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";
import type { ModuleDocumentationMetadata } from "./moduleDocumentation";
import type {
  DocumentId,
  DocumentQualifiedSemanticIdentity,
  DocumentQualifiedSourceLocation,
  DocumentSourceIdentity
} from "../document/multiDocumentPrimitives";
import type {
  SourceLexicalExternalNamespaceMember,
  SourceLexicalExternalNamespaceResolver
} from "./sourceLexicalNamespaceIndex";
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
  /** Present when this semantic result is owned by a multi-document source. */
  definitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
};

export type ModuleRecordSourceTarget =
  | {
      kind: "recordValue";
      statementId: StatementIdentity;
      statementIndex: number;
      typeIdentity: RecordTypeIdentity;
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | { kind: "moduleLocal"; statementId: StatementIdentity; statementIndex: number; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | { kind: "documentBinding"; bindingId: BindingId; statementId: StatementIdentity; statementIndex: number; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | {
      kind: "deferredModuleScalarExport";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      exportedStatementId: StatementIdentity;
      exportedStatementIndex: number;
      declaredType: ScalarType;
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    };

export type ModuleParentSourceTarget = {
  kind: "sourceContainer";
  statementId: StatementIdentity;
  statementIndex: number;
  containerKind: "group" | "conditionalGroup" | "forGroup";
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
    definitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  definitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  name: string;
  type: DslModuleParameterType | null;
  numericTypeOptions?: DslNumericTypeOptions;
  recordTypeIdentity: RecordTypeIdentity | null;
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
  ownerModuleDefinitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  /** Original defining Module identity; re-exports keep this identity. */
  definitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  definitionDocumentId?: DocumentId;
  definitionLocation?: DocumentQualifiedSourceLocation;
  /** Exact defining-document semantic object for graph-backed callers. */
  definition?: ModuleDefinitionSemantic;
  /** Raw documentation transported with the resolved defining Module entry. */
  documentation?: ModuleDocumentationMetadata;
};

export type ExternalModuleSemanticTarget = {
  identity: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  declaration: DocumentQualifiedSourceLocation;
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  name: string;
  parameters: readonly ResolvedModuleParameter[];
  /** Exact defining-document semantic object; never a cloned source model. */
  definition?: ModuleDefinitionSemantic;
  /** Raw documentation transported through the public API entry. */
  documentation?: ModuleDocumentationMetadata;
};

export type ModuleDefinitionSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  name: string;
  documentId?: DocumentId;
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  declaration?: DocumentQualifiedSourceLocation;
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
    identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
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
  documentId?: DocumentId;
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  location?: DocumentQualifiedSourceLocation;
  callerModuleDefinitionStatementId: StatementIdentity | null;
  callerModuleDefinitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity> | null;
  callee: ResolvedModuleCallee | null;
  calleeResolution: "resolved" | "undefined" | "forward" | "notModule" | "ambiguous";
  parameterBindings: readonly ResolvedModuleParameterBinding[];
};

export type ModuleCallEdge = {
  callerModuleDefinitionStatementId: StatementIdentity;
  calleeModuleDefinitionStatementId: StatementIdentity;
  instanceStatementId: StatementIdentity;
  callerIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  calleeIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
};

export type ModuleSemanticAnalysis = {
  documentId?: DocumentId;
  source?: DocumentSourceIdentity;
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
  /** Multi-document lookup maps use JSON identity keys, not local names. */
  definitionsByQualifiedIdentity?: ReadonlyMap<string, ModuleDefinitionSemantic>;
  instancesByQualifiedIdentity?: ReadonlyMap<string, ModuleInstanceSemantic>;
};

export type ModuleSemanticAnalysisInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  sourceNamespace: import("./sourceLexicalNamespaceIndex").SourceLexicalNamespaceIndex;
  spans: import("./dslDiagnosticSpan").DiagnosticSpanContext;
  logicalTextByStatementIndex?: ReadonlyMap<number, string>;
  documentScalarBindings?: ReadonlyMap<number, { bindingId: BindingId; statementId: StatementIdentity }>;
  /** Exact owner used for document-qualified semantic identities. */
  documentId?: DocumentId;
  source?: DocumentSourceIdentity;
  /** Existing graph-backed external namespace member resolver. */
  externalNamespaceResolver?: SourceLexicalExternalNamespaceResolver;
  /** Resolves an external public Module entry to its defining semantic data. */
  externalModuleResolver?: (member: SourceLexicalExternalNamespaceMember) => ExternalModuleSemanticTarget | null;
};

export const moduleSemanticIdentityKey = (
  identity: DocumentQualifiedSemanticIdentity<StatementIdentity>
) => JSON.stringify([identity.documentId, identity.localIdentity]);
