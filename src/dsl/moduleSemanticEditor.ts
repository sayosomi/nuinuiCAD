import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import { physicalSpanForLogicalRange } from "./logicalStatementSourceMap";
import type { CompiledDslDocument } from "./dslDocument";
import type {
  ModuleGeometrySourceTarget,
  ModuleParameterSlot,
  ModuleSourceTarget,
  ModuleSemanticAnalysis
} from "./moduleSemanticTypes";
import type { DslSpan } from "./dslTypes";
import type { StatementIdentity } from "../document/statementIdentity";

/** Source identity used by editor operations. It deliberately contains no
 * runtime element id and no name-derived registry key. */
export type ModuleSemanticTarget =
  | { kind: "moduleDefinition"; statementId: StatementIdentity }
  | { kind: "moduleParameter"; slot: ModuleParameterSlot }
  | { kind: "moduleInstance"; statementId: StatementIdentity }
  | { kind: "moduleSource"; statementId: StatementIdentity };

export type ModuleSemanticToken = {
  from: number;
  to: number;
  target: ModuleSemanticTarget;
};

export type ModuleSemanticRangeIndex = {
  tokens: readonly ModuleSemanticToken[];
  declarationByTarget: ReadonlyMap<string, ModuleSemanticToken>;
};

export const moduleSemanticTargetKey = (target: ModuleSemanticTarget): string => {
  if (target.kind === "moduleParameter") {
    return `parameter:${target.slot.definitionStatementId}:${target.slot.parameterIndex}`;
  }
  return `${target.kind}:${target.statementId}`;
};

const sourceTarget = (target: ModuleSourceTarget | null): ModuleSemanticTarget | null => {
  if (!target) return null;
  if (target.kind === "parameter" || target.kind === "parameterProperty") {
    return { kind: "moduleParameter", slot: {
      definitionStatementId: target.definitionStatementId,
      parameterIndex: target.parameterIndex
    }};
  }
  if (target.kind === "sourceGeometry" || target.kind === "sourceGeometryProperty" || target.kind === "moduleLocal") {
    return { kind: "moduleSource", statementId: target.statementId };
  }
  if (target.kind === "elementLocalVariable" || target.kind === "iteration") return { kind: "moduleSource", statementId: target.statementId };
  return null;
};

const scalarReferenceSpan = (span: DslSpan, name: string): DslSpan => ({ start: span.end - name.length, end: span.end });
const geometryPropertyReferenceSpan = (span: DslSpan, geometryName: string, property: string): DslSpan => ({
  start: span.end - property.length - geometryName.length,
  end: span.end - property.length
});

const projectedSpan = (compiled: CompiledDslDocument, statementIndex: number, span: DslSpan): DslPhysicalSpan | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const logical = compiled.spans.sourceMap.statements.find((candidate) => candidate.range.from === statement.documentRange.from);
  return logical ? physicalSpanForLogicalRange(compiled.spans.sourceMap, logical, span) : null;
};

const statementIndexById = (compiled: CompiledDslDocument) => {
  const result = new Map<StatementIdentity, number>();
  for (const [index, id] of compiled.statementMap?.statementIdByStatementIndex ?? []) result.set(id, index);
  return result;
};

const nameSpanFor = (compiled: CompiledDslDocument, statementIndex: number): DslPhysicalSpan | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement?.nameSpan) return null;
  return statement.namePhysicalSpan ?? projectedSpan(compiled, statementIndex, statement.nameSpan);
};

