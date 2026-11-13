import type {
  DslReferencePickSourceAnchor,
  DslReferencePickTarget
} from "@nuinuicad/nui-language";
import {
  formatDslReferencePath,
  parseDslSourceReference,
  parseDslSourceReferenceAt,
  type DslSourceReference
} from "@nuinuicad/nui-language";
import type { ModuleGeometryInterfaceType } from "@nuinuicad/nui-language";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import {
  isNumericComputedGeometryProperty,
  type NumericComputedGeometryProperty
} from "../geometry/numericExpressions";

/**
 * Only source-position facts that are stable across Extension Host and Webview
 * compiler sessions belong in the protocol proof. Semantic source revisions,
 * statement IDs and scope IDs are deliberately local-session facts and are
 * re-derived independently on each side from the matching document version.
 */
export type VscodeReferencePickTargetProof = {
  sourceAnchor: Pick<DslReferencePickSourceAnchor, "statementIndex" | "statementRange">;
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickTarget["role"];
  multiplicity: DslReferencePickTarget["multiplicity"];
  range: DslReferencePickTarget["range"];
  activationRange: DslReferencePickTarget["range"];
  oldText: string;
  activationOldText: string;
  numericProperty: DslReferencePickTarget["numericProperty"] | null;
  syntax?: DslReferencePickTarget["syntax"];
  selectionCount?: DslReferencePickTarget["selectionCount"];
};

export type VscodeReferencePickNumericPropertyDraft = {
  reference: CanonicalGeometrySourceReference;
  property: NumericComputedGeometryProperty;
};

export type VscodeReferencePickNumericCandidate = {
  reference: CanonicalGeometrySourceReference;
  properties: readonly NumericComputedGeometryProperty[];
};

export type VscodeReferencePickStartRequest = {
  type: "referencePickStartRequest";
  requestId: number;
  documentUri: string;
  documentVersion: number;
  mode?: "target-bound" | "browse";
  initialSelection?: { from: number; to: number; oldText: string };
  normalizedSourceOffset: number;
  targetProof: VscodeReferencePickTargetProof | null;
  initialDraftReferences?: readonly CanonicalGeometrySourceReference[];
  initialNumericPropertyDraft?: VscodeReferencePickNumericPropertyDraft;
  /** Restored after native Undo; keep Source active so immediate native Redo is available. */
  preserveSourceFocus?: true;
};

export type VscodeReferencePickCancelRequest = {
  type: "referencePickCancelRequest";
  requestId: number;
  documentUri: string;
  documentVersion: number;
};

type VscodeReferencePickResultBase = {
  type: "referencePickResult";
  requestId: number;
  documentUri: string;
  documentVersion: number;
  targetProof: VscodeReferencePickTargetProof | null;
  snapshot?: VscodeReferencePickSnapshotProvenance;
};

export type VscodeReferencePickSnapshotProvenance = {
  sourceRevision: number;
  matchesCurrentSource: boolean;
  origin: "current" | "pinned" | "temporary-extract" | "independent-prefix";
};

export type VscodeReferencePickStartedResult = VscodeReferencePickResultBase & {
  status: "started";
  sessionMode?: "target-bound" | "browse";
  candidateReferences: readonly CanonicalGeometrySourceReference[];
  numericCandidates?: readonly VscodeReferencePickNumericCandidate[];
  browseReferences?: readonly CanonicalGeometrySourceReference[];
  browseNumericCandidates?: readonly VscodeReferencePickNumericCandidate[];
};

export type VscodeReferencePickConfirmedResult =
  | (VscodeReferencePickResultBase & {
      status: "confirmed";
      resultKind: "geometry";
      references: readonly CanonicalGeometrySourceReference[];
    })
  | (VscodeReferencePickResultBase & {
      status: "confirmed";
      resultKind: "numericProperty";
      reference: CanonicalGeometrySourceReference;
      property: NumericComputedGeometryProperty;
    });

export type VscodeReferencePickTerminalResult = VscodeReferencePickResultBase & {
  status: "canceled" | "stale" | "rejected";
};

export type VscodeReferencePickExplicitResult = VscodeReferencePickResultBase & {
  status: "explicit-edit" | "copy";
  reference: CanonicalGeometrySourceReference;
  property?: NumericComputedGeometryProperty;
};

export type VscodeReferencePickResult =
  | VscodeReferencePickExplicitResult
  | VscodeReferencePickStartedResult
  | VscodeReferencePickConfirmedResult
  | VscodeReferencePickTerminalResult;

export type VscodeExtensionToReferencePickMessage =
  | VscodeReferencePickStartRequest
  | VscodeReferencePickCancelRequest;

export type VscodeReferencePickToExtensionMessage = VscodeReferencePickResult;

const sameRange = (
  left: { from: number; to: number },
  right: { from: number; to: number }
): boolean => left.from === right.from && left.to === right.to;

const sameStatementRange = (
  left: DslReferencePickSourceAnchor["statementRange"],
  right: DslReferencePickSourceAnchor["statementRange"]
): boolean =>
  left.from === right.from &&
  left.to === right.to &&
  left.startLine === right.startLine &&
  left.endLine === right.endLine;

