import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  dslSemanticIdentityKey,
  dslSemanticOccurrenceAt,
  semanticIdentityForModuleTarget,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "./dslSemanticOccurrenceIndex";
import type { ModuleRecordSourceTarget, ModuleSourceTarget } from "./moduleSemanticTypes";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import { parseDslSourceReference, parseDslSourceReferenceAt, readDslReferencePathSegments } from "./dslReferenceTokens";
import { dslRequiredValueTypeOf, isDslGeometryValueType } from "./dslValueTypes";

export type DslDefinitionRange = { from: number; to: number };

export type DslDefinitionSemanticSnapshot = {
  /** Source revision that produced this semantic snapshot. */
  sourceRevision: SourceRevision;
  /** Optional exact source proof. When omitted, compiled.spans.sourceMap.source is used. */
  sourceText?: string;
  /** Production source semantics for the exact source snapshot. */
  compiled?: CompiledDslDocument;
  /** Optional explicit binding analysis for callers that already hold it. */
  bindingAnalysis?: BindingAnalysis;
};

export type DslDefinitionQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslDefinitionSemanticSnapshot;
};

export type DslDefinitionQueryResult = {
  /** Exact source range of the reference identifier, excluding `@`. */
  referenceRange: DslDefinitionRange;
  /** Exact source range of the resolved declaration identifier. */
  declarationRange: DslDefinitionRange;
};

const semanticSourceText = (semantic: DslDefinitionSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslDefinitionSemanticSnapshot | undefined) => {
  if (!semantic || semantic.sourceRevision !== source.sourceRevision) return false;
  if (semanticSourceText(semantic) !== source.normalizedSource) return false;
  // An explicit sourceText is useful as a proof carried beside a semantic
  // result, but it cannot make a compiled source map from a different source
  // safe for source-range projection.
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

const shorthandLabelIdentityKey = (
  compiled: CompiledDslDocument,
  from: number,
  to: number
): string | null => {
  const statementIndex = compiled.statements.findIndex((statement) =>
    statement.physicalSpan.segments.some((segment) => from >= segment.from && from <= segment.to)
  );
  const statement = compiled.statements[statementIndex];
  const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.statementIndex === statementIndex);
  if (statement?.kind !== "moduleInstance" || !instance?.callee) return null;
  const argumentIndex = statement.arguments.findIndex((argument) => {
    const physical = argument.labelPhysicalSpan?.segments;
    return physical?.length === 1 && physical[0]?.from === from && physical[0]?.to === to;
  });
  if (argumentIndex < 0) return null;
  const binding = instance.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  if (!binding) return null;
  return dslSemanticIdentityKey({
    kind: "module",
    target: {
      kind: "moduleParameter",
      slot: {
        definitionStatementId: instance.callee.definitionStatementId,
        parameterIndex: binding.parameterIndex
      }
    }
  });
};

const shorthandValueIdentity = (
  compiled: CompiledDslDocument,
  target: ModuleSourceTarget | ModuleRecordSourceTarget | null
): DslSemanticIdentity | null => {
  if (!target) return null;
  if (target.kind === "parameter" || target.kind === "parameterProperty") {
    return {
      kind: "module",
      target: {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: target.definitionStatementId,
          parameterIndex: target.parameterIndex
        }
      }
    };
  }
  if (target.kind === "documentBinding") {
    return semanticIdentityForModuleTarget(compiled, { kind: "documentBinding", bindingId: target.bindingId });
  }
  if (target.kind === "moduleLocal" || target.kind === "sourceGeometry" || target.kind === "sourceGeometryProperty") {
    return semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId });
  }
  if (target.kind === "iteration") {
    return semanticIdentityForModuleTarget(compiled, { kind: "moduleIteration", statementId: target.statementId });
  }
  if (target.kind === "recordValue") return { kind: "recordValue", statementId: target.statementId };
  if (target.kind === "recordParameter") {
    return {
      kind: "module",
      target: {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: target.definitionStatementId,
          parameterIndex: target.parameterIndex
        }
      }
    };
  }
  if (target.kind === "deferredModuleRecordExport") {
    return semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.exportedStatementId });
  }
  if (target.kind === "geometryValue") {
    return semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId });
  }
  return null;
};

