import type {
  DslReferencePickMultiplicity,
  DslReferencePickRole,
  DslReferencePickNumericPropertyTarget
} from "../dsl/dslReferencePickQuery";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { ModuleGeometryInterfaceType } from "../dsl/moduleGeometryInterfaces";
import type { ElementId } from "../types/geometry";
import type { CanonicalGeometrySourceReference } from "./moduleSemanticCandidateBoundary";

export type ReferencePickSessionStatus = "active" | "confirmed" | "canceled";

export type ReferencePickHover = {
  candidateElementId: ElementId;
  reference: CanonicalGeometrySourceReference;
};

export type ReferencePickNumericPropertyDraft = {
  candidateElementId: ElementId;
  reference: CanonicalGeometrySourceReference;
  property: NumericMeasurementKey;
};

export type ReferencePickNumericPropertySession = {
  target: DslReferencePickNumericPropertyTarget;
  stage: "geometrySelection" | "propertySelection" | "draft";
  selectedGeometry: ReferencePickHover | null;
  properties: readonly NumericMeasurementKey[];
  draft: ReferencePickNumericPropertyDraft | null;
};

export type ReferencePickSession = {
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
  hover: ReferencePickHover | null;
  draftReferences: readonly CanonicalGeometrySourceReference[];
  numericProperty: ReferencePickNumericPropertySession | null;
  status: ReferencePickSessionStatus;
};

export type StartReferencePickSessionInput = {
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
  numericProperty?: DslReferencePickNumericPropertyTarget;
  seedReferences?: readonly CanonicalGeometrySourceReference[];
};

export const referencePickDraftKey = (
  reference: CanonicalGeometrySourceReference
) => JSON.stringify([reference.base, reference.pointKey ?? null]);

const uniqueReferences = (
  references: readonly CanonicalGeometrySourceReference[]
): CanonicalGeometrySourceReference[] => {
  const seen = new Set<string>();
  const result: CanonicalGeometrySourceReference[] = [];
  for (const reference of references) {
    const key = referencePickDraftKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
};

export const startReferencePickSession = ({
  expectedGeometryInterface,
  role,
  multiplicity,
  numericProperty,
  seedReferences = []
}: StartReferencePickSessionInput): ReferencePickSession => {
  return {
    expectedGeometryInterface,
    role,
    multiplicity,
    hover: null,
    draftReferences: uniqueReferences(seedReferences).slice(0, multiplicity === "single" ? 1 : undefined),
    numericProperty: numericProperty
      ? {
          target: numericProperty,
          stage: "geometrySelection",
          selectedGeometry: null,
          properties: [],
          draft: null
        }
      : null,
    status: "active"
  };
};

export const setReferencePickHover = (
  session: ReferencePickSession,
  hover: ReferencePickHover | null
): ReferencePickSession => session.status !== "active"
  ? session
  : { ...session, hover };

const numericPropertySessionFor = (
  session: ReferencePickSession
): ReferencePickNumericPropertySession | null =>
  session.role === "numericPropertyBase" ? session.numericProperty : null;

export const selectReferencePickNumericGeometry = (
  session: ReferencePickSession,
  selection: ReferencePickHover,
  properties: readonly NumericMeasurementKey[]
): ReferencePickSession => {
  const numeric = numericPropertySessionFor(session);
  if (session.status !== "active" || !numeric) return session;
  if (numeric.target.kind === "fixedProperty") {
    if (!properties.includes(numeric.target.property)) return session;
    return {
      ...session,
      hover: selection,
      numericProperty: {
        ...numeric,
        stage: "draft",
        selectedGeometry: selection,
        properties,
        draft: {
          candidateElementId: selection.candidateElementId,
          reference: selection.reference,
          property: numeric.target.property
        }
      }
    };
  }
  return {
    ...session,
    hover: selection,
    numericProperty: {
      ...numeric,
      stage: "propertySelection",
      selectedGeometry: selection,
      properties,
      draft: null
    }
  };
};

export const selectReferencePickNumericProperty = (
  session: ReferencePickSession,
  property: NumericMeasurementKey
): ReferencePickSession => {
  const numeric = numericPropertySessionFor(session);
  if (
    session.status !== "active" ||
    !numeric ||
    numeric.stage !== "propertySelection" ||
    !numeric.selectedGeometry ||
    !numeric.properties.includes(property)
  ) return session;
  return {
    ...session,
    numericProperty: {
      ...numeric,
      stage: "draft",
      draft: {
        candidateElementId: numeric.selectedGeometry.candidateElementId,
        reference: numeric.selectedGeometry.reference,
        property
      }
    }
  };
};

export const seedReferencePickNumericPropertyDraft = (
  session: ReferencePickSession,
  selection: ReferencePickNumericPropertyDraft,
  properties: readonly NumericMeasurementKey[]
): ReferencePickSession => {
  const numeric = numericPropertySessionFor(session);
  if (
    session.status !== "active" ||
    !numeric ||
    !properties.includes(selection.property) ||
    (numeric.target.kind === "fixedProperty" && numeric.target.property !== selection.property)
  ) return session;
  const hover: ReferencePickHover = {
    candidateElementId: selection.candidateElementId,
    reference: selection.reference
  };
  return {
    ...session,
    hover,
    numericProperty: {
      ...numeric,
      stage: "draft",
      selectedGeometry: hover,
      properties,
      draft: selection
    }
  };
};

export const selectReferencePickDraft = (
  session: ReferencePickSession,
  selection: ReferencePickHover | null
): ReferencePickSession => {
  if (session.status !== "active") return session;
  if (session.role === "numericPropertyBase") {
    const numeric = numericPropertySessionFor(session);
    if (!selection) {
      return numeric
        ? {
            ...session,
            hover: null,
            numericProperty: {
              ...numeric,
              stage: "geometrySelection",
              selectedGeometry: null,
              properties: [],
              draft: null
            }
          }
        : session;
    }
    return selectReferencePickNumericGeometry(session, selection, []);
  }
  if (!selection) return session;
  const reference = selection.reference;
  if (session.multiplicity === "single") {
    return {
      ...session,
      hover: selection,
      draftReferences: [reference]
    };
  }

  const key = referencePickDraftKey(reference);
  const existingIndex = session.draftReferences.findIndex(
    (candidate) => referencePickDraftKey(candidate) === key
  );
  return {
    ...session,
    hover: selection,
    draftReferences: existingIndex >= 0
      ? session.draftReferences.filter((_, index) => index !== existingIndex)
      : [...session.draftReferences, reference]
  };
};

export const confirmReferencePickSession = (
  session: ReferencePickSession
): ReferencePickSession => {
  if (session.status !== "active") return session;
  if (session.role === "numericPropertyBase") {
    return session.numericProperty?.draft
      ? { ...session, hover: null, status: "confirmed" }
      : session;
  }
  if (session.multiplicity === "single" && session.draftReferences.length !== 1) return session;
  return { ...session, hover: null, status: "confirmed" };
};

export const cancelReferencePickSession = (
  session: ReferencePickSession
): ReferencePickSession => session.status !== "active"
  ? session
  : { ...session, hover: null, status: "canceled" };

export const confirmedReferencePickResult = (
  session: ReferencePickSession
): readonly CanonicalGeometrySourceReference[] | null =>
  session.status === "confirmed" && session.role !== "numericPropertyBase" ? session.draftReferences : null;

export const confirmedReferencePickNumericResult = (
  session: ReferencePickSession
): ReferencePickNumericPropertyDraft | null =>
  session.status === "confirmed" && session.role === "numericPropertyBase"
    ? session.numericProperty?.draft ?? null
    : null;
