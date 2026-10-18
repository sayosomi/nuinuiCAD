import fc from "fast-check";

export type Slot = { id: string; suite: "R" | "M"; shape: 1 | 2; operation: string; seed: number };
export type Expression = number | string | { op: "+" | "-" | "*"; left: Expression; right: Expression };
export type Declaration = { name: string; expression: Expression };
export type Program = {
  source: string;
  roots: Declaration[];
  module?: { name: string; locals: Declaration[]; instances: { name: string; argument: Expression }[] };
  observations: string[];
};

// Fixed Cartesian IDs live in manifest.json BEFORE any compiler exploration.
export const slotFor = (id: string): Slot => {
  const match = /^([RM])([12])-([abcd])-(\d{2})$/.exec(id);
  if (!match || Number(match[4]) > 15) throw new Error(`invalid Stage-1 ID: ${id}`);
  return { id, suite: match[1] as Slot["suite"], shape: Number(match[2]) as Slot["shape"], operation: match[3], seed: Number(match[4]) };
};

// Positive factors retain nonzero sensitivity to x, so the two Module instances
// cannot accidentally have equal exports. Native fast-check shrinking preserves
// legality and this asymmetry; no filter/discard of compiler-rejected sources.
export const configuration = fc.record({
  initial: fc.integer({ min: -9, max: 9 }),
  terms: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 5, maxLength: 5 })
});
export type Configuration = fc.ArbitraryValue<typeof configuration>;
export const replaySeed = (slot: Slot) => (slot.suite === "R" ? 141500 : 241500) + slot.shape * 100 + slot.seed;
const binary = (op: "+" | "-" | "*", left: Expression, right: Expression): Expression => ({ op, left, right });
const ops = ["+", "-", "*"] as const;
const render = (expression: Expression): string => typeof expression === "number" ? `(${expression})`
  : typeof expression === "string" ? `@${expression}`
    : `(${render(expression.left)} ${expression.op} ${render(expression.right)})`;
const declaration = ({ name, expression }: Declaration, exported = false) => `${exported ? "export " : ""}const ${name}: number = ${render(expression)}`;
export const references = (expression: Expression): string[] => typeof expression === "number" ? []
  : typeof expression === "string" ? [expression] : [...references(expression.left), ...references(expression.right)];
const rename = (expression: Expression, from: string, to: string): Expression => typeof expression === "number" ? expression
  : typeof expression === "string" ? expression === from ? to : expression
    : { ...expression, left: rename(expression.left, from, to), right: rename(expression.right, from, to) };

