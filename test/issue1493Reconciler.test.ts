import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { assertCanonicalEdit, assertReconciled, canonicalEdit, reconcile, reconcilerCases, reconcilerFixture, residueWork, scopeWork } from "./issue1493ReconcilerSupport";

describe("#1493 deep/shallow reconciliation identity, stage and scope work", () => {
  for (const c of reconcilerCases) it(`${c.shape}-${c.scale}`, () => {
    const f = reconcilerFixture(c.shape, c.scale);
    const observed = scopeWork(f);
    assertReconciled(f, observed.result);
    assertReconciled(f, reconcile(f));
    assertCanonicalEdit(f, canonicalEdit(f)());
    // Repeated parent-pairing waves are legitimate. Within a wave, repeated
    // recursive traversal of the same named ancestors is avoidable.
    if (c.shape === "R1") assert.ok(observed.reads <= 4 * f.expected.length ** 2,
      `${observed.reads} scope reads exceed quadratic wave/output bound for ${f.expected.length} identities`);
    const residual = residueWork(f);
    assertReconciled(f, residual.result);
    if (c.shape === "R3") assert.ok(residual.visits + residual.membershipChecks <= 16 * f.expected.length,
      `${residual.visits} residue visits + ${residual.membershipChecks} membership checks exceed bounded-pass work for ${f.expected.length} identities`);
  }, 30_000);
});
