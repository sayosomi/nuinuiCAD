import type { DslGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import type { DslArrayValueType, DslValueType } from "./dslValueTypes";
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
      kind: "recordCollectionIndex";
      collectionValueId: string;
      collectionLength: number | null;
      targetSourceOrder: number;
      typeIdentity: RecordTypeIdentity;
      index: ModuleScalarExpressionSemantic;
      /** The declaration-backed collection binding whose member is selected. */
      collectionTarget: ModuleScalarSourceTarget;
      source: string;
      referenceSpan: DslSpan;
      nameSpan: DslSpan;
      /** Statically known record members are retained for field-backing
       * resolution. Dynamic indexes are evaluated by the runtime owner. */
      members?: readonly Extract<ModuleRecordSourceTarget, { kind: "recordValue" }>[];
    }
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
  | (ModuleParameterSlot & {
      kind: "collectionParameter";
      valueType: DslArrayValueType;
      optional: boolean;
    })
  | ModuleRecordFieldSourceTarget
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | { kind: "moduleLocal"; statementId: StatementIdentity; statementIndex: number; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | { kind: "documentBinding"; bindingId: BindingId; statementId: StatementIdentity; statementIndex: number; identity?: DocumentQualifiedSemanticIdentity<StatementIdentity> }
  | {
      kind: "collectionValue";
      statementId: StatementIdentity;
      statementIndex: number;
      valueType: DslArrayValueType;
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    }
  | {
      kind: "deferredModuleCollectionExport";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      exportedStatementId: StatementIdentity;
      exportedStatementIndex: number;
      valueType: DslArrayValueType;
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
    }
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
      kind: "collectionIndex";
      collectionValueId: string;
      collectionLength: number | null;
      targetSourceOrder: number;
      elementInterfaceType: ModuleGeometryInterfaceType;
      expectedGeometryKind: "point" | "line";
      expectedInterfaceType?: ModuleGeometryInterfaceType;
      index: ModuleScalarExpressionSemantic;
      source: string;
      referenceSpan: DslSpan;
      nameSpan: DslSpan;
      pointKey?: string;
    }
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
      kind: "geometryValue";
      statementId: StatementIdentity;
      statementIndex: number;
      declaredInterfaceType: ModuleGeometryInterfaceType;
      /** Reference aliases retain their resolved backing target. A pure
       * construction has no drawable/source backing target and carries null. */
      backingTarget: ModuleGeometrySourceTarget | null;
      ownerModuleDefinitionStatementId?: StatementIdentity | null;
      ownerModuleDefinitionStatementIndex?: number | null;
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

