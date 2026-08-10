import { encodeIdentityTuple } from "../document/identityTuple";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { isCompilableDslStatement } from "../dsl/dslCompilationGuard";
import type { DslStatement } from "../dsl/dslTypes";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleInstanceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSemanticAnalysis
} from "../dsl/moduleSemanticTypes";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import type { CadElement, ElementId, NumericValue } from "../types/geometry";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import type { BindingAnalysis, InitializerReference } from "./bindingAnalysis";
import { analyzeBindings } from "./bindingAnalysis";
import {
  buildBindingCatalog,
  type Binding,
  type BindingId,
  type BindingSeed
} from "./bindingCatalog";
import type { BindingControlMetadata } from "./bindingVersions";
import type { SetStatementAnalysis } from "./setStatementCompiler";
import { lowerScalarProgram, type ScalarProgram } from "./scalarProgram";
import type { ScalarType } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { BindingResolution } from "./bindingResolution";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
import { isNumericExpression } from "../geometry/numericExpressions";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import { isAssignableToPropertyCapability } from "./scalarAssignability";
import type { ReconciledCadContainerInput } from "./containerIndex";

export type MaterializedPropertyBindingSource = {
  elementId: ElementId;
  parameterKey: string;
  source: ScalarValueSource;
};

export type MaterializedNumericBindingSource = {
  elementId: ElementId;
  binding: CompiledNumericBinding;
};

export type ModuleScalarRuntimeCompilation = {
  bindingAnalysis: BindingAnalysis;
  scalarProgram: ScalarProgram;
  moduleSetStatements: readonly SetStatementAnalysis[];
  controlByScopeId: ReadonlyMap<string, BindingControlMetadata>;
  scalarExecutionPositionByRuntimeElementId: ReadonlyMap<ElementId, number>;
  scalarExecutionPositionByStatementIndex: ReadonlyMap<number, number>;
  materializedPropertyBindings: readonly MaterializedPropertyBindingSource[];
  materializedNumericBindings: readonly MaterializedNumericBindingSource[];
};

type BindingInfo = {
  id: BindingId;
  declarationVersionId: string;
  name: string;
  type: ScalarType;
  bindingKind: "const" | "let";
  scopeId: string;
  contextKey: string;
  statementId: string;
  statementIndex: number;
  eventOrder?: number;
};

type InstanceContext = {
  key: string;
  path: readonly string[];
  instance: ModuleInstanceSemantic;
  definition: ModuleDefinitionSemantic;
  parentKey: string | null;
  scopeId: string;
  parameters: ReadonlyMap<number, BindingInfo>;
  locals: ReadonlyMap<string, BindingInfo>;
};

type RuntimeEvent =
  | { kind: "binding"; bindingId: BindingId }
  | { kind: "set"; versionId: string }
  | { kind: "element"; elementId: ElementId };

const scalarTypeOf = (type: ModuleDefinitionSemantic["parameters"][number]["type"]): ScalarType | null =>
  type && (type.kind === "number" || type.kind === "string" || type.kind === "boolean" || type.kind === "choice")
    ? type
    : null;

const pathKey = (path: readonly string[]) => encodeIdentityTuple(["instance", ...path]);

const bindingIdFor = (kind: "parameter" | "local", context: InstanceContext, discriminator: string) =>
  `module-binding:${encodeIdentityTuple([kind, ...context.path, context.definition.statementId, discriminator])}`;

const declarationVersionIdFor = (kind: "parameter" | "local", context: InstanceContext, discriminator: string) =>
  `module-declaration:${encodeIdentityTuple([kind, ...context.path, context.definition.statementId, discriminator])}`;

const setVersionIdFor = (context: InstanceContext, statementId: string) =>
  `module-set:${encodeIdentityTuple([...context.path, context.definition.statementId, statementId])}`;

