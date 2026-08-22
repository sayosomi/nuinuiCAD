import type {
  DslReferencePickMultiplicity,
  DslReferencePickRole
} from "../dsl/dslReferencePickQuery";
import type { ModuleGeometryInterfaceType } from "../dsl/moduleGeometryInterfaces";
import type { ElementId } from "../types/geometry";
import type { CanonicalGeometrySourceReference } from "./moduleSemanticCandidateBoundary";

export type ReferencePickSessionStatus = "active" | "confirmed" | "canceled";

export type ReferencePickHover = {
  candidateElementId: ElementId;
  reference: CanonicalGeometrySourceReference;
};

export type ReferencePickSession = {
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
  hover: ReferencePickHover | null;
  draftReferences: readonly CanonicalGeometrySourceReference[];
  status: ReferencePickSessionStatus;
};

export type StartReferencePickSessionInput = {
  expectedGeometryInterface: ModuleGeometryInterfaceType;
  role: DslReferencePickRole;
  multiplicity: DslReferencePickMultiplicity;
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
  seedReferences = []
}: StartReferencePickSessionInput): ReferencePickSession => ({
  expectedGeometryInterface,
  role,
  multiplicity,
  hover: null,
  draftReferences: multiplicity === "multiple" ? uniqueReferences(seedReferences) : [],
  status: "active"
});

export const setReferencePickHover = (
  session: ReferencePickSession,
  hover: ReferencePickHover | null
): ReferencePickSession => session.status !== "active"
  ? session
  : { ...session, hover };

export const selectReferencePickDraft = (
  session: ReferencePickSession,
  selection: ReferencePickHover | null
): ReferencePickSession => {
  if (session.status !== "active" || !selection) return session;
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
): ReferencePickSession => session.status !== "active"
  ? session
  : { ...session, hover: null, status: "confirmed" };

export const cancelReferencePickSession = (
  session: ReferencePickSession
): ReferencePickSession => session.status !== "active"
  ? session
  : { ...session, hover: null, status: "canceled" };

export const confirmedReferencePickResult = (
  session: ReferencePickSession
): readonly CanonicalGeometrySourceReference[] | null =>
  session.status === "confirmed" ? session.draftReferences : null;