const validRange = (
  normalizedSource: string,
  range: { from: number; to: number }
): boolean => Number.isInteger(range.from) &&
  Number.isInteger(range.to) &&
  range.from >= 0 &&
  range.to >= range.from &&
  range.to <= normalizedSource.length;

const sameNumericPropertyTarget = (
  left: DslReferencePickTarget["numericProperty"] | null | undefined,
  right: VscodeReferencePickTargetProof["numericProperty"] | null | undefined
): boolean => (left?.kind ?? null) === (right?.kind ?? null);

export const referencePickTargetProofFor = (
  normalizedSource: string,
  target: DslReferencePickTarget
): VscodeReferencePickTargetProof | null => {
  const { from, to } = target.range;
  const activationRange = target.activationRange ?? target.range;
  const numericProperty = target.numericProperty ?? null;
  if (!validRange(normalizedSource, target.range) || !validRange(normalizedSource, activationRange)) return null;
  if (
    target.role === "numericPropertyBase" && !numericProperty
  ) return null;
  return {
    sourceAnchor: {
      statementIndex: target.sourceAnchor.statementIndex,
      statementRange: { ...target.sourceAnchor.statementRange }
    },
    expectedGeometryInterface: target.expectedGeometryInterface,
    role: target.role,
    multiplicity: target.multiplicity,
    range: { from, to },
    activationRange: { ...activationRange },
    oldText: normalizedSource.slice(from, to),
    activationOldText: normalizedSource.slice(activationRange.from, activationRange.to),
    numericProperty,
    ...(target.syntax ? { syntax: target.syntax } : {}),
    ...(target.selectionCount ? { selectionCount: { ...target.selectionCount } } : {})
  };
};

export const referencePickTargetMatchesProof = (
  normalizedSource: string,
  target: DslReferencePickTarget,
  proof: VscodeReferencePickTargetProof
): boolean => {
  const anchor = target.sourceAnchor;
  const expectedAnchor = proof.sourceAnchor;
  return (
    anchor.statementIndex === expectedAnchor.statementIndex &&
    sameStatementRange(anchor.statementRange, expectedAnchor.statementRange) &&
    target.expectedGeometryInterface === proof.expectedGeometryInterface &&
    target.role === proof.role &&
    target.multiplicity === proof.multiplicity &&
    sameRange(target.range, proof.range) &&
    sameRange(target.activationRange ?? target.range, proof.activationRange) &&
    normalizedSource.slice(target.range.from, target.range.to) === proof.oldText &&
    normalizedSource.slice(
      (target.activationRange ?? target.range).from,
      (target.activationRange ?? target.range).to
    ) === proof.activationOldText &&
    sameNumericPropertyTarget(target.numericProperty ?? null, proof.numericProperty) &&
    (target.syntax ?? "reference") === (proof.syntax ?? "reference") &&
    target.selectionCount?.min === proof.selectionCount?.min &&
    target.selectionCount?.max === proof.selectionCount?.max
  );
};

export const isValidNumericReferencePickCandidate = (
  candidate: VscodeReferencePickNumericCandidate
): boolean => isCanonicalReferencePickReference(candidate.reference) &&
  candidate.reference.pointKey === undefined &&
  candidate.properties.length > 0 &&
  new Set(candidate.properties).size === candidate.properties.length &&
  candidate.properties.every((property) => isNumericComputedGeometryProperty(property));

export const referencePickSourceForReference = (
  reference: CanonicalGeometrySourceReference
): string => `@${reference.base}${reference.occurrenceIndex === undefined ? "" : `[${reference.occurrenceIndex}]`}${reference.pointKey === undefined ? "" : `.${reference.pointKey}`}`;

export const referencePickReferenceKey = (
  reference: CanonicalGeometrySourceReference
): string => JSON.stringify([
  reference.base,
  reference.pointKey ?? null,
  ...(reference.occurrenceIndex === undefined ? [] : [String(reference.occurrenceIndex)])
]);

export const isCanonicalReferencePickReference = (
  reference: CanonicalGeometrySourceReference
): boolean => {
  if (typeof reference.base !== "string" || reference.base.length === 0) return false;
  if (reference.pointKey !== undefined && (typeof reference.pointKey !== "string" || reference.pointKey.length === 0)) {
    return false;
  }
  const parsed = parseDslSourceReference(referencePickSourceForReference(reference));
  if (parsed.kind !== "valid") return false;
  return (
    formatDslReferencePath(parsed.reference.path) === reference.base &&
    (parsed.reference.occurrenceIndex ?? undefined) === (reference.occurrenceIndex === undefined ? undefined : String(reference.occurrenceIndex)) &&
    (parsed.reference.property ?? undefined) === reference.pointKey
  );
};