const remapDocumentReference = (reference: InitializerReference, bindingsById: ReadonlyMap<BindingId, Binding>): InitializerReference => {
  if (reference.resolution.kind !== "resolved") return reference;
  const binding = bindingsById.get(reference.resolution.binding.id);
  if (!binding) throw new Error(`moduleScalarRuntime: document binding ${reference.resolution.binding.id} disappeared`);
  return { ...reference, resolution: { kind: "resolved", binding } };
};

const bindingResolutionFor = (binding: Binding | undefined, name: string, statementIndex: number): BindingResolution =>
  binding
    ? { kind: "resolved", binding }
    : { kind: "undefined", name, scopeId: "module-runtime", statementIndex };

const semanticReferencesUsedByAst = (semantic: ModuleScalarExpressionSemantic) => {
  const astReferences = collectScalarExpressionReferences(semantic.ast);
  return semantic.references.filter((reference) =>
    astReferences.some((astReference) => astReference.span.start === reference.span.start)
  );
};

const lowerExpression = (
  semantic: ModuleScalarExpressionSemantic,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  catalogBindings: ReadonlyMap<BindingId, Binding>
): { expression: TypedScalarExpression; references: InitializerReference[] } => {
  const references = semanticReferencesUsedByAst(semantic);
  const resolutions = references.map((reference) => bindingResolutionFor(
    reference.target && ["parameter", "moduleLocal", "documentBinding"].includes(reference.target.kind)
      ? bindingForTarget(reference.target as ModuleScalarSourceTarget, reference.name, reference.span.start)
      : undefined,
    reference.name,
    reference.span.start
  ));
  const checked = typecheckScalarExpression(semantic.ast, {
    expectedType: semantic.type,
    references: resolutions
  });
  const initializerReferences: InitializerReference[] = references.map((reference, index) => ({
    fromBindingId: "",
    occurrenceIndex: index,
    name: reference.name,
    span: reference.span,
    resolution: resolutions[index]
  }));
  // The caller fills fromBindingId after the owning binding is known. Keep a
  // catalog touch here so a missing target fails at the same lowering boundary
  // rather than being rediscovered by a runtime name lookup.
  for (const resolution of resolutions) {
    if (resolution.kind === "resolved" && !catalogBindings.has(resolution.binding.id)) {
      throw new Error(`moduleScalarRuntime: lowered reference ${resolution.binding.id} is not in the combined catalog`);
    }
  }
  return { expression: checked.typed, references: initializerReferences };
};

const elementForBody = (
  materialization: ModuleMaterialization,
  path: readonly string[],
  sourceStatementId: string
): { elementId: ElementId; statement: DslStatement } | undefined => {
  const entry = materialization.executionStatements.find((candidate) =>
    candidate.origin?.kind === "moduleBody" &&
    candidate.origin.sourceStatementId === sourceStatementId &&
    pathKey(candidate.instancePath) === pathKey(path)
  );
  return entry ? { elementId: entry.runtimeElementId, statement: entry.statement } : undefined;
};

const instanceElement = (
  materialization: ModuleMaterialization,
  path: readonly string[]
): ElementId | undefined => materialization.executionStatements.find((entry) =>
  entry.origin?.kind === "moduleInstance" && pathKey(entry.instancePath) === pathKey(path)
)?.runtimeElementId;

const scalarValueExpression = (element: CadElement, parameterKey: string): Extract<NumericValue, { kind: "expression" }> | undefined => {
  const value = getParameterValue(element, parameterKey) as NumericValue | undefined;
  return value !== undefined && isNumericExpression(value) ? value : undefined;
};

