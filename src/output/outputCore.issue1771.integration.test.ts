import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { canonicalRegressionSource } from "../../test/canonicalRegressionSource";
import { parsePdf } from "../../test/pdfArtifactInspector";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluatePreparedRust, prepareRustEvaluation } from "../geometry/rustEvaluationRunner";
import type { EvaluationPayload } from "../geometry/evaluationPayload";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import { evaluateOutputPlan, type OutputPlan, type OutputText } from "./outputCore";

const fixturePath = "test/fixtures/issue-1771/japanese-labels.nui";
const fixture = readFileSync(fixturePath, "utf8");
const fixtureLabelLiteral = '"AB 日本\\n裁断型紙"';
const fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
const pointsPerMm = 72 / 25.4;
const pageTolerance = 0.001;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

type MatrixCase = {
  id: string;
  label: string;
  basePdf: "PASS" | "REJECT" | null;
  baseError?: string;
  expectedPdf: "PASS" | "REJECT";
  expectedSvg: boolean;
  expectedError?: string;
};

type Observation = {
  [key: string]: unknown;
  id: string;
  pdf?: { status: string; error?: string | null; destinationPreserved?: boolean; bytes?: number; sha256?: string; artifact?: unknown };
  svg?: { status: string; bytes: number; sha256: string; artifact?: unknown };
};

const matrix: MatrixCase[] = [
  { id: "ab-japanese", label: "AB 日本", basePdf: "PASS", expectedPdf: "PASS", expectedSvg: true },
  { id: "you-sei-hand", label: "妖精 手", basePdf: "REJECT", baseError: "PDF text character U+5996 is not mapped by /UniJIS-UCS2-H", expectedPdf: "PASS", expectedSvg: true },
  { id: "ushiro-eri-mae", label: "後頭部・襟足・体前", basePdf: "REJECT", baseError: "PDF text character U+5F8C is not mapped by /UniJIS-UCS2-H", expectedPdf: "PASS", expectedSvg: true },
  { id: "nuishiro-10mm-right", label: "縫い代10mm（右）", basePdf: "REJECT", baseError: "PDF text character U+7E2B is not mapped by /UniJIS-UCS2-H", expectedPdf: "PASS", expectedSvg: true },
  { id: "cut-pattern", label: "裁断型紙", basePdf: null, expectedPdf: "PASS", expectedSvg: true },
  { id: "sleeve", label: "袖", basePdf: null, expectedPdf: "PASS", expectedSvg: true },
  { id: "shoulder", label: "肩", basePdf: null, expectedPdf: "PASS", expectedSvg: true },
  { id: "tall-taka", label: "髙", basePdf: null, expectedPdf: "PASS", expectedSvg: true },
  { id: "compatibility-saki", label: "﨑", basePdf: null, expectedPdf: "PASS", expectedSvg: true },
  { id: "arabic-u0627", label: "ا", basePdf: "REJECT", expectedPdf: "REJECT", expectedSvg: false, expectedError: "PDF text character U+0627 is not mapped by /UniJIS-UCS2-H" },
  { id: "emoji-u1f600", label: "😀", basePdf: "REJECT", expectedPdf: "REJECT", expectedSvg: false, expectedError: "PDF text character U+1F600 is not representable by /UniJIS-UCS2-H" },
  { id: "euro-u20ac", label: "€", basePdf: null, expectedPdf: "REJECT", expectedSvg: false, expectedError: "PDF text character U+20AC is not mapped by /UniJIS-UCS2-H" },
  { id: "unmapped-u0378", label: "\u0378", basePdf: null, expectedPdf: "REJECT", expectedSvg: false, expectedError: "PDF text character U+0378 is not mapped by /UniJIS-UCS2-H" }
];

type JapaneseLineContract = {
  hex: string[];
  advancesMm: number[];
  tjAdjustments: number[];
};