export function makePair(slot: Slot, config: Configuration): [Program, Program] {
  const suffix = `${slot.suite}${slot.shape}s${slot.seed}`;
  const count = slot.suite === "R" && slot.shape === 2 ? 3 + slot.seed % 3 : 2 + slot.seed % 4;
  const names = Array.from({ length: count }, (_, i) => `n${i}_${suffix}`);
  if (slot.suite === "R") {
    const nodes: Declaration[] = names.map((name, i) => ({
      name,
      expression: i === 0 ? config.initial + slot.seed
        : slot.shape === 1 ? binary(ops[(i + slot.seed) % 3], names[i - 1], config.terms[i])
          : binary(i === 1 ? "+" : i === 2 ? "*" : ops[(i + slot.seed) % 3], names[i <= 2 ? 0 : i - 1], config.terms[i])
    }));
    nodes.push({ name: "result", expression: slot.shape === 1 ? binary("-", names.at(-1)!, config.terms[0])
      : binary("+", binary("-", names[1], names[2]), names.at(-1)!) });
    const base: Program = { source: ["nui 1", ...[...nodes].reverse().map(n => declaration(n))].join("\n"), roots: nodes, observations: ["result"] };
    let changed = nodes;
    if (slot.operation === "b") changed = [...nodes, { name: `unused_${suffix}`, expression: binary("*", config.terms[0], 7) }];
    if (slot.operation === "c") changed = nodes.map(n => ({ name: n.name === names[1] ? `renamed_${suffix}` : n.name, expression: rename(n.expression, names[1], `renamed_${suffix}`) }));
    const lines = ["nui 1", ...(slot.operation === "a" ? changed : [...changed].reverse()).map(n => declaration(n))];
    const source = slot.operation === "d" ? lines.map((line, i) => i ? `\n// trivia ${suffix} ${i}\n  ${line.replaceAll(" = ", " /* ordinary */ =\n    ")}  // end\n` : line).join("\n") : lines.join("\n");
    return [base, { ...base, roots: changed, source }];
  }

  const moduleName = `Compute_${suffix}`;
  const instances = Array.from({ length: slot.shape }, (_, i) => ({ name: `${i ? "Right" : "Left"}_${suffix}`, argument: `input${i}_${suffix}` as Expression }));
  const inputs: Declaration[] = instances.map((_, i) => ({ name: `input${i}_${suffix}`, expression: i ? -11 - slot.seed : 7 + slot.seed }));
  const locals: Declaration[] = names.map((name, i) => ({ name, expression: binary(ops[(i + slot.seed) % 3], "x", config.terms[i]) }));
  // Each independent local contributes with positive slope, including subtraction.
  locals.push({ name: "value", expression: names.reduce<Expression>((sum, name) => binary("+", sum, name), config.initial) });
  const observations = instances.map((_, i) => i ? "otherResult" : "result");
  const outputs: Declaration[] = instances.map((instance, i) => ({ name: observations[i], expression: `${instance.name}::value` }));
  const emit = (roots: Declaration[], body: Declaration[], calls: typeof instances, reordered = false) => [
    "nui 1",
    ...roots.filter(n => !observations.includes(n.name)).map(n => declaration(n)),
    `module ${moduleName}(x: number) {`,
    ...body.map(n => `  ${declaration(n, n.name === "value")}`),
    "}",
    ...(reordered ? [...calls].reverse() : calls).map(instance => `instance ${instance.name} = ${moduleName}(x: ${render(instance.argument)})`),
    ...roots.filter(n => observations.includes(n.name)).map(n => declaration(n))
  ].join("\n");
  const base: Program = { source: emit([...inputs, ...outputs], locals, instances), roots: [...inputs, ...outputs], module: { name: moduleName, locals, instances }, observations };
  let roots = base.roots, body = locals, calls = instances;
  if (slot.operation === "a") { roots = [...[...inputs].reverse(), ...[...outputs].reverse()]; body = [locals.at(-1)!, ...locals.slice(0, -1).reverse()]; }
  if (slot.operation === "b") body = [...locals, { name: `unused_${suffix}`, expression: binary("-", 9, config.terms[0]) }];
  if (slot.operation === "c") {
    const oldName = instances[0].name, newName = `Renamed_${suffix}`;
    calls = instances.map((instance, i) => i ? instance : { ...instance, name: newName });
    roots = roots.map(n => ({ ...n, expression: rename(n.expression, `${oldName}::value`, `${newName}::value`) }));
  }
  if (slot.operation === "d") {
    const aliases: Declaration[] = instances.map((instance, i) => ({ name: `alias${i}_${suffix}`, expression: slot.seed % 2 ? `${instance.name}::value` : instance.argument }));
    roots = [...inputs, ...aliases, ...outputs.map((n, i) => slot.seed % 2 ? { ...n, expression: aliases[i].name } : n)];
    if (!(slot.seed % 2)) calls = instances.map((instance, i) => ({ ...instance, argument: aliases[i].name }));
  }
  return [base, { ...base, roots, module: { name: moduleName, locals: body, instances: calls }, source: emit(roots, body, calls, slot.operation === "a") }];
}

// This is an integer model interpreter, never a DSL parser or production helper.
// BigInt also verifies every intermediate stays inside the exact binary64 range.
export function oracle(program: Program): Map<string, number> {
  const nodes = modelNodes(program), values = new Map<string, bigint>();
  const expressionValue = (expression: Expression): bigint => {
    if (typeof expression === "number") return BigInt(expression);
    if (typeof expression === "string") return value(expression);
    const left = expressionValue(expression.left), right = expressionValue(expression.right);
    return expression.op === "+" ? left + right : expression.op === "-" ? left - right : left * right;
  };
  const value = (name: string): bigint => {
    if (values.has(name)) return values.get(name)!;
    if (!nodes.has(name)) throw new Error(`model missing ${name}`);
    const result = expressionValue(nodes.get(name)!);
    if (result < -1_000_000n || result > 1_000_000n) throw new Error(`unbounded model ${name}`);
    values.set(name, result);
    return result;
  };
  for (const name of nodes.keys()) value(name);
  return new Map([...values].map(([name, v]) => [name, Number(v)]));
}

export function modelNodes(program: Program): Map<string, Expression> {
  const nodes = new Map(program.roots.map(n => [n.name, n.expression]));
  for (const instance of program.module?.instances ?? []) {
    nodes.set(`${instance.name}::x`, instance.argument);
    for (const local of program.module!.locals) {
      let expression = rename(local.expression, "x", `${instance.name}::x`);
      for (const target of program.module!.locals) expression = rename(expression, target.name, `${instance.name}::${target.name}`);
      nodes.set(`${instance.name}::${local.name}`, expression);
    }
  }
  return nodes;
}
