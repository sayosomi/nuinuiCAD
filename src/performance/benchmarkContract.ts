export const BENCHMARK_SCHEMA_VERSION = 1 as const;

export const BENCHMARK_PROTOCOL = {
  warmupRuns: 5,
  trials: 21
} as const;

export const BENCHMARK_METRIC_IDS = [
  "compileMs",
  "rustRoundTripMs",
  "canvasDrawMs",
  "sourceChangeToFrameMs",
  "previewMutationToFrameMs",
  "pointerMoveToFrameMs"
] as const;

export type BenchmarkMetricId = (typeof BENCHMARK_METRIC_IDS)[number];

export const BENCHMARK_SCENARIO_IDS = [
  "source-edit-v1",
  "point-drag-v1",
  "bezier-handle-drag-v1"
] as const;

export type BenchmarkScenarioId = (typeof BENCHMARK_SCENARIO_IDS)[number];

export const REQUIRED_METRICS_BY_SCENARIO: Readonly<
  Record<BenchmarkScenarioId, readonly BenchmarkMetricId[]>
> = {
  "source-edit-v1": [
    "sourceChangeToFrameMs",
    "compileMs",
    "rustRoundTripMs",
    "canvasDrawMs"
  ],
  "point-drag-v1": [
    "pointerMoveToFrameMs",
    "previewMutationToFrameMs",
    "rustRoundTripMs",
    "canvasDrawMs"
  ],
  "bezier-handle-drag-v1": [
    "pointerMoveToFrameMs",
    "previewMutationToFrameMs",
    "rustRoundTripMs",
    "canvasDrawMs"
  ]
};
