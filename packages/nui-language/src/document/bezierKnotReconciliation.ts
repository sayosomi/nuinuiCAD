import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import { bezierKnotFields, parseBezierKnots } from "../dsl/dslBezierKnots";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { DslStatement } from "../dsl/dslTypes";
import type { CadElement } from "../types/geometry";
import { createCadElementId } from "../model/cadIds";

const fieldsFor = (statement: DslStatement) => {
  if (statement.kind !== "element" || statement.type !== "bezierCurve") return [];
  const source = statement.attrs.find(arg => arg.key === "intermediates")?.value ?? "[]";
  return parseBezierKnots(source, { start: 0, end: source.length }).knots.map(knot =>
    bezierKnotFields.map(field => knot.args.find(arg => arg.key === field)?.value ?? "")
  );
};

/** Match knots only with unique, reciprocal source proof. Position never proves identity. */
export const reconcileBezierKnotIds = (
  previous: CompiledDslDocument,
  statements: readonly DslStatement[],
  statementIds: ReadonlyMap<number, string>
): ReadonlyMap<number, readonly string[]> => {
  const assigned = new Map<number, readonly string[]>();
  const oldById = new Map([...(previous.statementMap?.statementIdByStatementIndex ?? previous.statementMap?.elementIdByStatementIndex) ?? []].map(([index, id]) => [id, index]));
  const curvesByOwner = new Map<string, Extract<CadElement, { type: "bezierCurve" }>[]>();
  for (const element of previous.document?.elements ?? []) {
    if (element.type !== "bezierCurve") continue;
    const owner = previous.statementMap ? sourceOwnerForRuntimeElementId({ ...previous, statementMap: previous.statementMap }, element.id) : null;
    if (owner?.sourceDocumentId && owner.sourceDocumentId !== previous.moduleRuntimeContext?.rootDocumentId) continue;
    const id = owner?.sourceStatementId ?? element.id;
    const candidates = curvesByOwner.get(id) ?? [];
    candidates.push(element);
    curvesByOwner.set(id, candidates);
  }
  for (const [index, id] of statementIds) {
    const statement = statements[index];
    if (!statement || statement.kind !== "element" || statement.type !== "bezierCurve") continue;
    const oldIndex = oldById.get(id);
    const oldStatement = oldIndex === undefined ? undefined : previous.statements[oldIndex];
    const candidates = curvesByOwner.get(id) ?? [];
    const element = new Set(candidates.map(element => element.type === "bezierCurve" ? JSON.stringify(element.intermediatePoints.map(knot => knot.id)) : "")).size === 1 ? candidates[0] : undefined;
    const oldFields = oldStatement ? fieldsFor(oldStatement) : [];
    const newFields = fieldsFor(statement);
    const oldIds = element?.type === "bezierCurve" && element.intermediatePoints.length === oldFields.length
      ? element.intermediatePoints.map(knot => knot.id) : [];
    const result = newFields.map(() => createCadElementId("bezierCurve"));
    const matchedOld = new Set<number>();
    const matchedNew = new Set<number>();
    for (const minimumEqual of [4, 3]) {
      const matches = (left: readonly string[], right: readonly string[]) => left.filter((field, i) => field === right[i]).length >= minimumEqual;
      for (const [newIndex, fields] of newFields.entries()) {
        if (matchedNew.has(newIndex)) continue;
        const candidates = oldFields.flatMap((old, i) => !matchedOld.has(i) && matches(old, fields) ? [i] : []);
        if (candidates.length !== 1) continue;
        const candidate = candidates[0]!;
        if (matchedOld.has(candidate) || !oldIds[candidate]) continue;
        if (newFields.filter((next, i) => !matchedNew.has(i) && matches(oldFields[candidate]!, next)).length !== 1) continue;
        result[newIndex] = oldIds[candidate]!;
        matchedNew.add(newIndex);
        matchedOld.add(candidate);
      }
    }
    assigned.set(index, result);
  }
  return assigned;
};

type KnotSnapshot = ReadonlyMap<string, readonly string[]>;
const history = new WeakMap<CompiledDslDocument, Map<string, KnotSnapshot | null>>();
const snapshot = (document: CompiledDslDocument): KnotSnapshot => {
  const result = new Map<string, readonly string[]>();
  const ambiguous = new Set<string>();
  for (const element of document.document?.elements ?? []) {
    if (element.type !== "bezierCurve") continue;
    const owner = document.statementMap ? sourceOwnerForRuntimeElementId({ ...document, statementMap: document.statementMap }, element.id) : null;
    if (owner?.sourceDocumentId && owner.sourceDocumentId !== document.moduleRuntimeContext?.rootDocumentId) continue;
    const id = owner?.sourceStatementId ?? element.id;
    const ids = element.intermediatePoints.map(knot => knot.id);
    if (result.has(id) && JSON.stringify(result.get(id)) !== JSON.stringify(ids)) ambiguous.add(id);
    else result.set(id, ids);
  }
  for (const id of ambiguous) result.delete(id);
  return result;
};

/** Bounded session-only revision history restores identity for native Source Undo/Redo. Nothing is persisted. */
export const knotIdsForRevision = (previous: CompiledDslDocument, source: string, statements: readonly DslStatement[], statementIds: ReadonlyMap<number, string>, restoreHistory = false) => {
  const revisions = history.get(previous) ?? new Map<string, KnotSnapshot | null>();
  history.set(previous, revisions);
  const previousSource = previous.spans.sourceMap.source;
  const current = snapshot(previous);
  const saved = revisions.get(previousSource);
  if (saved === undefined) revisions.set(previousSource, current);
  else if (saved && (saved.size !== current.size || [...saved].some(([id, ids]) => JSON.stringify(ids) !== JSON.stringify(current.get(id))))) {
    // The same text can be authored again with different knot identities.
    // Text alone cannot distinguish those historical revisions.
    revisions.set(previousSource, null);
  }
  const restored = restoreHistory ? revisions.get(source) : undefined;
  const ids = new Map(reconcileBezierKnotIds(previous, statements, statementIds));
  if (restored) for (const [index, id] of statementIds) {
    const saved = restored.get(id);
    const fields = statements[index] ? fieldsFor(statements[index]!) : [];
    // Duplicate knots have no unique target proof, even in a historical revision.
    if (saved && saved.length === fields.length && new Set(fields.map(value => JSON.stringify(value))).size === fields.length) ids.set(index, saved);
  }
  return { ids, retain: (next: CompiledDslDocument) => {
    while (revisions.size > 100) revisions.delete(revisions.keys().next().value!);
    history.set(next, revisions);
  } };
};
