import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { materializeModuleExecution } from "../packages/nui-language/src/dsl/moduleMaterialization";
import { assertMaterialization, compileModule, materializationInput, moduleCases, moduleFixture, runtimeArrayWork } from "./issue1493ModuleSupport";

describe("#1493 module materialization topology and work regressions", () => {
  for (const { shape, count } of moduleCases) it(`${shape}-${count}: preserves authored runtime and snapshot oracle`, () => {
    const f = moduleFixture(shape, count);
    const compiled = compileModule(f);
    if (compiled.moduleMaterialization) assertMaterialization(f, compiled.moduleMaterialization);
    else assert.equal(shape, "M-control");
    const observed = runtimeArrayWork(() => materializeModuleExecution(materializationInput(f, compiled)));
    assertMaterialization(f, observed.result);
    // Deterministic work bound, independent of machine speed. The two-level
    // shape necessarily emits each inner point into both ancestor snapshots.
    const necessaryOutput = f.entries.length + f.snapshots.reduce((n, s) => n + s.descendantIds.length, 0);
    assert.ok(observed.visits() <= 5 * necessaryOutput, `${observed.visits()} runtime array visits exceed output-sized work ${necessaryOutput}`);
  }, 30_000);
});