const japaneseLineContracts: Record<string, JapaneseLineContract> = {
  "AB 日本": {
    hex: ["0041", "0042", "0020", "65E5", "672C"],
    advancesMm: [2.48, 2.48, 2.48, 4, 4],
    tjAdjustments: [380, 380, 380, 0, 0]
  },
  "妖精 手": {
    hex: ["5996", "7CBE", "0020", "624B"],
    advancesMm: [4, 4, 2.48, 4],
    tjAdjustments: [0, 0, 380, 0]
  },
  "後頭部・襟足・体前": {
    hex: ["5F8C", "982D", "90E8", "30FB", "895F", "8DB3", "30FB", "4F53", "524D"],
    advancesMm: [4, 4, 4, 4, 4, 4, 4, 4, 4],
    tjAdjustments: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  "縫い代10mm（右）": {
    hex: ["7E2B", "3044", "4EE3", "0031", "0030", "006D", "006D", "FF08", "53F3", "FF09"],
    advancesMm: [4, 4, 4, 2.48, 2.48, 2.48, 2.48, 4, 4, 4],
    tjAdjustments: [0, 0, 0, 380, 380, 380, 380, 0, 0, 0]
  },
  "裁断型紙": {
    hex: ["88C1", "65AD", "578B", "7D19"],
    advancesMm: [4, 4, 4, 4],
    tjAdjustments: [0, 0, 0, 0]
  },
  "袖": { hex: ["8896"], advancesMm: [4], tjAdjustments: [0] },
  "肩": { hex: ["80A9"], advancesMm: [4], tjAdjustments: [0] },
  "髙": { hex: ["9AD9"], advancesMm: [4], tjAdjustments: [0] },
  "﨑": { hex: ["FA11"], advancesMm: [4], tjAdjustments: [0] }
};

const expectedPages = [
  { originMm: { x: -10, y: -10 }, column: 0 },
  { originMm: { x: 180, y: -10 }, column: 1 }
] as const;
const cos30 = Math.sqrt(3) / 2;
const expectedTextPlacements = [
  { anchorMm: { x: 28, y: 110 }, rotationDeg: 0, mirrorX: false },
  {
    anchorMm: { x: 260 - 8 * cos30 - 40, y: 70 - 4 + 80 * cos30 },
    rotationDeg: 30,
    mirrorX: true
  }
] as const;
const expectedReferenceSegmentsMm = [
  { start: { x: 20, y: 30 }, end: { x: 120, y: 30 } },
  { start: { x: 260, y: 70 }, end: { x: 260 - 100 * cos30, y: 20 } }
] as const;

const lineContractsFor = (label: string): JapaneseLineContract[] => label.split("\n").map((line) => {
  const contract = japaneseLineContracts[line];
  if (!contract) throw new Error("Missing independent Japanese fixture contract for " + JSON.stringify(line));
  return contract;
});

const expectedTjValues = (contract: JapaneseLineContract): (string | number)[] =>
  contract.hex.flatMap((hex, index) => ["<" + hex + ">", contract.tjAdjustments[index]!]);

const buildSource = (label: string) => {
  expect(fixture).toContain(fixtureLabelLiteral);
  return canonicalRegressionSource(fixture.replace(fixtureLabelLiteral, JSON.stringify(label)));
};

const compile = (label: string) => {
  const source = buildSource(label);
  expect(source).not.toMatch(/@[A-Za-z_]/u);
  const result = compileFreshCanonicalText(source);
  expect(result.status).not.toBe("fatal");
  expect(result.diagnostics).toEqual([]);
  const doc = result.doc;
  expect(doc.document.elements.map((element) => element.name)).toContain("Reference");
  expect(doc.document.elements.map((element) => element.name)).toContain("Caption");
  expect(doc.document.layouts.map((layout) => layout.name)).toContain("Sheet");
  expect(doc.document.printOutputs).toHaveLength(1);
  expect(doc.document.svgOutputs).toHaveLength(1);
  return { doc, source };
};

const near = (actual: number, expected: number, tolerance = pageTolerance) => {
  expect(Math.abs(actual - expected), `${actual} != ${expected}`).toBeLessThanOrEqual(tolerance);
};

let artifactDirectory = "";
let ownsArtifactDirectory = false;
let evidencePath = "";
let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let closure: { code: number | null; signal: NodeJS.Signals | null } | undefined;
let childError: string | undefined;
let resourceError: string | undefined;
const diagnostics: string[] = [];
const observations: Observation[] = [];

const saveEvidence = () => {
  if (!evidencePath) return;
  writeFileSync(evidencePath, `${JSON.stringify({
    fixture: fixturePath,
    fixtureSha256,
    execution: "canonical TypeScript compiler -> production Rust evaluation_stdio -> evaluateOutputPlan -> Rust export_output",
    cargoTargetDirectory: process.env.CARGO_TARGET_DIR ?? null,
    evaluationBinarySha256: process.env.CARGO_TARGET_DIR
      ? sha256(readFileSync(resolve(process.env.CARGO_TARGET_DIR, "debug", "evaluation_stdio")))
      : null,
    observations,
    diagnostics,
    childError,
    resourceError,
    processClosure: closure ?? null,
    finishedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
};

const bounded = async <T,>(operation: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          rust?.dispose();
          reject(new Error(`#1771 ${label} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const outputPlan = async (doc: ReturnType<typeof compile>["doc"], kind: "pdf" | "svg", label: string): Promise<OutputPlan> => {
  const output = kind === "pdf" ? doc.document.printOutputs[0]! : doc.document.svgOutputs[0]!;
  expect(output).toBeDefined();
  const plan = await evaluateOutputPlan({
    compiledDocument: doc,
    output,
    evaluate: async (elements, options) => {
      const prepared = prepareRustEvaluation(elements, options);
      expect(prepared.rustEligible, `${label} is eligible for production Rust evaluation`).toBe(true);
      const actual = await bounded(
        evaluatePreparedRust(prepared, async (input) => await rust!.request(input) as EvaluationPayload),
        `${label} ${kind} Rust evaluation`
      );
      expect(actual.errors).toEqual([]);
      expect(actual.geometryValueErrors ?? []).toEqual([]);
      const reference = evaluateElementsReference(elements, options);
      expect(reference.errors).toEqual([]);
      expect(actual.effectiveVisibleElementIds).toEqual(reference.effectiveVisibleElementIds);
      return actual;
    }
  });
  expect(plan.kind).toBe(kind === "pdf" ? "print" : "svg");
  expect(plan.rustPayload.drawables).toEqual(plan.drawables);
  expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Reference", "Caption", "Reference", "Caption"]);
  return plan;
};

const validatePlan = (plan: OutputPlan, label: string) => {
  expect(plan.placements.map(({ at, scale, angleDeg, mirror }) => ({ at, scale, angleDeg, mirror }))).toEqual([
    { at: { x: 20, y: 30 }, scale: 1, angleDeg: 0, mirror: false },
    { at: { x: 260, y: 70 }, scale: 1, angleDeg: 30, mirror: true }
  ]);

  const lines = plan.drawables.filter((drawable) => drawable.name === "Reference");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ kind: "line", start: { x: 20, y: 30 }, end: { x: 120, y: 30 }, stroke: { colorHex: "#31322f" } });
  expect(lines[1]?.kind).toBe("line");
  if (lines[1]?.kind !== "line") throw new Error("second reference must be a line");
  near(lines[1].start.x, 260);
  near(lines[1].start.y, 70);
  near(lines[1].end.x, 260 - 100 * cos30);
  near(lines[1].end.y, 20);

  const texts = plan.drawables.filter((drawable): drawable is OutputText => drawable.kind === "text");
  expect(texts).toHaveLength(2);
  expect(texts.map((text) => text.text)).toEqual([label, label]);
  expect(texts.map((text) => text.fontSizeMm)).toEqual([4, 4]);
  expect(texts.map((text) => text.colorHex)).toEqual(["#31322f", "#31322f"]);
  expect(texts[0]?.anchor).toEqual({ x: 28, y: 110 });
  near(texts[1]!.anchor.x, expectedTextPlacements[1].anchorMm.x);
  near(texts[1]!.anchor.y, expectedTextPlacements[1].anchorMm.y);
  for (const text of texts) {
    expect(text.lineHeightMm).toBe(4.8);
    expect(text.lineAdvancesMm.map((line) => line.length)).toEqual(label.split("\n").map((line) => [...line].length));
  }

  if (plan.kind === "print") {
    expect(plan.print).toMatchObject({ paper: "a4", orientation: "portrait", paperWidthMm: 210, paperHeightMm: 297, overlapMm: 10, columns: 2, rows: 1 });
    expect(plan.print!.pages).toHaveLength(2);
    expect(plan.print!.pages.map((page) => page.column)).toEqual([0, 1]);
    expect(plan.print!.pages[0]!.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 200)?.label?.text).toBe("1");
    expect(plan.print!.pages[1]!.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 10)?.label?.text).toBe("1");
  }
};

