import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createModuleSemanticRangeIndex,
  moduleSemanticTargetKey,
  type ModuleSemanticTarget
} from "./moduleSemanticEditor";
import {
  parseDslReferenceToken,
  parseDslSourceReference,
  readDslReferencePathSegments
} from "./dslReferenceTokens";
import { parseGeometryArrayDeferredModuleExportId } from "./geometryArraySemanticAnalysis";
import {
  resolveSourceLexicalPathSegments,
  type SourceLexicalDeclaration
} from "./sourceLexicalNamespaceIndex";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId } from "../scalars/bindingCatalog";
import { geometryPropertiesIn, referencesIn } from "../scalars/typedDependencyGraph";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { coordinateComponent } from "./dslParameterSpanScanner";
import type { ElementId } from "../types/geometry";
import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";

export type DslSemanticIdentity =
  | { kind: "typed"; bindingId: BindingId }
  | { kind: "module"; target: ModuleSemanticTarget }
  | { kind: "element"; elementId: ElementId }
  | { kind: "modifier"; name: string }
  | { kind: "source"; statementId: string };

export type DslSemanticOccurrence = {
  from: number;
  to: number;
  kind: "declaration" | "reference";
  identity: DslSemanticIdentity;
};

export type DslSemanticRange = { from: number; to: number };

export type DslSemanticOccurrenceIndex = {
  occurrences: readonly DslSemanticOccurrence[];
  declarationsByIdentity: ReadonlyMap<string, readonly DslSemanticRange[]>;
};

const physicalRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
): DslSemanticRange | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] ?? null : null;
};

export const dslSemanticIdentityKey = (identity: DslSemanticIdentity): string => {
  if (identity.kind === "typed") return `typed:${identity.bindingId}`;
  if (identity.kind === "element") return `element:${identity.elementId}`;
  if (identity.kind === "modifier") return `modifier:${identity.name}`;
  if (identity.kind === "source") return `source:${identity.statementId}`;
  return `module:${moduleSemanticTargetKey(identity.target)}`;
};

const statementIndexForId = (compiled: CompiledDslDocument, statementId: string) =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const elementIdForStatementIndex = (compiled: CompiledDslDocument, statementIndex: number): ElementId | null => {
  const elementId = compiled.statementMap?.elementIdByStatementIndex.get(statementIndex);
  return elementId && compiled.document?.elements.some((element) => element.id === elementId) ? elementId : null;
};

/** Map a compiler-owned Module target to the identity used by source editors. */
export const semanticIdentityForModuleTarget = (
  compiled: CompiledDslDocument,
  target: ModuleSemanticTarget
): DslSemanticIdentity | null => {
  if (target.kind === "documentBinding") return { kind: "typed", bindingId: target.bindingId };
  if (target.kind === "moduleSource") {
    const statementIndex = statementIndexForId(compiled, target.statementId);
    const elementId = statementIndex === undefined ? null : elementIdForStatementIndex(compiled, statementIndex);
    if (elementId) return { kind: "element", elementId };
  }
  return { kind: "module", target };
};

const elementIdentity = (compiled: CompiledDslDocument, elementId: string | null): DslSemanticIdentity | null =>
  elementId && compiled.document?.elements.some((element) => element.id === elementId)
    ? { kind: "element", elementId }
    : null;

const declarationIdentity = (
  compiled: CompiledDslDocument,
  declaration: SourceLexicalDeclaration
): DslSemanticIdentity | null => {
  const elementId = elementIdForStatementIndex(compiled, declaration.statementIndex);
  if (elementId) return { kind: "element", elementId };
  if (
    declaration.kind === "group" ||
    declaration.kind === "geometry" ||
    declaration.kind === "conditionalGroup" ||
    declaration.kind === "forGroup" ||
    declaration.kind === "typedDeclaration"
  ) {
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    return statementId ? { kind: "module", target: { kind: "moduleSource", statementId } } : null;
  }
  if (
    declaration.kind === "profile" ||
    declaration.kind === "layout" ||
    declaration.kind === "print" ||
    declaration.kind === "svg"
  ) {
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    return statementId ? { kind: "source", statementId } : null;
  }
  return null;
};

