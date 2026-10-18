import { configuration, type Configuration } from "../issue1415/model";
export { configuration };

export type Slot = { id: string; suite: "C" | "V" | "S" | "X"; shape: 1 | 2; operation: string; seed: number };
export type Expr = number | boolean | { ref: string } | { choice: string }
  | { op: "+" | "-" | "*" | "/" | "==" | ">"; left: Expr; right: Expr }
  | { kind: "if"; condition: Expr; yes: Expr; no: Expr }
  | { kind: "match"; selector: Expr; left: Expr; right: Expr }
  | { kind: "array"; members: Expr[] }
  | { kind: "map"; source: string; binder: string; body: Expr }
  | { kind: "index"; source: string; index: number }
  | { kind: "length"; source: string };
export type Declaration = { name: string; type: string; expression: Expr };
export type Loop = {
  binder: string; source: { collection: string } | { min: number; max: number; step: number };
  carries: { name: string; initial: Expr; next: Expr }[];
  body: Declaration[]; reverseNext?: boolean;
};
export type Program = { source: string; roots: Declaration[]; outputs: Declaration[]; loop?: Loop; observations: string[] };
export type Value = bigint | boolean | string | (bigint | string)[];
export type Step = { binder: Value; incoming: Map<string, Value>; next: Map<string, Value>; body: Map<string, Value>; branches: string[] };
export class ModelRuntimeError extends Error {
  constructor(readonly binding: string) { super(`independent division by zero in ${binding}`); }
}
export const slotFor = (id: string): Slot => {
  const m = /^([CVSX])([12])-([abcd])-(\d{2})$/.exec(id);
  if (!m || Number(m[4]) > 15) throw new Error(`invalid Stage-2 ID ${id}`);
  return { id, suite: m[1] as Slot["suite"], shape: Number(m[2]) as Slot["shape"], operation: m[3], seed: Number(m[4]) };
};
export const replaySeed = (s: Slot) => 141700 + "CVSX".indexOf(s.suite) * 10_000 + s.shape * 100 + s.seed;
export const ref = (name: string): Expr => ({ ref: name });
const op = (operator: Extract<Expr, { op: string }>["op"], left: Expr, right: Expr): Expr => ({ op: operator, left, right });
const num = (name: string, expression: Expr): Declaration => ({ name, type: "number", expression });
const choiceType = "choice(left, right)";
export const iterationCount = (s: Slot) => [0, 1, 2, 4][s.seed % 4];

export function render(e: Expr): string {
  if (typeof e === "number") return `(${e})`;
  if (typeof e === "boolean") return String(e);
  if ("ref" in e) return `@${e.ref}`;
  if ("choice" in e) return e.choice;
  if ("op" in e) return `(${render(e.left)} ${e.op} ${render(e.right)})`;
  switch (e.kind) {
    case "if": return `if (${render(e.condition)}) { ${render(e.yes)} } else { ${render(e.no)} }`;
    case "match": return `match ${render(e.selector)} { left => ${render(e.left)} right => ${render(e.right)} }`;
    // Collection members use the literal/reference grammar, rather than the
    // parenthesized general numeric-expression spelling used elsewhere.
    case "array": return `[${e.members.map(m => typeof m === "number" ? String(m) : render(m)).join(", ")}]`;
    case "map": return `for ${e.binder} in @${e.source} { ${render(e.body)} }`;
    case "index": return `@${e.source}[${e.index}]`;
    case "length": return `@${e.source}.length`;
  }
}
const declaration = (d: Declaration) => `const ${d.name}: ${d.type} = ${render(d.expression)}`;
export function emit(p: Omit<Program, "source">): Program {
  const lines = ["nui 1", ...p.roots.map(declaration)];
  if (p.loop) {
    const l = p.loop, s = l.source;
    lines.push(`for ${l.binder} in ${"collection" in s ? `@${s.collection}` : `range(min: ${s.min}, max: ${s.max}, step: ${s.step})`} ${l.carries.map(c => `carry ${c.name}: number = ${render(c.initial)}`).join(" ")} {`);
    lines.push(...l.body.map(d => `  ${declaration(d)}`));
    lines.push(...(l.reverseNext ? [...l.carries].reverse() : l.carries).map(c => `  next ${c.name} = ${render(c.next)}`), "}");
  }
  lines.push(...p.outputs.map(declaration));
  return { ...p, source: lines.join("\n") };
}

