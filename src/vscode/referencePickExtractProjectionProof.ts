import {
  physicalToLogicalOffset,
  referencePickStatementIdentityAt,
  type CompiledDslDocument,
  type DslReferencePickTarget,
  type SourceSnapshot
} from "@nuinuicad/nui-language";

export const sameSavedCandidateSources = (current: CompiledDslDocument, pinned: CompiledDslDocument): boolean => {
  const currentContext = current.moduleRuntimeContext;
  const pinnedContext = pinned.moduleRuntimeContext;
  if (!currentContext && !pinnedContext) return true;
  if (!currentContext?.valid || !pinnedContext?.valid ||
      currentContext.rootDocumentId !== pinnedContext.rootDocumentId) return false;
  const currentFingerprints = currentContext.graph.dependencyFingerprints;
  const pinnedFingerprints = pinnedContext.graph.dependencyFingerprints;
  return currentFingerprints.size === pinnedFingerprints.size &&
    [...pinnedFingerprints].every(([documentId, fingerprint]) => currentFingerprints.get(documentId) === fingerprint);
};


/** Only a parser-owned, empty right boundary can receive Pick's temporary end.
 * This proof is intentionally separate from ordinary saved Canvas reanchoring. */
export const isEmptyExtractRightBoundary = (compiled: CompiledDslDocument, target: DslReferencePickTarget): boolean => {
  const head = compiled.statements[target.sourceAnchor.statementIndex];
  const map = compiled.spans.sourceMap;
  const logical = map.statements.find(s => s.range.from === head?.documentRange.from && s.range.to === head.documentRange.to);
  if (head?.kind !== "extract" || !logical || target.range.from !== target.range.to ||
    target.sourceAnchor.sourceRevision !== map.sourceRevision) return false;
  const offset = physicalToLogicalOffset(map, logical, target.range.from);
  return head.parts.filter(p => p.right === "" && p.rightSpan.start === offset && p.rightSpan.end === offset).length === 1;
};

