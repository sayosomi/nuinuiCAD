import type { CompiledDslDocument, SourceSnapshot } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";

export type ModuleInstanceHostProjection = {
  statementId: StatementIdentity;
  statementIndex: number;
};

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && value >= 0;

const sameNumberPath = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Resolve a structural Canvas Module-instance path against the current Host compile. */
export const moduleInstanceHostProjectionFor = ({
  sourceStatementPath,
  source,
  compiled
}: {
  sourceStatementPath: unknown;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
}): ModuleInstanceHostProjection | null => {
  if (
    !Array.isArray(sourceStatementPath) ||
    sourceStatementPath.length === 0 ||
    !sourceStatementPath.every(isNonNegativeInteger)
  ) return null;

  const statementMap = compiled.statementMap;
  const materialization = compiled.moduleMaterialization;
  if (
    !statementMap ||
    !materialization ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    statementMap.sourceRevision !== source.sourceRevision ||
    !statementMap.statementIdByStatementIndex ||
    !statementMap.statementIndexByStatementId
  ) return null;

  const statementIdsByIndex = statementMap.statementIdByStatementIndex;
  const statementIndexesById = statementMap.statementIndexByStatementId;
  const candidates: ModuleInstanceHostProjection[] = [];

  for (const runtimeElementId of materialization.originByRuntimeElementId.keys()) {
    const owner = sourceOwnerForRuntimeElementId({
      statementMap,
      moduleMaterialization: materialization,
      moduleRuntimeContext: compiled.moduleRuntimeContext
    }, runtimeElementId);
    if (
      !owner ||
      owner.kind !== "moduleInstance" ||
      owner.source?.kind === "dependency-saved"
    ) continue;

    const runtimeIdentity = materialization.runtimeIdentityByElementId.get(runtimeElementId);
    const statementPath = owner.origin?.instancePath ?? runtimeIdentity?.path;
    if (!statementPath || statementPath.length === 0) continue;

    const indexPath = statementPath.map((statementId) => statementIndexesById.get(statementId));
    if (
      !indexPath.every(isNonNegativeInteger) ||
      !sameNumberPath(indexPath, sourceStatementPath)
    ) continue;

    const statementIndex = indexPath.at(-1);
    if (
      statementIndex === undefined ||
      owner.sourceStatementIndex !== statementIndex ||
      owner.sourceStatementId !== statementIdsByIndex.get(statementIndex)
    ) continue;

    const statement = compiled.statements[statementIndex];
    const statementInfo = statementMap.statements[statementIndex];
    const statementInfoById = statementMap.statementRangeById.get(owner.sourceStatementId);
    if (
      !statement ||
      statement.kind !== "moduleInstance" ||
      statement.sourceRevision !== source.sourceRevision ||
      statement.documentRange.sourceRevision !== source.sourceRevision ||
      !statementInfo ||
      statementInfo.statementIndex !== statementIndex ||
      statementInfo.sourceRevision !== source.sourceRevision ||
      !statementInfoById ||
      statementInfoById.statementIndex !== statementIndex ||
      statementInfoById.sourceRevision !== source.sourceRevision
    ) continue;

    candidates.push({
      statementId: owner.sourceStatementId,
      statementIndex
    });
  }

  return candidates.length === 1 ? candidates[0]! : null;
};