const directShorthandValueOccurrenceAt = (
  compiled: CompiledDslDocument,
  position: number
): DslSemanticOccurrence | null => {
  const source = compiled.spans.sourceMap.source;
  for (const instance of compiled.moduleSemanticAnalysis?.instances ?? []) {
    const statement = compiled.statements[instance.statementIndex];
    if (statement?.kind !== "moduleInstance") continue;
    for (const [argumentIndex, argument] of statement.arguments.entries()) {
      const physical = argument.labelPhysicalSpan?.segments;
      const label = physical?.length === 1 ? physical[0] : null;
      if (
        !label ||
        label.from <= 0 ||
        source[label.from - 1] !== "@" ||
        position < label.from - 1 ||
        position > label.to
      ) continue;
      const binding = instance.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
      if (!binding?.value || !argument.labelSpan) continue;
      let target: ModuleSourceTarget | ModuleRecordSourceTarget | null = null;
      if (binding.value.kind === "scalar") {
        target = binding.value.expression.references.find((reference) =>
          reference.nameSpan.start === argument.labelSpan!.start && reference.nameSpan.end === argument.labelSpan!.end
        )?.target ?? null;
      } else if (binding.value.kind === "geometry") {
        const nameSpan = binding.value.reference.nameSpan;
        if (nameSpan?.start === argument.labelSpan.start && nameSpan.end === argument.labelSpan.end) {
          target = binding.value.reference.target;
        }
      } else if (binding.value.kind === "record") {
        const reference = binding.value.reference;
        if (reference.target && reference.span.start + 1 === argument.labelSpan.start && reference.span.end === argument.labelSpan.end) {
          target = reference.target;
        }
      }
      const identity = shorthandValueIdentity(compiled, target);
      if (identity) return { from: label.from, to: label.to, kind: "reference", identity };
    }
  }
  return null;
};

const shorthandValueOccurrenceAt = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  position: number
): DslSemanticOccurrence | null => {
  const direct = directShorthandValueOccurrenceAt(compiled, position);
  if (direct) return direct;
  const matches = index.occurrences
    .filter((occurrence) => occurrence.kind === "reference" && occurrence.from <= position && position <= occurrence.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from) || left.from - right.from || left.to - right.to);
  if (matches.length === 0) return null;
  const shortest = matches[0]!.to - matches[0]!.from;
  const shortestMatches = matches.filter((occurrence) => occurrence.to - occurrence.from === shortest);
  const labelIdentityKey = shorthandLabelIdentityKey(compiled, shortestMatches[0]!.from, shortestMatches[0]!.to);
  if (!labelIdentityKey) return null;
  const valueMatches = shortestMatches.filter((occurrence) =>
    dslSemanticIdentityKey(occurrence.identity) !== labelIdentityKey
  );
  const identities = new Set(valueMatches.map((occurrence) => dslSemanticIdentityKey(occurrence.identity)));
  return identities.size === 1 ? valueMatches[0] ?? null : null;
};

const exactPhysicalRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
): DslDefinitionRange | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] ?? null : null;
};

const uniqueReferenceIdentityAtRange = (
  index: DslSemanticOccurrenceIndex,
  range: DslDefinitionRange
): DslSemanticIdentity | null => {
  const identities = new Map<string, DslSemanticIdentity>();
  for (const occurrence of index.occurrences) {
    if (occurrence.kind !== "reference" || occurrence.from !== range.from || occurrence.to !== range.to) continue;
    identities.set(dslSemanticIdentityKey(occurrence.identity), occurrence.identity);
  }
  return identities.size === 1 ? identities.values().next().value ?? null : null;
};

