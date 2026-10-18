// Closed Issue #1410 matrix. Oracles use analytic geometry, independently of
// either evaluator. Keep IDs and all Cartesian factors stable when reducing bugs.
export type Geometry = "line" | "arc" | "cubic";
export type Endpoint = "start" | "end";
export type Frame = "separate" | "same";
export type Cell = {
  id: string;
  suite: string;
  factors: Record<string, string | number>;
  source: string;
  expected: number | "diagnostic";
  previousExpected?: number;
  contrast?: string;
  contractInvalid?: string;
  legalExpected?: number;
  identity: Record<string, string | number>;
  oracle: string;
};
const geometries: Geometry[] = ["line", "arc", "cubic"];
const endpoints: Endpoint[] = ["start", "end"];
const frames: Frame[] = ["separate", "same"];
const rad = (a: number) => a * Math.PI / 180;
export const axisAngle = (a: number) => Math.acos(Math.min(1, Math.abs(Math.cos(rad(a - 7))))) * 180 / Math.PI;
const axis = "line Axis = polar(start: (430, -70), angle: 7, length: 33)";
const seed = "line Seed = polar(start: (-80, -40), angle: 7, length: 33)";
const text = (...lines: string[]) => ["nui 1", ...lines, ""].join("\n");
const indent = (s: string) => s.split("\n").map(l => `  ${l}`).join("\n");
const rotate = (name: string, stage: string, angle: string) =>
  `move ${name} as ${stage} (from: (0, 0), to: (0, 0), angleDeg: ${angle})`;
const tangent = (g: Geometry, e: Endpoint) => g === "line" ? 23 : g === "arc" ? (e === "start" ? 17 : 128) : (e === "start" ? 34 : 137);
const shape = (g: Geometry, binder: string, turn: string, x: string, name = "Generated") => {
  const px = `${x} + @${binder} * 120`;
  const a = `${turn} + @${binder} * 11`;
  return g === "line" ? `line ${name} = polar(start: (${px}, 7), angle: 23 + ${a}, length: 33)` :
    g === "arc" ? `arc ${name} = arc(center: (${px}, 7), radius: 26, start: 287 + ${a}, end: 38 + ${a}, direction: counterclockwise)` :
      `curve ${name} = bezier(start: (${px}, 7), end: (${px} + 75, 43), startAngle: 34 + ${a}, startLength: 23, endAngle: 137 + ${a}, endLength: 27)`;
};

// All next RHSs observe the same incoming snapshot. previous therefore retains
// Seed for one iteration, and occurrence zero for two iterations.
const frame = (g: Geometry, f: Frame, occurrence: number, stage: string,
  route = "direct", turn = "0", x = "0", custom?: (binder: string) => string) => {
  const binder = f === "same" ? "i" : "g";
  const generation = custom?.(binder) ?? [shape(g, binder, turn, x),
    rotate("Generated", "selected", "13"), rotate("Generated", "later", "31")].join("\n");
  const selected = `@Generated[@i].${stage}`;
  const routeBody = route === "alias" ? `const Alias: path = ${selected}` :
    route.startsWith("module") ? `instance Routed = Forward(source: ${selected})` : "";
  const target = route === "alias" ? "@Alias" : route.startsWith("module") ? "@Routed::out" : selected;
  const loop = `for i in range(min: 0, max: ${occurrence}, step: 1) carry edge: path = @Seed carry previous: path = @Seed {\n` +
    [f === "same" ? generation : "", routeBody, `next edge = ${target}`, "next previous = @edge"].filter(Boolean).map(indent).join("\n") + "\n}";
  return [seed, f === "separate" ? `for g in range(min: 0, max: 1, step: 1) {\n${indent(generation)}\n}` : "", loop].filter(Boolean).join("\n");
};
const forward = (carry: boolean) => carry ? `module Forward(source: path) {
  for tick in range(min: 0, max: 1, step: 1) carry forwarded: path = @source carry saved: path = @source {
    next forwarded = @source
    next saved = @forwarded
  }
  export const out: path = @forwarded
}` : "module Forward(source: path) {\n  export const out: path = @source\n}";
const measure = (ref: string, e: Endpoint) => `const result: number = lineAngle(${ref}.${e}, @Axis.start)`;
const oracle = "spec.md:669-685,1123-1150,1468-1498,1649-1654; line axis=23; CCW arc radius+90 (17,128); cubic B'(0)=3(P1-P0), B'(1)=3(P3-P2) axes=(34,137); rotations add in authored order; acos(abs(dot(unit axes))) vs 7 degrees; next values commit simultaneously";
export const cells: Cell[] = [];
const add = (suite: string, factors: Cell["factors"], source: string, expected: Cell["expected"],
  identity: Cell["identity"], extra: Partial<Cell> = {}) => {
  const ordinal = 1 + cells.filter(c => c.suite === suite).length;
  cells.push({ id: `${suite}${String(ordinal).padStart(3, "0")}`, suite, factors, source, expected, identity, oracle, ...extra });
};
const snapshotExpected = (g: Geometry, e: Endpoint, o: number, stage: string, turn = 0) =>
  axisAngle(tangent(g, e) + o * 11 + turn + (stage === "base" ? 0 : stage === "selected" ? 13 : 44));

