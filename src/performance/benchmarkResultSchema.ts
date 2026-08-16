import {
  BENCHMARK_SCENARIO_IDS,
  BENCHMARK_SCHEMA_VERSION,
  REQUIRED_METRICS_BY_SCENARIO,
  type BenchmarkScenarioId
} from "./benchmarkContract";
import {
  calculateBenchmarkStatistics,
  type BenchmarkStatistics
} from "./benchmarkStatistics";

export type BenchmarkTarget = "tauri" | "vscode";

export type BenchmarkMachine = {
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  logicalCpuCount: number;
};

export type BenchmarkRenderSurface = {
  cssWidthPx: number;
  cssHeightPx: number;
  backingWidthPx: number;
  backingHeightPx: number;
  devicePixelRatio: number;
};

export type BenchmarkResult = {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  target: BenchmarkTarget;
  capturedAt: string;
  build: {
    gitCommit: string;
    appVersion: string;
  };
  environment: {
    machine: BenchmarkMachine;
    webviewUserAgent: string;
    renderSurface: BenchmarkRenderSurface;
  };
  fixture: {
    id: string;
    hash: string;
  };
  protocol: {
    warmupRuns: number;
    trials: number;
  };
  scenarios: Record<string, {
    metrics: Record<string, BenchmarkStatistics>;
  }>;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isFiniteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isValidIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
};

const addError = (errors: string[], path: string, message: string): void => {
  errors.push(`${path}: ${message}`);
};

const validateMachine = (value: unknown, errors: string[], path: string): void => {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }
  for (const field of ["platform", "arch", "osRelease", "cpuModel"] as const) {
    if (!isNonEmptyString(value[field])) {
      addError(errors, `${path}.${field}`, "must be a non-empty string");
    }
  }
  if (!isPositiveFinite(value.logicalCpuCount) || !Number.isInteger(value.logicalCpuCount)) {
    addError(errors, `${path}.logicalCpuCount`, "must be a positive integer");
  }
};

const validateRenderSurface = (value: unknown, errors: string[], path: string): void => {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }
  for (const field of [
    "cssWidthPx",
    "cssHeightPx",
    "backingWidthPx",
    "backingHeightPx",
    "devicePixelRatio"
  ] as const) {
    if (!isPositiveFinite(value[field])) {
      addError(errors, `${path}.${field}`, "must be finite and positive");
    }
  }
};

const validateMetric = (
  value: unknown,
  trials: number | null,
  errors: string[],
  path: string
): void => {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  const samples = value.samples;
  if (!Array.isArray(samples)) {
    addError(errors, `${path}.samples`, "must be an array");
    return;
  }
  if (trials !== null && samples.length !== trials) {
    addError(errors, `${path}.samples`, `must contain exactly ${trials} samples`);
  }
  if (!samples.every(isFiniteNonnegative)) {
    addError(errors, `${path}.samples`, "must contain only finite, nonnegative numbers");
    return;
  }
  if (samples.length === 0) {
    addError(errors, `${path}.samples`, "must not be empty");
    return;
  }

  for (const field of ["p50", "p95", "max"] as const) {
    if (!isFiniteNonnegative(value[field])) {
      addError(errors, `${path}.${field}`, "must be finite and nonnegative");
    }
  }

  if (
    isFiniteNonnegative(value.p50) &&
    isFiniteNonnegative(value.p95) &&
    isFiniteNonnegative(value.max)
  ) {
    const expected = calculateBenchmarkStatistics(samples);
    if (value.p50 !== expected.p50) addError(errors, `${path}.p50`, "does not match samples");
    if (value.p95 !== expected.p95) addError(errors, `${path}.p95`, "does not match samples");
    if (value.max !== expected.max) addError(errors, `${path}.max`, "does not match samples");
  }
};