const isGeometryTargetIdentity = (compiled: CompiledDslDocument, identity: DslSemanticIdentity): boolean => {
  if (identity.kind === "element") {
    const element = compiled.document?.elements.find((candidate) => candidate.id === identity.elementId);
    return !!element && element.type !== "group" && element.type !== "conditionalGroup" &&
      element.type !== "forGroup" && element.type !== "moduleInstance";
  }
  if (identity.kind === "typed") {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
    return isDslGeometryValueType(dslRequiredValueTypeOf(binding?.declaredType));
  }
  if (identity.kind !== "module" || identity.target.kind !== "moduleSource") return false;
  const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(identity.target.statementId);
  const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
  return statement?.kind === "typedDeclaration" && isDslGeometryValueType(dslRequiredValueTypeOf(statement.valueType));
};

const isExtractPartGeometryIdentity = (compiled: CompiledDslDocument, identity: DslSemanticIdentity): boolean => {
  if (identity.kind !== "element") return false;
  const statementIndex = [...(compiled.statementMap?.elementIdByStatementIndex ?? [])]
    .find(([, elementId]) => elementId === identity.elementId)?.[0];
  const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
  return statement?.kind === "element" && statement.extractPart !== undefined;
};

const finalGeometryDeclarationRangeForPath = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  pathRange: DslDefinitionRange
): DslDefinitionRange | null => {
  const source = compiled.spans.sourceMap.source;
  const path = readDslReferencePathSegments(source, pathRange.from, pathRange.to);
  if (path.kind !== "valid" || path.end !== pathRange.to || path.segments.length < 2) return null;

  let finalIdentity: DslSemanticIdentity | null = null;
  for (const segment of path.segments) {
    const identity = uniqueReferenceIdentityAtRange(index, { from: segment.start, to: segment.end });
    if (!identity) return null;
    finalIdentity = identity;
  }
  if (!finalIdentity || !isGeometryTargetIdentity(compiled, finalIdentity)) return null;
  return dslSemanticDeclarationRange(index, finalIdentity);
};

type GeometryPathReferenceEvidence = "resolved" | "resolvedNonNumericProperty" | "unsafe" | "none";

const semanticTargetKind = (target: unknown): string | null =>
  typeof target === "object" && target !== null && "kind" in target && typeof target.kind === "string"
    ? target.kind
    : null;

const geometryPathReferenceEvidence = (
  compiled: CompiledDslDocument,
  pathRange: DslDefinitionRange
): GeometryPathReferenceEvidence => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return "none";
  const source = compiled.spans.sourceMap.source;
  let matched = false;
  let unsafe = false;
  let resolvedGeometryReference = false;
  let resolvedNumericProperty = false;
  let resolvedChoiceProperty = false;
  let resolvedNonNumericProperty = false;

  const consider = (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    isResolved: boolean,
    hasTarget: boolean
  ) => {
    const name = exactPhysicalRange(compiled, statementIndex, nameSpan);
    if (!name || name.from !== pathRange.from || name.to !== pathRange.to) return;
    matched = true;
    if (!isResolved || !hasTarget) unsafe = true;
    else resolvedGeometryReference = true;
  };

  const considerExpression = (
    statementIndex: number,
    expression: { geometryProperties: readonly {
      elementNameSpan: { start: number; end: number };
      resolution: string;
      target: unknown;
      type: { kind: string } | null;
    }[] }
  ) => {
    for (const property of expression.geometryProperties) {
      if (semanticTargetKind(property.target) === "recordField") continue;
      const name = exactPhysicalRange(compiled, statementIndex, property.elementNameSpan);
      if (!name || name.from !== pathRange.from || name.to !== pathRange.to) continue;
      matched = true;
      if (property.resolution !== "resolved" || property.target === null) {
        unsafe = true;
      } else if (property.type?.kind === "number") {
        resolvedNumericProperty = true;
      } else if (property.type?.kind === "choice") {
        resolvedChoiceProperty = true;
      } else {
        resolvedNonNumericProperty = true;
      }
    }
  };

  const considerGeometryReference = (
    statementIndex: number,
    reference: {
      span: { start: number; end: number };
      nameSpan?: { start: number; end: number };
      resolution: string;
      target: unknown;
    }
  ) => {
    let nameSpan = reference.nameSpan;
    if (!nameSpan) {
      const full = exactPhysicalRange(compiled, statementIndex, reference.span);
      if (!full) return;
      const parsed = parseDslSourceReference(source.slice(full.from, full.to));
      if (parsed.kind !== "valid") return;
      nameSpan = {
        start: reference.span.start + parsed.reference.pathRange.start,
        end: reference.span.start + parsed.reference.pathRange.end
      };
    }
    consider(statementIndex, nameSpan, reference.resolution === "resolved", reference.target !== null);
  };

  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex !== undefined) considerExpression(statementIndex, site.expression);
  }
  for (const [statementId, sites] of analysis.rootElementScalarExpressionsByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex === undefined) continue;
    for (const site of sites) considerExpression(statementIndex, site.expression);
  }
  for (const [statementId, sites] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex === undefined) continue;
    for (const site of sites) considerGeometryReference(statementIndex, site.reference);
  }
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const site of body.scalarExpressions) considerExpression(body.statementIndex, site.expression);
      for (const site of body.textTemplateHoles) considerExpression(body.statementIndex, site.expression);
      for (const site of body.geometryReferences) considerGeometryReference(body.statementIndex, site.reference);
    }
  }

  if (unsafe) return "unsafe";
  if (resolvedGeometryReference || resolvedNumericProperty || resolvedChoiceProperty) return "resolved";
  if (matched && resolvedNonNumericProperty) return "resolvedNonNumericProperty";
  return "none";
};

