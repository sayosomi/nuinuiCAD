import { blank, point } from "../issue1419/model";
import type { Candidate } from "./model";

// Manually minimized sources and source-derived expectations. Seed 0 denotes
// authored reductions, not another draw from the frozen discovery generator.
export const repairCandidates: Candidate[] = [];
for (const control of [false, true]) {
  const p = blank();
  p.source = [
    "nui 1",
    "module Box(Origin: number, Fail: boolean) {",
    `const Chosen: point = ${control ? "coordinate(x: @Origin + 2, y: 3)" : "if (@Origin > 0) { coordinate(x: @Origin + 2, y: 3) } else { coordinate(x: 1 / 0, y: 0) }"}`,
    "export point Mark = from(source: @Chosen)",
    "if (@Fail) {",
    "point Fault = coordinate(x: 1 / 0, y: 0)",
    "}",
    "}",
    "instance Healthy = Box(Origin: 3, Fail: false)",
    "point UseHealthy = from(source: @Healthy::Mark)",
    "instance Failed = Box(Origin: 7, Fail: true)",
    "point Observed = from(source: @Failed::Mark)",
    "point Independent = coordinate(x: 19, y: 23)",
    ""
  ].join("\n");
  const expected = blank();
  expected.geometry = [{ name: "Healthy::Mark", value: point(5, 3) }, { name: "UseHealthy", value: point(5, 3) }, { name: "Independent", value: point(19, 23) }];
  expected.errors = ["Failed::Fault"];
  repairCandidates.push({ id: `P1-${control ? "control" : "reproducer"}`, stratum: "E", method: "A", variant: 0, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 3, factor: 0 }, activation: ["conditional-owner-before-child", "failed-Module-atomicity"],
    limits: [{ placement: "full", through: "Independent", expected, instances: ["Healthy"] }] });
}
// Required repair follow-on: forwarding both private and exported values must
// not let a consumer observe a Module whose drawable child has already failed
// while its private value-program completion is still pending.
const aliasBase = repairCandidates.find(c => c.id === "P1-control")!;
repairCandidates.push({ ...aliasBase, id: "P1-alias-completion", program: { ...aliasBase.program, source: aliasBase.program.source
  .replace("export point Mark = from(source: @Chosen)", "const Send: point = @Chosen\nexport point Mark = from(source: @Send)")
  .replace("point UseHealthy = from(source: @Healthy::Mark)", "const ExportHealthy: point = @Healthy::Mark\npoint UseHealthy = from(source: @ExportHealthy)") },
  activation: ["repair-follow-on", "failed-Module-before-private-value-completion"] });
for (const control of [false, true]) {
  const p = blank();
  p.source = ["nui 1", "const Values: number[] = [7]", `const Chosen: point = coordinate(x: ${control ? "7" : "@Values[0]"}, y: 3)`, "point Observed = from(source: @Chosen)", ""].join("\n");
  const expected = blank();
  expected.geometry = [{ name: "Observed", value: point(7, 3) }];
  repairCandidates.push({ id: `P2-${control ? "control" : "reproducer"}`, stratum: "E", method: "B", variant: 0, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 3, factor: 0 }, activation: ["geometry-value-scalar-collection-index"],
    limits: [{ placement: "full", through: "Observed", expected, instances: [] }] });
}
for (const control of [false, true]) {
  const p = blank();
  p.source = ["nui 1", "module Guard(X: number) {", "point Mark = coordinate(x: @X, y: 0)", "}",
    `instance Dormant(enabled: ${control}) = Guard(X: 0)`, "const Chosen: number = 7", "const Forwarded: number = @Chosen", "const Independent: number = 11", "point Observed = coordinate(x: @Forwarded, y: 3)", ""].join("\n");
  p.scalars = { Chosen: 7n, Forwarded: 7n, Independent: 11n };
  p.geometry = [{ name: "Observed", value: point(7, 3) }, ...(control ? [{ name: "Mark", value: point(0, 0) }] : [])];
  if (!control) p.absent = ["Mark"];
  repairCandidates.push({ id: `P3-${control ? "control" : "reproducer"}`, stratum: "D", method: "A", variant: 1, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 3, factor: 0 }, activation: ["disabled-Module-poisoned-parameter-order", "typed-alias-observer"] });
}