const extractPdfText = (pdf: ReturnType<typeof parsePdf>) => pdf.pages.flatMap((page, pageIndex) =>
  page.ops.flatMap((operation, operationIndex) => {
    if (operation.op !== "TJ") return [];
    const array = operation.args.find(Array.isArray) as (string | number)[] | undefined;
    if (!array) return [];
    const codepoints = array
      .filter((value): value is string => typeof value === "string" && /^<[0-9A-Fa-f]{4}>$/.test(value))
      .map((value) => Number.parseInt(value.slice(1, -1), 16));
    if (codepoints.length === 0) return [];
    const previous = page.ops.slice(0, operationIndex).reverse();
    const matrix = previous.find((candidate) => candidate.op === "Tm")?.args as number[] | undefined;
    const color = previous.find((candidate) => candidate.op === "rg")?.args as number[] | undefined;
    const font = previous.find((candidate) => candidate.op === "Tf")?.args as (string | number)[] | undefined;
    return [{
      pageIndex,
      codepoints,
      matrix,
      color,
      fontSizePt: font?.slice().reverse().find((value) => typeof value === "number") as number | undefined,
      values: array
    }];
  })
);

const validateJapanesePlanAdvances = (plan: OutputPlan, label: string) => {
  const contracts = lineContractsFor(label);
  const texts = plan.drawables.filter((drawable): drawable is OutputText => drawable.kind === "text");
  expect(texts).toHaveLength(2);
  for (const text of texts) {
    expect(text.lineHeightMm).toBe(4.8);
    expect(text.lineAdvancesMm).toEqual(contracts.map((contract) => contract.advancesMm));
  }
};

