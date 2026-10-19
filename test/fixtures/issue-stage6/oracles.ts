import { renamed, type Candidate } from "./model";

// Source-semantics-only oracle. No compiler/evaluator output is an input.
// S uses a closed form: b-s becomes zero after the first iteration, b+s doubles and
// receives 2*tick. a=b-d throughout. This differs from the generator recurrence.
export function independentOracle(c: Candidate) {
  const { u, d, f, n } = c.inputs, name = (s: string) => renamed(c, s);
  if (c.stratum === "S") {
    const state = (i: number) => {
      const sum = 2 ** i * (u + d + f) + 2 * (2 ** (i + 1) - i - 2);
      const difference = i === 0 ? u + d - f : 0;
      const b = (sum + difference) / 2, s = (sum - difference) / 2;
      return { s, a: b - d, b };
    };
    const states = Array.from({ length: n + 1 }, (_, i) => state(i));
    const { a, b, s } = state(n);
    const countermodel = (order: "scalar" | "array") => {
      let scalar = f, first = u, second = u + d;
      const trace = [];
      for (let tick = 1; tick <= n; tick++) {
        if (order === "scalar") { scalar += second + tick; first += scalar + tick; second += scalar + tick; }
        else { first += scalar + tick; second += scalar + tick; scalar += second + tick; }
        trace.push({ scalar, values: [first, second] });
      }
      return { scalar, values: [first, second], trace };
    };
    return { states, scalars: { [name("Final0")]: a, [name("Final1")]: b, [name("FinalTotal")]: s },
      countermodels: { scalarFirst: countermodel("scalar"), arrayFirst: countermodel("array") } };
  }
  if (c.stratum === "O") return { rows: Array.from({ length: n }, (_, i) => ({ at: i, x: (c.inputs.negative ? -1 : 1) * (u + i * d) + f, y: d })), survivor: { x: u + d, y: 0 }, privateName: name("Private") };
  const failed = c.member === "control" ? undefined : name(c.cell & 4 ? "Two" : "One");
  return { failed, diagnosticCode: "evaluation-divide-by-zero", diagnostic: failed ? `${failed}::${name("Risk")}` : undefined,
    limits: [0,1,2,3].map(k => ({ placement: ["before-first", "through-first", "through-second", "through-independent"][k],
      through: k === 0 ? undefined : name(k === 3 ? "Survivor" : k === 1 ? "UseOne" : "UseTwo"),
      geometry: ["One", "Two"].slice(0, Math.min(k, 2)).flatMap((owner, i) => name(owner) === failed ? [] : [
        { name: `${name(owner)}::${name("Prefix")}`, x: u + i * d, y: 1 },
        { name: `${name(owner)}::${name("Mark")}`, x: u + i * d, y: d },
        { name: name(`Use${owner}`), x: u + i * d, y: d }
      ]).concat(k === 3 ? [{ name: name("Survivor"), x: u + d, y: -f }] : []),
      instances: ["One", "Two"].slice(0, Math.min(k, 2)).map(name).filter(n => n !== failed),
      failureActive: !!failed && [name("One"), name("Two")].slice(0, Math.min(k, 2)).includes(failed)
    })) };
}