export const validateBenchmarkResult = (value: unknown): string[] => {
  const errors: string[] = [];
  if (!isRecord(value)) return ["result: must be an object"];

  if (value.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    addError(errors, "schemaVersion", `must equal ${BENCHMARK_SCHEMA_VERSION}`);
  }
  if (value.target !== "tauri" && value.target !== "vscode") {
    addError(errors, "target", "must be tauri or vscode");
  }
  if (!isValidIsoTimestamp(value.capturedAt)) {
    addError(errors, "capturedAt", "must be a valid ISO timestamp");
  }

  if (!isRecord(value.build)) {
    addError(errors, "build", "must be an object");
  } else {
    if (!/^[0-9a-f]{40}$/i.test(String(value.build.gitCommit))) {
      addError(errors, "build.gitCommit", "must be a 40-character hexadecimal commit");
    }
    if (!isNonEmptyString(value.build.appVersion)) {
      addError(errors, "build.appVersion", "must be a non-empty string");
    }
  }

  if (!isRecord(value.environment)) {
    addError(errors, "environment", "must be an object");
  } else {
    validateMachine(value.environment.machine, errors, "environment.machine");
    if (!isNonEmptyString(value.environment.webviewUserAgent)) {
      addError(errors, "environment.webviewUserAgent", "must be a non-empty string");
    }
    validateRenderSurface(value.environment.renderSurface, errors, "environment.renderSurface");
  }

  if (!isRecord(value.fixture)) {
    addError(errors, "fixture", "must be an object");
  } else {
    if (!isNonEmptyString(value.fixture.id)) addError(errors, "fixture.id", "must be a non-empty string");
    if (!/^sha256:[0-9a-f]{64}$/.test(String(value.fixture.hash))) {
      addError(errors, "fixture.hash", "must use sha256:<64 lowercase hex>");
    }
  }

  let trials: number | null = null;
  if (!isRecord(value.protocol)) {
    addError(errors, "protocol", "must be an object");
  } else {
    if (!Number.isInteger(value.protocol.warmupRuns) || !isFiniteNonnegative(value.protocol.warmupRuns)) {
      addError(errors, "protocol.warmupRuns", "must be a nonnegative integer");
    }
    if (!Number.isInteger(value.protocol.trials) || !isPositiveFinite(value.protocol.trials)) {
      addError(errors, "protocol.trials", "must be a positive integer");
    } else {
      trials = value.protocol.trials;
    }
  }

  if (!isRecord(value.scenarios)) {
    addError(errors, "scenarios", "must be an object");
  } else {
    for (const scenarioId of BENCHMARK_SCENARIO_IDS) {
      if (!(scenarioId in value.scenarios)) {
        addError(errors, `scenarios.${scenarioId}`, "required scenario is missing");
      }
    }
    for (const [scenarioId, scenarioValue] of Object.entries(value.scenarios)) {
      if (!isRecord(scenarioValue) || !isRecord(scenarioValue.metrics)) {
        addError(errors, `scenarios.${scenarioId}.metrics`, "must be an object");
        continue;
      }
      const requiredMetrics = REQUIRED_METRICS_BY_SCENARIO[scenarioId as BenchmarkScenarioId] ?? [];
      for (const metricId of requiredMetrics) {
        if (!(metricId in scenarioValue.metrics)) {
          addError(errors, `scenarios.${scenarioId}.metrics.${metricId}`, "required metric is missing");
        }
      }
      for (const [metricId, metricValue] of Object.entries(scenarioValue.metrics)) {
        validateMetric(metricValue, trials, errors, `scenarios.${scenarioId}.metrics.${metricId}`);
      }
    }
  }

  return errors;
};

export const assertBenchmarkResult: (value: unknown) => asserts value is BenchmarkResult = (value) => {
  const errors = validateBenchmarkResult(value);
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark result:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
};

export const parseBenchmarkResult = (value: unknown): BenchmarkResult => {
  assertBenchmarkResult(value);
  return value;
};

export const isBenchmarkResult = (value: unknown): value is BenchmarkResult =>
  validateBenchmarkResult(value).length === 0;