const propertySourceFor = (
  element: CadElement,
  parameterKey: string,
  semantic: ModuleScalarExpressionSemantic,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined
): ScalarValueSource | undefined => {
  if (semantic.ast.kind !== "reference" || semantic.references.length !== 1) return undefined;
  const parameter = findParameterDefinition(element, parameterKey);
  const capability = parameter?.propertyCapability;
  const target = semantic.references[0].target;
  if (!capability || !target || !["parameter", "moduleLocal", "documentBinding"].includes(target.kind)) return undefined;
  const binding = bindingForTarget(target as ModuleScalarSourceTarget, semantic.references[0].name, semantic.references[0].span.start);
  if (!binding || !binding.declaredType || !isAssignableToPropertyCapability(binding.declaredType, capability)) return undefined;
  return {
    kind: "binding",
    bindingId: binding.id,
    type: binding.declaredType,
    span: semantic.references[0].span,
    nameSpan: { start: semantic.references[0].span.start + 1, end: semantic.references[0].span.end },
    name: semantic.references[0].name
  };
};

const numericSourceFor = (
  element: CadElement,
  parameterKey: string,
  semantic: ModuleScalarExpressionSemantic,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined
): CompiledNumericBinding | undefined => {
  const value = scalarValueExpression(element, parameterKey);
  if (!value || semantic.type?.kind !== "number") return undefined;
  const matches = scanExpressionReferences(value.expression).filter((match) => match.kind === "binding");
  const references = semanticReferencesUsedByAst(semantic);
  if (matches.length !== references.length) return undefined;
  const compiledReferences = matches.map((match, index) => {
    const reference = references[index];
    const target = reference.target;
    const binding = target && ["parameter", "moduleLocal", "documentBinding"].includes(target.kind)
      ? bindingForTarget(target as ModuleScalarSourceTarget, reference.name, reference.span.start)
      : undefined;
    if (!binding) return null;
    return {
      bindingId: binding.id,
      name: reference.name,
      span: reference.span,
      nameSpan: { start: reference.span.start + 1, end: reference.span.end },
      physicalNameSpan: null,
      expressionStart: match.from,
      expressionEnd: match.to,
      site: { scopeId: "module-runtime", statementIndex: reference.span.start }
    };
  });
  if (compiledReferences.some((reference) => reference === null)) return undefined;
  return {
    parameterKey,
    expression: value.expression,
    references: compiledReferences as NonNullable<typeof compiledReferences[number]>[]
  };
};

/**
 * Lowers Task 3 module scalar targets into the ordinary typed scalar
 * catalog/program/version graph. It deliberately receives semantic targets
 * and materialized identities; it never performs a second lexical lookup.
 */