// Rename the generator graph, never parse or replace strings in emitted DSL.
function renameExpr(e: Expr, from: string, to: string): Expr {
  if (typeof e !== "object") return e;
  const name = (n: string) => n === from ? to : n;
  const r = (x: Expr) => renameExpr(x, from, to);
  if ("ref" in e) return ref(name(e.ref));
  if ("choice" in e) return e;
  if ("op" in e) return { ...e, left: r(e.left), right: r(e.right) };
  switch (e.kind) {
    case "if": return { ...e, condition: r(e.condition), yes: r(e.yes), no: r(e.no) };
    case "match": return { ...e, selector: r(e.selector), left: r(e.left), right: r(e.right) };
    case "array": return { ...e, members: e.members.map(r) };
    case "map": return { ...e, source: name(e.source), binder: name(e.binder), body: r(e.body) };
    default: return { ...e, source: name(e.source) };
  }
}
function rename(p: Program, from: string, to: string): Program {
  const n = (name: string) => name === from ? to : name;
  const r = (e: Expr) => renameExpr(e, from, to);
  const d = (x: Declaration) => ({ ...x, name: n(x.name), expression: r(x.expression) });
  return emit({ ...p, roots: p.roots.map(d), outputs: p.outputs.map(d), loop: p.loop && {
    ...p.loop, binder: n(p.loop.binder), carries: p.loop.carries.map(c => ({ name: n(c.name), initial: r(c.initial), next: r(c.next) })), body: p.loop.body.map(d)
  } });
}