type GeometryPropertyDefinitionAt =
  | { matched: false }
  | { matched: true; result: DslDefinitionQueryResult | null };

const geometryPropertyDefinitionAt = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  position: number
): GeometryPropertyDefinitionAt => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return { matched: false };
  const source = compiled.spans.sourceMap.source;
  const results = new Map<string, DslDefinitionQueryResult>();
  let matched = false;

  const considerProperty = (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    propertySpan: { start: number; end: number },
    propertyName: string | null,
    propertyType: { kind: string } | null,
    resolved: boolean,
    hasTarget: boolean,
    referenceRange?: DslDefinitionRange
  ) => {
    if (!propertyName || (
      propertyName !== "start" && propertyName !== "end" && propertyName !== "length" &&
      propertyType?.kind !== "number" && propertyType?.kind !== "choice"
    )) return;
    const property = exactPhysicalRange(compiled, statementIndex, propertySpan);
    if (!property || position < property.from || position > property.to) return;
    const name = exactPhysicalRange(compiled, statementIndex, nameSpan);
    if (!name) return;
    const path = readDslReferencePathSegments(source, name.from, name.to);
    const finalSegment = path.kind === "valid" ? path.segments[path.segments.length - 1] : undefined;
    const finalIdentity = finalSegment
      ? uniqueReferenceIdentityAtRange(index, { from: finalSegment.start, to: finalSegment.end })
      : null;
    if (!finalIdentity || (!isGeometryTargetIdentity(compiled, finalIdentity) && !isExtractPartGeometryIdentity(compiled, finalIdentity))) return;
    matched = true;
    if (!resolved || !hasTarget) return;
    const declarationRange = finalGeometryDeclarationRangeForPath(compiled, index, name);
    if (!declarationRange) return;
    const reference = referenceRange ?? property;
    results.set(`${reference.from}:${reference.to}:${declarationRange.from}:${declarationRange.to}`, {
      referenceRange: reference,
      declarationRange
    });
  };

  const considerScalarExpression = (statementIndex: number, expression: { geometryProperties: readonly {
    elementNameSpan: { start: number; end: number };
    propertySpan: { start: number; end: number };
    property: string;
    resolution: string;
    target: unknown;
    type: { kind: string } | null;
  }[] }) => {
    for (const property of expression.geometryProperties) {
      considerProperty(
        statementIndex,
        property.elementNameSpan,
        property.propertySpan,
        property.property,
        property.type,
        property.resolution === "resolved",
        property.target !== null && semanticTargetKind(property.target) !== "recordField",
        undefined
      );
    }
  };

  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex !== undefined) considerScalarExpression(statementIndex, site.expression);
  }
  for (const [statementId, sites] of analysis.rootElementScalarExpressionsByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex === undefined) continue;
    for (const site of sites) considerScalarExpression(statementIndex, site.expression);
  }
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const site of body.scalarExpressions) considerScalarExpression(body.statementIndex, site.expression);
      for (const site of body.textTemplateHoles) considerScalarExpression(body.statementIndex, site.expression);
      for (const site of body.geometryReferences) {
        const reference = site.reference;
        const full = exactPhysicalRange(compiled, body.statementIndex, reference.span);
        if (!full) continue;
        const parsed = parseDslSourceReference(source.slice(full.from, full.to));
        if (parsed.kind !== "valid" || !parsed.reference.propertyRange) continue;
        const propertySpan = {
          start: reference.span.start + parsed.reference.propertyRange.start,
          end: reference.span.start + parsed.reference.propertyRange.end
        };
        considerProperty(
          body.statementIndex,
          reference.nameSpan ?? { start: reference.span.start + parsed.reference.pathRange.start, end: reference.span.start + parsed.reference.pathRange.end },
          propertySpan,
          parsed.reference.property,
          null,
          reference.resolution === "resolved",
          reference.target !== null,
          { from: full.from + parsed.reference.propertyRange.start, to: full.from + parsed.reference.propertyRange.end }
        );
      }
    }
  }
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statementIndex === undefined) continue;
    for (const site of references) {
      const reference = site.reference;
      const full = exactPhysicalRange(compiled, statementIndex, reference.span);
      if (!full) continue;
      const parsed = parseDslSourceReference(source.slice(full.from, full.to));
      if (parsed.kind !== "valid" || !parsed.reference.propertyRange) continue;
      const propertySpan = {
        start: reference.span.start + parsed.reference.propertyRange.start,
        end: reference.span.start + parsed.reference.propertyRange.end
      };
      considerProperty(
        statementIndex,
        reference.nameSpan ?? { start: reference.span.start + parsed.reference.pathRange.start, end: reference.span.start + parsed.reference.pathRange.end },
        propertySpan,
        parsed.reference.property,
        null,
        reference.resolution === "resolved",
        reference.target !== null,
        { from: full.from + parsed.reference.propertyRange.start, to: full.from + parsed.reference.propertyRange.end }
      );
    }
  }

  if (!matched) return { matched: false };
  return { matched: true, result: results.size === 1 ? results.values().next().value ?? null : null };
};

