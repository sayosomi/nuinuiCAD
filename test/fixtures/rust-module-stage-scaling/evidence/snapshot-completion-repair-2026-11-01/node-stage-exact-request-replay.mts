import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { RustEvaluationProcess } from "../../../../../src/node/rustEvaluationProcess.ts";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../../../src/geometry/evaluationPayload.ts";

const requestDir = process.env.ISSUE1519_STAGE_MATRIX_DIR!;
const binaryPath = resolve(process.env.ISSUE1519_RUST_STDIO_BINARY!);
const outputPath = resolve(process.env.ISSUE1519_NODE_REPLAY_OUTPUT!);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const variance = samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / (samples.length - 1);
  const sd = Math.sqrt(variance);
  return {
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1)!, minMs: sorted[0],
    rangeMs: sorted.at(-1)! - sorted[0], sampleStandardDeviationMs: sd,
    coefficientOfVariationPercent: mean === 0 ? 0 : sd / mean * 100
  };
};
const measureSync = <T>(fn: () => T) => {
  const warmupSamplesMs: number[] = [];
  for (let i = 0; i < 5; i++) { const start = process.hrtime.bigint(); fn(); warmupSamplesMs.push(Number(process.hrtime.bigint() - start) / 1e6); }
  const rawSamplesMs: number[] = [];
  let last!: T;
  for (let i = 0; i < 21; i++) { const start = process.hrtime.bigint(); last = fn(); rawSamplesMs.push(Number(process.hrtime.bigint() - start) / 1e6); }
  return { warmupSamplesMs, rawSamplesMs, summary: summarize(rawSamplesMs), last };
};
const measureAsync = async <T>(fn: () => Promise<T>) => {
  const warmupSamplesMs: number[] = [];
  for (let i = 0; i < 5; i++) { const start = process.hrtime.bigint(); await fn(); warmupSamplesMs.push(Number(process.hrtime.bigint() - start) / 1e6); }
  const rawSamplesMs: number[] = [];
  let last!: T;
  for (let i = 0; i < 21; i++) { const start = process.hrtime.bigint(); last = await fn(); rawSamplesMs.push(Number(process.hrtime.bigint() - start) / 1e6); }
  return { warmupSamplesMs, rawSamplesMs, summary: summarize(rawSamplesMs), last };
};
const within = async <T>(operation: Promise<T>, timeoutMs = 20000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1519 replay request exceeded 20 seconds")); }, timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
};
let rust: RustEvaluationProcess | undefined;
let rustClosed: Promise<void> | undefined;
let requestCount = 0;
const output: unknown[] = [];

try {
  rust = new RustEvaluationProcess(binaryPath, {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args) as ChildProcessWithoutNullStreams;
      rustClosed = new Promise<void>(resolveClosed => {
        child.once("close", () => resolveClosed());
        child.once("error", () => resolveClosed());
      });
      return child;
    }) as typeof spawn
  });
  for (const caseId of ["S-A", "S-B", "S-C", "M-A", "M-B", "M-C", "L-A", "L-B", "L-C"]) {
    const requestLine = readFileSync(join(requestDir, `${caseId}.request.json`), "utf8");
    const responseLine = readFileSync(join(requestDir, `${caseId}.response.json`), "utf8");
    const metadata = JSON.parse(readFileSync(join(requestDir, `${caseId}.case-metadata.json`), "utf8"));
    const frozenRequest = JSON.parse(requestLine) as { id: number; input: unknown };
    const frozenResponse = JSON.parse(responseLine) as { id: number; payload: EvaluationPayload };
    assert.equal(sha256(JSON.stringify(frozenRequest.input)), metadata.inputSha256, `${caseId} frozen input identity`);
    assert.equal(sha256(requestLine), metadata.productionRequestSha256, `${caseId} frozen request identity`);
    assert.equal(JSON.stringify({ id: frozenRequest.id, input: frozenRequest.input }), requestLine, `${caseId} stage 4 bytes`);

    const stringify = measureSync(() => JSON.stringify({ id: frozenRequest.id, input: frozenRequest.input }));
    assert.equal(stringify.last, requestLine);
    const parse = measureSync(() => JSON.parse(responseLine));
    assert.deepEqual(parse.last, frozenResponse);
    let latestPayload: EvaluationPayload = frozenResponse.payload;
    const request = await measureAsync(async () => {
      requestCount++;
      const payload = await within(rust!.request(frozenRequest.input)) as EvaluationPayload;
      assert.deepEqual(payload, frozenResponse.payload, `${caseId} exact Rust response payload`);
      assert.equal(payload.computedGeometry.length, metadata.runtimeDrawableCount, `${caseId} drawable count`);
      assert.deepEqual(payload.errors, [], `${caseId} dependency errors`);
      assert.deepEqual(payload.warnings, [], `${caseId} warnings`);
      latestPayload = payload;
      return payload;
    });
    const conversion = measureSync(() => evaluationPayloadToResult(latestPayload));
    assert.equal(conversion.last.computedGeometry.size, metadata.runtimeDrawableCount);
    assert.deepEqual(conversion.last.errors, []);
    assert.deepEqual(conversion.last.warnings, []);
    const record = {
      case: caseId,
      sourceSha256: metadata.sourceSha256,
      inputSha256: metadata.inputSha256,
      originalProductionRequestSha256: metadata.productionRequestSha256,
      originalProductionRequestBytes: Buffer.byteLength(requestLine),
      originalRequestId: frozenRequest.id,
      fixedReleaseBinarySha256: sha256(readFileSync(binaryPath)),
      warmupsPerStage: 5,
      measuredRepetitionsPerStage: 21,
      nodeJsonStringifyRequest: { warmupSamplesMs: stringify.warmupSamplesMs, rawSamplesMs: stringify.rawSamplesMs, summary: stringify.summary },
      persistentRustStdioRequestResponse: { warmupSamplesMs: request.warmupSamplesMs, rawSamplesMs: request.rawSamplesMs, summary: request.summary, exactFrozenInputReused: true, responsePayloadMatchesFrozenBase: true },
      nodeJsonParseResponse: { warmupSamplesMs: parse.warmupSamplesMs, rawSamplesMs: parse.rawSamplesMs, summary: parse.summary },
      nodePayloadConversion: { warmupSamplesMs: conversion.warmupSamplesMs, rawSamplesMs: conversion.rawSamplesMs, summary: conversion.summary },
      requestIdsInTimedPersistentProcessAreProcessGenerated: true
    };
    output.push(record);
    console.log(`ISSUE1519_NODE_EXACT_REQUEST_REPLAY ${JSON.stringify(record)}`);
  }
  assert.equal(requestCount, 234);
} finally {
  rust?.dispose();
  if (rustClosed) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([rustClosed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("#1519 replay Rust stdio did not close after dispose")), 5000); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}
