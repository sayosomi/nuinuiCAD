import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileDslDocument, isElementDslStatement, parseDsl, statementTypeOf } from "@nuinuicad/nui-language";
import { compileCanonicalText, isLastGoodDslDocument, reconcileStatements, type ReconcileInput, type ReconcileResult, type ReconcileStage } from "@nuinuicad/nui-language/document";

export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const point = (name: string, x = 1) => `point ${name} = coordinate(x: ${x}, y: -2)`;
const neighbor = point("Neighbor", 5);
export const reconcilerCases = ["R1", "R2", "R3"].flatMap(shape =>
  (shape === "R3" ? [16, 32, 64, 128] : [8, 16, 32, 64]).map(scale => ({ shape, scale }))
).concat([1, 2, 3, 4].map(scale => ({ shape: "RC", scale })), [{ shape: "R1", scale: 2 }, { shape: "R3", scale: 2 }]);

export function reconcilerFixture(shape: string, scale: number) {
  let oldSource: string;
  let newSource: string;
  let correspondence: Array<number | "group" | "freePoint">;
  let stages: ReconcileStage[];
  let parents: Array<number | null>;
  let branches: Array<"then" | "else" | undefined> = [];
  if (shape === "R1" || shape === "R2") {
    const nested = (next: boolean) => ["nui 1", "// unchanged neighboring control", neighbor, "",
      ...Array.from({ length: scale }, (_, i) => `${"  ".repeat(i)}group ${next && shape === "R1" ? "H" : "G"}${i} {`),
      `${"  ".repeat(scale)}${point(next ? "Q" : "P")}`,
      ...Array.from({ length: scale }, (_, i) => `${"  ".repeat(scale - i - 1)}}`)
    ].join("\n");
    oldSource = nested(false); newSource = nested(true);
    correspondence = Array.from({ length: scale + 2 }, (_, i) => i);
    stages = correspondence.map((_, i) => i === 0 || (shape === "R2" && i <= scale) ? 1 : 3);
    parents = correspondence.map((_, i) => i <= 1 ? null : i - 1);
  } else if (shape === "R3") {
    const siblings = (next: boolean) => ["nui 1", neighbor, "",
      ...Array.from({ length: scale }, (_, i) => [
        `group ${next ? "H" : "G"}${i} {`, `  ${point(`${next ? "Q" : "P"}${i}`)}`, "}"
      ]).flat()
    ].join("\n");
    oldSource = siblings(false); newSource = siblings(true);
    correspondence = Array.from({ length: 2 * scale + 1 }, (_, i) => i);
    stages = correspondence.map((_, i) => i === 0 ? 1 : 3);
    parents = correspondence.map((_, i) => i % 2 === 0 && i > 0 ? i - 1 : null);
  } else if (shape === "RC" && scale === 1) {
    const exact = (next: boolean) => ["nui 1", `group G(visible: ${!next}) {`,
      `  group H(visible: ${!next}) {`, `    ${point("P", next ? 9 : 1)}`, "  }", "}", neighbor].join("\n");
    oldSource = exact(false); newSource = exact(true);
    correspondence = [0, 1, 2, 3]; stages = [2, 2, 2, 1]; parents = [null, 0, 1, null];
  } else if (shape === "RC" && scale === 2) {
    oldSource = ["nui 1", "group {", `  ${point("")}`, `  ${point("Anchor", 7)}`, "}"].join("\n");
    newSource = ["nui 1", "group {", `  ${point("Anchor", 7)}`, `  ${point("", 9)}`, "}"].join("\n");
    correspondence = [0, 2, 1]; stages = [1, 1, 4]; parents = [null, 0, 0];
  } else if (shape === "RC" && scale === 3) {
    oldSource = ["nui 1", "if (true) {", `  ${point("C")}`, "} else {", `  ${point("D", 7)}`, "}", neighbor].join("\n");
    newSource = ["nui 1", "if (true) {", "} else {", `  ${point("D", 7)}`, `  ${point("C", 9)}`, "}", neighbor].join("\n");
    correspondence = [0, 2, 1, 3]; stages = [1, 1, 5, 1]; parents = [null, 0, 0, null]; branches = [undefined, "else", "else", undefined];
  } else {
    assert.equal(shape, "RC"); assert.equal(scale, 4);
    oldSource = ["nui 1", "// preserve this comment", point("A"), "", point("B", 2), point("C", 3), ""].join("\n");
    newSource = ["nui 1", "// preserve this comment", point("A"), "", point("C", 3), "group D {", `  ${point("E", 4)}`, "}", ""].join("\n");
    correspondence = [0, 2, "group", "freePoint"]; stages = [1, 1, 6, 6]; parents = [null, null, null, 2];
  }
  const old = parseDsl(oldSource), next = parseDsl(newSource);
  assert.deepEqual(old.diagnostics, []); assert.deepEqual(next.diagnostics, []);
  const oldIndexes = old.statements.flatMap((s, i) => isElementDslStatement(s) ? [i] : []);
  const newIndexes = next.statements.flatMap((s, i) => isElementDslStatement(s) ? [i] : []);
  assert.equal(newIndexes.length, correspondence.length);
  const oldIds = new Map(oldIndexes.map((i, ordinal) => [i, `old:${ordinal}`]));
  let created = 0;
  const expected = correspondence.map((oldOrdinal, ordinal) => ({
    index: newIndexes[ordinal],
    id: typeof oldOrdinal === "number" ? `old:${oldOrdinal}` : `created:${oldOrdinal}:${++created}`,
    oldIndex: typeof oldOrdinal === "number" ? oldIndexes[oldOrdinal] : null,
    stage: stages[ordinal], parentOrdinal: parents[ordinal], branch: branches[ordinal],
    sourceBranch: parents[ordinal] === null ? undefined : branches[ordinal] ?? "then",
    kind: statementTypeOf(next.statements[newIndexes[ordinal]])
  }));
  const inherited = new Set(correspondence.filter((n): n is number => typeof n === "number"));
  const vanished = oldIndexes.flatMap((_, ordinal) => inherited.has(ordinal) ? [] : [`old:${ordinal}`]);
  const input: ReconcileInput = { oldStatements: old.statements, oldLines: oldSource.split("\n"), oldElementIds: oldIds, oldStatementIds: oldIds, newStatements: next.statements, newLines: newSource.split("\n") };
  return { id: `${shape}-${scale}`, shape, scale, oldSource, newSource, oldSha256: hash(oldSource), newSha256: hash(newSource), input, expected, vanished };
}
export type ReconcilerFixture = ReturnType<typeof reconcilerFixture>;
export function reconcile(f: ReconcilerFixture, input = f.input) {
  let nextId = 0;
  return reconcileStatements(input, { createId: type => `created:${type}:${++nextId}` });
}
export function assertReconciled(f: ReconcilerFixture, result: ReconcileResult) {
  assert.deepEqual([...result.assignedIds].sort(([a], [b]) => a - b), f.expected.map(e => [e.index, e.id]));
  assert.deepEqual([...result.stageByNewStatementIndex].sort(([a], [b]) => a - b), f.expected.map(e => [e.index, e.stage]));
  assert.deepEqual([...result.createdIds], f.expected.filter(e => e.oldIndex === null).map(e => [e.index, e.id]));
  assert.deepEqual(result.vanishedIds, f.vanished);
  assert.equal(result.inheritedCount, f.expected.filter(e => e.oldIndex !== null).length);
  for (const row of f.expected) {
    const s = f.input.newStatements[row.index];
    assert.equal(statementTypeOf(s), row.kind);
    assert.equal(s.enclosing?.statementIndex ?? null, row.parentOrdinal === null ? null : f.expected[row.parentOrdinal].index);
    assert.equal(s.enclosing?.branch, row.sourceBranch);
    if (row.oldIndex !== null) assert.equal(statementTypeOf(f.input.oldStatements[row.oldIndex]), row.kind);
  }
}
export function canonicalEdit(f: ReconcilerFixture) {
  const old = compileDslDocument(f.oldSource, { assignedElementIds: f.input.oldElementIds, assignedStatementIds: f.input.oldStatementIds });
  assert.deepEqual(old.diagnostics, []); assert.ok(isLastGoodDslDocument(old));
  const current = { sourceText: f.oldSource, doc: old, docText: f.oldSource, diagnostics: [], bindingIssueDiagnostics: [] };
  return () => compileCanonicalText(current, f.newSource, { createdElementIds: f.expected.filter(e => e.oldIndex === null).map(e => e.id) });
}
export function assertCanonicalEdit(f: ReconcilerFixture, edited: ReturnType<ReturnType<typeof canonicalEdit>>) {
  assert.equal(edited.status, "valid");
  assert.deepEqual(edited.diagnostics, []);
  assert.deepEqual(edited.bindingIssueDiagnostics, []);
  assert.equal(edited.sourceText, f.newSource); assert.equal(edited.docText, f.newSource);
  for (const row of f.expected) {
    const id = edited.doc.statementMap.elementIdByStatementIndex.get(row.index);
    assert.equal(id, row.id);
    const e = edited.doc.document.elements.find(e => e.id === row.id)!;
    assert.equal(e.parentGroupId ?? null, row.parentOrdinal === null ? null : f.expected[row.parentOrdinal].id);
    assert.equal(e.conditionalBranch, row.branch);
  }
}

