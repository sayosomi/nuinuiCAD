import fc from "fast-check";
import { blank, point, type Program } from "../issue1419/model";

export type Stratum = "E" | "C" | "D";
export type Method = "A" | "B" | "C";
export type Candidate = {
  id: string; stratum: Stratum; method: Method; variant: number; seed: number;
  member: "S" | "T"; program: Program; activation: string[];
  limits?: { placement: string; through?: string; expected: Program; instances: string[] }[];
};
export const matrix = [..."ECD"].flatMap(s => [..."ABC"].flatMap(m => [0, 1, 2, 3].map(v => `${s}-${m}-0${v}`)));
const parameters = fc.record({ unit: fc.integer({ min: 7, max: 83 }), delta: fc.integer({ min: 11, max: 43 }), factor: fc.integer({ min: 2, max: 4 }) });

// A selects a repaired producer's adjacent boundary; B selects a concrete wire
// risk; C draws state from this model without consulting compiler/runtime data.
// No oracle below consumes compiled or evaluated output.
export function pair(id: string): Candidate[] {
  const [stratum, method, raw] = id.split("-") as [Stratum, Method, string];
  const variant = Number(raw), seed = 1421000 + "ECD".indexOf(stratum) * 10000 + "ABC".indexOf(method) * 100 + variant;
  const { unit: u, delta: d, factor: f } = fc.sample(parameters, { seed, numRuns: 1 })[0];
  return (["S", "T"] as const).map(member => {
    const alias = member === "T" && variant % 2 === 1;
    const p = blank(), code = ["nui 1", `const Unit: number = ${u}`, `const Delta: number = ${d}`];
    const c: Candidate = { id, stratum, method, variant, seed, member, program: p, activation: [] };
    if (alias) code.push("const Padding: number = @Unit + @Delta");
    if (stratum === "E") {
      // The failed third instance is an atomicity contrast in every source.
      code.push("module Box(Origin: number, Fail: boolean) {");
      if (method === "A") code.push("const Chosen: point = if (@Origin > 0) { coordinate(x: @Origin + 2, y: 7) } else { coordinate(x: 1 / 0, y: 0) }");
      if (method === "B") code.push("const FirstChoice: number = @Origin + 2", "const Choices: number[] = if (@Origin > 0) { [@FirstChoice, 7] } else { [] }", "const Chosen: point = coordinate(x: @Choices[0], y: @Choices[1])");
      if (method === "C") code.push(`const Chosen: point = coordinate(x: @Origin + ${f}, y: ${d})`);
      code.push(...(alias ? ["const Send: point = @Chosen", "export point Mark = from(source: @Send)"] : ["export point Mark = from(source: @Chosen)"]), "point Fault(enabled: @Fail) = coordinate(x: 1 / 0, y: 0)", "}");
      const origins = [u, u + d + 13];
      for (const [i, name] of ["One", "Two"].entries()) {
        code.push(`instance ${name} = Box(Origin: ${origins[i]}, Fail: false)`);
        if (alias) code.push(`const Export${name}: point = @${name}::Mark`);
        code.push(`point Use${name} = from(source: @${alias ? `Export${name}` : `${name}::Mark`})`);
      }
      code.push("instance Failed = Box(Origin: 101, Fail: true)", "point UseFailed = from(source: @Failed::Mark)", `point Independent = coordinate(x: ${u + d}, y: ${0 - d})`);
      const expected = (count: number, failed: boolean) => {
        const e = blank();
        for (let i = 0; i < count; i++) e.geometry.push({ name: `${["One", "Two"][i]}::Mark`, value: point(origins[i] + (method === "C" ? f : 2), method === "C" ? d : 7) }, { name: `Use${["One", "Two"][i]}`, value: point(origins[i] + (method === "C" ? f : 2), method === "C" ? d : 7) });
        if (failed) { e.geometry.push({ name: "Independent", value: point(u + d, -d) }); e.errors = ["Failed::Fault"]; }
        return e;
      };
      c.limits = [
        { placement: "before-first", expected: expected(0, false), instances: [] },
        { placement: "first-only", through: "UseOne", expected: expected(1, false), instances: ["One"] },
        { placement: "both", through: "UseTwo", expected: expected(2, false), instances: ["One", "Two"] },
        { placement: "failed-and-independent", through: "Independent", expected: expected(2, true), instances: ["One", "Two"] }
      ];
      c.activation = ["asymmetric-Module-exports", "four-limit-placements", "failed-instance-atomicity", method === "B" ? "Module-collection-selector-readiness" : "Module-geometry-value-readiness"];
    } else if (stratum === "C") {
      const n = [0, 1, 2, 4][variant], ticks = Array.from({ length: n }, (_, i) => i + 1);
      code.push(`const Ticks: number[] = [${ticks}]`);
      if (method === "B") {
        code.push(`for Tick in @Ticks carry Values: number[] = [${u}, ${u + d}] carry Total: number = ${d} {`, "const Mapped: number[] = for Item in @Values { if (@Tick > 0) { @Item + @Tick } else { 1 / 0 } }", "const Before: number = @Values[0]", "point Incoming = coordinate(x: @Before, y: @Total)", ...(alias ? ["const Send: number[] = @Mapped", "next Values = @Send"] : ["next Values = @Mapped"]), "next Total = @Total + @Values[1]", "}", "const Final0: number = @Values[0]", "const Final1: number = @Values[1]", "const Final2: number = @Total");
        let a = u, b = u + d, total = d;
        for (const [i, tick] of ticks.entries()) {
          p.geometry.push({ name: "Incoming", at: [i], value: point(a, total) });
          const next = [a + tick, b + tick, total + b];
          p.trace.push({ loop: "Tick", at: [i], incoming: { Values: [a, b], Total: total }, next: { Values: next.slice(0, 2), Total: next[2] }, final: {} });
          [a, b, total] = next;
        }
        p.scalars = { Final0: BigInt(a), Final1: BigInt(b), Final2: BigInt(total) }; p.carries = ["Values", "Total"]; p.templates = ["Incoming"];
        c.activation = ["collection-for-frame-capture", "lazy-if", "simultaneous-scalar-array-carry", `outer-count:${n}`];
      } else {
        const collection = method === "C", type = collection ? "number[]" : "number";
        code.push(`for Tick in @Ticks carry Outer: ${type} = ${collection ? `[${u}, ${d}]` : u} {`, `const Member: number = @Tick + ${f}`, `const Items: number[] = if (@Tick % 2 == 1) { [@Member, ${d}] } else { [] }`, `for Item in @Items carry Inner: ${type} = @Outer {`);
        if (collection) code.push("const First: number = @Inner[0]", "const Second: number = @Inner[1]", "point InnerTrace = coordinate(x: @First, y: @Second)", "const NewFirst: number = @Inner[0] + @Item", "const NewSecond: number = @Inner[1] + @Tick", "const Replacement: number[] = [@NewFirst, @NewSecond]", ...(alias ? ["const Send: number[] = @Replacement", "next Inner = @Send"] : ["next Inner = @Replacement"]));
        else code.push("point InnerTrace = coordinate(x: @Inner, y: @Item)", ...(alias ? ["const Send: number = @Inner * 2 + @Item", "next Inner = @Send"] : ["next Inner = @Inner * 2 + @Item"]));
        code.push("}", ...(collection ? ["const After: number = @Inner[0]", "const Before: number = @Outer[0]", "point Incoming = coordinate(x: @After, y: @Before)"] : ["point Incoming = coordinate(x: @Inner, y: @Outer)"]), ...(alias ? [`const OuterSend: ${type} = @Inner`, "next Outer = @OuterSend"] : ["next Outer = @Inner"]), "}");
        let a = u, b = d;
        for (const [i, tick] of ticks.entries()) {
          const old = a, items = tick % 2 ? [tick + f, d] : [];
          for (const [j, item] of items.entries()) {
            p.geometry.push({ name: "InnerTrace", at: [i, j], value: point(a, collection ? b : item) });
            const next = collection ? a + item : a * 2 + item;
            p.trace.push({ loop: "Item", at: [i, j], incoming: { Inner: collection ? [a, b] : a }, next: { Inner: collection ? [next, b + tick] : next }, final: {} });
            a = next; if (collection) b += tick;
          }
          p.geometry.push({ name: "Incoming", at: [i], value: point(a, old) });
        }
        code.push(...(collection ? ["const FinalValues: number[] = @Outer"] : ["const Escaped: number = @Outer", "const FinalValues: number[] = [@Escaped]"]), "const Final0: number = @FinalValues[0]");
        p.scalars.Final0 = BigInt(a);
        if (collection) { code.push("const Final1: number = @FinalValues[1]"); p.scalars.Final1 = BigInt(b); }
        p.carries = ["Outer", "Inner"]; p.templates = ["Incoming", "InnerTrace"];
        c.activation = ["nested-frame-conditional-source", "nearest-loop-next", collection ? "array-snapshot" : "scalar-snapshot", `outer-count:${n}`];
      }
    } else {
      const selected = variant === 0 || variant === 2;
      code.push("const Zero: number = 0", `const Flag: boolean = ${selected}`, "module Guard(Divisor: number) {", "const Selected: point = if (@Divisor > 0) { coordinate(x: @Divisor, y: 3) } else { coordinate(x: 1 / 0, y: 0) }", "export point Mark = from(source: @Selected)", "}");
      if (method === "B" || variant === 3) code.push("group Sleeping(enabled: false) {", "instance Dormant = Guard(Divisor: 0)", "}");
      else code.push("instance Dormant(enabled: false) = Guard(Divisor: 0)");
      const fail = method === "C" ? "(@Unit + @Delta) / @Zero" : "@Unit / @Zero";
      if (method === "B") code.push(`const Side: choice(failing, valid) = ${selected ? "failing" : "valid"}`);
      const branch = method === "B" ? `match @Side { failing => ${fail} valid => @Unit + @Delta }` : `if (@Flag) { ${fail} } else { @Unit + @Delta }`;
      // Choice match enumerates every declared option.
      code.push(`const Chosen: number = ${branch}`);
      if (alias) code.push("const Forwarded: number = @Chosen");
      const scalarError = "const IndependentError: number = @Delta / @Zero";
      const geometryError = "point IndependentErrorPoint = coordinate(x: @Delta / @Zero, y: 0)";
      code.push(...(variant >= 2 ? [geometryError, scalarError] : [scalarError, geometryError]), `point Dependent = coordinate(x: @${alias ? "Forwarded" : "Chosen"}, y: 5)`, "point Surviving = coordinate(x: @Unit, y: @Delta)");
      p.scalars = { Chosen: selected ? "evaluation-divide-by-zero" : BigInt(u + d), IndependentError: "evaluation-divide-by-zero" };
      p.diagnosticBindings.IndependentError = "evaluation-divide-by-zero";
      if (selected) p.diagnosticBindings.Chosen = "evaluation-divide-by-zero";
      if (alias) { p.scalars.Forwarded = p.scalars.Chosen; if (selected) p.diagnosticBindings.Forwarded = "evaluation-divide-by-zero"; }
      p.geometry = [{ name: "Surviving", value: point(u, d) }];
      if (!selected) p.geometry.push({ name: "Dependent", value: point(u + d, 5) });
      p.errors = selected ? ["IndependentErrorPoint", "Dependent"] : ["IndependentErrorPoint"];
      c.activation = [selected ? "selected-failure" : "unselected-failure-control", "independent-scalar-geometry-errors", method === "B" || variant === 3 ? "disabled-ancestor" : "disabled-Module", "diagnostic-owner-routing"];
    }
    p.source = code.join("\n") + "\n";
    if (member === "T" && variant % 2 === 0) {
      const rename = (v: string) => v.replace(/\b[A-Z][A-Za-z0-9]*\b/g, name => `Renamed${name}`);
      const transform = (p: Program) => {
        p.source = rename(p.source);
        p.scalars = Object.fromEntries(Object.entries(p.scalars).map(([k, v]) => [rename(k), v]));
        p.geometry = p.geometry.map(o => ({ ...o, name: rename(o.name) }));
        p.templates = p.templates.map(rename); p.carries = p.carries.map(rename); p.errors = p.errors.map(rename);
        p.diagnosticBindings = Object.fromEntries(Object.entries(p.diagnosticBindings).map(([k, v]) => [rename(k), v]));
      };
      transform(p);
      const lines = p.source.split("\n"); [lines[1], lines[2]] = [lines[2], lines[1]]; p.source = lines.join("\n");
      for (const limit of c.limits ?? []) { transform(limit.expected); if (limit.through) limit.through = rename(limit.through); limit.instances = limit.instances.map(rename); }
    }
    return c;
  });
}