for (const geometry of geometries) for (const occurrence of [0, 1]) for (const stage of ["base", "selected", "final"])
  for (const endpoint of endpoints) for (const scheduling of frames) {
    add("A", { geometry, occurrence, stage, endpoint, scheduling },
      text(axis, frame(geometry, scheduling, occurrence, stage), measure("@edge", endpoint),
        `const incoming: number = lineAngle(@previous.${endpoint}, @Axis.start)`),
      snapshotExpected(geometry, endpoint, occurrence, stage), { owner: "Generated", carry: "edge", occurrence, stage, endpoint },
      { previousExpected: occurrence === 0 ? 0 : snapshotExpected(geometry, endpoint, 0, stage) });
  }
for (const geometry of geometries) for (const occurrence of [0, 1]) for (const endpoint of endpoints)
  for (const scheduling of frames) for (const route of ["direct", "alias", "module", "module-carry"]) {
    add("B", { geometry, occurrence, endpoint, scheduling, route },
      text(axis, ...(route.startsWith("module") ? [forward(route === "module-carry")] : []),
        frame(geometry, scheduling, occurrence, "selected", route), measure("@edge", endpoint)),
      snapshotExpected(geometry, endpoint, occurrence, "selected"),
      { owner: "Generated", occurrence, stage: "selected", endpoint, carry: "edge", route });
  }