// Counting parsed-AST scope reads gives a deterministic recursion-work oracle
// while preserving all statement values and without adding production APIs.
export function scopeWork(f: ReconcilerFixture) {
  let reads = 0;
  const maximumDepth = (statements: ReconcileInput["oldStatements"]) => Math.max(0, ...statements.map(s => {
    let depth = 0;
    for (let parent = s.enclosing; parent; parent = statements[parent.statementIndex].enclosing) depth++;
    return depth;
  }));
  const wrap = (statements: ReconcileInput["oldStatements"]) => statements.map(s => new Proxy(s, {
    get(target, key, receiver) { if (key === "enclosing") reads++; return Reflect.get(target, key, receiver); }
  }));
  const result = reconcile(f, { ...f.input, oldStatements: wrap(f.input.oldStatements), newStatements: wrap(f.input.newStatements) });
  return { result, reads, maximumScopeDepth: maximumDepth(f.input.newStatements) };
}

export function residueWork(f: ReconcilerFixture) {
  let visits = 0;
  let membershipChecks = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator)!;
  const hasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
  try {
    Object.defineProperty(Set.prototype, Symbol.iterator, {
      ...descriptor,
      value: function (this: Set<unknown>) {
        // Reconciler residual sets contain statement indices. String IDs or
        // other sets are excluded, and the original iteration order is kept.
        if (typeof this.values().next().value === "number") visits += this.size;
        return Reflect.apply(descriptor.value, this, []);
      }
    });
    Object.defineProperty(Set.prototype, "has", {
      ...hasDescriptor,
      value: function (this: Set<unknown>, value: unknown) {
        if (typeof value === "number") membershipChecks++;
        return Reflect.apply(hasDescriptor.value, this, [value]);
      }
    });
    const result = reconcile(f);
    return { result, visits, membershipChecks };
  } finally {
    Object.defineProperty(Set.prototype, Symbol.iterator, descriptor);
    Object.defineProperty(Set.prototype, "has", hasDescriptor);
  }
}