type AddOccurrence = (
  kind: DslSemanticOccurrence["kind"],
  from: number,
  to: number,
  identity: DslSemanticIdentity | null
) => void;

const addPhysicalOccurrence = (
  add: AddOccurrence,
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number },
  identity: DslSemanticIdentity | null,
  kind: DslSemanticOccurrence["kind"]
) => {
  const physical = physicalRange(compiled, statementIndex, span);
  if (physical) add(kind, physical.from, physical.to, identity);
};

/** Returns the compiler-owned logical value span for one numeric binding. */
const numericValueSpan = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  parameterKey: string
) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;

  if (statement.kind === "element" || statement.kind === "group") {
    const elementId = elementIdForStatementIndex(compiled, statementIndex);
    const element = elementId ? compiled.document?.elements.find((candidate) => candidate.id === elementId) : undefined;
    return element ? resolveParameterValueSpan(logical.logicalText, element, parameterKey) : null;
  }

  if (statement.kind !== "layout" && statement.kind !== "print" && statement.kind !== "svg" && statement.kind !== "place") return null;
  const coordinate = parameterKey.match(/^(.+):(x|y)$/);
  const attributeKey = coordinate?.[1] ?? parameterKey;
  const outer = statement.payloadSpans[attributeKey];
  if (!outer) return null;
  return coordinate
    ? coordinateComponent(logical.logicalText, outer, coordinate[2] as "x" | "y")
    : outer;
};

const addNumericGeometryPropertyOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  numeric: CompiledNumericBinding,
  addQualifiedPathOccurrences: (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => void
) => {
  if (!numeric.typedExpression) return;
  const valueSpan = numericValueSpan(compiled, statementIndex, numeric.parameterKey);
  if (!valueSpan) return;
  for (const reference of geometryPropertiesIn(numeric.typedExpression)) {
    const identity = elementIdentity(compiled, reference.elementId);
    if (!identity) continue;
    addQualifiedPathOccurrences(
      statementIndex,
      {
        start: valueSpan.start + reference.elementNameSpan.start,
        end: valueSpan.start + reference.elementNameSpan.end
      },
      identity
    );
  }
};