// C uses a fixed asymmetric cubic translated per occurrence before splitting.
// split returns the far segment [t,1], hence its start derivative is B'(t).
const p0 = [0, 7], p1 = [23 * Math.cos(rad(34)), 7 + 23 * Math.sin(rad(34))];
const p3 = [75, 43], p2 = [75 - 27 * Math.cos(rad(137)), 43 - 27 * Math.sin(rad(137))];
const t = 0.37, u = 1 - t;
const cut = [0, 1].map(k => u ** 3 * p0[k] + 3 * u ** 2 * t * p1[k] + 3 * u * t ** 2 * p2[k] + t ** 3 * p3[k]);
const derivative = [0, 1].map(k => u ** 2 * (p1[k] - p0[k]) + 2 * u * t * (p2[k] - p1[k]) + t ** 2 * (p3[k] - p2[k]));
const splitAxis = Math.atan2(derivative[1], derivative[0]) * 180 / Math.PI;
const transformed = (g: Geometry, operation: string, binder: string) => {
  const original = shape(g, binder, "0", "0", operation === "reverse" ? "Generated" : "Source")
    .replaceAll(` + @${binder} * 11`, "");
  const point = g === "line" ? [33 * t * Math.cos(rad(23)), 7 + 33 * t * Math.sin(rad(23))] :
    g === "arc" ? [26 * Math.cos(rad(287 + 111 * t)), 7 + 26 * Math.sin(rad(287 + 111 * t))] : cut;
  const operationLines = operation === "reverse" ? "reverse Generated as reversed ()" : operation === "offset" ?
    "line Generated = offset(sources: [@Source.base], distance: 1.5, side: right, closed: false, suppressTrimWarnings: false)" :
    `point Cut = coordinate(x: @${binder} * 120 + ${point[0]}, y: ${point[1]})\nline Generated = split(source: @Source.base, at: @Cut)`;
  return [original, operationLines, rotate("Generated", "selected", `13 + @${binder} * 11`), rotate("Generated", "later", "31")].join("\n");
};
for (const geometry of geometries) for (const transform of ["reverse", "offset", "split"]) for (const endpoint of endpoints)
  for (const scheduling of frames) for (const carrier of ["root", "module", "alias"]) for (const index of ["literal", "typed", "nested"]) {
    let a = tangent(geometry, endpoint);
    if (transform === "reverse") a = tangent(geometry, endpoint === "start" ? "end" : "start");
    if (transform === "split" && endpoint === "start") a = geometry === "line" ? 23 : geometry === "arc" ? 17 + 111 * t : splitAxis;
    const pack = "module Pack(source: path, other: path) {\n  export const Paths: path[] = [@other, @source, @other]\n}\ninstance Packed = Pack(source: @edge, other: @previous)";
    const ref = carrier === "module" ? "@Packed::Paths" : carrier === "alias" ? "@AliasPaths" : "@Paths";
    const selector = index === "literal" ? "1" : index === "typed" ? "@pick" : "@indices[@pick]";
    add("C", { geometry, transform, endpoint, scheduling, carrier, index },
      text(axis, frame(geometry, scheduling, 1, "selected", "direct", "0", "0", b => transformed(geometry, transform, b)),
        "const Paths: path[] = [@Seed, @edge, @previous]", "const AliasPaths: path[] = @Paths",
        ...(carrier === "module" ? [pack] : []), "const pick: number = 1", "const indices: number[] = [0, 1]",
        measure(`${ref}[${selector}]`, endpoint)), axisAngle(a + 24),
      { owner: "Generated", occurrence: 1, stage: "selected", endpoint, carry: "edge", collectionIndex: 1, carrier, transform },
      { oracle: `${oracle}; C: reverse swaps endpoints; offset tangent from the selected evaluated path; split far segment t=.37, derivative axis=${splitAxis}; occurrence-one rotation=24 degrees` });
  }
for (const geometry of geometries) for (const occurrence of [0, 1]) for (const endpoint of endpoints)
  for (const scheduling of frames) for (const variant of ["baseline", "translation", "reorder", "rename"]) {
    const declarations = [axis, forward(true), frame(geometry, scheduling, occurrence, "selected"),
      "const Alias: path = @edge", "instance Chosen = Forward(source: @Alias)"];
    let source = text(...(variant === "reorder" ? ["const unrelated: number = 123", ...declarations.reverse()] : [...declarations, "const unrelated: number = 123"]), measure("@Chosen::out", endpoint));
    if (variant === "translation") source = source.replaceAll("+ @i * 120", "+ 67 + @i * 120").replaceAll("+ @g * 120", "+ 67 + @g * 120").replace("(430, -70)", "(497, -29)");
    if (variant === "rename") for (const name of ["Generated", "Alias", "Forward", "Chosen", "edge", "previous"]) source = source.replaceAll(name, `Renamed${name}`);
    add("D", { geometry, occurrence, endpoint, scheduling, variant }, source,
      snapshotExpected(geometry, endpoint, occurrence, "selected"),
      { owner: variant === "rename" ? "RenamedGenerated" : "Generated", occurrence, stage: "selected", endpoint, variant });
  }