const verifyPdf = (bytes: Buffer, label: string) => {
  const pdf = parsePdf(bytes);
  expect(pdf.pages).toHaveLength(expectedPages.length);
  const fontObjects = [...pdf.objects.values()].join("\n");
  expect(fontObjects).toContain("/BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H");
  expect(fontObjects).toContain("/Ordering (Japan1) /Supplement 2");

  const pt = pointsPerMm;
  const textRecords = extractPdfText(pdf);
  const lineContracts = lineContractsFor(label);
  const expectedSequences = lineContracts.map((contract) => JSON.stringify(contract.hex.map((hex) => Number.parseInt(hex, 16))));

  for (const [pageIndex, page] of pdf.pages.entries()) {
    near(page.box[0]!, 0);
    near(page.box[1]!, 0);
    near(page.box[2]!, 210 * pt);
    near(page.box[3]!, 297 * pt);
    const clipIndex = page.ops.findIndex((operation) => operation.op === "re" &&
      Math.abs(Number(operation.args[0])) < pageTolerance &&
      Math.abs(Number(operation.args[1])) < pageTolerance &&
      Math.abs(Number(operation.args[2]) - 210 * pt) < pageTolerance &&
      Math.abs(Number(operation.args[3]) - 297 * pt) < pageTolerance);
    expect(clipIndex).toBeGreaterThanOrEqual(0);
    expect(page.ops[clipIndex + 1]?.op).toBe("W");
    expect(page.ops[clipIndex + 2]?.op).toBe("n");

    const origin = expectedPages[pageIndex]!.originMm;
    for (const segment of expectedReferenceSegmentsMm) {
      const start = [(segment.start.x - origin.x) * pt, (segment.start.y - origin.y) * pt];
      const end = [(segment.end.x - origin.x) * pt, (segment.end.y - origin.y) * pt];
      const hasLine = page.ops.some((operation, index) => operation.op === "m" &&
        page.ops[index + 1]?.op === "l" && page.ops[index + 2]?.op === "S" &&
        Math.abs(Number(operation.args[0]) - start[0]!) < pageTolerance &&
        Math.abs(Number(operation.args[1]) - start[1]!) < pageTolerance &&
        Math.abs(Number(page.ops[index + 1]!.args[0]) - end[0]!) < pageTolerance &&
        Math.abs(Number(page.ops[index + 1]!.args[1]) - end[1]!) < pageTolerance);
      expect(hasLine, "page " + pageIndex + " retains the independent reference line").toBe(true);
    }

    for (const [lineIndex, contract] of lineContracts.entries()) {
      const expectedCodepoints = contract.hex.map((hex) => Number.parseInt(hex, 16));
      const localY = -lineIndex * 4.8;
      for (const placement of expectedTextPlacements) {
        const angle = placement.rotationDeg * Math.PI / 180;
        const sign = placement.mirrorX ? -1 : 1;
        const a = Math.cos(angle) * sign;
        const b = Math.sin(angle) * sign;
        const c = -Math.sin(angle);
        const d = Math.cos(angle);
        const expectedMatrix = [
          a, b, c, d,
          (placement.anchorMm.x + c * localY - origin.x) * pt,
          (placement.anchorMm.y + d * localY - origin.y) * pt
        ];
        const records = textRecords.filter((candidate) => candidate.pageIndex === pageIndex &&
          JSON.stringify(candidate.codepoints) === JSON.stringify(expectedCodepoints) &&
          candidate.matrix?.length === 6 && candidate.matrix.every((value, index) => Math.abs(value - expectedMatrix[index]!) < pageTolerance));
        expect(records, "page " + pageIndex + " has one independently placed line " + lineIndex).toHaveLength(1);
        expect(records[0]!.values).toEqual(expectedTjValues(contract));
        expect(records[0]!.color).toEqual([0.192, 0.196, 0.184]);
        near(records[0]!.fontSizePt!, 4 * pt);
      }
    }

    const observedSequences = textRecords
      .filter((record) => record.pageIndex === pageIndex && expectedSequences.includes(JSON.stringify(record.codepoints)))
      .map((record) => JSON.stringify(record.codepoints));
    expect(observedSequences).toEqual([...expectedSequences, ...expectedSequences]);
  }

  expect(textRecords.some((record) => record.pageIndex === 0 && record.codepoints.join(",") === "49")).toBe(true);
  expect(textRecords.some((record) => record.pageIndex === 1 && record.codepoints.join(",") === "49")).toBe(true);
  return { pages: pdf.pages.length, pageBoxes: pdf.pages.map((page) => page.box), fontObjects: fontObjects.match(/\/Type \/Font[^\n]*/g) ?? [] };
};

