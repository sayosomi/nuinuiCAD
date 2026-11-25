import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { MirrorCopyPreview } from "../src/geometry/evaluationTypes";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import manifest from "./fixtures/issue-1497/manifest.json";
import { canonicalRegressionSource } from "./canonicalRegressionSource";

type Unit = {
  id: string; file: string; sha256: string; expected: Record<string, unknown>;
  errors?: Record<string, string>; pureErrors?: Record<string, string>; pure?: string[];
  unchanged?: Record<string, unknown>; edit?: Partial<Unit> & { file: string; sha256: string };
};
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1497_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let requests = 0, spawns = 0;
async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1497 Rust exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}
beforeAll(() => {
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      // Subscribe before a request or disposal can trigger termination.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1497_RECORD) writeFileSync(process.env.ISSUE1497_RECORD,
    JSON.stringify({ base: manifest.base, validateOnly, spawns, requests, observations }, null, 2) + "\n");
});
function compare(actual: unknown, expected: unknown, path: string, tolerance = manifest.coordinateTolerance): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (typeof actual !== "number" || !Number.isFinite(actual)) {
      throw new Error(`${path}: expected finite numeric output, received ${String(actual)}`);
    }
    const delta = Math.abs(Number(actual) - expected);
    const error = path.endsWith("AngleDeg") ? Math.min(delta, Math.abs(delta - 360)) : delta;
    expect(error, `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(path.endsWith("length") ? tolerance : manifest.coordinateTolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, `${path}[${i}]`, tolerance));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    const object = expected as Record<string, unknown>;
    const localTolerance = typeof object.lengthTolerance === "number" ? object.lengthTolerance : tolerance;
    for (const [k, v] of Object.entries(object)) if (k !== "lengthTolerance") compare((actual as Record<string, unknown>)[k], v, `${path}.${k}`, localTolerance);
  } else expect(actual, path).toEqual(expected);
}
function identityFree(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(value).not.toHaveProperty("elementId");
  expect(value).not.toHaveProperty("name");
  for (const child of Object.values(value)) identityFree(child);
}

function canonicalNui1References(source: string): string {
  const groupNames = new Set([...source.matchAll(/^\s*group\s+([\w]+)/gm)].map(match => match[1]!));
  const enumNames = new Set(["clockwise", "counterclockwise", "left", "right"]);
  return source
    .replace(/@([A-Za-z_][A-Za-z_0-9]*)/g, (token, name: string) =>
      enumNames.has(name) || groupNames.has(name) ? token : name
    )
    .replace(/\b(direction|side):\s*(clockwise|counterclockwise|left|right)\b/g, (_token, key: string, value: string) => `${key}: @${value}`);
}

function mirrorCopyNames(source: string): { pureNames: Set<string>; previewNames: Set<string>; removedNames: Set<string> } {
  const pureNames = new Set<string>();
  const previewNames = new Set<string>();
  const removedNames = new Set<string>();
  for (const line of source.split("\n")) {
    const pure = line.match(/^\s*const\s+([\w]+)\s*:\s*path\s*=\s*mirrorCopy\s*\(/);
    const preview = line.match(/^\s*line\s+([\w]+)\s*=\s*mirrorCopy\s*\(/);
    if (pure?.[1]) {
      pureNames.add(pure[1]);
      removedNames.add(pure[1]);
    }
    if (preview?.[1]) previewNames.add(preview[1]);
  }
  const mirrorNames = new Set([...pureNames, ...previewNames]);
  for (const line of source.split("\n")) {
    if (/^\s*\/\//.test(line) || /^\s*const\s+[\w]+\s*:\s*path\s*=\s*mirrorCopy\s*\(/.test(line)) continue;
    const preview = line.match(/^\s*line\s+([\w]+)\s*=\s*mirrorCopy\s*\(/)?.[1];
    const referencesOtherMirror = [...mirrorNames].some(name => name !== preview && new RegExp(`\\b${name}\\b`).test(line));
    if (referencesOtherMirror && preview) removedNames.add(preview);
    else if (referencesOtherMirror) {
      const declaration = line.match(/^\s*(?:const|point|line|curve|arc)\s+([\w]+)(?:\s*:\s*[^=]+)?\s*=/)?.[1];
      if (declaration) removedNames.add(declaration);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of source.split("\n")) {
      if (/^\s*\/\//.test(line) || /^\s*const\s+[\w]+\s*:\s*path\s*=\s*mirrorCopy\s*\(/.test(line)) continue;
      const preview = line.match(/^\s*line\s+([\w]+)\s*=\s*mirrorCopy\s*\(/)?.[1];
      const referencesRemoved = [...removedNames].some(name => name !== preview && new RegExp(`\\b${name}\\b`).test(line));
      if (!referencesRemoved) continue;
      const declaration = preview ?? line.match(/^\s*(?:const|point|line|curve|arc)\s+([\w]+)(?:\s*:\s*[^=]+)?\s*=/)?.[1];
      if (declaration && !removedNames.has(declaration)) {
        removedNames.add(declaration);
        changed = true;
      }
    }
  }
  return { pureNames, previewNames, removedNames };
}

function sourceForNonMirrorControls(source: string): string {
  const { removedNames } = mirrorCopyNames(source);
  return source.split("\n").filter(line => {
    if (/^\s*\/\//.test(line)) return true;
    if (/^\s*const\s+[\w]+\s*:\s*path\s*=\s*mirrorCopy\s*\(/.test(line)) return false;
    const previewDeclaration = line.match(/^\s*line\s+([\w]+)\s*=\s*mirrorCopy\s*\(/);
    if (previewDeclaration) return !removedNames.has(previewDeclaration[1]!);
    return ![...removedNames].some(name => new RegExp(`\\b${name}\\b`).test(line));
  }).join("\n");
}

function expectLegacyMirrorDiagnostics(source: string, compiled: ReturnType<typeof compileCanonicalText>): void {
  const { pureNames, previewNames } = mirrorCopyNames(source);
  const previewReferences = source.split("\n").filter(line => {
    const owner = line.match(/^\s*line\s+([\w]+)\s*=\s*mirrorCopy\s*\(/)?.[1];
    return [...previewNames].some(name => name !== owner && new RegExp(`\\b${name}\\b`).test(line));
  });
  if (pureNames.size === 0 && previewReferences.length === 0) return;

  expect(compiled.status).toBe("fatal");
  const diagnostics = compiled.diagnostics as Array<{
    code?: string;
    message?: string;
    physicalSpan?: { segments?: Array<{ from: number; to: number }> };
  }>;
  const pureDiagnostics = diagnostics.filter(diagnostic =>
    diagnostic.code === "geometry-value-unsupported-construction" && diagnostic.message?.includes("mirrorCopy")
  );
  expect(pureDiagnostics.length).toBeGreaterThanOrEqual(pureNames.size);
  for (const diagnostic of pureDiagnostics) {
    expect(diagnostic.physicalSpan?.segments?.some(segment => segment.to > segment.from)).toBe(true);
  }
  if (previewReferences.length > 0) {
    const previewDiagnostics = diagnostics.filter(diagnostic =>
      diagnostic.code === "mirror-copy-preview-not-referenceable" && diagnostic.message?.includes("mirrorCopy")
    );
    expect(previewDiagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of previewDiagnostics) {
      expect(diagnostic.physicalSpan?.segments?.some(segment => segment.to > segment.from)).toBe(true);
    }
  }
}

describe("#1497 sealed affine-copy mathematical conformance", () => {
  it.each(units)("$id compiler/legal production/reference oracle", async unit => {
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const failures: string[] = [];
    const priorIds = new Map<string, string>();
    for (const checkpoint of [unit, ...(unit.edit ? [{ ...unit, ...unit.edit }] : [])]) {
      const source = readFileSync(`test/fixtures/issue-1497/${checkpoint.file}`, "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      // The sealed #1497 cases predate Issue #1697's bare-name geometry
      // references. Keep the files and hashes untouched, then project their
      // old reference spelling into the current nui1 form for evaluation.
      const currentSyntaxSource = canonicalNui1References(source);
      const authoredSource = canonicalRegressionSource(currentSyntaxSource);
      const authoredCompiled = compileCanonicalText(current, authoredSource);
      expectLegacyMirrorDiagnostics(currentSyntaxSource, authoredCompiled);
      const controlSource = sourceForNonMirrorControls(currentSyntaxSource);
      const compiled = controlSource === currentSyntaxSource
        ? authoredCompiled
        : compileCanonicalText(current, canonicalRegressionSource(controlSource));
      observations.push({
        id: unit.id,
        file: checkpoint.file,
        phase: "compile",
        diagnostics: authoredCompiled.diagnostics,
        evaluatedSourceHasMirrorOnlyRemovals: controlSource !== currentSyntaxSource
      });
      expect(compiled.status, JSON.stringify({ file: checkpoint.file, controlSource, diagnostics: compiled.diagnostics })).not.toBe("fatal");
      expect(compiled.diagnostics).toEqual([]);
      current = compiled;
      if (validateOnly) continue;
      const options = buildEvaluationOptions({ compiledDocument: compiled.doc });
      const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
      expect(prepared.rustEligible).toBe(true);
      requests++;
      const payloads = [
        ["Rust", await bounded(rust.request(prepared.input)) as EvaluationPayload],
        ["TS", evaluateElementsReferencePayload(compiled.doc.document.elements, options)]
      ] as const;
      const statements = new Map(compiled.doc.statements.map((s, i) => [compiled.doc.statementMap.statementIdByStatementIndex.get(i), s.name]));
      for (const [host, payload] of payloads) {
        const result = evaluationPayloadToResult(payload);
        const record: Record<string, unknown> = { id: unit.id, file: checkpoint.file, host, payload };
        observations.push(record);
        const byName: Record<string, unknown> = {};
        const ids = new Map<string, string>();
        for (const g of result.computedGeometry.values()) {
          const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(g.elementId);
          const name = [...(origin?.instancePath ?? []).map(id => statements.get(id)), g.name].join("::");
          byName[name] = g; ids.set(name, g.elementId);
        }
        const pureByName = new Map<string, unknown>();
        const pureErrorByName = new Map<string, string>();
        const mirrorPreviewsByName = new Map<string, MirrorCopyPreview>();
        const {
          pureNames: mirrorPureNames,
          previewNames: mirrorPreviewNames,
          removedNames: mirrorRemovedNames
        } = mirrorCopyNames(source);
        for (const entry of result.computedGeometryValues?.values() ?? []) {
          const name = [...entry.occurrence.instancePath.map(id => statements.get(id)), statements.get(entry.occurrence.sourceStatementId)].join("::");
          pureByName.set(name, entry.value);
          byName[name] = entry.value;
        }
        for (const error of result.geometryValueErrors ?? []) {
          const name = [...error.occurrence.instancePath.map(id => statements.get(id)), statements.get(error.occurrence.sourceStatementId)].join("::");
          pureErrorByName.set(name, error.message);
        }
        for (const [elementId, preview] of result.mirrorCopyPreviews ?? []) {
          const owner = compiled.doc.document.elements.find(element => element.id === elementId);
          if (owner) mirrorPreviewsByName.set(owner.name, preview);
        }
        try {
          expect(result.errors).toHaveLength(Object.keys(checkpoint.errors ?? {}).length);
          for (const [name, message] of Object.entries(checkpoint.errors ?? {})) {
            const element = compiled.doc.document.elements.find(e => e.name === name)!;
            expect(result.errors.find(e => e.elementId === element.id)?.message).toContain(message);
            expect(byName[name]).toBeUndefined();
          }
          const expectedPureRuntimeErrors = Object.entries(checkpoint.pureErrors ?? {})
            .filter(([name]) => !mirrorPureNames.has(name));
          expect(result.geometryValueErrors ?? []).toHaveLength(expectedPureRuntimeErrors.length);
          for (const [name, message] of expectedPureRuntimeErrors) {
            expect(pureErrorByName.get(name)).toContain(message);
            expect(pureByName.has(name)).toBe(false);
          }
          expect(result.warnings).toEqual([]);
          compare(byName.Control, { start: { x: 201, y: -103 }, end: { x: 238, y: -103 }, length: 37 }, "unaffected sibling");
          for (const [name, expected] of Object.entries(checkpoint.expected)) {
            if (mirrorPureNames.has(name)) {
              expect(byName[name], `${host}.${name} is not drawable`).toBeUndefined();
              expect(pureByName.has(name), `${host}.${name} is not a path value`).toBe(false);
              expect(mirrorPreviewsByName.has(name), `${host}.${name} has no preview owner`).toBe(false);
              continue;
            }
            const preview = mirrorPreviewsByName.get(name);
            if (preview) {
              const owner = compiled.doc.document.elements.find(element => element.name === name && element.type === "symmetricCopyLine");
              expect(owner, `${host}.${name} retains its authored preview owner`).toBeDefined();
              expect(result.computedGeometry.has(owner!.id), `${host}.${name} is not computed geometry`).toBe(false);
              expect(byName[name], `${host}.${name} is not a named geometry`).toBeUndefined();
              expect(ids.has(name), `${host}.${name} has no drawable identity`).toBe(false);
              const sourceIds = (owner as unknown as { baseLineIds?: string[] }).baseLineIds ?? [];
              const expectedGeometry = expected as { segments?: unknown[]; lengthTolerance?: number };
              const oracleSegments = expectedGeometry.segments ?? [];
              const previewTolerance = expectedGeometry.lengthTolerance ?? manifest.coordinateTolerance;
              expect(preview.groups).toHaveLength(sourceIds.length);
              let oracleOffset = 0;
              preview.groups.forEach((group, groupIndex) => {
                const sourceId = sourceIds[groupIndex]!;
                expect(group.sourceElementId).toBe(sourceId);
                const sourceGeometry = result.computedGeometry.get(sourceId) as { kind?: string; segments?: unknown[] } | undefined;
                const sourceSegmentCount = sourceGeometry?.segments?.length ??
                  (sourceGeometry && ["line", "arc", "arcLine"].includes(sourceGeometry.kind ?? "") ? 1 : undefined);
                expect(sourceSegmentCount).toBeDefined();
                expect(sourceSegmentCount!).toBeGreaterThan(0);
                expect(group.segments).toHaveLength(sourceSegmentCount);
                compare(
                  group.segments,
                  oracleSegments.slice(oracleOffset, oracleOffset + sourceSegmentCount!),
                  `${host}.${name}.groups[${groupIndex}]`,
                  previewTolerance
                );
                identityFree(group);
                oracleOffset += sourceSegmentCount!;
              });
              expect(oracleOffset).toBe(oracleSegments.length);
              continue;
            }
            if (mirrorRemovedNames.has(name) || mirrorPreviewNames.has(name)) {
              expect(byName[name], `${host}.${name} has no geometry fallback`).toBeUndefined();
              expect(pureByName.has(name), `${host}.${name} has no path fallback`).toBe(false);
              continue;
            }
            compare(byName[name], expected, `${host}.${name}`);
          }
          for (const [name, expected] of Object.entries(checkpoint.unchanged ?? {})) compare(byName[name], expected, `${host}.original.${name}`);
          for (const name of [...(checkpoint.pure ?? []), ...Object.keys(checkpoint.pureErrors ?? {})]) {
            if (mirrorPureNames.has(name)) {
              expect(pureByName.has(name), `${host}.${name} is rejected as a path value`).toBe(false);
              continue;
            }
            if (checkpoint.pureErrors?.[name]) continue;
            expect(pureByName.has(name), name).toBe(true);
            expect(ids.has(name), name + " must not allocate drawable identity").toBe(false);
          }
          for (const value of pureByName.values()) identityFree(value);
          if (unit.id === "V2") {
            expect(ids.get("First::Copy")).not.toBe(ids.get("Second::Copy"));
            expect(ids.get("First::Copy")).toBeTruthy(); expect(ids.get("Second::Copy")).toBeTruthy();
          }
          for (const [name, value] of Object.entries(checkpoint.expected)) {
            if (mirrorPreviewNames.has(name) || mirrorRemovedNames.has(name)) continue;
            if (!value || typeof value !== "object" || !("segments" in value)) continue;
            const geometry = byName[name] as { length: number; segments: { kind: string; start: { x: number; y: number }; end: { x: number; y: number }; length: number }[] };
            expect(Number.isFinite(geometry.length) && geometry.length >= 0).toBe(true);
            compare(geometry.length, geometry.segments.reduce((sum, s) => sum + s.length, 0), "sum.length");
            geometry.segments.forEach((s, i) => {
              expect(Number.isFinite(s.length) && s.length > 0).toBe(true);
              if (i) compare(s.start, { x: geometry.segments[i - 1].end.x, y: geometry.segments[i - 1].end.y }, name + " authored continuity");
            });
          }
          // Same compiler document through invalid -> valid revisions keeps sibling identity.
          if (priorIds.has(host)) expect(ids.get("Control")).toBe(priorIds.get(host));
          priorIds.set(host, ids.get("Control")!);
          record.status = "PASS";
        } catch (error) { record.status = "FAIL"; record.failure = String(error); failures.push(`${host} ${checkpoint.file}: ${String(error)}`); }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});