const addTypedOccurrences = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis | undefined,
  add: AddOccurrence,
  addQualifiedPathOccurrences: (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => void
) => {
  const analysis = bindingAnalysis;
  if (!analysis) return;
  for (const binding of analysis.catalog.bindings) {
    if (binding.kind !== "typed" || !binding.nameSpan) continue;
    addPhysicalOccurrence(add, compiled, binding.statementIndex, binding.nameSpan, { kind: "typed", bindingId: binding.id }, "declaration");
  }
  const addExpression = (statementIndex: number, expression: TypedScalarExpression) => {
    for (const reference of referencesIn(expression)) {
      if (!reference.bindingId) continue;
      addPhysicalOccurrence(add, compiled, statementIndex, reference.nameSpan, {
        kind: "typed",
        bindingId: reference.bindingId
      }, "reference");
    }
  };
  for (const statement of compiled.scalarProgram?.statements ?? []) {
    const statementIndex = analysis.catalog.bindingsById.get(statement.bindingId)?.statementIndex;
    if (statementIndex !== undefined) {
      addExpression(statementIndex, statement.declaration.initializer);
      for (const reference of geometryPropertiesIn(statement.declaration.initializer)) {
        const identity = elementIdentity(compiled, reference.elementId);
        if (identity) addQualifiedPathOccurrences(statementIndex, reference.elementNameSpan, identity);
      }
    }
  }
  for (const reference of analysis.initializerReferences) {
    if (reference.resolution.kind !== "resolved" || !reference.span) continue;
    const statementIndex = analysis.catalog.bindingsById.get(reference.fromBindingId)?.statementIndex;
    if (statementIndex === undefined) continue;
    addPhysicalOccurrence(add, compiled, statementIndex, {
      start: reference.span.start + 1,
      end: reference.span.end
    }, { kind: "typed", bindingId: reference.resolution.binding.id }, "reference");
  }
  for (const [occurrenceKey, source] of compiled.propertyBindings ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    if (source.kind === "binding") {
      addPhysicalOccurrence(add, compiled, statementIndex, source.nameSpan, { kind: "typed", bindingId: source.bindingId }, "reference");
    } else if (source.kind === "expression") {
      addExpression(statementIndex, source.expression);
    }
  }
  for (const [occurrenceKey, expression] of compiled.conditionalGroupConditions ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (Number.isInteger(statementIndex)) addExpression(statementIndex, expression);
  }
  for (const [statementIndex, analysisForSet] of compiled.setStatements ?? []) {
    if (analysisForSet.targetBindingId) {
      addPhysicalOccurrence(add, compiled, statementIndex, analysisForSet.targetSpan, {
        kind: "typed",
        bindingId: analysisForSet.targetBindingId
      }, "reference");
    }
    addExpression(statementIndex, analysisForSet.expression);
  }
  for (const [occurrenceKey, template] of compiled.textTemplates ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    for (const segment of template.segments) {
      if (segment.kind !== "hole" || segment.holeKind === "numeric") continue;
      addExpression(statementIndex, segment.expression);
    }
  }
  for (const [occurrenceKey, numeric] of compiled.numericBindings ?? []) {
    const occurrence = parsePropertyBindingOccurrenceKey(occurrenceKey);
    if (occurrence) addNumericGeometryPropertyOccurrences(compiled, add, occurrence.statementIndex, numeric, addQualifiedPathOccurrences);
    for (const reference of numeric.references) {
      const physical = reference.physicalNameSpan?.segments.length === 1
        ? reference.physicalNameSpan.segments[0]
        : null;
      if (physical) add("reference", physical.from, physical.to, { kind: "typed", bindingId: reference.bindingId });
    }
  }
};

const addQualifiedPathOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  nameSpan: { start: number; end: number },
  finalTarget: DslSemanticIdentity | null
) => {
  const physical = physicalRange(compiled, statementIndex, nameSpan);
  const namespace = compiled.sourceLexicalNamespace;
  if (!physical || !namespace) return;
  const source = compiled.spans.sourceMap.source;
  const pathText = source.slice(physical.from, physical.to);
  const path = parseDslReferenceToken(pathText);
  const resolved = resolveSourceLexicalPathSegments(namespace, statementIndex, path);
  if (resolved.segments.length !== path.segments.length) return;
  const ranges = readDslReferencePathSegments(source, physical.from, physical.to);
  if (ranges.kind !== "valid" || ranges.segments.length !== resolved.segments.length) return;
  resolved.segments.forEach((declaration, index) => {
    const identity = declarationIdentity(compiled, declaration) ?? (index === resolved.segments.length - 1 ? finalTarget : null);
    const range = ranges.segments[index];
    if (range) add("reference", range.start, range.end, identity);
  });
};

const geometryArrayValueIdentity = (
  compiled: CompiledDslDocument,
  statementId: string
): DslSemanticIdentity | null => semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId });

const geometryArrayParameterIdentity = (
  definitionStatementId: string,
  parameterIndex: number
): DslSemanticIdentity => ({
  kind: "module",
  target: {
    kind: "moduleParameter",
    slot: { definitionStatementId, parameterIndex }
  }
});

const addGeometryArrayOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const analysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  if (!analysis) return;

  const parsedReferenceAt = (statementIndex: number, span: { start: number; end: number }) => {
    const statement = compiled.statements[statementIndex];
    const logical = statement
      ? compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from)
      : undefined;
    if (!logical) return null;
    const parsed = parseDslSourceReference(logical.logicalText.slice(span.start, span.end));
    if (parsed.kind !== "valid") return null;
    return {
      reference: parsed.reference,
      pathSpan: {
        start: span.start + parsed.reference.pathRange.start,
        end: span.start + parsed.reference.pathRange.end
      }
    };
  };

  const addReference = (
    statementIndex: number,
    span: { start: number; end: number },
    identity: DslSemanticIdentity | null,
    direct = false
  ) => {
    const parsed = parsedReferenceAt(statementIndex, span);
    if (!parsed || !identity) return;
    if (direct) {
      addPhysicalOccurrence(add, compiled, statementIndex, parsed.pathSpan, identity, "reference");
      return;
    }
    addQualifiedPathOccurrences(compiled, add, statementIndex, parsed.pathSpan, identity);
  };

  const parameterForValueId = (valueId: string) => analysis.moduleParameters.find((parameter) =>
    valueId === `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`
  ) ?? null;

  const addDeferredExportReference = (
    statementIndex: number,
    span: { start: number; end: number },
    instanceStatementId: string,
    exportName: string
  ) => {
    const parsed = parsedReferenceAt(statementIndex, span);
    if (!parsed) return;
    const physical = physicalRange(compiled, statementIndex, parsed.pathSpan);
    if (!physical) return;
    const source = compiled.spans.sourceMap.source;
    const ranges = readDslReferencePathSegments(source, physical.from, physical.to);
    if (ranges.kind !== "valid" || ranges.segments.length !== 2) return;
    const instanceRange = ranges.segments[0];
    if (instanceRange) add("reference", instanceRange.start, instanceRange.end, {
      kind: "module",
      target: { kind: "moduleInstance", statementId: instanceStatementId }
    });
    const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(instanceStatementId);
    const definitionIndex = instance?.callee?.definitionStatementIndex;
    const exported = definitionIndex === undefined
      ? null
      : analysis.values.find((value) =>
          value.ownerModuleDefinitionStatementIndex === definitionIndex &&
          value.exported &&
          value.name === exportName
        ) ?? null;
    const exportRange = ranges.segments[1];
    if (exportRange && exported) {
      add("reference", exportRange.start, exportRange.end, geometryArrayValueIdentity(compiled, exported.statementId));
    }
  };

  for (const value of analysis.values) {
    const statement = compiled.statements[value.statementIndex];
    if (!statement?.nameSpan) continue;
    const valueIdentity = geometryArrayValueIdentity(compiled, value.statementId);
    addPhysicalOccurrence(add, compiled, value.statementIndex, statement.nameSpan, valueIdentity, "declaration");
    if (!value.value) continue;

    if (value.value.kind === "literal") {
      for (const member of value.value.members) {
        if (member.target.kind === "coordinate") continue;
        if (member.target.kind === "moduleParameter") {
          addReference(
            value.statementIndex,
            member.sourceSpan,
            geometryArrayParameterIdentity(member.target.definitionStatementId, member.target.parameterIndex),
            true
          );
          continue;
        }
        const elementId = elementIdForStatementIndex(compiled, member.target.statementIndex);
        const identity = elementIdentity(compiled, elementId) ?? geometryArrayValueIdentity(compiled, member.target.statementId);
        addReference(value.statementIndex, member.sourceSpan, identity);
      }
      continue;
    }

    const targetValue = analysis.valuesByStatementId.get(value.value.targetValueId);
    if (targetValue) {
      addReference(value.statementIndex, value.value.sourceSpan, geometryArrayValueIdentity(compiled, targetValue.statementId));
      continue;
    }
    const parameter = parameterForValueId(value.value.targetValueId);
    if (parameter) {
      addReference(
        value.statementIndex,
        value.value.sourceSpan,
        geometryArrayParameterIdentity(parameter.definitionStatementId, parameter.parameterIndex),
        true
      );
      continue;
    }
    const deferred = parseGeometryArrayDeferredModuleExportId(value.value.targetValueId);
    if (deferred) {
      addDeferredExportReference(value.statementIndex, value.value.sourceSpan, deferred.instanceStatementId, deferred.exportName);
    }
  }
};

const addModuleSemanticPathOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return;
  const addGeometry = (statementIndex: number, reference: { nameSpan?: { start: number; end: number }; target: unknown }) => {
    if (!reference.nameSpan || !reference.target) return;
    const target = reference.target as { kind?: string; statementId?: string };
    const finalTarget = target.kind === "sourceGeometry" || target.kind === "sourceGeometryProperty"
      ? target.statementId
        ? semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
        : null
      : null;
    addQualifiedPathOccurrences(compiled, add, statementIndex, reference.nameSpan, finalTarget);
  };
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of references) addGeometry(statementIndex, reference.reference);
  }
  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of site.expression.geometryProperties) addGeometry(statementIndex, reference);
  }
  for (const [statementId, site] of analysis.rootParentReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined || !site.reference.nameSpan || !site.reference.target) continue;
    const target = site.reference.target;
    const finalTarget = target.kind === "sourceContainer"
      ? semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
      : null;
    addQualifiedPathOccurrences(compiled, add, statementIndex, site.reference.nameSpan, finalTarget);
  }
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const reference of body.geometryReferences) addGeometry(body.statementIndex, reference.reference);
      for (const site of body.scalarExpressions) {
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
      }
      for (const site of body.textTemplateHoles) {
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
      }
    }
  }
};

const addModuleOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const semanticCompiled = compiled.moduleSemanticAnalysis || !compiled.sourceSemanticAnalysis
    ? compiled
    : { ...compiled, moduleSemanticAnalysis: compiled.sourceSemanticAnalysis };
  const index = createModuleSemanticRangeIndex(semanticCompiled);
  const source = compiled.spans.sourceMap.source;
  for (const token of index.tokens) {
    const identity = semanticIdentityForModuleTarget(compiled, token.target);
    if (!identity) continue;
    const declaration = index.declarationByTarget.get(moduleSemanticTargetKey(token.target));
    const isDeclaration = declaration?.from === token.from && declaration.to === token.to;
    const pathRanges = readDslReferencePathSegments(source, token.from, token.to);
    if (!isDeclaration && pathRanges.kind === "valid" && pathRanges.segments.length > 1) continue;
    add(isDeclaration ? "declaration" : "reference", token.from, token.to, identity);
  }
  addModuleSemanticPathOccurrences(compiled, add);
};

const addRootDeclarations = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const declaration of namespace.allDeclarations) {
    if (
      declaration.kind !== "profile" &&
      declaration.kind !== "group" &&
      declaration.kind !== "geometry" &&
      declaration.kind !== "conditionalGroup" &&
      declaration.kind !== "forGroup" &&
      declaration.kind !== "layout" &&
      declaration.kind !== "print" &&
      declaration.kind !== "svg"
    ) continue;
    const identity = declarationIdentity(compiled, declaration);
    if (!identity || !declaration.nameSpan) continue;
    addPhysicalOccurrence(add, compiled, declaration.statementIndex, declaration.nameSpan, identity, "declaration");
  }
};

const addDrawingProfileOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "modifierProfileBlock") continue;
    addQualifiedPathOccurrences(compiled, add, statementIndex, statement.profileNameSpan, null);
  }
};

/** Document-global modifier names deliberately stay outside lexical namespaces. */
const addDrawingModifierOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const index = createModifierAuthoringIndex(compiled);
  for (const definition of index.definitions) {
    add("declaration", definition.range.from, definition.range.to, { kind: "modifier", name: definition.name });
  }
  for (const reference of index.references) {
    add("reference", reference.range.from, reference.range.to, { kind: "modifier", name: reference.name });
  }
};

const addSourceOutputOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "layout" && statement.kind !== "print" && statement.kind !== "svg" && statement.kind !== "place") continue;
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) continue;
    for (const key of ["group", "origin", "layout", "profile"]) {
      const valueSpan = statement.payloadSpans[key];
      if (!valueSpan) continue;
      const parsed = parseDslSourceReference(logical.logicalText.slice(valueSpan.start, valueSpan.end));
      if (parsed.kind !== "valid" || parsed.reference.property) continue;
      addQualifiedPathOccurrences(compiled, add, statementIndex, {
        start: valueSpan.start + parsed.reference.pathRange.start,
        end: valueSpan.start + parsed.reference.pathRange.end
      }, null);
    }
  }
};

/** Build exact, compiler-resolved declaration/reference occurrences in source order. */
export const createDslSemanticOccurrenceIndex = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis | undefined = compiled.bindingAnalysis
): DslSemanticOccurrenceIndex => {
  const byKey = new Map<string, DslSemanticOccurrence>();
  const add: AddOccurrence = (kind, from, to, identity) => {
    if (!identity || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to) return;
    const key = `${dslSemanticIdentityKey(identity)}:${from}:${to}`;
    const current = byKey.get(key);
    if (!current || (kind === "declaration" && current.kind === "reference")) {
      byKey.set(key, { from, to, kind, identity });
    }
  };

  const addQualifiedPath = (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => addQualifiedPathOccurrences(compiled, add, statementIndex, nameSpan, finalTarget);

  addTypedOccurrences(compiled, bindingAnalysis, add, addQualifiedPath);
  addRootDeclarations(compiled, add);
  addModuleOccurrences(compiled, add);
  addGeometryArrayOccurrences(compiled, add);
  addSourceOutputOccurrences(compiled, add);
  addDrawingProfileOccurrences(compiled, add);
  addDrawingModifierOccurrences(compiled, add);

  const occurrences = [...byKey.values()].sort((left, right) =>
    left.from - right.from || left.to - right.to || (left.kind === "declaration" ? -1 : 1) ||
    dslSemanticIdentityKey(left.identity).localeCompare(dslSemanticIdentityKey(right.identity))
  );
  const declarationsByIdentity = new Map<string, DslSemanticRange[]>();
  for (const occurrence of occurrences) {
    if (occurrence.kind !== "declaration") continue;
    const declarations = declarationsByIdentity.get(dslSemanticIdentityKey(occurrence.identity)) ?? [];
    if (!declarations.some((range) => range.from === occurrence.from && range.to === occurrence.to)) {
      declarations.push({ from: occurrence.from, to: occurrence.to });
      declarationsByIdentity.set(dslSemanticIdentityKey(occurrence.identity), declarations);
    }
  }
  return { occurrences, declarationsByIdentity };
};

export const dslSemanticOccurrenceAt = (
  index: DslSemanticOccurrenceIndex,
  position: number
): DslSemanticOccurrence | null => {
  const matches = index.occurrences
    .filter((occurrence) => occurrence.from <= position && position <= occurrence.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from) || left.from - right.from || left.to - right.to);
  if (matches.length === 0) return null;
  const shortest = matches[0]!.to - matches[0]!.from;
  const shortestMatches = matches.filter((occurrence) => occurrence.to - occurrence.from === shortest);
  const identities = new Set(shortestMatches.map((occurrence) => dslSemanticIdentityKey(occurrence.identity)));
  return identities.size === 1 ? shortestMatches[0]! : null;
};

export const dslSemanticDeclarationRange = (
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DslSemanticRange | null => {
  const declarations = index.declarationsByIdentity.get(dslSemanticIdentityKey(identity)) ?? [];
  return declarations.length === 1 ? declarations[0]! : null;
};
