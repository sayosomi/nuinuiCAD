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
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScopeId } from "../scalars/lexicalScopeIndex";

/** Source identity used by editor operations. It deliberately contains no
 * runtime element id and no name-derived registry key. */
export type ModuleSemanticTarget =
  | { kind: "moduleDefinition"; statementId: StatementIdentity }
  | { kind: "moduleParameter"; slot: ModuleParameterSlot }
  | { kind: "moduleInstance"; statementId: StatementIdentity }
  | { kind: "moduleSource"; statementId: StatementIdentity }
  | { kind: "moduleElementLocalVariable"; statementId: StatementIdentity; variableIndex: number }
  | { kind: "moduleIteration"; statementId: StatementIdentity }
  | { kind: "documentBinding"; bindingId: BindingId };

export type ModuleSemanticToken = {
  from: number;
  to: number;
  target: ModuleSemanticTarget;
};

export type ModuleSemanticStatementRange = { from: number; to: number };

export type ModuleSemanticScopeRange = {
  scopeId: ScopeId;
  from: number;
  to: number;
  /** Header/closing anchors; edits touching them invalidate live call-site proof. */
  anchors: readonly { from: number; to: number }[];
};

export type ModuleSemanticRangeIndex = {
  tokens: readonly ModuleSemanticToken[];
  declarationByTarget: ReadonlyMap<string, ModuleSemanticToken>;
  /** Existing compiled Module statements usable for completion identity mapping. */
  statementRanges?: ReadonlyMap<number, ModuleSemanticStatementRange>;
  /** Stale-site markers. These survive token replacement/deletion and never
   * authorize completion or semantic identity reuse. */
  staleStatementRanges?: ReadonlyMap<number, ModuleSemanticStatementRange>;
  /** All last-good statement positions, including non-Module anchors used to
   * place a brand-new Module call without fabricating a StatementIdentity. */
  statementAnchors?: ReadonlyMap<number, ModuleSemanticStatementRange & { scopeId: ScopeId }>;
  /** Structural lexical scope ranges used only for safe live call-site proof. */
  lexicalScopeRanges?: readonly ModuleSemanticScopeRange[];
  /** Stable Module definition body scopes used to distinguish Module-owned
   * dirty statements from ordinary document/group statements. */
  moduleBodyScopeIds?: ReadonlySet<ScopeId>;
  /** False after an edit touches a Module/group structural delimiter. */
  moduleStructureStable?: boolean;
};

export const moduleSemanticTargetKey = (target: ModuleSemanticTarget): string => {
  if (target.kind === "moduleParameter") {
    return `parameter:${target.slot.definitionStatementId}:${target.slot.parameterIndex}`;
  }
  if (target.kind === "documentBinding") return `documentBinding:${target.bindingId}`;
  if (target.kind === "moduleElementLocalVariable") return `elementLocal:${target.statementId}:${target.variableIndex}`;
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
  if (target.kind === "elementLocalVariable") return { kind: "moduleElementLocalVariable", statementId: target.statementId, variableIndex: target.variableIndex };
  if (target.kind === "iteration") return { kind: "moduleIteration", statementId: target.statementId };
  if (target.kind === "documentBinding") return { kind: "documentBinding", bindingId: target.bindingId };
  return null;
};

const scalarReferenceSpan = (reference: { nameSpan: DslSpan }): DslSpan => reference.nameSpan;

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

const lineStartAt = (source: string, line: number) => {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
    currentLine += 1;
  }
  return offset;
};

const structuralBraceAnchor = (compiled: CompiledDslDocument, statement: CompiledDslDocument["statements"][number], brace: "{" | "}") => {
  const source = compiled.spans.sourceMap.source;
  const inStatement = source.indexOf(brace, statement.documentRange.from);
  if (inStatement >= statement.documentRange.from && inStatement < statement.documentRange.to) {
    return { from: inStatement, to: inStatement + 1 };
  }
  if (brace === "{" && statement.openBraceLine !== undefined) {
    const lineFrom = lineStartAt(source, statement.openBraceLine);
    const lineTo = source.indexOf("\n", lineFrom);
    const open = source.indexOf("{", lineFrom);
    if (open >= lineFrom && (lineTo < 0 || open < lineTo)) return { from: open, to: open + 1 };
  }
  return { from: statement.documentRange.from, to: statement.documentRange.to };
};

