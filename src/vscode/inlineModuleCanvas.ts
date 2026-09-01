import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  sourceOwnerForRuntimeElementId,
  type SourceOwner
} from "../dsl/sourceOwnership";
import type {
  MaterializedRuntimeIdentity,
  ModuleMaterialization,
  ModuleOrigin
} from "../dsl/moduleMaterialization";
import type { ElementId } from "../types/geometry";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { CadElement } from "../types/geometry";
import type { VscodeInlineModuleCanvasTargetProof } from "./inlineModuleProtocol";

/** The narrow materialization view available to Canvas, including graph-backed views. */
export type InlineModuleCanvasMaterialization = {
  originByRuntimeElementId: ReadonlyMap<
    ElementId,
    Pick<ModuleOrigin, "kind" | "instancePath" | "runtimeInstancePath">
  >;
  runtimeIdentityByElementId?: ReadonlyMap<
    ElementId,
    Pick<MaterializedRuntimeIdentity, "kind" | "path" | "key">
  >;
};

export type InlineModuleCanvasTargetProjectionInput = {
  source: SourceSnapshot;
  compiled: Pick<CompiledDslDocument, "statements" | "statementMap" | "moduleMaterialization">;
  elements: readonly CadElement[];
  selectedElementIds: readonly string[];
  moduleMaterialization?: InlineModuleCanvasMaterialization;
};

const sourcePathFor = (
  owner: SourceOwner,
  compiled: InlineModuleCanvasTargetProjectionInput["compiled"],
  moduleMaterialization: InlineModuleCanvasMaterialization
): readonly number[] | null => {
  const path = owner.origin?.instancePath ??
    moduleMaterialization.runtimeIdentityByElementId?.get(owner.runtimeElementId)?.path;
  const statementIndexes = compiled.statementMap?.statementIndexByStatementId;
  if (!path || path.length === 0 || !statementIndexes) return null;
  const indexes = path.map((statementId) => statementIndexes.get(statementId));
  return indexes.every((index): index is number => index !== undefined && Number.isInteger(index) && index >= 0)
    ? indexes
    : null;
};

/**
 * Projects only currently selected concrete module-instance runtime elements.
 * This intentionally does not consume canvasObservation.selectedElementSources:
 * that surface is the ordinary-owner projection and remains unchanged.
 */
export const inlineModuleCanvasTargetProofsFor = ({
  source,
  compiled,
  elements,
  selectedElementIds,
  moduleMaterialization
}: InlineModuleCanvasTargetProjectionInput): readonly VscodeInlineModuleCanvasTargetProof[] => {
  if (
    source.normalizedSource.includes("\r") ||
    !compiled.statementMap ||
    !moduleMaterialization
  ) return [];

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const proofs: VscodeInlineModuleCanvasTargetProof[] = [];
  for (const runtimeElementId of selectedElementIds) {
    const element = elementsById.get(runtimeElementId);
    if (element?.type !== "moduleInstance") continue;

    // The cast is limited to this adapter: sourceOwnership only reads the
    // origin map here, while the optional runtime-identity map is used for
    // the path proof below.
    const owner = sourceOwnerForRuntimeElementId({
      statementMap: compiled.statementMap,
      moduleMaterialization: moduleMaterialization as ModuleMaterialization
    }, runtimeElementId);
    if (!owner || owner.kind !== "moduleInstance") continue;
    if (owner.source?.kind === "dependency-saved") continue;

    const statement = compiled.statements?.[owner.sourceStatementIndex];
    const statementId = compiled.statementMap.statementIdByStatementIndex?.get(owner.sourceStatementIndex);
    const path = sourcePathFor(owner, compiled, moduleMaterialization);
    if (
      !statement ||
      statement.kind !== "moduleInstance" ||
      !statementId ||
      owner.sourceStatementId !== statementId ||
      !path ||
      statement.sourceRevision !== source.sourceRevision ||
      statement.documentRange.sourceRevision !== source.sourceRevision ||
      statement.documentRange.from < 0 ||
      statement.documentRange.to <= statement.documentRange.from ||
      statement.documentRange.to > source.normalizedSource.length
    ) continue;

    proofs.push({
      runtimeElementId,
      sourceStatementId: owner.sourceStatementId,
      sourceStatementIndex: owner.sourceStatementIndex,
      sourceStatementPath: path,
      sourceRange: {
        from: statement.documentRange.from,
        to: statement.documentRange.to
      }
    });
  }

  return proofs
    .sort((left, right) =>
      left.sourceStatementIndex - right.sourceStatementIndex ||
      left.sourceStatementPath.length - right.sourceStatementPath.length ||
      left.sourceStatementPath.reduce((difference, value, index) =>
        difference || value - (right.sourceStatementPath[index] ?? value), 0) ||
      left.runtimeElementId.localeCompare(right.runtimeElementId)
    )
    .filter((proof, index, all) => index === 0 || proof.sourceStatementIndex !== all[index - 1]!.sourceStatementIndex);
};