for (const boundary of ["index", "stage", "disabled", "tangent"]) for (const endpoint of endpoints)
  for (const scheduling of frames) for (const context of ["root", "module"]) {
    let body = frame("line", scheduling, 1, "selected");
    if (boundary === "index") body = body.replace("next edge = @Generated[@i]", "next edge = @Generated[9]");
    if (boundary === "stage") body = body.replace("next edge = @Generated[@i].selected", "next edge = @Generated[@i].nonexistent");
    if (boundary === "disabled") body = body.replace("angle: 23 + 0 +", "enabled: false, angle: 23 + 0 +");
    if (boundary === "tangent") body = body.replace("angle: 23 + 0 + @i * 11, length: 33", "angle: 23 + 0 + @i * 11, length: 0")
      .replace("angle: 23 + 0 + @g * 11, length: 33", "angle: 23 + 0 + @g * 11, length: 0");
    const wrap = (s: string) => context === "root" ? s : `module Provider() {\n${indent(s)}\n  export const out: path = @edge\n}\ninstance Chosen = Provider()`;
    add("E", { boundary, endpoint, scheduling, context }, text(axis, wrap(body), measure(context === "root" ? "@edge" : "@Chosen::out", endpoint)), "diagnostic",
      { boundary, owner: "Generated", occurrence: boundary === "index" ? 9 : 1, endpoint, context },
      { contrast: text(axis, wrap(frame("line", scheduling, 1, "selected")), measure(context === "root" ? "@edge" : "@Chosen::out", endpoint)) });
  }
for (const geometry of geometries) for (const scheduling of frames) for (const occurrence of [0, 1])
  for (const endpoint of endpoints) for (const instance of ["One", "Two"]) {
    add("F", { geometry, scheduling, occurrence, endpoint, instance },
      text(axis, `module Provider(turn: number, x: number) {\n${indent(frame(geometry, scheduling, occurrence, "selected", "direct", "@turn", "@x"))}\n  export const out: path = @edge\n  export const prior: path = @previous\n}`,
        "instance One = Provider(turn: 0, x: 0)", "instance Two = Provider(turn: 21, x: 170)", measure(`@${instance}::out`, endpoint),
        `const incoming: number = lineAngle(@${instance}::prior.${endpoint}, @Axis.start)`),
      snapshotExpected(geometry, endpoint, occurrence, "selected", instance === "Two" ? 21 : 0),
      { owner: "Generated", occurrence, stage: "selected", endpoint, instance, carry: "edge" },
      { previousExpected: occurrence === 0 ? 0 : snapshotExpected(geometry, endpoint, 0, "selected", instance === "Two" ? 21 : 0) });
  }
if (cells.length !== 668 || new Set(cells.map(c => c.id)).size !== 668) throw new Error("Issue #1410 matrix identity/count drift");

// Retain the originally declared C sources. A bare generated Source is
// ambiguous after occurrence one (spec.md statement-for, lines 1123-1127).
// Legal indexed counterparts cover the same Cartesian factors independently.
export const legalVariants: Cell[] = [];
for (const cell of cells.filter(cell => cell.suite === "C" && cell.factors.transform !== "reverse")) {
  const expected = cell.expected as number;
  const binder = cell.factors.scheduling === "same" ? "i" : "g";
  legalVariants.push({ ...cell, id: `L-${cell.id}`, suite: "adjacent",
    source: cell.source.replaceAll("@Source.base", `@Source[@${binder}].base`).replaceAll("at: @Cut)", `at: @Cut[@${binder}])`),
    identity: { ...cell.identity, mapsTo: cell.id },
    oracle: `${cell.oracle}; explicit current occurrence Source[@${binder}].base` });
  cell.contractInvalid = "spec.md statement-for: bare @Name is valid only when exactly one occurrence is available; Source.base has two available occurrences in iteration one. Preserve collection-index-unavailable diagnostic; no current-row fallback.";
  cell.legalExpected = expected;
  cell.expected = "diagnostic";
}

// These split variants were also executed during legality triage: Source was
// indexed but Cut was still bare. Retain them instead of losing trial inputs.
export const invalidVariants: Cell[] = legalVariants.filter(cell => cell.factors.transform === "split").map(cell => ({
  ...cell, id: cell.id.replace("L-", "U-"), expected: "diagnostic", legalExpected: cell.expected as number,
  source: cell.source.replace(/at: @Cut\[@[ig]\]/g, "at: @Cut"),
  contractInvalid: "spec.md statement-for: Cut has two available generated occurrences in iteration one; bare @Cut must report collection-index-unavailable. The indexed L- counterpart is legal."
}));