const qualifiedPathDefinitionRangeAt = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  occurrence: DslSemanticOccurrence
): { qualified: boolean; declarationRange: DslDefinitionRange | null } => {
  const source = compiled.spans.sourceMap.source;
  const references = index.occurrences.filter((candidate) => candidate.kind === "reference");
  let pathStart = occurrence.from;
  let qualified = source.slice(occurrence.to, occurrence.to + 2) === "::";

  while (source.slice(pathStart - 2, pathStart) === "::" && source.slice(pathStart - 3, pathStart) !== "@::") {
    qualified = true;
    const previous = references.filter((candidate) => candidate.to === pathStart - 2 && candidate.from < candidate.to);
    const ranges = new Map(previous.map((candidate) => [`${candidate.from}:${candidate.to}`, candidate]));
    if (ranges.size !== 1) return { qualified: true, declarationRange: null };
    const previousRange = ranges.values().next().value as DslSemanticOccurrence | undefined;
    if (!previousRange || !uniqueReferenceIdentityAtRange(index, previousRange)) {
      return { qualified: true, declarationRange: null };
    }
    pathStart = previousRange.from;
  }

  const referenceStart = source.slice(pathStart - 3, pathStart) === "@::"
    ? pathStart - 3
    : source[pathStart - 1] === "@"
      ? pathStart - 1
      : null;
  let propertyName: string | null = null;
  if (referenceStart !== null) {
    const parsedReference = parseDslSourceReferenceAt(source, referenceStart, source.length, { allowIncompleteProperty: true });
    if (parsedReference.kind === "invalid" || parsedReference.reference.property === "") {
      return { qualified: true, declarationRange: null };
    }
    propertyName = parsedReference.reference.property;
  }

  const path = readDslReferencePathSegments(source, pathStart, source.length);
  if (path.kind !== "valid") return { qualified, declarationRange: null };
  qualified ||= path.segments.length > 1;
  if (!qualified) return { qualified: false, declarationRange: null };

  const currentSegment = path.segments.find((segment) => segment.start === occurrence.from && segment.end === occurrence.to);
  if (!currentSegment) return { qualified: true, declarationRange: null };
  const pathRange = { from: pathStart, to: path.end };
  const finalSegment = path.segments[path.segments.length - 1];
  const finalIdentity = finalSegment
    ? uniqueReferenceIdentityAtRange(index, { from: finalSegment.start, to: finalSegment.end })
    : null;
  if (!finalIdentity) return { qualified: true, declarationRange: null };
  const geometryTarget = isGeometryTargetIdentity(compiled, finalIdentity);
  const extractPart = isExtractPartGeometryIdentity(compiled, finalIdentity);
  const geometryEvidence = geometryPathReferenceEvidence(compiled, pathRange);
  if (propertyName) {
    if (!geometryTarget && !extractPart) return { qualified: false, declarationRange: null };
    if (geometryEvidence === "resolvedNonNumericProperty") return { qualified: false, declarationRange: null };
    if (geometryEvidence !== "resolved") return { qualified: true, declarationRange: null };
  } else if (!extractPart && (!geometryTarget || geometryEvidence !== "resolved")) {
    return { qualified: false, declarationRange: null };
  }
  const declarationRange = finalGeometryDeclarationRangeForPath(compiled, index, pathRange);
  if (!declarationRange) {
    // A fully resolved non-geometry path keeps its established definition
    // target. Missing or ambiguous segments are unsafe and must not fall
    // back to an ancestor declaration.
    if (finalIdentity && !isGeometryTargetIdentity(compiled, finalIdentity)) {
      return { qualified: false, declarationRange: null };
    }
    return { qualified: true, declarationRange: null };
  }
  return { qualified: true, declarationRange };
};