const referenceFromParsedSource = (
  reference: DslSourceReference
): CanonicalGeometrySourceReference => ({
  base: formatDslReferencePath(reference.path),
  ...(reference.occurrenceIndex === null ? {} : { occurrenceIndex: reference.occurrenceIndex }),
  ...(reference.property === null ? {} : { pointKey: reference.property })
});

const parseOneReference = (source: string): CanonicalGeometrySourceReference | null => {
  const parsed = parseDslSourceReference(source);
  return parsed.kind === "valid" ? referenceFromParsedSource(parsed.reference) : null;
};

const parseReferenceList = (source: string): CanonicalGeometrySourceReference[] | null => {
  let start = 0;
  let end = source.length;
  while (start < end && /\s/.test(source[start]!)) start += 1;
  while (end > start && /\s/.test(source[end - 1]!)) end -= 1;
  if (source[start] !== "[") return null;
  const closed = source[end - 1] === "]";
  let cursor = start + 1;
  const limit = closed ? end - 1 : end;
  const references: CanonicalGeometrySourceReference[] = [];
  for (;;) {
    while (cursor < limit && /\s/.test(source[cursor]!)) cursor += 1;
    if (cursor === limit) return references;
    // Only a final empty slot or bare sigil is an authoring hole. Earlier
    // items still go through the canonical parser and must be fully valid.
    if (source.slice(cursor, limit).trim() === "@") return references;
    if (source[cursor] !== "@") return null;
    const parsed = parseDslSourceReferenceAt(source, cursor, limit);
    if (parsed.kind !== "valid") return null;
    references.push(referenceFromParsedSource(parsed.reference));
    cursor = parsed.end;
    while (cursor < limit && /\s/.test(source[cursor]!)) cursor += 1;
    if (cursor === limit) return closed ? references : null;
    if (source[cursor] !== ",") return null;
    cursor += 1;
  }
};

export const referencePickSeedReferences = (
  proof: VscodeReferencePickTargetProof | null
): readonly CanonicalGeometrySourceReference[] | null => {
  if (!proof) return null;
  const text = proof.oldText.trim();
  if (text === "" || text === "@") return [];
  if (text.startsWith("[") && (proof.multiplicity === "multiple" || proof.syntax === "transformationTarget")) {
    const references = parseReferenceList(proof.oldText);
    // Single-target authoring can also arrive from an incomplete list. Keep
    // its sole valid prefix, but never truncate an ambiguous multi-item seed.
    if (references && proof.multiplicity === "single" && references.length > 1) return null;
    return references ?? (proof.syntax === "transformationTarget" ? null : []);
  }
  const parsed = parseOneReference(proof.oldText);
  return parsed ? [parsed] : proof.syntax === "transformationTarget" ? null : [];
};

/**
 * Seeds the shared numeric-property Pick draft only for a complete
 * `@Geometry.property` source operand. Numeric literals and scalar variables
 * intentionally return no Canvas selection seed.
 */
export const referencePickNumericPropertyDraftFor = (
  proof: VscodeReferencePickTargetProof
): VscodeReferencePickNumericPropertyDraft | null => {
  if (proof.role !== "numericPropertyBase" || !proof.numericProperty) return null;
  const parsed = parseDslSourceReference(proof.oldText);
  if (
    parsed.kind !== "valid" ||
    parsed.reference.property === null ||
    !isNumericComputedGeometryProperty(parsed.reference.property)
  ) return null;
  return {
    reference: {
      base: formatDslReferencePath(parsed.reference.path),
      ...(parsed.reference.occurrenceIndex === null ? {} : { occurrenceIndex: parsed.reference.occurrenceIndex })
    },
    property: parsed.reference.property
  };
};

export const referencePickReplacementText = (
  multiplicity: DslReferencePickTarget["multiplicity"],
  references: readonly CanonicalGeometrySourceReference[]
): string | null => {
  if (!references.every(isCanonicalReferencePickReference)) return null;
  if (multiplicity === "single") {
    return references.length === 1 ? referencePickSourceForReference(references[0]!) : null;
  }
  return `[${references.map((reference) => referencePickSourceForReference(reference)).join(", ")}]`;
};

export const sameReferencePickTargetProof = (
  left: VscodeReferencePickTargetProof | null,
  right: VscodeReferencePickTargetProof | null
): boolean =>
  (!left || !right) ? left === right :
  left.sourceAnchor.statementIndex === right.sourceAnchor.statementIndex &&
  sameStatementRange(left.sourceAnchor.statementRange, right.sourceAnchor.statementRange) &&
  left.expectedGeometryInterface === right.expectedGeometryInterface &&
  left.role === right.role &&
  left.multiplicity === right.multiplicity &&
  sameRange(left.range, right.range) &&
  sameRange(left.activationRange, right.activationRange) &&
  left.oldText === right.oldText &&
  left.activationOldText === right.activationOldText &&
  sameNumericPropertyTarget(left.numericProperty, right.numericProperty) &&
  (left.syntax ?? "reference") === (right.syntax ?? "reference") &&
  left.selectionCount?.min === right.selectionCount?.min &&
  left.selectionCount?.max === right.selectionCount?.max;