export function makePair(s: Slot, c: Configuration): [Program, Program] {
  const roots: Declaration[] = [num("p", 11 + s.seed * 3 + c.initial), num("q", -19 - s.seed * 2 - c.terms[0])];
  const outputs: Declaration[] = [], observations: string[] = [];
  const observe = (name: string, expression: Expr) => { outputs.push(num(name, expression)); observations.push(name); };
  const length = iterationCount(s);
  let loop: Loop | undefined;
  if (s.suite === "C") {
    for (let i = 2; i < 2 + s.seed % 4; i++) roots.push(num(`p${i}`, 31 + i * 7 + s.seed));
    const extra = roots.slice(2).reduce<Expr>((sum, d) => op("+", sum, ref(d.name)), 0);
    const yes = op("+", op("*", ref("p"), 2), extra), no = op("-", ref("q"), extra);
    roots.push(num("zero", op("-", ref("p"), ref("p"))));
    roots.push(s.shape === 1 ? { name: "selector", type: "boolean", expression: s.seed % 2 === 0 }
      : { name: "selector", type: choiceType, expression: { choice: s.seed % 2 ? "right" : "left" } });
    observe("result", s.shape === 1 ? { kind: "if", condition: ref("selector"), yes, no }
      : { kind: "match", selector: ref("selector"), left: yes, right: no });
  } else if (s.suite === "V") {
    roots.push({ name: "items", type: "number[]", expression: { kind: "array", members: Array.from({ length }, (_, i) => (i % 2 ? -1 : 1) * (s.seed + 3 + i * 7)) } });
    roots.push({ name: "mapped", type: "number[]", expression: { kind: "map", source: "items", binder: "item", body: op("+", op("*", ref("item"), c.terms[1] + 1), ref("p")) } });
    if (s.shape === 2) roots.push({ name: "chained", type: "number[]", expression: { kind: "map", source: "mapped", binder: "other", body: op("-", op("*", ref("other"), 3), ref("q")) } });
  } else {
    const isMatch = s.suite === "X" && s.shape === 2;
    roots.push({ name: "items", type: isMatch ? `${choiceType}[]` : "number[]", expression: { kind: "array", members: Array.from({ length }, (_, i) => isMatch
      ? { choice: (s.operation === "d" ? s.seed : i + s.seed) % 2 ? "right" : "left" }
      : (s.operation === "d" && s.suite === "X" ? (s.seed % 2 ? -1 : 1) : (i % 2 ? -1 : 1)) * (i + s.seed + 2)) } });
    roots.push(num("zero", op("-", ref("p"), ref("p"))));
    const binder = "tick";
    const source: Loop["source"] = s.suite === "S" && length > 0 && s.seed % 2 ? { min: 2, max: 2 + (length - 1) * 3, step: 3 } : { collection: "items" };
    const total = ref("total"), tick = ref(binder);
    let next = op("+", op("+", total, tick), ref("p"));
    if (s.suite === "X") next = isMatch
      ? { kind: "match", selector: tick, left: op("+", total, ref("p")), right: op("-", total, ref("q")) }
      : { kind: "if", condition: op(">", tick, 0), yes: op("+", total, ref("p")), no: op("-", total, ref("q")) };
    loop = { binder, source, carries: [{ name: "total", initial: ref("p"), next }], body: [num("incomingTotal", total)] };
    if (s.suite === "S" && s.shape === 2) {
      loop.carries[0].next = op("+", ref("otherTotal"), tick);
      loop.carries.push({ name: "otherTotal", initial: ref("q"), next: op("-", total, tick) });
      loop.body.push(num("incomingOther", ref("otherTotal")));
      observe("otherResult", ref("otherTotal"));
    }
    if (s.suite === "X") {
      const branch = next as Extract<Expr, { kind: "if" | "match" }>;
      loop.body.push(num("branchSeen", branch.kind === "if" ? { ...branch, yes: 1, no: 0 } : { ...branch, left: 1, right: 0 }));
    } else loop.body.push(num("binderSeen", tick));
    observe("result", total);
  }
  // A signed numeric expression is authored in an ordinary scalar initializer;
  // the collection then uses the normative whole scalar-reference member form.
  for (const d of [...roots]) {
    const e = d.expression;
    if (typeof e !== "object" || !("kind" in e) || e.kind !== "array") continue;
    e.members = e.members.map((member, i) => {
      if (typeof member !== "number" || member >= 0) return member;
      const name = `${d.name}Member${i}`;
      roots.splice(roots.indexOf(d), 0, num(name, member));
      return ref(name);
    });
  }
  // Full collection observations force every lazy result member, including
  // intermediate maps. Length zero has no index observation by construction.
  for (const d of roots.filter(d => d.type.endsWith("[]"))) {
    outputs.push(num(`${d.name}Length`, { kind: "length", source: d.name }));
    for (let i = 0; i < length; i++) {
      const type = d.type.slice(0, -2), name = `${d.name}At${i}`;
      outputs.push({ name, type, expression: { kind: "index", source: d.name, index: i } });
      observations.push(name);
    }
    observations.push(`${d.name}Length`);
  }
  const original = emit({ roots, outputs, loop, observations });
  let changed = structuredClone(original);
  if (s.operation === "a") {
    // Only independent numeric prerequisites move, never loop/source ownership.
    [changed.roots[0], changed.roots[1]] = [changed.roots[1], changed.roots[0]];
    if (s.suite === "C") changed.roots.reverse();
  } else if ((s.suite === "C" && s.operation === "b") || (s.suite === "V" && s.operation === "d") || (s.suite === "S" && s.operation === "c")) {
    changed.roots.unshift(num("unused", 101 + s.seed));
  } else if ((s.suite === "C" && s.operation === "c")) changed = rename(changed, "p", "renamedP");
  else if (s.operation === "b") {
    if (s.suite === "V") {
      changed = rename(changed, "item", "renamedItem");
      if (s.shape === 2) changed = rename(changed, "other", "renamedOther");
    } else {
      changed = rename(rename(changed, "tick", "renamedTick"), "total", "renamedTotal");
      if (s.suite === "S" && s.shape === 2) changed = rename(changed, "otherTotal", "renamedOtherTotal");
    }
  } else if (s.suite === "V" && s.operation === "c") {
    changed.roots.splice(changed.roots.findIndex(d => d.name === "items") + 1, 0, { name: "inputAlias", type: "number[]", expression: ref("items") });
    changed.outputs.push(num("inputAliasLength", { kind: "length", source: "inputAlias" }));
    for (let i = 0; i < length; i++) changed.outputs.push(num(`inputAliasAt${i}`, { kind: "index", source: "inputAlias", index: i }));
    const map = changed.roots.find(d => d.name === "mapped")!.expression;
    if (typeof map !== "object" || !("kind" in map) || map.kind !== "map") throw new Error("missing generated map");
    map.source = "inputAlias";
  } else if (s.suite === "X" && s.operation === "c") {
    const selected = s.shape === 2 && s.seed % 2 ? "q" : "p";
    changed.roots.push(num("selectedAlias", ref(selected)));
    changed.loop!.carries[0].next = renameExpr(changed.loop!.carries[0].next, selected, "selectedAlias");
  } else if (s.suite === "S" && s.operation === "d") {
    if (s.shape === 2) changed.loop!.reverseNext = true;
    else { changed.roots.push(num("initialAlias", ref("p"))); changed.loop!.carries[0].initial = ref("initialAlias"); }
  } else if (s.operation === "d") {
    const target = s.suite === "C" ? changed.outputs[0] : changed.loop!.carries[0];
    const expr = "expression" in target ? target.expression : target.next;
    const fail = op("/", 1, ref("zero"));
    if (typeof expr !== "object" || !("kind" in expr)) throw new Error("missing conditional");
    if (expr.kind === "if") { if (s.seed % 2) expr.yes = fail; else expr.no = fail; }
    else if (expr.kind === "match") { if (s.seed % 2) expr.left = fail; else expr.right = fail; }
  }
  return [original, emit(changed)];
}

