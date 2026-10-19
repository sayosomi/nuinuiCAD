import { point, type Program } from "../issue1419/model";
import { renamed, type Candidate } from "./model";

export const view = (p: Program) => ({ scalars: p.scalars, geometry: p.geometry, errors: p.errors, diagnosticBindings: p.diagnosticBindings, absent: p.absent });

// Closed-form audit of the author's model. No compiler, payload, evaluator or
// historical regression result is an input. The generator uses iterative state;
// this calculation uses prefix sums to check simultaneous incoming snapshots.
export function independentOracle(c: Candidate) {
  const { u, d, f, n, reverse, failed } = c.inputs;
  const rename = (s: string) => renamed(c, s);
  const mapped = (v: ReturnType<typeof view>) => ({
    ...v, scalars: Object.fromEntries(Object.entries(v.scalars).map(([k, x]) => [rename(k), x])),
    geometry: v.geometry.map(o => ({ ...o, name: rename(o.name), ...(o.instance ? { instance: rename(o.instance) } : {}) })),
    errors: v.errors.map(rename), diagnosticBindings: Object.fromEntries(Object.entries(v.diagnosticBindings).map(([k, x]) => [rename(k), x])), absent: v.absent.map(rename)
  });
  const empty = (): ReturnType<typeof view> => ({ scalars: {}, geometry: [], errors: [], diagnosticBindings: {}, absent: [] });
  if (c.stratum === "E") return [0, 1, 2, 3].map(k => {
    const v = empty(), instances: string[] = [];
    for (const [i, name] of ["One", "Two"].slice(0, Math.min(k, 2)).entries()) {
      if (failed.includes(name)) v.errors.push(`${name}::Fault`);
      else {
        instances.push(rename(name));
        const value = point((reverse ? -1 : 1) * (u + i * (d + 19)) + f, d);
        v.geometry.push({ name: `${name}::Mark`, value }, { name: `Use${name}`, value });
      }
    }
    if (k === 3) v.geometry.push({ name: "Independent", value: point(u + d, -f) });
    return { ...mapped(v), instances };
  });
  const v = empty();
  if (c.stratum === "C") {
    const multiplier = c.method === "C" ? f : 1, first = reverse ? 3 : 1;
    const increment = (i: number) => multiplier * (i * first + i * (i - 1) / 2);
    const total = (i: number) => d + i * (c.method === "C" ? u : u + d) + multiplier * (first * i * (i - 1) / 2 + i * (i - 1) * (i - 2) / 6);
    for (let i = 0; i < n; i++) v.geometry.push({ name: "Incoming", at: [i], value: point(u + increment(i), total(i)) });
    v.geometry.push({ name: "Final", value: point(u + increment(n), total(n)) });
    v.scalars = { Final0: BigInt(u + increment(n)), Final1: BigInt(u + d + increment(n)), FinalTotal: BigInt(total(n)) };
  } else if (c.stratum === "D") {
    const selected = reverse ? c.cell === 1 : c.cell === 0, error = "evaluation-divide-by-zero";
    v.scalars = { Chosen: selected ? error : BigInt(u + d), IndependentError: error };
    v.diagnosticBindings = { IndependentError: error, ...(selected ? { Chosen: error } : {}) };
    if (c.member === "T") { v.scalars.Send = v.scalars.Chosen; if (selected) v.diagnosticBindings.Send = error; }
    v.geometry.push({ name: "Survivor", value: point(u, d) });
    if (!selected) v.geometry.push({ name: "Dependent", value: point(u + d, f) });
    v.errors = ["IndependentFault", ...(selected ? ["Dependent"] : [])]; v.absent = ["Mark"];
  } else {
    for (let i = 0; i < n; i++) for (const name of ["Mark", "Consumer"]) v.geometry.push({ name, ...(name === "Mark" ? { instance: "Live" } : {}), at: [i], value: point(u + d * i + f, d) });
    v.geometry.push({ name: "Control", value: point(u + d, 0) });
  }
  return mapped(v);
}
