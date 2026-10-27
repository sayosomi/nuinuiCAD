// Finite Issue #1412 model. Generation does not invoke the compiler/evaluators.
import { cells as historical } from "../issue1410/cases";
export type Shape = "line" | "arc" | "cubic";
export type End = "start" | "end";
export type Cell = {
  id: string; suite: string; factors: Record<string, string | number>;
  source: string; expected: number | "diagnostic";
  checks: Record<string, number>; historical?: string;
  nearest: string[]; missing: string; oracle: string;
  identity: { owners: string[]; stages: string[]; collection?: boolean; nested?: number };
  contrastSource?: string;
};
const shapes: Shape[] = ["line", "arc", "cubic"];
const ends: End[] = ["start", "end"];
const frames = ["separate", "same"];
const rad = (v: number) => v * Math.PI / 180;
export const angle = (a: number, b = 7) => Math.acos(Math.min(1, Math.abs(Math.cos(rad(a)) * Math.cos(rad(b)) + Math.sin(rad(a)) * Math.sin(rad(b))))) * 180 / Math.PI;
const tangent = (g: Shape, e: End) => g === "line" ? 23 : g === "arc" ? e === "start" ? 17 : 128 : e === "start" ? 34 : 137;
const shape = (g: Shape, name: string, turn = "0", x = "0") => g === "line"
  ? `line ${name} = polar(start: (${x}, 7), angle: 23 + ${turn}, length: 33)`
  : g === "arc" ? `arc ${name} = arc(center: (${x}, 7), radius: 26, start: 287 + ${turn}, end: 38 + ${turn}, direction: counterclockwise)`
    : `curve ${name} = bezier(start: (${x}, 7), end: (${x} + 75, 43), startAngle: 34 + ${turn}, startLength: 23, endAngle: 137 + ${turn}, endLength: 27)`;
const indent = (s: string) => s.split("\n").map(l => `  ${l}`).join("\n");
const text = (...s: string[]) => ["nui 1", ...s.filter(Boolean), ""].join("\n");
const axis = "line Axis = polar(start: (430, -70), angle: 7, length: 33)";
const seed = "line Seed = polar(start: (-80, -40), angle: 7, length: 33)";
const turn = (name: string, stage: string, a: string) => `move ${name} as ${stage} (from: (0, 0), to: (17, -9), angleDeg: ${a})`;
const stages = (name: string) => [turn(name, "selected", "13"), turn(name, "later", "31")].join("\n");
const measure = (ref: string, e: End, name = "result", other = "@Axis.start") => `const ${name}: number = lineAngle(${ref}.${e}, ${other})`;
const pack = "module Pack(source: path, other: path) {\n  export const paths: path[] = [@other, @source, @other]\n}";
const forward = (carry: boolean) => carry ? `module Forward(source: path, other: path) {
  for tick in range(min: 0, max: 0, step: 1) carry forwarded: path = @other carry saved: path = @source {
    next forwarded = @saved
    next saved = @forwarded
  }
  export const out: path = @forwarded
}` : "module Forward(source: path, other: path) {\n  export const out: path = @source\n}";
const oracle = "docs/nui1/spec.md:669-701,1123-1150,1438-1500,1615-1775; independent analytic endpoint axes: line=23, CCW arc=(17,128), cubic derivative=(34,137); move adds 13 then 31 degrees; reverse swaps endpoint derivatives; axis angle=acos(abs(dot(unit tangents))). Immutable next snapshots commit simultaneously.";
export const cells: Cell[] = [];
const add = (suite: string, factors: Cell["factors"], source: string, expected: Cell["expected"], nearest: string[], missing: string, identity: Cell["identity"], extra: Partial<Cell> = {}) => {
  cells.push({ id: `${suite}${String(cells.filter(c => c.suite === suite).length + 1).padStart(3, "0")}`, suite, factors, source, expected, checks: {}, nearest, missing, identity, oracle, ...extra });
};