const verifySvg = (bytes: Buffer, plan: OutputPlan, label: string) => {
  const document = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  const texts = [...document.querySelectorAll("text")];
  expect(texts).toHaveLength(2);
  for (const node of texts) {
    expect(node.getAttribute("fill")).toBe("#31322f");
    near(Number(node.getAttribute("font-size")), 4);
    expect([...node.querySelectorAll("tspan")].map((line) => line.textContent)).toEqual(label.split("\n"));
  }
  expect(plan.placements).toHaveLength(2);
  return { text: texts.map((node) => [...node.querySelectorAll("tspan")].map((line) => line.textContent)), fills: texts.map((node) => node.getAttribute("fill")) };
};

describe("Issue 1771 Adobe Japanese PDF text support", () => {
  beforeAll(() => {
    const configuredDirectory = process.env.ISSUE1771_ARTIFACTS?.trim();
    if (configuredDirectory) {
      artifactDirectory = resolve(configuredDirectory);
      mkdirSync(artifactDirectory, { recursive: true });
    } else {
      artifactDirectory = mkdtempSync(join(tmpdir(), "nuinui-issue1771-"));
      ownsArtifactDirectory = true;
    }
    evidencePath = process.env.ISSUE1771_EVIDENCE?.trim() ? resolve(process.env.ISSUE1771_EVIDENCE) : "";
    if (evidencePath) mkdirSync(resolve(evidencePath, ".."), { recursive: true });

    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], {
      cwd: process.cwd(),
      timeout: 120_000,
      stdio: "inherit"
    });
    const binary = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
    rust = new RustEvaluationProcess(binary, {
      reportDiagnostic: (message) => diagnostics.push(message),
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        child = spawn("/bin/sh", ["-c", 'ulimit -t 60 || exit 1; exec "$@"', "issue1771-rust", args[0]], { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
        child.once("error", (error) => {
          childError = String(error);
        });
        closed = new Promise<void>((resolveClosed) => {
          child!.once("close", (code, signal) => {
            closure = { code, signal };
            resolveClosed();
          });
          child!.once("error", () => resolveClosed());
        });
        const memory = setInterval(() => {
          try {
            const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child!.pid)], {
              encoding: "utf8", timeout: 1_000, maxBuffer: 1_024
            }));
            if (rss > 512 * 1_024) {
              resourceError = "test-owned evaluation_stdio exceeded 512 MiB RSS";
              rust?.dispose();
            }
          } catch {
            // The test-owned process may close before a final RSS sample.
          }
        }, 100);
        child.once("close", () => clearInterval(memory));
        child.once("error", () => clearInterval(memory));
        return child;
      }) as typeof spawn
    });
  }, 130_000);

  afterEach(() => saveEvidence());

  afterAll(async () => {
    rust?.dispose();
    if (closed) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("#1771 evaluation_stdio close exceeded 5 seconds")), 5_000);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    saveEvidence();
    if (ownsArtifactDirectory) rmSync(artifactDirectory, { recursive: true, force: true });
    expect(childError).toBeUndefined();
    expect(resourceError).toBeUndefined();
    expect(closure).toBeDefined();
    expect(closure?.code).toBeNull();
    expect(closure?.signal).toBe("SIGTERM");
  }, 10_000);

  for (const entry of matrix) {
    it(`${entry.id} PDF and SVG result`, async () => {
      const record: Observation = {
        id: entry.id,
        label: entry.label,
        base: { pdf: entry.basePdf, error: entry.baseError ?? null },
        expected: { pdf: entry.expectedPdf, svg: entry.expectedSvg ? "PASS" : null, error: entry.expectedError ?? null },
        sourceSha256: sha256(buildSource(entry.label))
      };
      observations.push(record);

      const { doc } = compile(entry.label);
      const pdfPlan = await outputPlan(doc, "pdf", entry.id);
      validatePlan(pdfPlan, entry.label);
      record.plan = {
        pageCount: pdfPlan.print?.pages.length,
        columns: pdfPlan.print?.columns,
        rows: pdfPlan.print?.rows,
        renderedBounds: pdfPlan.renderedBounds,
        drawables: pdfPlan.drawables.map((drawable) => drawable.kind === "text"
          ? { kind: drawable.kind, text: drawable.text, anchor: drawable.anchor, fontSizeMm: drawable.fontSizeMm, lineWidthsMm: drawable.lineWidthsMm, lineAdvancesMm: drawable.lineAdvancesMm, rotationDeg: drawable.rotationDeg, mirrorX: drawable.mirrorX, colorHex: drawable.colorHex }
          : { kind: drawable.kind, name: drawable.name })
      };

      const pdfPath = join(artifactDirectory, `${entry.id}.pdf`);
      let sentinel: Buffer | undefined;
      if (entry.expectedPdf === "REJECT") {
        sentinel = Buffer.from(`ISSUE1771-DESTINATION-SENTINEL:${entry.id}`, "utf8");
        writeFileSync(pdfPath, sentinel);
        record.destinationBeforeSha256 = sha256(sentinel);
      }

      let pdfError: string | undefined;
      try {
        const response = await bounded(rust!.exportOutput({ path: pdfPath, payload: pdfPlan.rustPayload }), `${entry.id} PDF export`);
        expect(response).toEqual({ exported: true });
      } catch (error) {
        pdfError = error instanceof Error ? error.message : String(error);
      }
      if (entry.expectedPdf === "REJECT") {
        const actual = readFileSync(pdfPath);
        record.pdf = { status: pdfError ? "REJECT" : "PASS", error: pdfError ?? null, destinationPreserved: actual.equals(sentinel!) };
        record.destinationAfterSha256 = sha256(actual);
        expect(pdfError).toBe(entry.expectedError);
        expect(actual).toEqual(sentinel);
      } else {
        expect(pdfError).toBeUndefined();
        validateJapanesePlanAdvances(pdfPlan, entry.label);
        const bytes = readFileSync(pdfPath);
        record.pdf = { status: "PASS", bytes: bytes.length, sha256: sha256(bytes), artifact: verifyPdf(bytes, entry.label) };
      }

      if (entry.expectedSvg) {
        const svgPlan = await outputPlan(doc, "svg", entry.id);
        validatePlan(svgPlan, entry.label);
        expect(svgPlan.drawables).toEqual(pdfPlan.drawables);
        expect(svgPlan.renderedBounds).toEqual(pdfPlan.renderedBounds);
        const svgPath = join(artifactDirectory, `${entry.id}.svg`);
        const response = await bounded(rust!.exportOutput({ path: svgPath, payload: svgPlan.rustPayload }), `${entry.id} SVG export`);
        expect(response).toEqual({ exported: true });
        const bytes = readFileSync(svgPath);
        record.svg = { status: "PASS", bytes: bytes.length, sha256: sha256(bytes), artifact: verifySvg(bytes, svgPlan, entry.label) };
      }
      expect(record.pdf?.status).toBe(entry.expectedPdf);
      if (entry.expectedSvg) expect(record.svg?.status).toBe("PASS");
    }, 60_000);
  }

  it("retains multiline upright order, transformed placement, tiled pages, joining labels, and independent coordinates", async () => {
    const label = "AB 日本\n妖精 手\n後頭部・襟足・体前\n縫い代10mm（右）\n裁断型紙\n袖\n肩\n髙\n﨑";
    const record: Observation = { id: "multiline-transformed-layout", label, sourceSha256: fixtureSha256 };
    observations.push(record);
    const { doc } = compile(label);
    const pdfPlan = await outputPlan(doc, "pdf", record.id);
    const svgPlan = await outputPlan(doc, "svg", record.id);
    validatePlan(pdfPlan, label);
    validatePlan(svgPlan, label);
    expect(pdfPlan.drawables).toEqual(svgPlan.drawables);
    expect(pdfPlan.renderedBounds).toEqual(svgPlan.renderedBounds);

    const firstText = pdfPlan.drawables.find((drawable): drawable is OutputText => drawable.kind === "text")!;
    validateJapanesePlanAdvances(pdfPlan, label);
    expect(firstText.lineWidthsMm.slice(0, 2)).toEqual([15.44, 14.48]);
    expect(firstText.widthMm).toBe(Math.max(...firstText.lineWidthsMm));
    expect(pdfPlan.print?.pages.flatMap((page) => page.guides).filter((guide) => guide.label)).toHaveLength(2);

    const pdfPath = join(artifactDirectory, "multiline-transformed-layout.pdf");
    const pdfResponse = await bounded(rust!.exportOutput({ path: pdfPath, payload: pdfPlan.rustPayload }), "multiline PDF export");
    expect(pdfResponse).toEqual({ exported: true });
    const pdfBytes = readFileSync(pdfPath);
    record.pdf = { status: "PASS", bytes: pdfBytes.length, sha256: sha256(pdfBytes), artifact: verifyPdf(pdfBytes, label) };

    const svgPath = join(artifactDirectory, "multiline-transformed-layout.svg");
    const svgResponse = await bounded(rust!.exportOutput({ path: svgPath, payload: svgPlan.rustPayload }), "multiline SVG export");
    expect(svgResponse).toEqual({ exported: true });
    const svgBytes = readFileSync(svgPath);
    record.svg = { status: "PASS", bytes: svgBytes.length, sha256: sha256(svgBytes), artifact: verifySvg(svgBytes, svgPlan, label) };
  }, 60_000);
});