export const compileModuleScalarRuntime = ({
  statements,
  stableStatementIdByIndex,
  moduleSemanticAnalysis,
  moduleMaterialization,
  documentBindingAnalysis,
  documentScalarProgram,
  reconciledContainers,
  includeStatement,
  elements
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  documentBindingAnalysis?: BindingAnalysis;
  documentScalarProgram?: ScalarProgram;
  reconciledContainers: ReconciledCadContainerInput;
  includeStatement?: (statement: DslStatement, statementIndex: number) => boolean;
  elements: readonly CadElement[];
}): ModuleScalarRuntimeCompilation => {
  const include = includeStatement ?? ((_statement, index) => isCompilableDslStatement(statements, index));
  const baseScopeIndex = documentBindingAnalysis?.catalog.scopeIndex ?? buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex, include);
  const adapter = buildDslBindingAdapterSeeds({
    statements,
    scopeIndex: baseScopeIndex,
    stableStatementIdByIndex,
    reconciledContainers
  });
  const baseCatalog = documentBindingAnalysis?.catalog ?? buildBindingCatalog({
    scopeIndex: baseScopeIndex,
    stableStatementIdByIndex,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });

  const contextsByKey = new Map<string, InstanceContext>();
  const allBindingInfos: BindingInfo[] = [];
  const registerInstance = (instance: ModuleInstanceSemantic, parentPath: readonly string[], parentKey: string | null): InstanceContext | undefined => {
    if (!instance.callee) return undefined;
    const path = [...parentPath, instance.statementId];
    const key = pathKey(path);
    const existing = contextsByKey.get(key);
    if (existing) return existing;
    const definition = moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) return undefined;
    const scopeId = `module-instance-scope:${encodeIdentityTuple([...path, definition.bodyScopeId])}`;
    const parameters = new Map<number, BindingInfo>();
    const locals = new Map<string, BindingInfo>();
    const context = { key, path, instance, definition, parentKey, scopeId, parameters, locals } as InstanceContext;
    for (const parameter of definition.parameters) {
      const type = scalarTypeOf(parameter.type);
      if (!type) continue;
      const id = bindingIdFor("parameter", context, String(parameter.parameterIndex));
      const info: BindingInfo = {
        id,
        declarationVersionId: declarationVersionIdFor("parameter", context, String(parameter.parameterIndex)),
        name: parameter.name,
        type,
        bindingKind: "const",
        scopeId,
        contextKey: key,
        statementId: definition.statementId,
        statementIndex: instance.statementIndex
      };
      parameters.set(parameter.parameterIndex, info);
      allBindingInfos.push(info);
    }
    for (const local of definition.localScalars) {
      if (!local.type || (local.type.kind !== "number" && local.type.kind !== "string" && local.type.kind !== "boolean" && local.type.kind !== "choice")) continue;
      const info: BindingInfo = {
        id: bindingIdFor("local", context, local.statementId),
        declarationVersionId: declarationVersionIdFor("local", context, local.statementId),
        name: local.name,
        type: local.type,
        bindingKind: local.bindingKind,
        scopeId,
        contextKey: key,
        statementId: local.statementId,
        statementIndex: local.statementIndex
      };
      locals.set(local.statementId, info);
      allBindingInfos.push(info);
    }
    contextsByKey.set(key, context);
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "moduleInstance") continue;
      const nested = moduleSemanticAnalysis.instancesByStatementId.get(body.statementId);
      if (nested) registerInstance(nested, path, key);
    }
    return context;
  };

  for (const instance of moduleSemanticAnalysis.instances) {
    if (instance.callerModuleDefinitionStatementId === null) registerInstance(instance, [], null);
  }

  const bindingInfoById = new Map(allBindingInfos.map((info) => [info.id, info] as const));
  const bindingInfoForTarget = (target: ModuleScalarSourceTarget, current: InstanceContext): BindingInfo | undefined => {
    if (target.kind === "documentBinding") return bindingInfoById.get(target.bindingId);
    const contextCandidates: InstanceContext[] = [];
    let cursor: InstanceContext | undefined = current;
    while (cursor) {
      contextCandidates.push(cursor);
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    if (target.kind === "parameter") {
      return contextCandidates.find((candidate) => candidate.definition.statementId === target.definitionStatementId)
        ?.parameters.get(target.parameterIndex);
    }
    if (target.kind === "moduleLocal") {
      return contextCandidates.find((candidate) => candidate.locals.has(target.statementId))
        ?.locals.get(target.statementId);
    }
    return undefined;
  };

  const events: RuntimeEvent[] = [];
  const eventOrderByBindingId = new Map<BindingId, number>();
  const eventOrderByVersionId = new Map<string, number>();
  const eventOrderByStatementIndex = new Map<number, number>();
  const elementOrderById = new Map<ElementId, number>();
  const scopeExitOrderById = new Map<string, number>();
  let evaluationLimitSourceOrder: number | undefined;
  const pushEvent = (event: RuntimeEvent, sourceStatementIndex?: number) => {
    const order = events.length;
    events.push(event);
    if (sourceStatementIndex !== undefined && !eventOrderByStatementIndex.has(sourceStatementIndex)) {
      eventOrderByStatementIndex.set(sourceStatementIndex, order);
    }
    if (event.kind === "binding") eventOrderByBindingId.set(event.bindingId, order);
    if (event.kind === "set") eventOrderByVersionId.set(event.versionId, order);
    if (event.kind === "element") elementOrderById.set(event.elementId, order);
  };

  const bodyRuntimeEntry = (context: InstanceContext, body: ModuleBodyStatementSemantic) =>
    elementForBody(moduleMaterialization, context.path, body.statementId);

  const emitInstance = (context: InstanceContext) => {
    const start = events.length;
    const runtimeId = instanceElement(moduleMaterialization, context.path);
    if (runtimeId) pushEvent({ kind: "element", elementId: runtimeId }, context.instance.statementIndex);
    for (const parameter of context.definition.parameters) {
      const info = context.parameters.get(parameter.parameterIndex);
      if (info) pushEvent({ kind: "binding", bindingId: info.id }, context.instance.statementIndex);
    }
    for (const body of context.definition.bodyStatements) {
      if (body.statementKind === "typedDeclaration") {
        const info = context.locals.get(body.statementId);
        if (info) pushEvent({ kind: "binding", bindingId: info.id }, body.statementIndex);
      } else if (body.statementKind === "set") {
        const versionId = setVersionIdFor(context, body.statementId);
        pushEvent({ kind: "set", versionId }, body.statementIndex);
      } else if (body.statementKind === "moduleInstance") {
        const nested = contextsByKey.get(pathKey([...context.path, body.statementId]));
        if (nested) emitInstance(nested);
      } else {
        const runtime = bodyRuntimeEntry(context, body);
        if (runtime) pushEvent({ kind: "element", elementId: runtime.elementId }, body.statementIndex);
      }
    }
    scopeExitOrderById.set(context.scopeId, Math.max(start, events.length));
  };

  for (const [statementIndex, statement] of statements.entries()) {
    if (!include(statement, statementIndex)) continue;
    if (statement.kind === "atStop") {
      evaluationLimitSourceOrder ??= events.length;
      if (!eventOrderByStatementIndex.has(statementIndex)) {
        eventOrderByStatementIndex.set(statementIndex, events.length);
      }
      continue;
    }
    if (statement.kind === "moduleDefinition") continue;
    if (statement.kind === "moduleInstance") {
      const context = contextsByKey.get(pathKey([stableStatementIdByIndex.get(statementIndex)!]));
      if (context) emitInstance(context);
      continue;
    }
    if (statement.kind === "typedDeclaration" || statement.kind === "set") {
      const stableId = stableStatementIdByIndex.get(statementIndex);
      const binding = baseCatalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.statementIndex === statementIndex && candidate.id === `binding:${stableId}`);
      if (statement.kind === "typedDeclaration" && binding) pushEvent({ kind: "binding", bindingId: binding.id }, statementIndex);
      if (statement.kind === "set") {
        const setId = stableId;
        if (setId) pushEvent({ kind: "set", versionId: setId }, statementIndex);
      }
      continue;
    }
    const elementId = moduleMaterialization.elementIdBySourceStatementIndex.get(statementIndex);
    if (elementId) pushEvent({ kind: "element", elementId }, statementIndex);
  }

  for (const entry of moduleMaterialization.executionStatements) {
    if (!elementOrderById.has(entry.runtimeElementId)) {
      pushEvent({ kind: "element", elementId: entry.runtimeElementId }, entry.sourceStatementIndex);
    }
  }

  for (const info of allBindingInfos) info.eventOrder = eventOrderByBindingId.get(info.id);
  const moduleSeeds: BindingSeed[] = allBindingInfos.flatMap<BindingSeed>((info) => info.eventOrder === undefined ? [] : [{
    id: info.id,
    kind: "typed" as const,
    name: info.name,
    nameSpan: null,
    statementIndex: info.statementIndex,
    sourceOrder: info.eventOrder,
    effectiveScopeId: info.scopeId,
    visibility: { kind: "typed", scopeId: info.scopeId } as BindingSeed["visibility"],
    mutability: info.bindingKind === "let" ? "let" as const : "const" as const,
    declaredType: info.type,
    declarationVersionId: info.declarationVersionId
  }]);
  const iterationSeeds = baseCatalog.bindings.filter((binding) => binding.kind === "iteration").map((binding) => ({
    id: binding.id,
    kind: "iteration" as const,
    name: binding.name,
    nameSpan: binding.nameSpan,
    statementIndex: binding.statementIndex,
    sourceOrder: 0,
    effectiveScopeId: binding.effectiveScopeId,
    visibility: binding.visibility as Extract<BindingSeed["visibility"], { kind: "iteration" }>,
    mutability: binding.mutability,
    declaredType: binding.declaredType
  }));
  const combinedCatalog = buildBindingCatalog({
    scopeIndex: baseCatalog.scopeIndex,
    stableStatementIdByIndex,
    iterationBindings: iterationSeeds,
    additionalBindings: moduleSeeds,
    containerIndex: baseCatalog.containerIndex
  });
  const bindingsById = combinedCatalog.bindingsById;
  const resolvedBindingForContext = (target: ModuleScalarSourceTarget, context: InstanceContext): Binding | undefined => {
    if (target.kind === "documentBinding") return bindingsById.get(target.bindingId);
    const info = bindingInfoForTarget(target, context);
    return info ? bindingsById.get(info.id) : undefined;
  };
  const moduleInitializers = new Map<BindingId, TypedScalarExpression>();
  const moduleReferences: InitializerReference[] = [];
  const lowerForContext = (semantic: ModuleScalarExpressionSemantic, context: InstanceContext, ownerBindingId: BindingId) => {
    const lowered = lowerExpression(
      semantic,
      (target) => resolvedBindingForContext(target, context),
      bindingsById
    );
    moduleInitializers.set(ownerBindingId, lowered.expression);
    for (const reference of lowered.references) moduleReferences.push({ ...reference, fromBindingId: ownerBindingId });
  };

  for (const context of contextsByKey.values()) {
    for (const parameter of context.definition.parameters) {
      const info = context.parameters.get(parameter.parameterIndex);
      const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (!info || !binding || binding.value?.kind !== "scalar") continue;
      lowerForContext(binding.value.expression, context, info.id);
    }
    for (const local of context.definition.localScalars) {
      const info = context.locals.get(local.statementId);
      if (info && local.initializer) lowerForContext(local.initializer, context, info.id);
    }
  }

  const moduleSets: SetStatementAnalysis[] = [];
  const materializedPropertyBindings: MaterializedPropertyBindingSource[] = [];
  const materializedNumericBindings: MaterializedNumericBindingSource[] = [];
  for (const context of contextsByKey.values()) {
    for (const body of context.definition.bodyStatements) {
      if (body.statementKind === "set") {
        const statement = statements[body.statementIndex];
        const info = body.scalarTarget?.kind === "moduleLocal" ? bindingInfoForTarget(body.scalarTarget, context) : undefined;
        const semantic = body.scalarExpressions[0]?.expression;
        const order = eventOrderByVersionId.get(setVersionIdFor(context, body.statementId));
        if (statement?.kind === "set" && info && semantic && order !== undefined) {
          const lowered = lowerExpression(semantic, (target) => resolvedBindingForContext(target, context), bindingsById);
          moduleSets.push({
            statementId: body.statementId,
            versionId: setVersionIdFor(context, body.statementId),
            sourceOrder: order,
            scopeId: context.scopeId,
            targetBindingId: info.id,
            targetName: statement.name,
            targetSpan: statement.nameSpan ?? statement.keywordSpan,
            expressionSpan: statement.payloadSpans.expression ?? statement.keywordSpan,
            expression: lowered.expression
          });
        }
      }
      const runtime = bodyRuntimeEntry(context, body);
      if (!runtime || (body.statementKind !== "element" && body.statementKind !== "group")) continue;
      const element = elements.find((candidate) => candidate.id === runtime.elementId);
      if (!element) continue;
      for (const site of body.scalarExpressions) {
        if (site.parameterKey === null) continue;
        const property = propertySourceFor(element, site.parameterKey, site.expression, (target) => resolvedBindingForContext(target, context));
        if (property) materializedPropertyBindings.push({ elementId: runtime.elementId, parameterKey: site.parameterKey, source: property });
        const numeric = numericSourceFor(element, site.parameterKey, site.expression, (target) => resolvedBindingForContext(target, context));
        if (numeric) materializedNumericBindings.push({ elementId: runtime.elementId, binding: numeric });
      }
    }
  }

  const documentReferences = (documentBindingAnalysis?.initializerReferences ?? []).map((reference) => remapDocumentReference(reference, bindingsById));
  const combinedReferences = [...documentReferences, ...moduleReferences];
  const combinedAnalysis = analyzeBindings({ catalog: combinedCatalog, initializerReferences: combinedReferences });
  const initializers = new Map<BindingId, TypedScalarExpression>();
  for (const [bindingId, initializer] of documentBindingAnalysis
    ? (documentBindingAnalysis as BindingAnalysis).catalog.bindings
      .filter((binding) => binding.kind === "typed")
      .map((binding) => [binding.id, documentScalarProgram?.statements.find((statement) => statement.bindingId === binding.id)?.declaration.initializer] as const)
    : []) {
    if (initializer) initializers.set(bindingId, initializer);
  }
  for (const [bindingId, initializer] of moduleInitializers) initializers.set(bindingId, initializer);
  const sourceOrderByBindingId = new Map<BindingId, number>();
  for (const [bindingId, order] of eventOrderByBindingId) sourceOrderByBindingId.set(bindingId, order);
  const scalarProgram = lowerScalarProgram({
    bindingAnalysis: combinedAnalysis,
    typedInitializerByBindingId: initializers,
    positionMap: documentBindingAnalysis?.catalog ? { sourceOrderByElementIndex: [] } : { sourceOrderByElementIndex: [] },
    sourceOrderByBindingId,
    evaluationLimitSourceOrder
  });

  const sourceOrderByStatementIndex = new Map(eventOrderByStatementIndex);
  let nextSourceOrder = events.length;
  for (let statementIndex = statements.length - 1; statementIndex >= 0; statementIndex -= 1) {
    const exactOrder = sourceOrderByStatementIndex.get(statementIndex);
    if (exactOrder !== undefined) nextSourceOrder = exactOrder;
    else sourceOrderByStatementIndex.set(statementIndex, nextSourceOrder);
  }
  moduleSets.sort((left, right) => left.sourceOrder - right.sourceOrder);
  const controlByScopeId = new Map<string, BindingControlMetadata>();
  for (const [scopeId, control] of (documentBindingAnalysis ? new Map<string, BindingControlMetadata>() : new Map<string, BindingControlMetadata>())) controlByScopeId.set(scopeId, control);
  // The document control map is rebuilt by dslDocument with its exact scope
  // metadata. Module scopes are linear, instance-qualified, and never shared.
  for (const context of contextsByKey.values()) {
    const exit = scopeExitOrderById.get(context.scopeId) ?? context.instance.statementIndex + 1;
    controlByScopeId.set(context.scopeId, {
      scopeId: context.scopeId,
      scopeExitSourceOrder: exit,
      ownerChain: [],
      kind: "linear"
    });
  }

  return {
    bindingAnalysis: combinedAnalysis,
    scalarProgram,
    moduleSetStatements: moduleSets,
    controlByScopeId,
    scalarExecutionPositionByRuntimeElementId: elementOrderById,
    scalarExecutionPositionByStatementIndex: sourceOrderByStatementIndex,
    materializedPropertyBindings,
    materializedNumericBindings
  };
};