/** Build the editor view of the already-compiled module semantics. */
export const createModuleSemanticRangeIndex = (compiled: CompiledDslDocument): ModuleSemanticRangeIndex => {
  const analysis = compiled.moduleSemanticAnalysis;
  const tokens: ModuleSemanticToken[] = [];
  const declarations = new Map<string, ModuleSemanticToken>();
  const statementRanges = new Map<number, { from: number; to: number }>();
  const staleStatementRanges = new Map<number, { from: number; to: number }>();
  const statementAnchors = new Map<number, { from: number; to: number; scopeId: ScopeId }>();
  const lexicalScopeRanges: ModuleSemanticScopeRange[] = [];
  const moduleBodyScopeIds = new Set<ScopeId>();
  if (!analysis || !compiled.statementMap) return {
    tokens,
    declarationByTarget: declarations,
    statementRanges,
    staleStatementRanges,
    statementAnchors,
    lexicalScopeRanges,
    moduleBodyScopeIds,
    moduleStructureStable: true
  };
  for (const definition of analysis.definitions) moduleBodyScopeIds.add(definition.bodyScopeId);
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    const scopeId = compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(statementIndex);
    if (scopeId) statementAnchors.set(statementIndex, { from: statement.documentRange.from, to: statement.documentRange.to, scopeId });
  }
  for (const [scopeId, scope] of compiled.sourceLexicalNamespace?.scopeIndex.scopes ?? []) {
    if (scopeId === compiled.sourceLexicalNamespace?.scopeIndex.rootScopeId || scope.openingStatementIndex === null) continue;
    const opening = compiled.statements[scope.openingStatementIndex];
    const closing = scope.exitStatementIndex < compiled.statements.length ? compiled.statements[scope.exitStatementIndex] : null;
    if (!opening) continue;
    lexicalScopeRanges.push({
      scopeId,
      from: opening.documentRange.from,
      to: closing?.documentRange.to ?? compiled.spans.sourceMap.source.length,
      anchors: [
        structuralBraceAnchor(compiled, opening, "{"),
        ...(closing ? [structuralBraceAnchor(compiled, closing, "}")] : [])
      ]
    });
  }
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
    if (!editorTarget) return;
    if (editorTarget.kind === "documentBinding" && target?.kind === "documentBinding") {
      addPhysical(nameSpanFor(compiled, target.statementIndex), editorTarget, true);
    }
    add(statementIndex, span, editorTarget);
  };

  for (const definition of analysis.definitions) {
    const statementIndex = indexById.get(definition.statementId);
    if (statementIndex === undefined) continue;
    const definitionStatement = compiled.statements[statementIndex];
    if (definitionStatement) statementRanges.set(statementIndex, { from: definitionStatement.documentRange.from, to: definitionStatement.documentRange.to });
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
          for (const reference of parameter.defaultExpression.references) addSourceTarget(statementIndex, reference.target, scalarReferenceSpan(reference));
          for (const reference of parameter.defaultExpression.geometryProperties) addGeometryPropertyReference(compiled, statementIndex, reference, add, addSourceTarget);
        }
      });
    }
    for (const body of definition.bodyStatements) {
      const bodyStatement = compiled.statements[body.statementIndex];
      if (bodyStatement) statementRanges.set(body.statementIndex, { from: bodyStatement.documentRange.from, to: bodyStatement.documentRange.to });
      addBodyReferences(compiled, body.statementIndex, body, add, addSourceTarget);
    }
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
    const instanceStatement = compiled.statements[statementIndex];
    if (instanceStatement) statementRanges.set(statementIndex, { from: instanceStatement.documentRange.from, to: instanceStatement.documentRange.to });
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
      if (binding.argumentIndex !== null && binding.value?.kind === "scalar") {
        for (const reference of binding.value.expression.references) addSourceTarget(statementIndex, reference.target, scalarReferenceSpan(reference));
        for (const reference of binding.value.expression.geometryProperties) addGeometryPropertyReference(compiled, statementIndex, reference, add, addSourceTarget);
      } else if (binding.argumentIndex !== null && binding.value?.kind === "geometry") {
        addGeometryReference(compiled, statementIndex, binding.value.reference, add, addSourceTarget);
      }
    }
  }
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = indexById.get(statementId);
    if (statementIndex === undefined) continue;
    const statement = compiled.statements[statementIndex];
    if (statement) staleStatementRanges.set(statementIndex, { from: statement.documentRange.from, to: statement.documentRange.to });
    for (const site of references) addGeometryReference(compiled, statementIndex, site.reference, add, addSourceTarget);
  }
  tokens.sort((a, b) => a.from - b.from || b.to - a.to);
  return { tokens, declarationByTarget: declarations, statementRanges, staleStatementRanges, statementAnchors, lexicalScopeRanges, moduleBodyScopeIds, moduleStructureStable: true };
};

