import type { DslGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarType } from "../scalars/types";
import type { BindingId } from "../scalars/bindingCatalog";
import type { StatementIdentity } from "../document/statementIdentity";
import type { ScopeId } from "../scalars/lexicalScopeIndex";

export type ModuleParameterSlot = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
};

export type ModuleScalarSourceTarget =
  | (ModuleParameterSlot & { kind: "parameter" })
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string }
  | { kind: "moduleLocal"; statementId: StatementIdentity; statementIndex: number }
  | { kind: "documentBinding"; bindingId: BindingId; statementId: StatementIdentity; statementIndex: number };

export type ModuleGeometrySourceTarget =
  | (ModuleParameterSlot & { kind: "parameter"; geometryKind: "point" | "line" })
  | {
      kind: "sourceGeometry";
      statementId: StatementIdentity;
      statementIndex: number;
      category: DslGeometryDeclarationCategory;
      geometryKind: "point" | "line";
    };

export type ModuleSourceTarget = ModuleScalarSourceTarget | ModuleGeometrySourceTarget;

export type ModuleScalarReference = {
  name: string;
  span: DslSpan;
  target: ModuleSourceTarget | null;
  resolution: "resolved" | "undefined" | "forward" | "outerCapture" | "invalid";
};

export type ModuleScalarExpressionSemantic = {
  ast: ScalarExpressionAst;
  type: ScalarType | null;
  references: readonly ModuleScalarReference[];
};

export type ModuleGeometryReferenceSemantic = {
  source: string;
  span: DslSpan;
  target: ModuleGeometrySourceTarget | null;
};

export type ResolvedModuleParameter = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  required: boolean;
  defaultValue: string | null;
  defaultSpan: DslSpan | null;
  defaultExpression: ModuleScalarExpressionSemantic | null;
};

export type ModuleArgumentSemantic =
  | { kind: "scalar"; expression: ModuleScalarExpressionSemantic }
  | { kind: "geometry"; reference: ModuleGeometryReferenceSemantic };

/** One entry per callee parameter, already in parameter source order. */
export type ResolvedModuleParameterBinding = {
  parameterIndex: number;
  parameterName: string;
  parameterType: DslModuleParameterType | null;
  argumentIndex: number | null;
  argumentLabel: string | null;
  argumentSpan: DslSpan | null;
  usesDefault: boolean;
  value: ModuleArgumentSemantic | null;
};

export type ResolvedModuleExport = {
  ownerModuleDefinitionStatementId: StatementIdentity;
  exportedStatementId: StatementIdentity;
  exportedStatementIndex: number;
  sourceOrder: number;
  name: string;
  category: DslGeometryDeclarationCategory;
};

export type ModuleScalarExpressionSite = {
  parameterKey: string | null;
  span: DslSpan;
  expression: ModuleScalarExpressionSemantic;
};

export type ModuleGeometryReferenceSite = {
  parameterKey: string | null;
  span: DslSpan;
  reference: ModuleGeometryReferenceSemantic;
};

/** Resolved source references attached to one statement in a module body. */
export type ModuleBodyStatementSemantic = {
  statementId: StatementIdentity;
  statementIndex: number;
  statementKind: DslStatement["kind"];
  scalarExpressions: readonly ModuleScalarExpressionSite[];
  geometryReferences: readonly ModuleGeometryReferenceSite[];
  scalarTarget: ModuleScalarSourceTarget | null;
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
