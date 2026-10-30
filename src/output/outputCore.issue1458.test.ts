import { parsePdf, type PdfOp as Op } from "../../test/pdfArtifactInspector";
import { createHash } from "node:crypto";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileFreshCanonicalText, commitLineSplicePatch } from "@nuinuicad/nui-language/document";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { prepareRustEvaluation, evaluatePreparedRust } from "../geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import type { EvaluationPayload } from "../geometry/evaluationPayload";
import { evaluateOutputPlan, type OutputPlan } from "./outputCore";

type Point = [number, number];
type Shape = { type: "line" | "cubic" | "arc" | "contour" | "text" | "mixed"; points: Point[]; segments?: Shape[]; width: number; color: string; dash: string; fill?: string; opacity?: number; segmented?: boolean; closed?: boolean; center?: Point; radius?: number; start?: number; sweep?: number; value?: string; size?: number; angle?: number; mirror?: boolean; widths?: number[] };
type Frozen = { id: string; variant: string; source: string; sha256: string; shapes: Shape[]; bounds: [number, number, number, number]; margin: number; paper: Point; overlap: number; columns: number; rows: number; error?: string; encodeError?: string };

const root = "test/fixtures/issue-1458/";
const cases: Frozen[] = JSON.parse(readFileSync(`${root}cases.json`, "utf8"));
const pt = 72 / 25.4;
const tolerance = .00051; // Each encoded numeric field rounds to 0.001 mm (SVG) or pt (PDF).
const near = (a: number, b: number, tol = tolerance) => expect(Math.abs(a - b), `${a} != ${b}`).toBeLessThan(tol);
const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const eqNumbers = (actual: number[], expected: number[], tol = tolerance) => { expect(actual).toHaveLength(expected.length); actual.forEach((n, i) => near(n, expected[i], tol)); };
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
let directory: string;
let rust: RustEvaluationProcess;
let child: ChildProcessWithoutNullStreams;
let closed: Promise<void>;
let resourceError: Error | undefined;
let spawnCount = 0;
const observations: object[] = [];
const compiled = new Map<Frozen, ReturnType<typeof compile>>();
const compile = (c: Frozen) => {
  expect(hash(c.source)).toBe(c.sha256);
  const r = compileFreshCanonicalText(c.source);
  if (r.status === "fatal") throw new Error(`${c.id}/${c.variant} ${JSON.stringify(r.diagnostics)}`);
  expect(r.doc.diagnostics.filter(d => d.severity === "error"), `${c.id}/${c.variant}`).toEqual([]);
  return r.doc;
};
const bounded = async <T,>(f: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([f, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("bounded stdio request exceeded 15s")), 15000); })]); }
  finally { clearTimeout(timer); }
};
beforeAll(() => {
  // All frozen sources/oracles exist before the first product output observation.
  for (const c of cases) compiled.set(c, compile(c));
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000 });
  directory = mkdtempSync(join(tmpdir(), "nuinui-1458-"));
  rust = new RustEvaluationProcess(resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", "evaluation_stdio"), { spawnProcess: (typeofSpawn => ((...args: Parameters<typeof spawn>) => {
    ++spawnCount;
    child = typeofSpawn("/bin/sh", ["-c", 'ulimit -t 60 || exit 1; exec "$@"', "issue1458-rust", args[0]], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    // macOS does not implement a usable RLIMIT_AS. Bound resident memory with
    // a sampled 512 MiB watchdog instead; only this test-owned process is killed.
    const memory = setInterval(() => {
      try {
        const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 }));
        if (rss > 512 * 1024) { resourceError = new Error("Rust artifact harness exceeded 512 MiB RSS"); rust.dispose(); }
      } catch { /* The child may already have exited before its close event. */ }
    }, 100);
    // Install completion/error listeners before any request or teardown.
    closed = new Promise<void>((resolve) => { child.once("close", () => { clearInterval(memory); resolve(); }); child.once("error", () => { clearInterval(memory); resolve(); }); });
    return child;
  }) as typeof spawn)(spawn) });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (process.env.ISSUE1458_EVIDENCE) writeFileSync(process.env.ISSUE1458_EVIDENCE, JSON.stringify(observations, null, 2) + "\n");
  expect(resourceError).toBeUndefined();
  if (rust) expect(spawnCount).toBe(1);
});

