import fc from "fast-check";
import { blank, point, type Program } from "../issue1419/model";

export type Stratum = "S" | "O" | "X";
export type Candidate = {
  id: string; stratum: Stratum; cell: number; member: "S" | "T" | "control";
  seed: number; methods: string[]; faultModels: string[];
  inputs: { u: number; d: number; f: number; n: number; reverse: boolean; match: boolean; negative: boolean };
  program: Program;
};
const draws = fc.record({ u: fc.integer({ min: 3, max: 29 }), d: fc.integer({ min: 7, max: 37 }), f: fc.integer({ min: 2, max: 9 }) });
export const renamed = (c: Candidate, s: string) => c.member === "T" ? s.replace(/\b[A-Z][A-Za-z0-9]*\b/g, n => `Twin${n}`) : s;

export function candidate(stratum: Stratum, cell: number, member: Candidate["member"]): Candidate {
  const seed = 8000 + "SOX".indexOf(stratum) * 100 + cell;
  const { u, d, f } = fc.sample(draws, { seed, numRuns: 1 })[0];
  const n = member === "control" ? 0 : 2 + (cell >> 2), reverse = !!(cell & 2), match = !!(cell & 1), negative = !!(cell & 1);
  const p = blank(), c: Candidate = { id: `${stratum}-${String(cell).padStart(2, "0")}-${member}`, stratum, cell, member, seed,
    methods: [stratum === "O" ? "OWNER" : "RISK", "MODEL"],
    faultModels: stratum === "S" ? ["scalar-updated-first", "array-updated-first"] : stratum === "O" ? ["private-lazy-first-loss"] : ["atomicity", "gate-before-input", "selected-branch", "limit-owner"],
    inputs: { u, d, f, n, reverse, match, negative }, program: p };
  const code = ["nui 1", `const Unit: number = ${u}`, `const Delta: number = ${d}`];
  const alias = member === "T";
  if (alias) code.push("const Padding: number = @Unit + @Delta");
  if (stratum === "S") {
    code.push(`const Ticks: number[] = [${Array.from({ length: n }, (_, i) => i + 1)}]`,
      `for Tick in @Ticks carry Total: number = ${f} carry Values: number[] = [${u}, ${u + d}] {`,
      "point Incoming = coordinate(x: @Values[0], y: @Total)", "point Indexed = coordinate(x: @Values[1], y: @Tick)");
    if (match) code.push("const Side: choice(pick, skip) = pick");
    const conditional = (good: string) => match ? `match @Side { pick => ${good} skip => 1 / 0 }` : `if (@Tick > 0) { ${good} } else { 1 / 0 }`;
    code.push(`const Mapped: number[] = for Item in @Values { ${conditional("@Item + @Total + @Tick")} }`);
    if (alias) code.push("const Send: number[] = @Mapped");
    const scalar = `next Total = ${conditional("@Total + @Values[1] + @Tick")}`, array = `next Values = @${alias ? "Send" : "Mapped"}`;
    code.push(...(reverse ? [array, scalar] : [scalar, array]), "}", "const Final0: number = @Values[0]", "const Final1: number = @Values[1]", "const FinalTotal: number = @Total", "point Final = coordinate(x: @Final0, y: @FinalTotal)");
    let s = f, a = u, b = u + d;
    for (let i = 0; i < n; i++) {
      const tick = i + 1, next = { Total: s + b + tick, Values: [a + s + tick, b + s + tick] };
      p.geometry.push({ name: "Incoming", at: [i], value: point(a, s) }, { name: "Indexed", at: [i], value: point(b, tick) });
      p.trace.push({ loop: "outer", at: [i], incoming: { Total: s, Values: [a, b], Tick: tick }, next, final: next });
      s = next.Total; [a, b] = next.Values;
    }
    p.scalars = { Final0: BigInt(a), Final1: BigInt(b), FinalTotal: BigInt(s) };
    p.geometry.push({ name: "Final", value: point(a, s) }); p.templates = ["Incoming", "Indexed"]; p.carries = ["Total", "Values"];
  } else if (stratum === "O") {
    // Axes: n=2/3, if/match, positive/negative selected branch.
    c.inputs.match = reverse;
    const sign = negative ? -1 : 1;
    code.push(`const Ticks: number[] = [${Array.from({ length: n }, (_, i) => u + i * d)}]`, "module Box(Seed: number) {");
    if (reverse) code.push(`const Side: choice(positive, negative) = if (@Seed > 0) { positive } else { negative }`);
    const good = `coordinate(x: @Seed + ${f}, y: ${d})`, bad = "coordinate(x: @Seed / 0, y: 0)";
    code.push(reverse ? `const Private: point = match @Side { positive => ${negative ? bad : good} negative => ${negative ? good : bad} }` : `const Private: point = if (@Seed > 0) { ${negative ? bad : good} } else { ${negative ? good : bad} }`);
    if (alias) code.push("const Send: point = @Private");
    code.push(`export point Mark = from(source: @${alias ? "Send" : "Private"})`, "}", "for Tick in @Ticks {", `instance Live = Box(Seed: ${negative ? "-@Tick" : "@Tick"})`, "point Consumer = from(source: @Live::Mark)", "}", "point Survivor = coordinate(x: @Unit + @Delta, y: 0)");
    for (let i = 0; i < n; i++) for (const name of ["Mark", "Consumer"]) p.geometry.push({ name, ...(name === "Mark" ? { instance: "Live" } : {}), at: [i], value: point(sign * (u + i * d) + f, d) });
    p.geometry.push({ name: "Survivor", value: point(u + d, 0) }); p.templates = ["Mark", "Consumer"];
  } else {
    // X axes: first/second failure, direct/ancestor disabled, if/match.
    const failFirst = !(cell & 4), disabledAncestor = reverse, control = member === "control";
    code.push("module Box(Origin: number, Fail: boolean) {", "export point Prefix = coordinate(x: @Origin, y: 1)");
    if (match) code.push("const Side: choice(fail, valid) = if (@Fail) { fail } else { valid }");
    code.push(`const Risk: number = ${match ? "match @Side { fail => 1 / 0 valid => @Origin }" : "if (@Fail) { 1 / 0 } else { @Origin }"}`);
    if (alias) code.push("const Send: number = @Risk");
    code.push(`export point Mark = coordinate(x: @${alias ? "Send" : "Risk"}, y: ${d})`, "}");
    if (disabledAncestor) code.push("group Sleeping(enabled: false) {", "instance Dormant = Box(Origin: 1 / 0, Fail: true)", "}");
    else code.push("instance Dormant(enabled: false) = Box(Origin: 1 / 0, Fail: true)");
    for (const [i, name] of ["One", "Two"].entries()) code.push(`instance ${name} = Box(Origin: ${u + i * d}, Fail: ${!control && (i === 0) === failFirst})`, `point Use${name} = from(source: @${name}::Mark)`);
    code.push(`point Survivor = coordinate(x: @Unit + @Delta, y: ${-f})`);
  }
  const rename = (s: string) => renamed(c, s);
  p.source = rename(code.join("\n") + "\n");
  p.scalars = Object.fromEntries(Object.entries(p.scalars).map(([k, v]) => [rename(k), v]));
  p.geometry = p.geometry.map(g => ({ ...g, name: rename(g.name), ...(g.instance ? { instance: rename(g.instance) } : {}) }));
  p.templates = p.templates.map(rename); p.carries = p.carries.map(rename);
  if (alias) { const lines = p.source.split("\n"); [lines[1], lines[2]] = [lines[2], lines[1]]; p.source = lines.join("\n"); }
  return c;
}
export const campaign = () => (["S", "O", "X"] as const).flatMap(s => [0,1,2,3,4,5,6,7].flatMap(cell => (["S", "T"] as const).map(m => candidate(s, cell, m))).concat([candidate(s, 0, "control")]));
