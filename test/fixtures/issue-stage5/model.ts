import fc from "fast-check";
import { blank, point, type Program } from "../issue1419/model";

export type Method = "A" | "B" | "C";
export type Stratum = "E" | "C" | "D" | "G";
export type Candidate = {
  id: string; wave: "W1" | "W2" | "G"; stratum: Stratum; method: Method;
  cell: number; member: "S" | "T" | "control"; seed: number;
  inputs: { u: number; d: number; f: number; n: number; reverse: boolean; failed: string[] };
  program: Program;
  limits?: { placement: string; through?: string; expected: Program; instances: string[] }[];
};
const draws = fc.record({ u: fc.integer({ min: 17, max: 97 }), d: fc.integer({ min: 9, max: 49 }), f: fc.integer({ min: 2, max: 5 }) });
export const renamed = (c: Candidate, s: string) => c.member === "T" ? s.replace(/\b[A-Z][A-Za-z0-9]*\b/g, n => `Twin${n}`) : s;

function transform(c: Candidate, p: Program) {
  const rename = (s: string) => renamed(c, s);
  const keys = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k), v]));
  p.source = rename(p.source); p.scalars = keys(p.scalars); p.diagnosticBindings = keys(p.diagnosticBindings);
  p.geometry = p.geometry.map(o => ({ ...o, name: rename(o.name), ...(o.instance ? { instance: rename(o.instance) } : {}) }));
  p.errors = p.errors.map(rename); p.absent = p.absent.map(rename); p.templates = p.templates.map(rename); p.carries = p.carries.map(rename);
}