const isModuleBodyStatementId = (analysis: ModuleSemanticAnalysis, statementId: StatementIdentity) =>
  analysis.definitions.some((definition) => definition.bodyStatementIds.includes(statementId));

const addGeometryReference = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  reference: { span: DslSpan; nameSpan?: DslSpan; target: ModuleGeometrySourceTarget | null },
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
    add(statementIndex, deferred.instanceSpan, { kind: "moduleInstance", statementId: deferred.instanceStatementId });
    return;
  }
  if (reference.target?.kind === "parameter") {
    const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(reference.target.definitionStatementId);
    const name = definition?.parameters[reference.target.parameterIndex]?.name;
    if (name) return addSourceTarget(statementIndex, reference.target, reference.nameSpan ?? reference.span);
  }
  addSourceTarget(statementIndex, reference.target, reference.nameSpan ?? reference.span);
};

const addGeometryPropertyReference = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  reference: { elementNameSpan: DslSpan; target: ModuleSourceTarget | null },
  add: (statementIndex: number, span: DslSpan | null | undefined, target: ModuleSemanticTarget, declaration?: boolean) => void,
  addSourceTarget: (statementIndex: number, target: ModuleSourceTarget | null, span: DslSpan | null | undefined) => void
) => {
  const target = reference.target;
  if (target?.kind !== "deferredModuleExportProperty") {
    addSourceTarget(statementIndex, target, reference.elementNameSpan);
    return;
  }
  const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(target.instanceStatementId);
  const exportTarget = instance?.callee && compiled.moduleSemanticAnalysis?.definitionsByStatementId
    .get(instance.callee.definitionStatementId)?.exports.find((item) => item.name === target.exportName);
  if (exportTarget) add(statementIndex, target.memberSpan, { kind: "moduleSource", statementId: exportTarget.exportedStatementId });
  add(statementIndex, target.instanceSpan, { kind: "moduleInstance", statementId: target.instanceStatementId });
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
      if (target?.kind === "moduleParameter") add(statementIndex, reference.nameSpan, target);
      else addSourceTarget(statementIndex, reference.target, reference.nameSpan);
    }
    for (const reference of site.expression.geometryProperties) addGeometryPropertyReference(compiled, statementIndex, reference, add, addSourceTarget);
  }
  for (const site of body.geometryReferences) addGeometryReference(compiled, statementIndex, site.reference, add, addSourceTarget);
  for (const site of body.textTemplateHoles) for (const reference of site.expression.references) {
    const target = sourceTarget(reference.target);
    const span = reference.nameSpan;
    if (target?.kind === "moduleParameter") add(statementIndex, span, target); else addSourceTarget(statementIndex, reference.target, span);
  }
  for (const site of body.textTemplateHoles) {
    for (const reference of site.expression.geometryProperties) addGeometryPropertyReference(compiled, statementIndex, reference, add, addSourceTarget);
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