export const unwrapModuleGeometrySourceTarget = (target: ModuleGeometrySourceTarget): {
  target: ModuleGeometrySourceTarget;
  pointKey?: string;
} => {
  let current = target;
  let pointKey = target.pointKey;
  while (current.kind === "geometryValue") {
    pointKey ??= current.pointKey;
    if (!current.backingTarget) break;
    current = current.backingTarget;
  }
  pointKey ??= current.pointKey;
  return { target: current, ...(pointKey ? { pointKey } : {}) };
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
  | {
      kind: "collectionValueLength";
      statementId: StatementIdentity;
      statementIndex: number;
      valueId: string;
      valueType: DslArrayValueType;
      length: number | null;
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    }
  | (ModuleParameterSlot & {
      kind: "collectionParameterLength";
      valueType: DslArrayValueType;
      optional: boolean;
    })
  | {
      kind: "deferredModuleCollectionExportLength";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      exportedStatementId: StatementIdentity;
      exportedStatementIndex: number;
      valueType: DslArrayValueType;
      referenceSpan: DslSpan;
      instanceSpan: DslSpan;
      memberSpan: DslSpan;
      instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
      exportedIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    }
  | (ModuleParameterSlot & { kind: "parameterProperty"; geometryKind: "point" | "line"; property: string; pointKey?: string })
  | {
      kind: "geometryValueProperty";
      statementId: StatementIdentity;
      statementIndex: number;
      declaredInterfaceType: ModuleGeometryInterfaceType;
      ownerModuleDefinitionStatementId?: StatementIdentity | null;
      ownerModuleDefinitionStatementIndex?: number | null;
      property: string;
      pointKey?: string;
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    }
  | {
      kind: "sourceGeometryProperty";
      statementId: StatementIdentity;
      statementIndex: number;
      category: DslGeometryDeclarationCategory;
      property: string;
      pointKey?: string;
      identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
    }
  | {
      kind: "deferredModuleExportProperty";
      instanceStatementId: StatementIdentity;
      instanceStatementIndex: number;
      instanceName: string;
      exportName: string;
      property: string;
      pointKey?: string;
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
  /** Present only for a collection-index base reference. */
  collectionValueId?: string | null;
  collectionLength?: number | null;
  targetSourceOrder?: number | null;
  collectionElementType?: ScalarType | null;
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

export type ModuleGeometryBezierIntermediateSemantic = {
  span: DslSpan;
  point: ModuleGeometryReferenceSemantic;
  angle: ModuleScalarExpressionSemantic | null;
  incomingLength: ModuleScalarExpressionSemantic | null;
  outgoingLength: ModuleScalarExpressionSemantic | null;
};

export type ModuleGeometryConstructionSemantic =
  | {
      kind: "coordinate";
      span: DslSpan;
      x: ModuleScalarExpressionSemantic | null;
      y: ModuleScalarExpressionSemantic | null;
    }
  | {
      kind: "segment";
      span: DslSpan;
      start: ModuleGeometryReferenceSemantic;
      end: ModuleGeometryReferenceSemantic;
    }
  | {
      kind: "arc";
      span: DslSpan;
      center: ModuleGeometryReferenceSemantic;
      radius: ModuleScalarExpressionSemantic | null;
      start: ModuleScalarExpressionSemantic | null;
      end: ModuleScalarExpressionSemantic | null;
      direction: ModuleScalarExpressionSemantic | null;
    }
  | {
      kind: "through";
      span: DslSpan;
      point1: ModuleGeometryReferenceSemantic;
      point2: ModuleGeometryReferenceSemantic;
      point3: ModuleGeometryReferenceSemantic;
      start: ModuleScalarExpressionSemantic | null;
      end: ModuleScalarExpressionSemantic | null;
    }
  | {
      kind: "bezier";
      span: DslSpan;
      start: ModuleGeometryReferenceSemantic;
      end: ModuleGeometryReferenceSemantic;
      startAngle: ModuleScalarExpressionSemantic | null;
      startLength: ModuleScalarExpressionSemantic | null;
      endAngle: ModuleScalarExpressionSemantic | null;
      endLength: ModuleScalarExpressionSemantic | null;
      intermediates: readonly ModuleGeometryBezierIntermediateSemantic[];
    };

export type ModuleGeometryValueSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  identity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  name: string;
  declaredInterfaceType: ModuleGeometryInterfaceType;
  ownerModuleDefinitionStatementId: StatementIdentity | null;
  ownerModuleDefinitionStatementIndex: number | null;
  exported: boolean;
  initializer: ModuleGeometryReferenceSemantic | null;
  construction: ModuleGeometryConstructionSemantic | null;
  backingTarget: ModuleGeometrySourceTarget | null;
};

export type ResolvedModuleParameter = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  definitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  name: string;
  type: DslModuleParameterType | null;
  valueType: DslValueType | null;
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
  | { kind: "record"; reference: ModuleRecordReferenceSemantic }
  | {
      kind: "collection";
      source: string;
      span: DslSpan;
      targetValueId: string;
      valueType: DslArrayValueType;
    };

/** One entry per callee parameter, already in parameter source order. */
export type ResolvedModuleParameterBinding = {
  parameterIndex: number;
  parameterName: string;
  parameterType: DslModuleParameterType | null;
  parameterValueType: DslValueType | null;
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
  category: DslGeometryDeclarationCategory | null;
  interfaceType: ModuleGeometryInterfaceType;
  backingTarget?: ModuleGeometrySourceTarget;
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

export type ResolvedModuleCollectionExport = ResolvedModuleExportBase & {
  kind: "collection";
  valueType: DslArrayValueType;
};

export type ResolvedModuleExport = ResolvedModuleGeometryExport | ResolvedModuleScalarExport | ResolvedModuleRecordExport | ResolvedModuleCollectionExport;

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
  localGeometryValues: readonly ModuleGeometryValueSemantic[];
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
  /** Source-only immutable single-geometry values, including Module locals. */
  geometryValues: readonly ModuleGeometryValueSemantic[];
  geometryValuesByStatementId: ReadonlyMap<StatementIdentity, ModuleGeometryValueSemantic>;
  geometryValuesByStatementIndex: ReadonlyMap<number, ModuleGeometryValueSemantic>;
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