export function selectedErrorControl(p: Program, s: Slot): Program {
  const changed = structuredClone(p), fail = op("/", 1, ref("zero"));
  const expr = s.suite === "C" ? changed.outputs[0].expression : changed.loop!.carries[0].next;
  if (typeof expr !== "object" || !("kind" in expr)) throw new Error("missing error contrast");
  if (expr.kind === "if") { if (s.seed % 2) expr.no = fail; else expr.yes = fail; }
  else if (expr.kind === "match") { if (s.seed % 2) expr.right = fail; else expr.left = fail; }
  // Empty X sources have no branch to select. A singleton of the same exact
  // binder type is the nearby contrast, preserving all prerequisites/owners.
  if (s.suite === "X" && iterationCount(s) === 0) {
    const items = changed.roots.find(d => d.name === "items")!;
    items.expression = { kind: "array", members: [s.shape === 2 ? { choice: "left" } : 2] };
  }
  return emit(changed);
}

// Independent bounded integer interpreter over GENERATOR nodes. No compiler or
// evaluator product participates in this oracle. Commit uses a new Map only
// after ALL right-hand sides have read the same incoming snapshot.
export function oracle(p: Program) {
  const values = new Map<string, Value>(), trace: Step[] = [], branches: string[] = [];
  const declarations = new Map([...p.roots, ...p.outputs].map(d => [d.name, d.expression]));
  const bounded = (n: bigint) => { if (n < -1_000_000n || n > 1_000_000n) throw new Error("unbounded model integer"); return n; };
  const number = (v: Value): bigint => { if (typeof v !== "bigint") throw new Error("model expected integer"); return v; };
  const read = (name: string): Value => {
    if (values.has(name)) return values.get(name)!;
    const e = declarations.get(name);
    if (e === undefined) throw new Error(`model missing ${name}`);
    const v = evaluate(e, new Map(), name); values.set(name, v); return v;
  };
  const evaluate = (e: Expr, frame: Map<string, Value>, owner: string, selections = branches): Value => {
    if (typeof e === "number") return bounded(BigInt(e));
    if (typeof e === "boolean") return e;
    if ("ref" in e) return frame.has(e.ref) ? frame.get(e.ref)! : read(e.ref);
    if ("choice" in e) return e.choice;
    if ("op" in e) {
      const a = number(evaluate(e.left, frame, owner, selections)), b = number(evaluate(e.right, frame, owner, selections));
      if (e.op === "==") return a === b;
      if (e.op === ">") return a > b;
      if (e.op === "/") { if (b === 0n) throw new ModelRuntimeError(owner); if (a % b) throw new Error("model inexact division"); }
      return bounded(e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : a / b);
    }
    switch (e.kind) {
      case "if": {
        const selected = evaluate(e.condition, frame, owner, selections);
        if (typeof selected !== "boolean") throw new Error("model nonboolean if");
        selections.push(selected ? "then" : "else"); return evaluate(selected ? e.yes : e.no, frame, owner, selections);
      }
      case "match": {
        const selected = evaluate(e.selector, frame, owner, selections);
        if (selected !== "left" && selected !== "right") throw new Error("model invalid exact choice");
        selections.push(selected); return evaluate(e[selected], frame, owner, selections);
      }
      case "array": return e.members.map(m => {
        const v = evaluate(m, frame, owner, selections);
        if (typeof v !== "bigint" && typeof v !== "string") throw new Error("model invalid member"); return v;
      });
      case "map": {
        const source = read(e.source);
        if (!Array.isArray(source)) throw new Error("model noncollection map");
        return source.map(v => number(evaluate(e.body, new Map([...frame, [e.binder, v]]), owner, selections)));
      }
      case "length": { const v = read(e.source); if (!Array.isArray(v)) throw new Error("model noncollection length"); return BigInt(v.length); }
      case "index": { const v = read(e.source); if (!Array.isArray(v) || e.index >= v.length) throw new Error("model missing index"); return v[e.index]; }
    }
  };
  for (const d of p.roots) read(d.name);
  if (p.loop) {
    const l = p.loop;
    let state = new Map(l.carries.map(c => [c.name, evaluate(c.initial, new Map(), c.name)]));
    const source = "collection" in l.source ? read(l.source.collection) : Array.from({ length: (l.source.max - l.source.min) / l.source.step + 1 }, (_, i) => BigInt((l.source as { min: number; step: number }).min + i * (l.source as { step: number }).step));
    if (!Array.isArray(source)) throw new Error("model noncollection loop");
    for (const binder of source) {
      const frame = new Map([...state, [l.binder, binder]]), body = new Map<string, Value>(), selections: string[] = [];
      for (const d of l.body) { const v = evaluate(d.expression, frame, d.name, []); body.set(d.name, v); frame.set(d.name, v); }
      const next = new Map(l.carries.map(c => [c.name, evaluate(c.next, frame, c.name, selections)]));
      trace.push({ binder, incoming: state, next, body, branches: selections }); state = next;
    }
    for (const [name, v] of state) values.set(name, v);
  }
  for (const d of p.outputs) read(d.name);
  return { values, trace, branches };
}

export const jsonValue = (value: Value): number | boolean | string | (number | string)[] => typeof value === "bigint" ? Number(value)
  : Array.isArray(value) ? value.map(v => typeof v === "bigint" ? Number(v) : v) : value;
