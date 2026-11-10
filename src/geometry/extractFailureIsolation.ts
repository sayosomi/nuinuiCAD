import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import { geometryValueOccurrenceKey } from "@nuinuicad/nui-language";

export type ExtractFailureIsolation = { elementIds: readonly string[]; valueSourceStatementIds: readonly string[] };

/** Compiler-owned part identities, closed over the existing dependency graph.
 * This metadata only permits retaining successful siblings in a failed Module;
 * it never makes an invalid part or the whole instance successful. */
export const extractFailureIsolationFor = (compiled: CompiledDslDocument): ExtractFailureIsolation | undefined => {
  const graph = compiled.typedDependencyGraph, map = compiled.statementMap;
  if (!graph || !map) return undefined;
  const statementIds = new Set(compiled.statements.flatMap((statement, index) =>
    statement.kind === "element" && statement.extractPart ? [map.statementIdByStatementIndex?.get(index)].filter((id): id is string => Boolean(id)) : []));
  if (!statementIds.size) return undefined;
  const reached = new Set<string>();
  for (const [index, id] of map.elementIdByStatementIndex) if (statementIds.has(map.statementIdByStatementIndex?.get(index) ?? "")) reached.add(`element:${id}`);
  for (const [id, origin] of compiled.moduleMaterialization?.originByRuntimeElementId ?? []) if (statementIds.has(origin.sourceStatementId)) reached.add(`element:${id}`);
  for (const entry of compiled.geometryValueProgram ?? []) if (statementIds.has(entry.sourceStatementId)) reached.add(`geometry-value:${geometryValueOccurrenceKey(entry.occurrence)}`);
  const reverse = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const key = `${edge.to.kind}:${edge.to.id}`;
    const list = reverse.get(key) ?? []; list.push(`${edge.from.kind}:${edge.from.id}`); reverse.set(key, list);
  }
  const pending = [...reached];
  for (let i = 0; i < pending.length; i++) for (const id of reverse.get(pending[i]) ?? []) if (!reached.has(id)) { reached.add(id); pending.push(id); }
  for (const entry of compiled.geometryValueProgram ?? []) if (reached.has(`geometry-value:${geometryValueOccurrenceKey(entry.occurrence)}`)) statementIds.add(entry.sourceStatementId);
  return { elementIds: [...reached].filter(id => id.startsWith("element:")).map(id => id.slice(8)), valueSourceStatementIds: [...statementIds] };
};
