import type { ElementId } from "../types/geometry";
import type { StatementIdentity } from "../document/statementIdentity";
import type { CompiledDslDocument, StatementInfo, StatementMap } from "./dslDocument";
import type { ModuleMaterialization, ModuleOrigin } from "./moduleMaterialization";

export type SourceOwnerKind = "ordinary" | "moduleInstance" | "moduleBody";

/**
 * The authored statement that owns a runtime element.
 *
 * This is deliberately a lookup result, not another identity registry. Runtime
 * IDs and module origins remain owned by moduleMaterialization; current source
 * ranges remain owned by StatementMap.
 */
export type SourceOwner = {
  runtimeElementId: ElementId;
  kind: SourceOwnerKind;
  sourceStatementId: StatementIdentity;
  sourceStatementIndex: number;
  statement: StatementInfo;
  origin?: ModuleOrigin;
};

export type SourceOwnershipDocument = Pick<
  CompiledDslDocument,
  "statementMap" | "moduleMaterialization"
> & {
  statementMap: StatementMap;
};

const ordinarySourceStatementId = (
  statementMap: StatementMap,
  statement: StatementInfo,
  elementId: ElementId
): StatementIdentity =>
  statementMap.statementIdByStatementIndex?.get(statement.statementIndex) ?? elementId;

const ownerFromOrigin = (
  statementMap: StatementMap,
  runtimeElementId: ElementId,
  origin: ModuleOrigin
): SourceOwner | null => {
  const statement = statementMap.statementRangeById.get(origin.sourceStatementId);
  if (!statement) return null;
  return {
    runtimeElementId,
    kind: origin.kind,
    sourceStatementId: origin.sourceStatementId,
    sourceStatementIndex: origin.sourceStatementIndex,
    statement,
    origin
  };
};

/** Resolve a runtime ElementId to its authored source statement. */
export const sourceOwnerForRuntimeElementId = (
  document: SourceOwnershipDocument,
  runtimeElementId: ElementId
): SourceOwner | null => {
  const materialization: ModuleMaterialization | undefined = document.moduleMaterialization;
  const origin = materialization?.originByRuntimeElementId.get(runtimeElementId);
  if (origin) {
    // A stale origin must fail closed. Falling through to byElementId here
    // would make a materialized child appear to own a runtime statement.
    return ownerFromOrigin(document.statementMap, runtimeElementId, origin);
  }

  const statement = document.statementMap.byElementId.get(runtimeElementId);
  if (!statement) return null;
  return {
    runtimeElementId,
    kind: "ordinary",
    sourceStatementId: ordinarySourceStatementId(document.statementMap, statement, runtimeElementId),
    sourceStatementIndex: statement.statementIndex,
    statement
  };
};

/** Build the source-owner view used by editor/navigation consumers. */
export const sourceOwnerByRuntimeElementId = (
  document: SourceOwnershipDocument
): ReadonlyMap<ElementId, SourceOwner> => {
  const owners = new Map<ElementId, SourceOwner>();
  for (const elementId of document.statementMap.byElementId.keys()) {
    const owner = sourceOwnerForRuntimeElementId(document, elementId);
    if (owner) owners.set(elementId, owner);
  }
  for (const elementId of document.moduleMaterialization?.originByRuntimeElementId.keys() ?? []) {
    const owner = sourceOwnerForRuntimeElementId(document, elementId);
    if (owner) owners.set(elementId, owner);
  }
  return owners;
};