/** Build the editor view of the already-compiled module semantics. */
export const createModuleSemanticRangeIndex = (compiled: CompiledDslDocument): ModuleSemanticRangeIndex => {
  const analysis = compiled.moduleSemanticAnalysis;
  const tokens: ModuleSemanticToken[] = [];
  const declarations = new Map<string, ModuleSemanticToken>();
  if (!analysis || !compiled.statementMap) return { tokens, declarationByTarget: declarations };
  const indexById = statementIndexById(compiled);
  const add = (statementIndex: number, span: DslSpan | null | undefined, target: ModuleSemanticTarget, declaration = false) => {
    if (!span) return;
    const physical = projectedSpan(compiled, statementIndex, span);
    if (!physical || physical.segments.length !== 1) return;
    const segment = physical.segments[0];
    const token = { from: segment.from, to: segment.to, target };
    tokens.push(token);
    if (declaration) declarations.set(moduleSemanticTargetKey(target), token);
  };
  const addPhysical = (span: DslPhysicalSpan | null | undefined, target: ModuleSemanticTarget, declaration = false) => {
    if (!span || span.segments.length !== 1) return;
    const segment = span.segments[0];
    const token = { from: segment.from, to: segment.to, target };
    tokens.push(token);
    if (declaration) declarations.set(moduleSemanticTargetKey(target), token);
  };
  const addSourceTarget = (statementIndex: number, target: ModuleSourceTarget | null, span: DslSpan | null | undefined) => {
    const editorTarget = sourceTarget(target);
    if (editorTarget) add(statementIndex, span, editorTarget);
  };

  for (const definition of analysis.definitions) {
    const statementIndex = indexById.get(definition.statementId);
    if (statementIndex === undefined) continue;
    addPhysical(nameSpanFor(compiled, statementIndex), { kind: "moduleDefinition", statementId: definition.statementId }, true);
    const statement = compiled.statements[statementIndex];
    if (statement.kind === "moduleDefinition") {
      definition.parameters.forEach((parameter, parameterIndex) => {
        const parsed = statement.parameters[parameterIndex];
        addPhysical(parsed?.namePhysicalSpan, { kind: "moduleParameter", slot: {
          definitionStatementId: definition.statementId,
          parameterIndex
        }}, true);
        if (parameter.defaultExpression) {
          for (const reference of parameter.defaultExpression.references) addSourceTarget(statementIndex, reference.target, scalarReferenceSpan(reference.span, reference.name));
          for (const reference of parameter.defaultExpression.geometryProperties) addSourceTarget(statementIndex, reference.target, geometryPropertyReferenceSpan(reference.span, reference.geometryName, reference.property));
        }
      });
    }
    for (const body of definition.bodyStatements) addBodyReferences(compiled, body.statementIndex, body, add, addSourceTarget);
  }
  for (const declaration of compiled.sourceLexicalNamespace?.allDeclarations ?? []) {
    if (declaration.kind !== "geometry" && declaration.kind !== "typedDeclaration") continue;
    if (!isModuleBodyStatementId(analysis, declaration.statementId)) continue;
    const statement = compiled.statements[declaration.statementIndex];
    if (statement?.nameSpan) addPhysical(nameSpanFor(compiled, declaration.statementIndex), {
      kind: "moduleSource", statementId: declaration.statementId
    }, true);
  }
  for (const instance of analysis.instances) {
    const statementIndex = indexById.get(instance.statementId);
    if (statementIndex === undefined) continue;
    addPhysical(nameSpanFor(compiled, statementIndex), { kind: "moduleInstance", statementId: instance.statementId }, true);
    const statement = compiled.statements[statementIndex];
    if (statement.kind !== "moduleInstance") continue;
    if (instance.callee && statement.moduleNameSpan) {
      add(statementIndex, statement.moduleNameSpan, { kind: "moduleDefinition", statementId: instance.callee.definitionStatementId });
    }
    for (const binding of instance.parameterBindings) {
      const argument = binding.argumentIndex === null ? null : statement.arguments[binding.argumentIndex];
      if (argument?.labelSpan && instance.callee) add(statementIndex, argument.labelSpan, { kind: "moduleParameter", slot: {
        definitionStatementId: instance.callee.definitionStatementId,
        parameterIndex: binding.parameterIndex
      }});
      if (binding.value?.kind === "scalar") {
        for (const reference of binding.value.expression.references) addSourceTarget(statementIndex, reference.target, scalarReferenceSpan(reference.span, reference.name));
        for (const reference of binding.value.expression.geometryProperties) addSourceTarget(statementIndex, reference.target, geometryPropertyReferenceSpan(reference.span, reference.geometryName, reference.property));
      } else if (binding.value?.kind === "geometry") {
        addGeometryReference(compiled, statementIndex, binding.value.reference, add, addSourceTarget);
      }
    }
  }
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = indexById.get(statementId);
    if (statementIndex === undefined) continue;
    for (const site of references) addGeometryReference(compiled, statementIndex, site.reference, add, addSourceTarget);
  }
  tokens.sort((a, b) => a.from - b.from || b.to - a.to);
  return { tokens, declarationByTarget: declarations };
};

