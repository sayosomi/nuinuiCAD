import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { prepareRustEvaluation } from "../geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import type { EvaluationResult } from "../types/geometry";
import { PX_TO_MM, buildOutputPlan, type OutputPlan } from "./outputCore";
import { parsePdf } from "../../test/pdfArtifactInspector";

const source = [
  "nui 1",
  "group Placed {",
  "  line Base = segment(start: (0, 0), end: (100, 0))",
  "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
  "}",
  "layout L {",
  "  place Placed(at: (0, 0))",
  "}",
  "svg Vector(layout: L, layers: [default], margin: 1)",
  "print Paper(layout: L, layers: [default], paper: a4, orientation: portrait, overlap: 0)"
].join("\n");

const numericValues = (value: string) => (value.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const compare = (actual: readonly number[], expected: readonly number[], tolerance = 0.00051) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(tolerance));
};

let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let closure: { code: number | null; signal: NodeJS.Signals | null } | undefined;
let childError: Error | undefined;
let artifactDirectory = "";
const bounded = async <T,>(operation: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          rust?.dispose();
          reject(new Error(`#1748 ${label} exceeded the ${timeoutMs / 1000}s bound`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

beforeAll(() => {
  artifactDirectory = mkdtempSync(join(tmpdir(), "nuinui-1748-output-"));
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], {
    cwd: process.cwd(),
    timeout: 120_000,
    stdio: "inherit"
  });
  const binary = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  rust = new RustEvaluationProcess(binary, {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      // Observe process failure and completion before the evaluator starts any request.
      child.once("error", (error) => { childError = error; });
      closed = new Promise<void>((resolveClosed) => {
        child!.once("close", (code, signal) => {
          closure = { code, signal };
          resolveClosed();
        });
      });
      return child;
    }) as typeof spawn
  });
}, 125_000);

afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed, "process cleanup", 5_000);
  if (artifactDirectory) rmSync(artifactDirectory, { recursive: true, force: true });
  expect(childError).toBeUndefined();
  expect(closure).toBeDefined();
});