// D: both runtime index values select different members, not a fixed pick=1.
for (const g of shapes) for (const e of ends) for (const origin of ["carry", "module-number", "iteration-expression"])
  for (const carrier of ["root", "module"]) for (const stage of ["base", "selected"]) {
    const geometry = [shape(g, "First"), stages("First"), shape(g, "Second", "29", "140"), stages("Second")].join("\n");
    const paths = carrier === "root" ? "@paths" : "@Packed::paths";
    const declarations = carrier === "root" ? "const paths: path[] = [@First." + stage + ", @Second." + stage + "]" :
      `module Paths(first: path, second: path) {\n  export const paths: path[] = [@first, @second]\n}\ninstance Packed = Paths(first: @First.${stage}, second: @Second.${stage})`;
    let body: string, ref: string, checks: Record<string, number>;
    const a = tangent(g, e) + (stage === "base" ? 0 : 13);
    if (origin === "module-number") {
      body = `module Select(paths: path[], pick: number) {\n  export const out: path = @paths[@pick]\n}\ninstance One = Select(paths: ${paths}, pick: 0)\ninstance Two = Select(paths: ${paths}, pick: 1)`;
      ref = "@Two::out";
      checks = { first: angle(a) };
      body += "\n" + measure("@One::out", e, "first");
    } else {
      const selector = origin === "carry" ? "@pick" : "1 - @i";
      body = `for i in range(min: 0, max: 1, step: 1) carry pick: number = 0 carry edge: path = @Seed carry previous: path = @Seed {\n  next edge = ${paths}[${selector}]\n  next previous = @edge\n  next pick = @pick + 1\n}`;
      ref = "@edge";
      body += "\n" + measure("@previous", e, "first");
      checks = { first: angle(a + (origin === "carry" ? 0 : 29)), pick: 2 };
    }
    add("D", { shape: g, endpoint: e, origin, carrier, stage }, text(axis, seed, geometry, declarations, body, measure(ref, e)),
      angle(a + (origin === "iteration-expression" ? 0 : 29)),
      ["1410:C (fixed typed/nested pick=1)", "rootScalarCarryCollectionIndexRust:asymmetric Module instances keep iteration-selected scalar and collection carry snapshots"],
      "Historical controls do not change a geometry-collection lineAngle selector across iterations/instances.",
      { owners: ["First", "Second"], stages: [stage], collection: true }, { checks });
  }

// P: neither selected operand is the fixed historical Axis control.
for (const ga of shapes) for (const gb of shapes) for (const ea of ends) for (const eb of ends)
  for (const ar of ["generated-carry", "module-collection"]) for (const br of ["generated", "module-carry"]) {
    const a = `for i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed {\n${indent(shape(ga, "A", "@i * 11", "@i * 120") + "\n" + stages("A"))}\n  next edge = @A[@i].selected\n}`;
    const bBody = shape(gb, "B", "61 + @j * 17", "600 + @j * 120") + "\n" + turn("B", "chosen", "19");
    const b = br === "generated" ? `for j in range(min: 0, max: 2, step: 1) {\n${indent(bBody)}\n}` :
      `module Other() {\n${indent(seed)}\n  for j in range(min: 0, max: 2, step: 1) carry independent: path = @Seed {\n${indent(indent(bBody))}\n    next independent = @B[@j].chosen\n  }\n  export const out: path = @independent\n}\ninstance Chosen = Other()`;
    const aRef = ar === "generated-carry" ? "@edge" : "@Packed::paths[1]";
    const bRef = br === "generated" ? "@B[1].chosen" : "@Chosen::out";
    const expected = angle(tangent(ga, ea) + 24, tangent(gb, eb) + 61 + (br === "generated" ? 17 : 34) + 19);
    add("P", { aShape: ga, bShape: gb, aEndpoint: ea, bEndpoint: eb, aRoute: ar, bRoute: br },
      text(axis, seed, a, b, ar === "module-collection" ? pack + "\ninstance Packed = Pack(source: @edge, other: @Seed)" : "",
        measure(aRef, ea, "result", `${bRef}.${eb}`), measure(bRef, eb, "swapped", `${aRef}.${ea}`)), expected,
      [`1406:G-${ga === "cubic" ? "bezier" : ga}-${gb === "cubic" ? "bezier" : gb}-${ea}-${eb}`, "1410:B (one transported operand)", "1408:B01-B08"],
      "Direct shape pairs and one transported operand do not prove two independent generated/Module/carry owners.",
      { owners: ["A", "B"], stages: ["selected", "chosen"], collection: ar === "module-collection" }, { checks: { swapped: expected } });
  }