export const proveTemporarilyCompletedExtract = ({ target, currentCompiled: current, canvasSnapshot: snapshot }: {
  target: DslReferencePickTarget;
  currentCompiled: CompiledDslDocument;
  canvasSnapshot: { source: SourceSnapshot; compiled: CompiledDslDocument };
}): DslReferencePickTarget | null => {
  const candidate = snapshot.compiled;
  const original = current.spans.sourceMap;
  if (!sameSavedCandidateSources(current, candidate)) return null;
  const { from, to } = target.range;
  if (!isEmptyExtractRightBoundary(current, target) || !candidate.document ||
    snapshot.source.sourceRevision !== original.sourceRevision + 1 ||
    candidate.spans.sourceMap.sourceRevision !== snapshot.source.sourceRevision ||
    candidate.statementMap?.sourceRevision !== snapshot.source.sourceRevision ||
    current.statementMap?.sourceRevision !== original.sourceRevision ||
    snapshot.source.normalizedSource !== original.source.slice(0, from) + "end" + original.source.slice(to) ||
    candidate.spans.sourceMap.source !== snapshot.source.normalizedSource ||
    current.statements.length !== candidate.statements.length) return null;
  const headIndex = target.sourceAnchor.statementIndex;
  const head = current.statements[headIndex];
  const completed = candidate.statements[headIndex];
  if (head?.kind !== "extract" || completed?.kind !== "extract" ||
    referencePickStatementIdentityAt(current, headIndex) !== target.sourceAnchor.statementId ||
    current.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(headIndex) !== target.sourceAnchor.scopeId ||
    head.parts.length !== completed.parts.length) return null;
  const seen = new Set<string>();
  const parts = new Set<number>();
  for (const [index, before] of current.statements.entries()) {
    const after = candidate.statements[index]!;
    // Version declarations intentionally have no reconciler identity.
    const id = referencePickStatementIdentityAt(current, index);
    const nextId = referencePickStatementIdentityAt(candidate, index);
    if (before.kind !== after.kind || ('name' in before && before.name !== ('name' in after ? after.name : undefined))) return null;
    if (before.kind !== 'version' && (!id || id !== nextId || seen.has(id) ||
      current.statementMap?.statementIdByStatementIndex?.get(index) !== id ||
      current.statementMap?.statementIndexByStatementId?.get(id) !== index ||
      candidate.statementMap?.statementIdByStatementIndex?.get(index) !== id ||
      candidate.statementMap?.statementIndexByStatementId?.get(id) !== index)) return null;
    if (id) seen.add(id);
    const oldScope = current.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(index);
    const newScope = candidate.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(index);
    const oldScopeInfo = oldScope && current.sourceLexicalNamespace?.scopeIndex.scopes.get(oldScope);
    const newScopeInfo = newScope && candidate.sourceLexicalNamespace?.scopeIndex.scopes.get(newScope);
    if (!oldScope || oldScope !== newScope || !oldScopeInfo || !newScopeInfo ||
      oldScopeInfo.kind !== newScopeInfo.kind || oldScopeInfo.parentId !== newScopeInfo.parentId) return null;
    let alias = false;
    if (before.kind === 'element' && after.kind === 'element') {
      const elementId = current.statementMap!.elementIdByStatementIndex.get(index);
      const nextElementId = candidate.statementMap!.elementIdByStatementIndex.get(index);
      // Syntax-error drafts intentionally have no runtime element map. Their
      // non-null reconciler identity above must become the candidate element ID.
      const draftRuntimeMap = current.document === null && current.statementMap!.elementIdByStatementIndex.size === 0 &&
        current.statementMap!.byElementId.size === 0;
      if (!nextElementId || nextElementId !== id ||
        (!draftRuntimeMap && (elementId !== nextElementId || current.statementMap!.byElementId.get(nextElementId)?.statementIndex !== index)) ||
        candidate.statementMap!.byElementId.get(nextElementId)?.statementIndex !== index ||
        [...candidate.statementMap!.elementIdByStatementIndex.values()].filter(value => value === nextElementId).length !== 1) return null;
      if (before.type !== after.type || before.category !== after.category ||
        JSON.stringify(before.extractPart) !== JSON.stringify(after.extractPart)) return null;
      if (before.extractPart?.declarationIndex === headIndex) {
        const part = before.extractPart.partIndex;
        if (parts.has(part) || !Number.isInteger(part) || part < 0 || part >= head.parts.length ||
          before.name !== head.parts[part]!.name || before.enclosing?.statementIndex !== headIndex ||
          after.enclosing?.statementIndex !== headIndex || before.type !== 'materializedPath' || before.category !== 'path') return null;
        parts.add(part);
        alias = true;
      }
    }
    const a = before.documentRange, b = after.documentRange;
    if (a.sourceRevision !== original.sourceRevision || b.sourceRevision !== snapshot.source.sourceRevision ||
      before.sourceRevision !== a.sourceRevision || after.sourceRevision !== b.sourceRevision) return null;
    const oldText = original.source.slice(a.from, a.to), newText = snapshot.source.normalizedSource.slice(b.from, b.to);
    if (index === headIndex || alias) {
      if (a.from !== head.documentRange.from || a.to !== head.documentRange.to ||
        b.from !== completed.documentRange.from || b.to !== completed.documentRange.to ||
        newText !== oldText.slice(0, from - a.from) + 'end' + oldText.slice(to - a.from)) return null;
    } else if (oldText !== newText || b.from !== a.from + (a.from >= to ? 3 : 0) || b.to !== a.to + (a.to > to ? 3 : 0)) return null;
  }
  if (parts.size !== head.parts.length) return null;
  return { ...target, sourceAnchor: { ...target.sourceAnchor, sourceRevision: snapshot.source.sourceRevision } };
};

/** Seed only this extract's compiler-owned parts, then follow typed reverse
 * dependencies. Unknown materialized owners are never trusted by this route. */
export const temporaryExtractExcludedElements = (compiled: CompiledDslDocument, target: DslReferencePickTarget): Set<string> => {
  const reached = new Set<string>();
  for (const [index, statement] of compiled.statements.entries()) {
    if (statement.kind === 'element' && statement.extractPart?.declarationIndex === target.sourceAnchor.statementIndex) {
      const id = compiled.statementMap?.elementIdByStatementIndex.get(index);
      if (id) reached.add(`element:${id}`);
    }
  }
  const reverse = new Map<string, string[]>();
  for (const edge of compiled.typedDependencyGraph?.edges ?? []) {
    const key = `${edge.to.kind}:${edge.to.id}`;
    reverse.set(key, [...reverse.get(key) ?? [], `${edge.from.kind}:${edge.from.id}`]);
  }
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++) for (const id of reverse.get(queue[i]!) ?? []) {
    if (!reached.has(id)) { reached.add(id); queue.push(id); }
  }
  return new Set([...reached].filter(id => id.startsWith('element:')).map(id => id.slice(8)));
};
