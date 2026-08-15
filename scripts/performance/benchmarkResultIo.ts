import { readFileSync, writeFileSync } from "node:fs";
import {
  assertBenchmarkResult,
  parseBenchmarkResult,
  type BenchmarkResult
} from "../../src/performance/benchmarkResultSchema";

export const readBenchmarkResultFile = (path: string): BenchmarkResult => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read benchmark result ${path}: ${String(error)}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in benchmark result ${path}: ${String(error)}`, { cause: error });
  }

  try {
    return parseBenchmarkResult(parsed);
  } catch (error) {
    throw new Error(`Invalid benchmark result ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

export const writeBenchmarkResultFile = (path: string, result: BenchmarkResult): void => {
  try {
    assertBenchmarkResult(result);
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(`Unable to write benchmark result ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};