// R: retain exact #1410 selected-stage alias/parameter interactions as historical.
for (const g of shapes) for (const stage of ["base", "selected", "final"]) for (const route of ["alias", "module", "module-carry"])
  for (const e of ends) for (const frame of frames) {
    const h = stage === "selected" && route !== "module-carry" ? historical.find(c => c.suite === "B" && c.factors.geometry === g && c.factors.occurrence === 1 && c.factors.endpoint === e && c.factors.scheduling === frame && c.factors.route === route) : undefined;
    const generated = shape(g, "Generated", "@i * 11", "@i * 120") + "\n" + stages("Generated");
    const separate = generated.replaceAll("@i", "@g");
    const selected = `@Generated[@i].${stage}`;
    const routed = route === "alias" ? `const Alias: path = ${selected}` : `instance Routed = Forward(source: ${selected}, other: @previous)`;
    const body = `for i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed carry previous: path = @Seed {\n${indent([frame === "same" ? generated : "", routed, `next edge = ${route === "alias" ? "@Alias" : "@Routed::out"}`, "next previous = @edge"].filter(Boolean).join("\n"))}\n}`;
    add("R", { shape: g, stage, route, endpoint: e, frame }, h?.source ?? text(axis, seed, route === "alias" ? "" : forward(route === "module-carry"),
      frame === "separate" ? `for g in range(min: 0, max: 1, step: 1) {\n${indent(separate)}\n}` : "", body, measure("@edge", e)),
      h?.expected ?? angle(tangent(g, e) + 11 + (stage === "base" ? 0 : stage === "selected" ? 13 : 44)),
      h ? [`1410:${h.id}`] : ["1410:A (stage/carry)", "1410:B (selected route)", "1410:D (Module carry alias)"],
      h ? "Exact semantic interaction retained byte-for-byte; do not count as new exploration." : "Cross stage and forwarding route in an updating frame; Module carry now changes its initializer value.",
      { owners: ["Generated"], stages: [stage] }, { historical: h?.id });
  }

// Analytic t=.37 far split. B'(t), not the chord, supplies its start axis.
const t = .37, u = 1 - t;
const p = [[0, 7], [23 * Math.cos(rad(34)), 7 + 23 * Math.sin(rad(34))], [75 - 27 * Math.cos(rad(137)), 43 - 27 * Math.sin(rad(137))], [75, 43]];
const cut = [0, 1].map(k => u ** 3 * p[0][k] + 3 * u ** 2 * t * p[1][k] + 3 * u * t ** 2 * p[2][k] + t ** 3 * p[3][k]);
const derivative = [0, 1].map(k => u ** 2 * (p[1][k] - p[0][k]) + 2 * u * t * (p[2][k] - p[1][k]) + t ** 2 * (p[3][k] - p[2][k]));
const splitAxis = Math.atan2(derivative[1], derivative[0]) * 180 / Math.PI;
for (const g of shapes) for (const op of ["offset", "split"]) for (const stage of ["base", "selected", "final"])
  for (const route of ["carry", "module-collection"]) for (const e of ends) for (const frame of frames) {
    const b = frame === "same" ? "i" : "g";
    const point = g === "line" ? [33 * t * Math.cos(rad(23)), 7 + 33 * t * Math.sin(rad(23))] :
      g === "arc" ? [26 * Math.cos(rad(287 + 111 * t)), 7 + 26 * Math.sin(rad(287 + 111 * t))] : cut;
    const construction = op === "offset" ? `line Generated = offset(sources: [@Source[@${b}].base], distance: 1.5, side: right, closed: false, suppressTrimWarnings: false)` :
      `point Cut = coordinate(x: @${b} * 120 + ${point[0]}, y: ${point[1]})\nline Generated = split(source: @Source[@${b}].base, at: @Cut[@${b}])`;
    const generated = [shape(g, "Source", "0", `@${b} * 120`), construction, turn("Generated", "selected", `13 + @${b} * 11`), "reverse Generated as flipped ()"].join("\n");
    const loop = `for i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed carry previous: path = @Seed {\n${indent([frame === "same" ? generated : "", `next edge = @Generated[@i].${stage}`, "next previous = @edge"].filter(Boolean).join("\n"))}\n}`;
    const actualEnd = stage === "final" ? e === "start" ? "end" : "start" : e;
    let a = tangent(g, actualEnd);
    if (op === "split" && actualEnd === "start") a = g === "line" ? 23 : g === "arc" ? 17 + 111 * t : splitAxis;
    add("T", { shape: g, operation: op, stage, route, endpoint: e, frame },
      text(axis, seed, frame === "separate" ? `for g in range(min: 0, max: 1, step: 1) {\n${indent(generated)}\n}` : "", loop,
        route === "module-collection" ? pack + "\ninstance Packed = Pack(source: @edge, other: @previous)" : "",
        measure(route === "carry" ? "@edge" : "@Packed::paths[1]", e)), angle(a + (stage === "base" ? 0 : 24)),
      ["1410:L-C001..L-C324 (offset/split followed by moves, no final reverse)", "1408:K05,K06,K08"],
      "Compound construction->named move->reverse selected stage crossed with carried/Module collection snapshot and updating frame.",
      { owners: ["Source", "Generated"], stages: [stage], collection: route === "module-collection" },
      { oracle: `${oracle} split far segment [.37,1]; cubic B'(.37) axis=${splitAxis}.` });
  }