const pathTokens = (s: string): (number | string)[] => (s.match(/[MLCAZ]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(t => /^[MLCAZ]$/i.test(t) ? t : Number(t));
const eqTokens = (actual: (number | string)[], expected: (number | string)[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((x, i) => typeof x === "number" && typeof expected[i] === "number" ? near(x, expected[i] as number) : expect(x).toBe(expected[i]));
};
const localSvg = (c: Frozen, p: Point): Point => [p[0] - c.bounds[0] + c.margin, c.bounds[3] + c.margin - p[1]];
const pathFor = (s: Shape, map: (p: Point) => Point): (string | number)[] => {
  if (s.type === "mixed") return [...s.segments!.flatMap((part, i) => pathFor(part, map).slice(i ? 3 : 0)), "Z"];
  if (s.type === "arc") {
    const n = Math.max(1, Math.ceil(Math.abs(s.sweep!) / 180));
    const result: (string | number)[] = [];
    for (let i = 0; i <= n; ++i) {
      const a = (s.start! + s.sweep! * i / n) * Math.PI / 180;
      const p: Point = [s.center![0] + s.radius! * Math.cos(a), s.center![1] + s.radius! * Math.sin(a)];
      if (!i) result.push("M", ...map(p));
      else result.push("A", s.radius!, s.radius!, 0, 0, s.sweep! < 0 ? 1 : 0, ...map(p));
    }
    return result;
  }
  const [start, ...rest] = s.points;
  return ["M", ...map(start), ...(s.type === "cubic" ? ["C", ...rest.flatMap(map)] : rest.flatMap(p => ["L", ...map(p)])), ...(s.closed ? ["Z"] : [])];
};
const svgExpected = (c: Frozen) => c.shapes.flatMap(s => {
  if (s.type === "text") return [{ s, text: true, path: [] as (string | number)[], fill: "", stroke: "" }];
  if (!s.segmented) return [{ s, path: pathFor(s, p => localSvg(c, p)), fill: s.fill ?? "none", stroke: s.color }];
  const result = [];
  if (s.fill) result.push({ s, path: pathFor(s, p => localSvg(c, p)), fill: s.fill, stroke: "none" });
  if (s.type === "mixed") return [...result, ...s.segments!.map(part => ({ s, path: pathFor(part, p => localSvg(c, p)), fill: "none", stroke: s.color }))];
  for (let i = 1; i < s.points.length; ++i) result.push({ s, path: pathFor({ ...s, type: "line", points: [s.points[i - 1], s.points[i]], closed: false }, p => localSvg(c, p)), fill: "none", stroke: s.color });
  return result;
});
const svgTextPoint = (transform: string, p: Point): Point => {
  const parts = [...transform.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)];
  expect(parts).toHaveLength(3);
  let [x, y] = p;
  for (const [, op, args] of parts.reverse()) {
    const ns = nums(args);
    if (op === "scale") { x *= ns[0]; y *= ns[1]; }
    if (op === "rotate") { const a = ns[0] * Math.PI / 180; [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }
    if (op === "translate") { x += ns[0]; y += ns[1]; }
  }
  return [x, y];
};
const checkSvg = (bytes: Buffer, c: Frozen) => {
  const xml = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  const svg = xml.documentElement;
  expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
  const w = c.bounds[2] - c.bounds[0] + 2 * c.margin, h = c.bounds[3] - c.bounds[1] + 2 * c.margin;
  expect(svg.getAttribute("width")).toMatch(/mm$/); expect(svg.getAttribute("height")).toMatch(/mm$/);
  near(parseFloat(svg.getAttribute("width")!), w); near(parseFloat(svg.getAttribute("height")!), h);
  eqNumbers(nums(svg.getAttribute("viewBox")!), [0, 0, w, h]);
  const expected = svgExpected(c);
  expect(svg.children).toHaveLength(expected.length);
  [...svg.children].forEach((node, i) => {
    const { s, path, fill, stroke } = expected[i];
    if (s.type === "text") {
      expect(node.tagName).toBe("text");
      near(Number(node.getAttribute("font-size")), s.size!);
      const transform = node.getAttribute("transform")!;
      const anchor = localSvg(c, s.points[0]);
      eqNumbers(svgTextPoint(transform, [0, 0]), anchor);
      const angle = -s.angle! * Math.PI / 180;
      // Native SVG glyph ascent is negative Y. It must stay above its baseline
      // before drafting rotation; local glyph axes already use SVG's Y-down.
      const ascent = s.size! * .8;
      eqNumbers(svgTextPoint(transform, [0, -ascent]), [anchor[0] + ascent * Math.sin(angle), anchor[1] - ascent * Math.cos(angle)]);
      const rows = s.value!.split("\n");
      expect(node.children).toHaveLength(rows.length);
      let baseline = 0;
      [...node.children].forEach((span, j) => {
        expect(span.tagName).toBe("tspan"); expect(span.textContent).toBe(rows[j]);
        if (span.hasAttribute("y")) baseline = Number(span.getAttribute("y"));
        baseline += Number(span.getAttribute("dy") ?? 0);
        near(Number(span.getAttribute("textLength")), s.widths![j]);
        const dy = j * s.size! * 1.2;
        eqNumbers(svgTextPoint(transform, [0, baseline]), [anchor[0] - dy * Math.sin(angle), anchor[1] + dy * Math.cos(angle)]);
      });
      return;
    }
    expect(node.tagName).toBe("path");
    eqTokens(pathTokens(node.getAttribute("d")!), path);
    expect(node.getAttribute("stroke")).toBe(stroke); expect(node.getAttribute("fill")).toBe(fill);
    if (fill !== "none") near(Number(node.getAttribute("fill-opacity")), s.opacity!);
    if (stroke !== "none") {
      near(Number(node.getAttribute("stroke-width")), s.width);
      expect(node.getAttribute("stroke-linecap")).toBe("round"); expect(node.getAttribute("stroke-linejoin")).toBe("round");
      const dash = node.getAttribute("stroke-dasharray");
      if (s.dash === "solid") expect(dash).toBeNull(); else eqNumbers(nums(dash!), s.dash === "dashed" ? [4, 3] : [1, 2]);
    }
  });
  return { widthMm: parseFloat(svg.getAttribute("width")!), heightMm: parseFloat(svg.getAttribute("height")!), children: [...svg.children].map(n => ({ tag: n.tagName, attributes: Object.fromEntries([...n.attributes].map(a => [a.name, a.value])), text: n.textContent })) };
};

const checkPdf = (bytes: Buffer, c: Frozen) => {
  const parsed = parsePdf(bytes);
  expect(parsed.pages).toHaveLength(c.columns * c.rows);
  const pages = parsed.pages.map((page, index) => {
    eqNumbers(page.box, [0, 0, ...c.paper.map(n => n * pt)]);
    const origin: Point = [c.bounds[0] - c.overlap + index % c.columns * (c.paper[0] - 2 * c.overlap), c.bounds[1] - c.overlap + Math.floor(index / c.columns) * (c.paper[1] - 2 * c.overlap)];
    const map = (p: Point): Point => [(p[0] - origin[0]) * pt, (p[1] - origin[1]) * pt];
    let depth = 0; let inDrawing = true;
    const drawing: Op[] = [], guides: Op[] = [];
    for (const op of page.ops) {
      if (op.op === "q") ++depth;
      (inDrawing ? drawing : guides).push(op);
      if (op.op === "Q" && --depth === 0) inDrawing = false;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    eqNumbers(drawing.find(o => o.op === "re")!.args as number[], [0, 0, ...c.paper.map(n => n * pt)]);
    expect(drawing.slice(2, 4).map(o => o.op)).toEqual(["W", "n"]);
    const actualPath = drawing.filter(o => ["m", "l", "c", "h", "f", "S", "B"].includes(o.op));
    const expectedPath: Op[] = [];
    const segment = (ps: Point[], cubic: boolean) => {
      expectedPath.push({ op: "m", args: map(ps[0]) });
      if (cubic) expectedPath.push({ op: "c", args: ps.slice(1).flatMap(map) });
      else for (const p of ps.slice(1)) expectedPath.push({ op: "l", args: map(p) });
    };
    const strokeShapes: Shape[] = [];
    const emit = (s: Shape, continuation = false) => {
      if (s.type !== "arc") {
        if (!continuation) segment(s.points, s.type === "cubic");
        else if (s.type === "cubic") expectedPath.push({ op: "c", args: s.points.slice(1).flatMap(map) });
        else s.points.slice(1).forEach(p => expectedPath.push({ op: "l", args: map(p) }));
        return;
      }
      // Independent circle tangent construction for each <=90 degree cubic.
      const n = Math.ceil(Math.abs(s.sweep!) / 90);
      for (let i = 0; i < n; ++i) {
        const a = (s.start! + s.sweep! * i / n) * Math.PI / 180;
        const b = (s.start! + s.sweep! * (i + 1) / n) * Math.PI / 180;
        const k = 4 * Math.tan((b - a) / 4) / 3, r = s.radius!, [cx, cy] = s.center!;
        const p: Point = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        const q: Point = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
        if (!i && !continuation) expectedPath.push({ op: "m", args: map(p) });
        expectedPath.push({ op: "c", args: [[p[0] - k * r * Math.sin(a), p[1] + k * r * Math.cos(a)], [q[0] + k * r * Math.sin(b), q[1] - k * r * Math.cos(b)], q].flatMap(v => map(v as Point)) });
      }
    };
    for (const s of c.shapes) {
      if (s.type === "text") continue;
      if (s.type === "mixed") {
        if (s.fill) { s.segments!.forEach((part, i) => emit(part, i > 0)); expectedPath.push({ op: "h", args: [] }, { op: "f", args: [] }); }
        for (const part of s.segments!) { emit(part); expectedPath.push({ op: "S", args: [] }); strokeShapes.push(s); }
        continue;
      }
      if (s.fill && s.segmented) {
        segment(s.points, false); expectedPath.push({ op: "h", args: [] }, { op: "f", args: [] });
      }
      if (s.segmented) {
        for (let j = 1; j < s.points.length; ++j) { segment(s.points.slice(j - 1, j + 1), false); expectedPath.push({ op: "S", args: [] }); strokeShapes.push(s); }
      } else {
        segment(s.points, s.type === "cubic");
        if (s.closed) expectedPath.push({ op: "h", args: [] });
        expectedPath.push({ op: s.fill ? "B" : "S", args: [] }); strokeShapes.push(s);
      }
    }
    expect(actualPath.map(o => o.op)).toEqual(expectedPath.map(o => o.op));
    actualPath.forEach((o, i) => eqNumbers(o.args as number[], expectedPath[i].args as number[]));
    const widths = drawing.filter(o => o.op === "w");
    expect(widths).toHaveLength(strokeShapes.length);
    widths.forEach((o, i) => eqNumbers(o.args as number[], [strokeShapes[i].width * pt]));
    const dashes = drawing.filter(o => o.op === "d");
    dashes.forEach((o, i) => { const style = strokeShapes[i].dash; eqNumbers(o.args[0] as number[], (style === "solid" ? [] : style === "dashed" ? [4, 3] : [1, 2]).map(x => x * pt)); expect(o.args[1]).toBe(0); });
    expect(drawing.filter(o => o.op === "J").every(o => o.args[0] === 1)).toBe(true);
    expect(drawing.filter(o => o.op === "j").every(o => o.args[0] === 1)).toBe(true);
    const fills = c.shapes.filter(s => s.fill);
    expect(drawing.filter(o => o.op === "rg")).toHaveLength(fills.length + c.shapes.filter(s => s.type === "text").reduce((n, s) => n + s.value!.split("\n").length, 0));
    for (const s of fills) {
      const rgb = [1, 3, 5].map(i => parseInt(s.fill!.slice(i, i + 2), 16) / 255);
      expect(drawing.filter(o => o.op === "rg").some(o => (o.args as number[]).every((a, i) => Math.abs(a - rgb[i]) < tolerance))).toBe(true);
      expect([...parsed.objects.values()].some(o => o.includes(`/ca ${s.opacity}`) && o.includes("/CA 1"))).toBe(true);
    }
    let alpha = 1, strokeAlpha = 1, fillIndex = 0;
    const stack: Point[] = [];
    for (const o of drawing) {
      if (o.op === "q") stack.push([alpha, strokeAlpha]);
      if (o.op === "Q") [alpha, strokeAlpha] = stack.pop()!;
      if (o.op === "gs") {
        const id = Number(new RegExp(`${o.args[0]} (\\d+) 0 R`).exec(page.object)?.[1]);
        const state = parsed.objects.get(id)!;
        alpha = Number(/\/ca ([\d.]+)/.exec(state)?.[1]);
        strokeAlpha = Number(/\/CA ([\d.]+)/.exec(state)?.[1]);
      }
      if (o.op === "f" || o.op === "B") near(alpha, fills[fillIndex++].opacity!);
      if (o.op === "S" || o.op === "B") near(strokeAlpha, 1);
    }
    const textRows = c.shapes.filter(s => s.type === "text").flatMap(s => s.value!.split("\n").map((row, i) => ({ s, row, i })));
    const textMatrices = drawing.filter(o => o.op === "Tm");
    const textArrays = drawing.filter(o => o.op === "TJ");
    expect(textMatrices).toHaveLength(textRows.length);
    textRows.forEach(({ s, row, i }, j) => {
      const angle = s.angle! * Math.PI / 180, sign = s.mirror ? -1 : 1;
      const baseline = -i * s.size! * 1.2;
      const p: Point = [s.points[0][0] - baseline * Math.sin(angle), s.points[0][1] + baseline * Math.cos(angle)];
      eqNumbers(textMatrices[j].args as number[], [sign * Math.cos(angle), sign * Math.sin(angle), -Math.sin(angle), Math.cos(angle), ...map(p)]);
      const tj = textArrays[j].args[0] as (number | string)[];
      const expected = [...row].flatMap(ch => [`<${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`, ch.codePointAt(0)! > 0x2e80 ? 0 : 380]);
      eqTokens(tj, expected);
    });
    const guidePaths = guides.filter(o => ["m", "l", "S"].includes(o.op));
    const wanted: Op[] = [];
    if (c.overlap) {
      for (const x of [c.overlap, c.paper[0] - c.overlap]) wanted.push({ op: "m", args: [x * pt, 0] }, { op: "l", args: [x * pt, c.paper[1] * pt] }, { op: "S", args: [] });
      for (const y of [c.overlap, c.paper[1] - c.overlap]) wanted.push({ op: "m", args: [0, y * pt] }, { op: "l", args: [c.paper[0] * pt, y * pt] }, { op: "S", args: [] });
    }
    expect(guidePaths.map(o => o.op)).toEqual(wanted.map(o => o.op));
    guidePaths.forEach((o, i) => eqNumbers(o.args as number[], wanted[i].args as number[]));
    const col = index % c.columns, row = Math.floor(index / c.columns);
    const alphaLabel = (n: number): string => n < 26 ? String.fromCharCode(65 + n) : alphaLabel(Math.floor(n / 26) - 1) + alphaLabel(n % 26);
    const labels: { value: string; vertical: boolean; center: Point }[] = [];
    if (c.overlap) {
      if (col) labels.push({ value: String(row * (c.columns - 1) + col), vertical: true, center: [c.overlap / 2, c.paper[1] / 2] });
      if (col < c.columns - 1) labels.push({ value: String(row * (c.columns - 1) + col + 1), vertical: true, center: [c.paper[0] - c.overlap / 2, c.paper[1] / 2] });
      if (row) labels.push({ value: alphaLabel((row - 1) * c.columns + col), vertical: false, center: [c.paper[0] / 2, c.overlap / 2] });
      if (row < c.rows - 1) labels.push({ value: alphaLabel(row * c.columns + col), vertical: false, center: [c.paper[0] / 2, c.paper[1] - c.overlap / 2] });
    }
    const texts = guides.filter(o => o.op === "TJ");
    expect(texts.map(o => (o.args[0] as (number | string)[]).filter(x => typeof x === "string").map(x => String.fromCharCode(parseInt((x as string).slice(1, -1), 16))).join(""))).toEqual(labels.map(l => l.value));
    const matrices = guides.filter(o => o.op === "Tm");
    const fonts = guides.filter(o => o.op === "Tf");
    matrices.forEach((o, i) => {
      const l = labels[i], f = Math.min(3, c.overlap); // vertical strips fit font height; horizontal labels are short.
      const width = l.value.length * .62 * f;
      const anchor = l.vertical ? [l.center[0] + .3 * f, l.center[1] - width / 2] : [l.center[0] - width / 2, l.center[1] - .3 * f];
      eqNumbers(o.args as number[], [...(l.vertical ? [0, 1, -1, 0] : [1, 0, 0, 1]), ...anchor.map(x => x * pt)]);
      near(fonts[i].args[1] as number, f * pt);
      const tj = texts[i].args[0] as (string | number)[];
      tj.filter(x => typeof x === "number").forEach(x => near(x as number, 380));
    });
    return { originMm: origin, drawingPaths: actualPath, textMatrices, textArrays, guides: guidePaths, labels: labels.map(l => l.value), mediaBox: page.box };
  });
  return { pages };
};

// Fault injection is confined to copied XML or copied oracle arguments. It
// never mutates source fixtures, the planner, the encoders, or a real payload.
const sensitivity = (bytes: Buffer, c: Frozen, kind: "svg" | "pdf") => {
  const detected: string[] = [];
  const reject = (name: string, check: () => void) => { expect(check, name).toThrow(); detected.push(name); };
  const xmlFault = (change: (svg: Element) => void) => {
    const doc = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
    change(doc.documentElement);
    checkSvg(Buffer.from(new XMLSerializer().serializeToString(doc)), c);
  };
  if (kind === "svg") {
    if (c.id === "S1") reject("reversed overlap order", () => xmlFault(svg => { svg.insertBefore(svg.lastElementChild!, svg.firstElementChild); }));
    if (c.id === "S2") {
      reject("wrong transformed cubic control", () => { const bad = structuredClone(c); bad.shapes[0].points[1][0] += 1; checkSvg(bytes, bad); });
      reject("pixel rather than mm root units", () => xmlFault(svg => { svg.setAttribute("width", svg.getAttribute("width")!.replace("mm", "px")); }));
    }
    if (c.id === "S4") reject("false closing stroke", () => xmlFault(svg => { const p = [...svg.children].find(n => n.getAttribute("stroke") !== "none")!; p.setAttribute("d", p.getAttribute("d")! + " Z"); }));
    if (c.id === "S6") {
      reject("physical stroke scaled twice", () => xmlFault(svg => { const p = svg.firstElementChild!; p.setAttribute("stroke-width", String(Number(p.getAttribute("stroke-width")) * 2.5)); }));
      const other = cases.find(x => x.id === c.id && x.variant !== c.variant)!;
      reject("wrong Drawing Profile", () => checkSvg(bytes, other));
    }
    if (c.id === "S7" || c.id === "X4" || (c.id === "F1" && c.variant === "text")) reject("inverted glyph ascent", () => xmlFault(svg => {
      const text = svg.firstElementChild!;
      text.setAttribute("transform", text.getAttribute("transform")!.replace(/scale\(([-\d]+) 1\)/, "scale($1 -1)"));
    }));
    if (c.id === "X4") reject("lost blank-row baseline advance", () => xmlFault(svg => { svg.querySelectorAll("tspan")[1].setAttribute("dy", "0"); }));
  } else {
    if (c.id === "P2") {
      reject("missing sheet", () => checkPdf(bytes, { ...c, columns: c.columns + 1 }));
      reject("wrong mm to pt conversion", () => checkPdf(bytes, { ...c, paper: c.paper.map(n => n / pt) as Point }));
      reject("wrong overlap and tile origin", () => checkPdf(bytes, { ...c, overlap: c.overlap + 1 }));
    }
    if (c.id === "P4") reject("lost curve across sheets", () => checkPdf(bytes, { ...c, shapes: [] }));
    if (c.id === "P5" && c.variant === "filled") reject("omitted fill contour", () => { const bad = structuredClone(c); delete bad.shapes[0].fill; checkPdf(bytes, bad); });
    if (c.id === "P6") reject("wrong physical dash", () => { const bad = structuredClone(c); bad.shapes[0].dash = "solid"; checkPdf(bytes, bad); });
    if (c.id === "P7") reject("wrong print profile", () => checkPdf(bytes, cases.find(x => x.id === c.id && x.variant !== c.variant)!));
    if (c.id === "X3") reject("opacity resource applied to wrong contour", () => { const bad = structuredClone(c); bad.shapes[0].opacity = .9; checkPdf(bytes, bad); });
  }
  return detected;
};

const run = async (c: Frozen, kind: "svg" | "pdf", target?: string) => {
  if (resourceError) throw resourceError;
  const doc = compiled.get(c)!;
  const output = kind === "svg" ? doc.document.svgOutputs[0] : doc.document.printOutputs[0];
  let evaluationOrder: string[] = [];
  const plan: OutputPlan = await evaluateOutputPlan({ compiledDocument: doc, output, evaluate: async (elements, options) => {
    const prepared = prepareRustEvaluation(elements, options);
    expect(prepared.rustEligible, `${c.id}/${c.variant} production eligibility`).toBe(true);
    const evaluation = await bounded(evaluatePreparedRust(prepared, async input => await rust.request(input) as EvaluationPayload));
    expect(evaluation.errors).toEqual([]);
    evaluationOrder = [...evaluation.computedGeometry.values()].map(g => g.name);
    if (c.id === "S1" && c.variant === "dependent") expect(evaluationOrder.indexOf("Later")).toBeLessThan(evaluationOrder.indexOf("First"));
    const reference = evaluateElementsReference(elements, options);
    expect(reference.errors).toEqual([]);
    // An additional comparison only; encoded geometry is checked against frozen authored values.
    expect(evaluation.effectiveVisibleElementIds).toEqual(reference.effectiveVisibleElementIds);
    return evaluation;
  } });
  eqNumbers([plan.renderedBounds.minX, plan.renderedBounds.minY, plan.renderedBounds.maxX, plan.renderedBounds.maxY], c.bounds, 1e-8);
  expect(plan.rustPayload.drawables).toEqual(plan.drawables);
  // Placement occurrence identity is (placement id, canonical drawable id).
  expect(new Set(plan.placements.flatMap(p => p.drawables.map(d => `${p.id}/${d.elementId}`))).size).toBe(plan.drawables.length);
  const path = target ?? join(directory, `${c.id}-${c.variant}.${kind}`);
  if (c.error && kind === "pdf") throw new Error("planner should have rejected this case");
  if (c.encodeError && kind === "pdf") {
    const sentinel = readFileSync(path);
    await expect(bounded(rust.exportOutput({ path, payload: plan.rustPayload }))).rejects.toThrow(c.encodeError);
    expect(readFileSync(path)).toEqual(sentinel);
    observations.push({ id: c.id, variant: c.variant, kind, result: "PASS", error: c.encodeError, sentinelSha256: hash(sentinel) });
    return;
  }
  expect(await bounded(rust.exportOutput({ path, payload: plan.rustPayload }))).toEqual({ exported: true });
  const bytes = readFileSync(path);
  const record = { id: c.id, variant: c.variant, kind, sourceSha256: c.sha256, payloadSha256: hash(JSON.stringify(plan.rustPayload)), artifactSha256: hash(bytes), bytes: bytes.length, result: "OBSERVED" };
  observations.push(record);
  let artifact;
  try { artifact = kind === "svg" ? checkSvg(bytes, c) : checkPdf(bytes, c); }
  catch (error) {
    Object.assign(record, { result: "FAIL", error: String(error), ...(kind === "svg" ? { xml: bytes.toString("utf8") } : {}) });
    throw error;
  }
  const detected = sensitivity(bytes, c, kind);
  Object.assign(record, { result: "PASS", artifact, detected, ...(c.id === "R3" || c.id === "S1" ? { evaluationOrder } : {}) });
  return { bytes, plan, artifact, evaluationOrder };
};

describe("Issue 1458 actual production encoded physical artifacts", () => {
  for (const id of [...new Set(cases.map(c => c.id))]) it(id, async () => {
    const failures: string[] = [];
    const previous = new Map<string, Buffer>();
    const previousOrder = new Map<string, string[]>();
    const sharedPath = join(directory, `${id}-current`);
    writeFileSync(sharedPath, Buffer.from([0, 255, 83, 65, 70, 69]));
    for (const c of cases.filter(c => c.id === id)) {
      if (id === "R8" && c.variant === "after") {
        const before = cases.find(x => x.id === id && x.variant === "before")!;
        const current = compileFreshCanonicalText(before.source);
        const line = before.source.split("\n").findIndex(s => s.includes("line Edge"));
        const patch = commitLineSplicePatch(current, [{ startLine: line + 1, endLine: line + 1, replacementLines: [c.source.split("\n")[line]] }]);
        expect(patch.status).toBe("committed");
        if (patch.status !== "committed") throw new Error("R8 splice failed");
        expect(patch.value.sourceText).toBe(c.source);
        expect(patch.value.doc.document.elements.map(e => [e.name, e.id])).toEqual(current.doc.document.elements.map(e => [e.name, e.id]));
        compiled.set(c, patch.value.doc);
      }
      const kinds: ("svg" | "pdf")[] = (id.startsWith("S") && id !== "S7") || id === "R1" || id === "R8" ? ["svg"] : id.startsWith("P") || id === "R5" || id === "R7" || id === "X8" ? ["pdf"] : ["svg", "pdf"];
      for (const kind of kinds) {
        try {
        if (c.error) {
          const sentinel = readFileSync(sharedPath);
          await expect(run(c, kind, sharedPath)).rejects.toThrow(c.error);
          expect(readFileSync(sharedPath)).toEqual(sentinel);
          observations.push({ id, variant: c.variant, kind, result: "PASS", error: c.error, sentinelSha256: hash(sentinel) });
        } else {
          const result = await run(c, kind, sharedPath);
          if (result) {
            // Source-revision stale artifact controls. Same geometry after a legal
            // declaration reorder must instead remain byte-identical.
            const old = previous.get(kind);
            if (old && id.startsWith("R")) {
              if (id === "R3") {
                expect(result.bytes).toEqual(old);
                expect(result.evaluationOrder).not.toEqual(previousOrder.get(kind));
              }
              else expect(() => kind === "svg" ? checkSvg(old, c) : checkPdf(old, c), `${id} stale artifact`).toThrow();
            }
            previous.set(kind, result.bytes);
            previousOrder.set(kind, result.evaluationOrder);
          }
        }
        } catch (error) { failures.push(`${c.variant}/${kind}: ${String(error)}`); }
      }
    }
    expect(failures).toEqual([]);
  }, 60000);
});