/** Query a resolved DSL reference without importing host APIs or CodeMirror. */
export const queryDslDefinition = ({ source, position, semantic }: DslDefinitionQueryInput): DslDefinitionQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  if (!semanticIsExact(source, semantic) || !semantic?.compiled) return null;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(
    semantic.compiled,
    semantic.bindingAnalysis ?? semantic.compiled.bindingAnalysis
  );
  const propertyDefinition = geometryPropertyDefinitionAt(semantic.compiled, occurrenceIndex, position);
  if (propertyDefinition.matched) return propertyDefinition.result;
  const occurrence = shorthandValueOccurrenceAt(semantic.compiled, occurrenceIndex, position) ?? dslSemanticOccurrenceAt(occurrenceIndex, position);
  if (!occurrence || occurrence.kind !== "reference") return null;
  const qualified = qualifiedPathDefinitionRangeAt(semantic.compiled, occurrenceIndex, occurrence);
  if (qualified.qualified) {
    if (!qualified.declarationRange) return null;
    return {
      referenceRange: { from: occurrence.from, to: occurrence.to },
      declarationRange: qualified.declarationRange
    };
  }
  const declarationRange = dslSemanticDeclarationRange(occurrenceIndex, occurrence.identity);
  if (!declarationRange || (declarationRange.from === occurrence.from && declarationRange.to === occurrence.to)) return null;
  return {
    referenceRange: { from: occurrence.from, to: occurrence.to },
    declarationRange
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