for (const g of shapes) for (const depth of [2, 3]) for (const n of [2, 3]) for (const selection of ["first", "interior", "last"])
  for (const route of ["carry", "module-collection"]) for (const e of ends) {
    const count = n ** depth, selected = selection === "first" ? 0 : selection === "last" ? count - 1 : Math.floor(count / 2);
    const index = Array.from({ length: depth }, (_, k) => `@i${k} * ${n ** (depth - k - 1)}`).join(" + ");
    let body = `const flat: number = ${index}\n` + shape(g, "Generated", "@flat * 11", "@flat * 120") + "\n" + stages("Generated") +
      `\nnext edge${depth - 1} = if (@flat == ${selected}) { @Generated[@flat].selected } else { @edge${depth - 1} }\nnext prior${depth - 1} = @edge${depth - 1}`;
    for (let k = depth - 1; k >= 0; k--) {
      if (k < depth - 1) body += `\nnext edge${k} = @edge${k + 1}\nnext prior${k} = @edge${k}`;
      body = `for i${k} in range(min: 0, max: ${n - 1}, step: 1) carry edge${k}: path = ${k === 0 ? "@Seed" : `@edge${k - 1}`} carry prior${k}: path = @Seed {\n${indent(body)}\n}`;
    }
    add("N", { shape: g, depth, cardinality: n, selection, route, endpoint: e },
      text(axis, seed, body, route === "module-collection" ? pack + "\ninstance Packed = Pack(source: @edge0, other: @prior0)" : "", measure(route === "carry" ? "@edge0" : "@Packed::paths[1]", e)),
      angle(tangent(g, e) + selected * 11 + 13), ["1408:preserves flattened nested occurrence 0/3 through the same Module", "statementForDrawableOccurrenceRust:preserves nested mapped geometry snapshots for each outer carry iteration", "rootNestedCollectionCarryRust:matches the TypeScript reference for nested direct and named collection carries"],
      "Existing 2-level first/last flattening is a control; conditional source-dependent selected snapshot propagates through multiple interdependent inner/outer carries.",
      { owners: ["Generated"], stages: ["selected"], collection: route === "module-collection", nested: depth });
  }

for (const boundary of ["index", "stage", "disabled", "zero", "nonfinite"]) for (const route of ["alias", "module-carry", "module-collection"])
  for (const e of ends) for (const frame of frames) {
    const make = (invalid: boolean) => {
      const b = frame === "same" ? "i" : "g";
      let generated = shape("line", "Generated", `@${b} * 11`, `@${b} * 120`);
      if (invalid && boundary === "disabled") generated = generated.replace("length: 33)", "length: 33, enabled: false)");
      if (invalid && boundary === "zero") generated = generated.replace("length: 33", "length: 0");
      if (invalid && boundary === "nonfinite") generated = generated.replace(`23 + @${b} * 11`, "1 / 0");
      generated += "\n" + stages("Generated");
      const selected = `@Generated[${invalid && boundary === "index" ? "@bad" : "@i"}].${invalid && boundary === "stage" ? "nonexistent" : "selected"}`;
      const loop = `for i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed carry bad: number = 9 {\n${indent([frame === "same" ? generated : "", `next edge = ${selected}`, "next bad = @bad"].filter(Boolean).join("\n"))}\n}`;
      const forwarding = route === "alias" ? "const Alias: path = @edge" : route === "module-carry" ? forward(true) + "\ninstance Routed = Forward(source: @edge, other: @Seed)" : pack + "\ninstance Packed = Pack(source: @edge, other: @Seed)";
      return text(axis, seed, frame === "separate" ? `for g in range(min: 0, max: 1, step: 1) {\n${indent(generated)}\n}` : "", loop, forwarding,
        measure(route === "alias" ? "@Alias" : route === "module-carry" ? "@Routed::out" : "@Packed::paths[1]", e));
    };
    add("E", { boundary, route, endpoint: e, frame }, make(true), "diagnostic", ["1410:E (root/Module index/stage/disabled/zero)", "1408:rejects invalid occurrence without selecting the last row"],
      "Deep forwarding route with runtime-bound index and nonfinite tangent; preserve compile/runtime diagnostic boundary.",
      { owners: ["Generated"], stages: [boundary === "stage" ? "nonexistent" : "selected"], collection: route === "module-collection" }, { contrastSource: make(false) });
  }