const isModuleBodyStatementId = (analysis: ModuleSemanticAnalysis, statementId: StatementIdentity) =>
  analysis.definitions.some((definition) => definition.bodyStatementIds.includes(statementId));

const addGeometryReference = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  reference: { span: DslSpan; target: ModuleGeometrySourceTarget | null },
  add: (statementIndex: number, span: DslSpan | null | undefined, target: ModuleSemanticTarget, declaration?: boolean) => void,
  addSourceTarget: (statementIndex: number, target: ModuleSourceTarget | null, span: DslSpan | null | undefined) => void
) => {
  if (reference.target?.kind === "deferredModuleExport") {
    const analysis = compiled.moduleSemanticAnalysis;
    if (!analysis) return;
    const deferred = reference.target;
    const target = analysis.instancesByStatementId.get(deferred.instanceStatementId);
    const exportTarget = target?.callee && analysis.definitionsByStatementId
      .get(target.callee.definitionStatementId)?.exports.find((item) => item.name === deferred.exportName);
    if (exportTarget) add(statementIndex, deferred.memberSpan, { kind: "moduleSource", statementId: exportTarget.exportedStatementId });
    const instanceStart = deferred.memberSpan.start - deferred.instanceName.length - 2;
    if (instanceStart >= 0) add(statementIndex, { start: instanceStart, end: instanceStart + deferred.instanceName.length }, {
      kind: "moduleInstance", statementId: deferred.instanceStatementId
    });
    return;
  }
  if (reference.target?.kind === "parameter") {
    const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(reference.target.definitionStatementId);
    const name = definition?.parameters[reference.target.parameterIndex]?.name;
    if (name) return addSourceTarget(statementIndex, reference.target, scalarReferenceSpan(reference.span, name));
  }
  addSourceTarget(statementIndex, reference.target, reference.span);
};

const addBodyReferences = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  body: ModuleSemanticAnalysis["definitions"][number]["bodyStatements"][number],
  add: (statementIndex: number, span: DslSpan | null | undefined, target: ModuleSemanticTarget, declaration?: boolean) => void,
  addSourceTarget: (statementIndex: number, target: ModuleSourceTarget | null, span: DslSpan | null | undefined) => void
) => {
  for (const site of body.scalarExpressions) {
    for (const reference of site.expression.references) {
      const target = sourceTarget(reference.target);
      if (target?.kind === "moduleParameter") add(statementIndex, { start: reference.span.end - reference.name.length, end: reference.span.end }, target);
      else addSourceTarget(statementIndex, reference.target, { start: reference.span.end - reference.name.length, end: reference.span.end });
    }
    for (const reference of site.expression.geometryProperties) addSourceTarget(statementIndex, reference.target, geometryPropertyReferenceSpan(reference.span, reference.geometryName, reference.property));
  }
  for (const site of body.geometryReferences) addGeometryReference(compiled, statementIndex, site.reference, add, addSourceTarget);
  for (const site of body.textTemplateHoles) for (const reference of site.expression.references) {
    const target = sourceTarget(reference.target);
    const span = { start: reference.span.end - reference.name.length, end: reference.span.end };
    if (target?.kind === "moduleParameter") add(statementIndex, span, target); else addSourceTarget(statementIndex, reference.target, span);
  }
  if (body.scalarTarget) {
    const target = sourceTarget(body.scalarTarget);
    const statement = compiled.statements[statementIndex];
    if (target && statement?.nameSpan) add(statementIndex, statement.nameSpan, target);
  }
};

export const moduleSemanticTargetAt = (index: ModuleSemanticRangeIndex, position: number): ModuleSemanticTarget | null => {
  const candidates = index.tokens.filter((token) => position >= token.from && position <= token.to);
  return candidates.sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]?.target ?? null;
};

export const moduleSemanticDeclarationRange = (index: ModuleSemanticRangeIndex, target: ModuleSemanticTarget) =>
  index.declarationByTarget.get(moduleSemanticTargetKey(target)) ?? null;
