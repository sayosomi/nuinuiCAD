import { point, type Observation, type Program } from "../issue1419/model";
import type { Candidate } from "./model";

// A second calculation, independent of the generator's iterative state update.
// It receives authored model inputs only; no compiler, payload or runtime data.
export function independentOracle(c: Candidate) {
  const { unit: u, delta: d, factor: f } = c.oracleInputs;
  const rename = (name: string) => c.member === "T" && c.variant % 2 === 0
    ? name.replace(/\b[A-Z][A-Za-z0-9]*\b/g, token => `Renamed${token}`) : name;
  const view = (p: Pick<Program, "scalars" | "geometry" | "errors" | "diagnosticBindings" | "absent">) => ({
    scalars: Object.fromEntries(Object.entries(p.scalars).map(([k, v]) => [rename(k), v])),
    geometry: p.geometry.map(o => ({ ...o, name: rename(o.name) })),
    errors: p.errors.map(rename),
    diagnosticBindings: Object.fromEntries(Object.entries(p.diagnosticBindings).map(([k, v]) => [rename(k), v])),
    absent: p.absent.map(rename)
  });
  if (c.stratum === "E") return [0, 1, 2, 2].map((count, placement) => {
    const geometry: Observation[] = [];
    for (let i = 0; i < count; i++) {
      const value = point(u + i * (d + 13) + (c.method === "C" ? f : 2), c.method === "C" ? d : 7);
      geometry.push({ name: `${["One", "Two"][i]}::Mark`, value }, { name: `Use${["One", "Two"][i]}`, value });
    }
    if (placement === 3) geometry.push({ name: "Independent", value: point(u + d, -d) });
    return { ...view({ scalars: {}, geometry, errors: placement === 3 ? ["Failed::Fault"] : [], diagnosticBindings: {}, absent: [] }), instances: ["One", "Two"].slice(0, count).map(rename) };
  });
  if (c.stratum === "D") {
    const failed = c.variant % 2 === 0, error = "evaluation-divide-by-zero";
    const scalars: Program["scalars"] = { Chosen: failed ? error : BigInt(u + d), IndependentError: error };
    const diagnosticBindings: Program["diagnosticBindings"] = { IndependentError: error };
    if (failed) diagnosticBindings.Chosen = error;
    if (c.member === "T" && c.variant % 2 === 1) scalars.Forwarded = BigInt(u + d);
    return view({ scalars, diagnosticBindings, absent: ["Mark"], errors: failed ? ["IndependentErrorPoint", "Dependent"] : ["IndependentErrorPoint"], geometry: [
      { name: "Surviving", value: point(u, d) },
      ...(!failed ? [{ name: "Dependent", value: point(u + d, 5) }] : [])
    ] });
  }
  const n = [0, 1, 2, 4][c.variant], geometry: Observation[] = [];
  const triangle = (k: number) => k * (k + 1) / 2;
  // After m odd outer iterations, A has applied the affine map twice per
  // inner loop. C adds the odd integers, whose sum is m².
  const a = (m: number) => c.method === "C" ? u + m * m + m * (f + d)
    : u * 4 ** m + Array.from({ length: m }, (_, r) => (2 * (2 * r + 1 + f) + d) * 4 ** (m - r - 1)).reduce((x, y) => x + y, 0);
  const b = (m: number) => d + 2 * m * m;
  for (let i = 0; i < n; i++) {
    if (c.method === "B") geometry.push({ name: "Incoming", at: [i], value: point(u + triangle(i), d + i * (u + d) + (i - 1) * i * (i + 1) / 6) });
    else {
      const tick = i + 1, m = Math.ceil(i / 2);
      if (tick % 2) {
        geometry.push({ name: "InnerTrace", at: [i, 0], value: point(a(m), c.method === "C" ? b(m) : tick + f) });
        geometry.push({ name: "InnerTrace", at: [i, 1], value: point(c.method === "C" ? a(m) + tick + f : 2 * a(m) + tick + f, c.method === "C" ? b(m) + tick : d) });
      }
      geometry.push({ name: "Incoming", at: [i], value: point(a(Math.ceil(tick / 2)), a(m)) });
    }
  }
  const scalars: Program["scalars"] = c.method === "B"
    ? { Final0: BigInt(u + triangle(n)), Final1: BigInt(u + d + triangle(n)), Final2: BigInt(d + n * (u + d) + (n - 1) * n * (n + 1) / 6) }
    : { Final0: BigInt(a(Math.ceil(n / 2))), ...(c.method === "C" ? { Final1: BigInt(b(Math.ceil(n / 2))) } : {}) };
  return view({ scalars, geometry, errors: [], diagnosticBindings: {}, absent: [] });
}