const expectedPaths = [
  { name: "Base", kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { name: "Preview", kind: "joinedPath", segments: [{ kind: "line", start: { x: 0, y: 0 }, end: { x: -100, y: 0 } }] }
];

const expectIndependentPlan = (plan: OutputPlan, kind: "svg" | "print") => {
  expect(plan.kind).toBe(kind);
  expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Base", "Preview"]);
  expect(plan.drawables[0]).toMatchObject(expectedPaths[0]);
  expect(plan.drawables[1]).toMatchObject(expectedPaths[1]);
  expect(plan.rustPayload.drawables).toEqual(plan.drawables);
  expect(plan.renderedBounds.minX).toBeCloseTo(-100 - PX_TO_MM / 2, 10);
  expect(plan.renderedBounds.maxX).toBeCloseTo(100 + PX_TO_MM / 2, 10);
  if (kind === "svg") {
    expect(plan.svg?.widthMm).toBeCloseTo(202 + PX_TO_MM, 10);
    expect(plan.svg?.heightMm).toBeCloseTo(2 + PX_TO_MM, 10);
  } else {
    expect(plan.print).toMatchObject({ columns: 1, rows: 1, pages: [expect.objectContaining({ column: 0, row: 0 })] });
  }
};

const expectEvaluation = (evaluation: EvaluationResult, ownerId: string) => {
  expect(evaluation.errors).toEqual([]);
  expect(evaluation.geometryValueErrors ?? []).toEqual([]);
  expect(evaluation.mirrorCopyPreviews?.get(ownerId)?.groups).toMatchObject([
    { sourceElementId: expect.any(String), segments: [{ kind: "line", start: { x: 0, y: 0 }, end: { x: -100, y: 0 } }] }
  ]);
  expect(evaluation.computedGeometry.has(ownerId)).toBe(false);
};

describe("#1748 canonical live mirrorCopy output through Rust artifacts", () => {
  it("plans TS and actual Rust evaluation, then inspects exported SVG and PDF geometry", async () => {
    const compiled = compileFreshCanonicalText(source);
    expect(compiled.status).not.toBe("fatal");
    expect(compiled.diagnostics).toEqual([]);
    const doc = compiled.doc;
    const ownerId = doc.document.elements.find((element) => element.name === "Preview")!.id;
    const options = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: doc.document.evaluationLimitIndex });
    const prepared = prepareRustEvaluation(doc.document.elements, options);
    expect(prepared.rustEligible).toBe(true);

    const typescript = evaluateElementsReference(doc.document.elements, options);
    expectEvaluation(typescript, ownerId);
    const rustPayload = await bounded(rust!.request(prepared.input) as Promise<EvaluationPayload>, "evaluation request");
    const actualRust = evaluationPayloadToResult(rustPayload);
    expectEvaluation(actualRust, ownerId);

    const svgPlan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: actualRust });
    const printPlan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0]!, evaluation: actualRust });
    const typescriptSvgPlan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: typescript });
    const typescriptPrintPlan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0]!, evaluation: typescript });
    expectIndependentPlan(typescriptSvgPlan, "svg");
    expectIndependentPlan(typescriptPrintPlan, "print");
    expectIndependentPlan(svgPlan, "svg");
    expectIndependentPlan(printPlan, "print");

    const svgPath = join(artifactDirectory, "mirror.svg");
    const pdfPath = join(artifactDirectory, "mirror.pdf");
    expect(await bounded(rust!.exportOutput({ path: svgPath, payload: svgPlan.rustPayload }), "SVG export")).toEqual({ exported: true });
    expect(await bounded(rust!.exportOutput({ path: pdfPath, payload: printPlan.rustPayload }), "PDF export")).toEqual({ exported: true });
    expect(statSync(svgPath).size).toBeGreaterThan(0);
    expect(statSync(pdfPath).size).toBeGreaterThan(0);

    const svgDocument = new DOMParser().parseFromString(readFileSync(svgPath, "utf8"), "image/svg+xml");
    expect(svgDocument.querySelector("parsererror")).toBeNull();
    const svg = svgDocument.documentElement;
    const halfStroke = PX_TO_MM / 2;
    const margin = 1;
    const expectedSvgWidth = 200 + PX_TO_MM + 2 * margin;
    const expectedSvgHeight = PX_TO_MM + 2 * margin;
    compare([parseFloat(svg.getAttribute("width")!), parseFloat(svg.getAttribute("height")!)], [expectedSvgWidth, expectedSvgHeight]);
    const svgPaths = [...svg.children];
    expect(svgPaths).toHaveLength(2);
    const expectedY = expectedSvgHeight - (halfStroke + margin);
    const expectedLeft = 100 + halfStroke + margin;
    for (const path of svgPaths) {
      expect(path.tagName).toBe("path");
      expect(path.getAttribute("stroke")).toBe("#31322f");
      expect(path.getAttribute("fill")).toBe("none");
      compare([Number(path.getAttribute("stroke-width"))], [PX_TO_MM]);
    }
    compare(numericValues(svgPaths[0]!.getAttribute("d")!), [expectedLeft, expectedY, expectedLeft + 100, expectedY]);
    compare(numericValues(svgPaths[1]!.getAttribute("d")!), [expectedLeft, expectedY, expectedLeft - 100, expectedY]);

    const pdf = parsePdf(readFileSync(pdfPath));
    expect(pdf.pages).toHaveLength(1);
    compare(pdf.pages[0]!.box, [0, 0, 210 * 72 / 25.4, 297 * 72 / 25.4]);
    const pathOps = pdf.pages[0]!.ops.filter((operation) => ["m", "l", "S"].includes(operation.op));
    expect(pathOps.map((operation) => operation.op)).toEqual(["m", "l", "S", "m", "l", "S"]);
    const pointsToMm = 25.4 / 72;
    const pageOriginX = -100 - halfStroke;
    const pageOriginY = -halfStroke;
    const pageLines = [pathOps.slice(0, 3), pathOps.slice(3, 6)].map((line) => {
      const start = line[0]!.args as number[];
      const end = line[1]!.args as number[];
      return [start[0]! * pointsToMm + pageOriginX, start[1]! * pointsToMm + pageOriginY,
        end[0]! * pointsToMm + pageOriginX, end[1]! * pointsToMm + pageOriginY];
    });
    compare(pageLines[0]!, [0, 0, 100, 0]);
    compare(pageLines[1]!, [0, 0, -100, 0]);
    compare(pdf.pages[0]!.ops.filter((operation) => operation.op === "w").map((operation) => (operation.args as number[])[0]!), [0.75, 0.75]);
    compare(pdf.pages[0]!.ops.filter((operation) => operation.op === "RG").flatMap((operation) => operation.args as number[]), [
      49 / 255, 50 / 255, 47 / 255,
      49 / 255, 50 / 255, 47 / 255
    ]);
  }, 30_000);
});
