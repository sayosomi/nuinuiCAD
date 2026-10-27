import { blank } from "../issue1419/model";
import type { Candidate } from "./model";

// Independently authored reductions of C-B-02/03; no generator/oracle edits.
// Historical F5-root-control also failed: it is the independent F6 producer
// reproducer, rather than a credited passing control.
export const finalRepairCandidates: Candidate[] = [];
for (const kind of ["map-reproducer", "constant-control", "one-iteration-control", "literal-member-contrast"] as const) {
  const p = blank(), once = kind === "one-iteration-control", constant = kind === "constant-control", literal = kind === "literal-member-contrast";
  p.source = ["nui 1", `const Ticks: number[] = ${once ? "[1]" : "[1, 2]"}`,
    "for Tick in @Ticks carry Values: number[] = [1] carry Total: number = 0 {",
    ...(literal ? ["const Member: number = @Values[0] + @Tick", "const Mapped: number[] = [@Member]"]
      : [`const Mapped: number[] = for Item in @Values { @Item + ${constant ? "1" : "@Tick"} }`]),
    "next Values = @Mapped", "next Total = @Total + @Values[0]", "}",
    "const FinalValue: number = @Values[0]", "const FinalTotal: number = @Total", ""].join("\n");
  // Incoming snapshots: ([1],0) -> ([2],1) -> ([4],3).
  // Constant +1 control instead ends ([3],3); one iteration ends ([2],1).
  p.scalars = { FinalValue: once ? 2n : constant ? 3n : 4n, FinalTotal: once ? 1n : 3n };
  finalRepairCandidates.push({ id: `F4-${kind}`, stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 1, delta: 0, factor: 0 }, activation: ["incoming-collection-carry-closure", "simultaneous-scalar-next", kind] });
}
{
  const p = blank();
  p.source = ["nui 1", "const Ticks: number[] = [1, 2]", "for Tick in @Ticks carry Values: number[] = [1] {",
    "const Before: number = @Values[0]", "point Incoming = coordinate(x: @Before, y: @Tick)",
    "const Mapped: number[] = for Item in @Values { @Item + @Tick }", "next Values = @Mapped", "}", ""].join("\n");
  p.geometry = [1, 2].map((value, i) => ({ name: "Incoming", at: [i], value: { x: value, y: value } }));
  p.templates = ["Incoming"];
  finalRepairCandidates.push({ id: "F4-alias-observer", stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 1, delta: 0, factor: 0 }, activation: ["minimal-single-carry", "incoming-collection-carry-closure"] });
}
for (const kind of ["reproducer", "alias-control", "root-control"] as const) {
  const p = blank(), root = kind === "root-control", alias = kind === "alias-control";
  p.source = ["nui 1", ...(root ? ["const Values: number[] = [7]"] : ["const Ticks: number[] = [1]", "for Tick in @Ticks carry Values: number[] = [7] {"]),
    ...(alias ? ["const Value: number = @Values[0]"] : []),
    `point Observed = coordinate(x: ${alias ? "@Value" : "@Values[0]"}, y: 0)`,
    ...(!root ? ["next Values = @Values", "}"] : []), ""].join("\n");
  p.geometry = [{ name: "Observed", ...(!root ? { at: [0] } : {}), value: { x: 7, y: 0 } }];
  if (!root) p.templates = ["Observed"];
  finalRepairCandidates.push({ id: `F5-${kind}`, stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 0, factor: 0 }, activation: ["indexed-collection-numeric-construction", kind] });
}
{
  const p = blank();
  p.source = ["nui 1", "const Ticks: number[] = [1, 2]", "for Tick in @Ticks carry Values: number[] = [1] {",
    "point Incoming = coordinate(x: @Values[0], y: @Tick)",
    "const Mapped: number[] = for Item in @Values { @Item + @Tick }", "next Values = @Mapped", "}", ""].join("\n");
  p.geometry = [1, 2].map((value, i) => ({ name: "Incoming", at: [i], value: { x: value, y: value } }));
  p.templates = ["Incoming"];
  finalRepairCandidates.push({ id: "F5-original-reduction", stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 1, delta: 0, factor: 0 }, activation: ["original-rejected-reduction", "indexed-collection-numeric-construction"] });
}
{
  const p = blank();
  p.source = "nui 1\nconst Values: number[] = [7]\nconst Index: number = 2\npoint Observed = coordinate(x: @Values[@Index], y: 0)\n";
  p.errors = ["Observed"];
  finalRepairCandidates.push({ id: "F5-invalid-index-control", stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 0, factor: 0 }, activation: ["indexed-collection-runtime-error-owner"] });
}
{
  const p = blank(), expected = blank();
  p.source = "nui 1\nmodule Box(Values: number[]) {\nexport point Mark = coordinate(x: @Values[0], y: 0)\n}\ninstance Healthy = Box(Values: [7])\npoint Independent = coordinate(x: 19, y: 23)\n";
  expected.geometry = [{ name: "Healthy::Mark", value: { x: 7, y: 0 } }, { name: "Independent", value: { x: 19, y: 23 } }];
  finalRepairCandidates.push({ id: "F5-Module-counterpart", stratum: "E", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 0, factor: 0 }, activation: ["existing-Module-numeric-owner", "indexed-collection-numeric-construction"],
    limits: [{ placement: "full", through: "Independent", expected, instances: ["Healthy"] }] });
}
{
  const p = blank();
  const inputs = ["const Values: number[] = [@Number]", "const Index: number = 0", "const Number: number = 7"];
  const observer = "point Observed = coordinate(x: @Values[@Index], y: 0)";
  p.source = ["nui 1", ...inputs, observer, ""].join("\n");
  p.geometry = [{ name: "Observed", value: { x: 7, y: 0 } }];
  finalRepairCandidates.push({ id: "F6-ordered-dependencies", stratum: "C", method: "B", variant: 2, seed: 0, member: "S", program: p,
    oracleInputs: { unit: 7, delta: 0, factor: 0 }, activation: ["canonical-dependency-order", "typed-index-and-member-input"] });
}