export function candidate(wave: Candidate["wave"], stratum: Stratum, method: Method, cell: number, member: Candidate["member"]): Candidate {
  const seed = (wave === "W1" ? 5000 : wave === "W2" ? 6000 : 7000) + (stratum === "G" ? 0 : "ECD".indexOf(stratum) * 100) + "ABC".indexOf(method) * 10 + cell;
  const { u, d, f } = fc.sample(draws, { seed, numRuns: 1 })[0];
  const reverse = wave === "W2", n = stratum === "G" ? (member === "control" ? 0 : cell + 1) : reverse && cell === 0 ? 0 : cell + 1;
  const failed = stratum === "E" ? (reverse && cell === 0 ? ["One"] : cell === 1 ? ["Two"] : []) : [];
  const p = blank(), code = ["nui 1", `const Unit: number = ${u}`, `const Delta: number = ${d}`];
  const c: Candidate = { id: `${wave}-${stratum}-${method}-0${cell}-${member}`, wave, stratum, method, cell, member, seed, inputs: { u, d, f, n, reverse, failed }, program: p };
  const alias = member === "T";
  if (alias) code.push("const Padding: number = @Delta + @Unit");
  if (stratum === "E") {
    code.push("module Box(Origin: number, Fail: boolean) {");
    const good = `coordinate(x: @Origin + ${f}, y: ${d})`, bad = "coordinate(x: 1 / 0, y: 0)";
    if (method === "B") {
      code.push(`const X: number = @Origin + ${f}`, `const Choices: number[] = if (@Origin > 0) { ${reverse ? "[]" : `[@X, ${d}]`} } else { ${reverse ? `[@X, ${d}]` : "[]"} }`, "const Chosen: point = coordinate(x: @Choices[0], y: @Choices[1])");
    } else code.push(`const Chosen: point = if (@Origin > 0) { ${reverse ? bad : good} } else { ${reverse ? good : bad} }`);
    if (alias) code.push("const Send: point = @Chosen");
    code.push(`export point Mark = from(source: @${alias ? "Send" : "Chosen"})`, "if (@Fail) {", "point Fault = coordinate(x: 1 / 0, y: 0)", "}", "}");
    const origins = [u, u + d + 19].map(x => reverse ? -x : x);
    for (const [i, name] of ["One", "Two"].entries()) code.push(`instance ${name} = Box(Origin: ${origins[i]}, Fail: ${failed.includes(name)})`, `point Use${name} = from(source: @${name}::Mark)`);
    code.push(`const Control: point = coordinate(x: ${u + d}, y: ${-f})`, "point Independent = from(source: @Control)");
    c.limits = [0, 1, 2, 3].map(k => {
      const expected = blank(), instances: string[] = [];
      for (let i = 0; i < Math.min(k, 2); i++) {
        const name = ["One", "Two"][i];
        if (failed.includes(name)) expected.errors.push(`${name}::Fault`);
        else { instances.push(name); expected.geometry.push({ name: `${name}::Mark`, value: point(origins[i] + f, d) }, { name: `Use${name}`, value: point(origins[i] + f, d) }); }
      }
      if (k === 3) expected.geometry.push({ name: "Independent", value: point(u + d, -f) });
      return { placement: ["before-first", "first-only", "both", "failed-instance-independent-success"][k], through: [undefined, "UseOne", "UseTwo", "Independent"][k], expected, instances };
    });
  } else if (stratum === "C") {
    const ticks = Array.from({ length: n }, (_, i) => (reverse ? 3 : 1) + i);
    code.push(`const Ticks: number[] = [${ticks}]`, `for Tick in @Ticks carry Values: number[] = [${u}, ${u + d}] carry Total: number = ${d} {`, "point Incoming = coordinate(x: @Values[0], y: @Total)");
    // A varies nested next ownership from Stage 3/4; B targets canonical
    // numeric/carry indexing; C draws an affine model independently of faults.
    const increment = method === "C" ? `@Tick * ${f}` : "@Tick";
    if (reverse) code.push("const Side: choice(pick, skip) = pick");
    const body = reverse ? `match @Side { pick => @Item + ${increment} skip => 1 / 0 }` : `if (@Tick > 0) { @Item + ${increment} } else { 1 / 0 }`;
    code.push(`const Mapped: number[] = for Item in @Values { ${body} }`);
    if (method === "A") code.push(`const InnerTicks: number[] = [${d}]`, "for InnerTick in @InnerTicks carry Inner: number = @Total {", "next Inner = @Inner + @Values[0] + @InnerTick", "}", "next Total = @Inner");
    else code.push(`next Total = @Total + @Values[${method === "B" ? 1 : 0}]`);
    if (alias) code.push("const Send: number[] = @Mapped");
    code.push(`next Values = @${alias ? "Send" : "Mapped"}`, "}", "const Final0: number = @Values[0]", "const Final1: number = @Values[1]", "const FinalTotal: number = @Total", "point Final = coordinate(x: @Final0, y: @FinalTotal)");
    let a = u, b = u + d, total = d;
    for (const [i, tick] of ticks.entries()) {
      p.geometry.push({ name: "Incoming", at: [i], value: point(a, total) });
      total += method === "A" ? a + d : method === "B" ? b : a;
      const delta = tick * (method === "C" ? f : 1); a += delta; b += delta;
    }
    p.scalars = { Final0: BigInt(a), Final1: BigInt(b), FinalTotal: BigInt(total) };
    p.geometry.push({ name: "Final", value: point(a, total) }); p.templates = ["Incoming"]; p.carries = ["Values", "Total"];
  } else if (stratum === "D") {
    const selected = reverse ? cell === 1 : cell === 0, error = "evaluation-divide-by-zero";
    code.push("const Zero: number = 0", "module Guard(Seed: number) {", "const Private: point = if (@Seed > 0) { coordinate(x: @Seed, y: 0) } else { coordinate(x: 1 / 0, y: 0) }", "export point Mark = from(source: @Private)", "}");
    if (reverse || method === "B") code.push("group Sleeping(enabled: false) {", "instance Dormant = Guard(Seed: 0)", "}");
    else code.push("instance Dormant(enabled: false) = Guard(Seed: 0)");
    if (method === "B") code.push(`const Side: choice(fail, valid) = ${selected ? "fail" : "valid"}`);
    const expression = method === "B" ? "match @Side { fail => @Unit / @Zero valid => @Unit + @Delta }" : `if (${selected}) { @Unit / @Zero } else { @Unit + @Delta }`;
    code.push(`const Chosen: number = ${expression}`);
    const fault = ["const IndependentError: number = @Delta / @Zero", "point IndependentFault = coordinate(x: @Unit / @Zero, y: 0)"];
    code.push(...(alias ? [...fault].reverse() : fault));
    if (alias) code.push("const Send: number = @Chosen");
    code.push(`point Dependent = coordinate(x: @${alias ? "Send" : "Chosen"}, y: ${f})`, "point Survivor = coordinate(x: @Unit, y: @Delta)");
    p.scalars = { Chosen: selected ? error : BigInt(u + d), IndependentError: error };
    p.diagnosticBindings = { IndependentError: error, ...(selected ? { Chosen: error } : {}) };
    if (alias) { p.scalars.Send = p.scalars.Chosen; if (selected) p.diagnosticBindings.Send = error; }
    p.geometry.push({ name: "Survivor", value: point(u, d) });
    if (!selected) p.geometry.push({ name: "Dependent", value: point(u + d, f) });
    p.errors = ["IndependentFault", ...(selected ? ["Dependent"] : [])]; p.absent = ["Mark"];
  } else {
    code.push(`const Ticks: number[] = [${Array.from({ length: n }, (_, i) => u + i * d)}]`, "module Box(Seed: number) {");
    const good = `coordinate(x: @Seed + ${f}, y: ${d})`, bad = "coordinate(x: 1 / 0, y: 0)";
    if (method === "B") code.push("const Side: choice(pick, skip) = pick");
    code.push(method === "B" ? `const Private: point = match @Side { pick => ${good} skip => ${bad} }` : `const Private: point = if (@Seed > 0) { ${good} } else { ${bad} }`);
    if (alias) code.push("const Send: point = @Private");
    code.push(`export point Mark = from(source: @${alias ? "Send" : "Private"})`, "}", "for Tick in @Ticks {", "instance Live = Box(Seed: @Tick)", "point Consumer = from(source: @Live::Mark)", "}", "point Control = coordinate(x: @Unit + @Delta, y: 0)");
    for (let i = 0; i < n; i++) p.geometry.push({ name: "Mark", instance: "Live", at: [i], value: point(u + i * d + f, d) }, { name: "Consumer", at: [i], value: point(u + i * d + f, d) });
    p.geometry.push({ name: "Control", value: point(u + d, 0) }); p.templates = ["Mark", "Consumer"];
  }
  p.source = code.join("\n") + "\n";
  transform(c, p);
  if (alias) { const lines = p.source.split("\n"); [lines[1], lines[2]] = [lines[2], lines[1]]; p.source = lines.join("\n"); }
  for (const l of c.limits ?? []) { transform(c, l.expected); l.through = l.through && renamed(c, l.through); l.instances = l.instances.map(n => renamed(c, n)); }
  return c;
}

export const campaign = () => (["W1", "W2"] as const).flatMap(wave => (["E", "C", "D"] as const).flatMap(s => (["A", "B", "C"] as const).flatMap(m => [0, 1].flatMap(cell => (["S", "T"] as const).map(member => candidate(wave, s, m, cell, member)))))).concat(
  (["A", "B", "C"] as const).flatMap(m => [0, 1].flatMap(cell => (["S", "T"] as const).map(member => candidate("G", "G", m, cell, member))).concat([candidate("G", "G", m, 0, "control")]))
);