for (const g of shapes) for (const depth of [2, 3]) for (const siblings of [2, 3]) for (const route of ["carry", "collection"])
  for (const e of ends) {
    const definitions = [`module Level0(turn: number, x: number) {\n${indent(seed)}\n  for i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed {\n${indent(indent(shape(g, "Generated", "@turn + @i * 11", "@x + @i * 120") + "\n" + stages("Generated")))}\n    next edge = @Generated[@i].selected\n  }\n  export const out: path = @edge\n}`];
    for (let d = 1; d < depth; d++) definitions.push(`module Level${d}(turn: number, x: number) {\n${indent(seed)}\n  instance Child = Level${d - 1}(turn: @turn + 11, x: @x + 130)\n` +
      (route === "carry" ? "  for k in range(min: 0, max: 0, step: 1) carry forwarded: path = @Seed {\n    next forwarded = @Child::out\n  }\n  export const out: path = @forwarded" : "  const paths: path[] = [@Seed, @Child::out]\n  export const out: path = @paths[1]") + "\n}");
    const instances = Array.from({ length: siblings }, (_, i) => `instance Sibling${i} = Level${depth - 1}(turn: ${i * 17}, x: ${i * 370})`);
    const checks = Object.fromEntries(Array.from({ length: siblings - 1 }, (_, i) => [`sibling${i}`, angle(tangent(g, e) + i * 17 + (depth - 1) * 11 + 24)]));
    add("M", { shape: g, depth, siblings, forwarding: route, endpoint: e }, text(axis, seed, ...definitions, ...instances,
      ...Array.from({ length: siblings - 1 }, (_, i) => measure(`@Sibling${i}::out`, e, `sibling${i}`)), measure(`@Sibling${siblings - 1}::out`, e)),
      angle(tangent(g, e) + (siblings - 1) * 17 + (depth - 1) * 11 + 24), ["1410:F (single Module layer)", "moduleNestedScalarExportForwardingRust:keeps per-instance geometry-derived exports available through nested forwarding and reordering", "moduleGeometryCollectionCarryRust:keeps indexed collection targets and snapshots isolated across asymmetric Module instances"],
      "Nested geometry carry/selected collection endpoint identity with all asymmetric sibling instances measured.",
      { owners: ["Generated"], stages: ["selected"], collection: route === "collection", nested: depth }, { checks });
  }

for (const g of shapes) for (const form of ["if", "match"]) for (const stage of ["base", "selected"])
  for (const route of ["root", "module"]) for (const e of ends) {
    const good = `if (@i == 0) { @previous } else { @Generated[@i].${stage} }`;
    const branch = form === "if" ? `if (true) { @Valid } else { @Dormant }` : `match @side { left => @Dormant right => @Valid }`;
    const body = `line Dormant = polar(start: (900, 0), angle: 71, length: 20, enabled: false)\nconst side: choice(left, right) = right\nfor i in range(min: 0, max: 1, step: 1) carry edge: path = @Seed carry previous: path = @Seed {\n${indent(shape(g, "Generated", "@i * 11", "@i * 120") + "\n" + stages("Generated"))}\n  const Valid: path = ${good}\n  next edge = ${branch}\n  next previous = @edge\n}`;
    const source = text(axis, seed, route === "root" ? body : `module Provider() {\n${indent(seed)}\n${indent(body)}\n  export const out: path = @edge\n}\ninstance Chosen = Provider()`, measure(route === "root" ? "@edge" : "@Chosen::out", e));
    add("B", { shape: g, branch: form, stage, forwarding: route, endpoint: e }, source, angle(tangent(g, e) + 11 + (stage === "base" ? 0 : 13)),
      ["geometryCarryIfMatchNextRust:evaluates only the selected exhaustive match branch and preserves stage and endpoint projections", "geometryCarryIfMatchNextRust:commits independent geometry carries from one incoming snapshot in either next order", "geometryCarryNextEndpointProjectionRust:projects from the selected transformation-stage carry snapshot", "rootGeometryCollectionCarryValueForRust:captures conditional carry collections with mapped branches from one snapshot"],
      "Known conditional geometry/projection mechanisms do not independently prove lineAngle tangent composition through selected generated stages and Module carry.",
      { owners: ["Generated", "Dormant"], stages: [stage] });
  }
if (cells.length !== 768 || new Set(cells.map(c => c.id)).size !== 768) throw new Error("Issue #1412 stable model drift");
