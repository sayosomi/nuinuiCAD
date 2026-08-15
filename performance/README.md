# Benchmark comparison foundation

This directory contains the shared, host-neutral benchmark contract for comparing
the Tauri application with a future VS Code host. It defines the protocol,
scenario and metric names, result schema, statistics, comparison behavior, and
fixed `.nui` workloads. It does not contain production timing instrumentation,
a baseline runner, or host-specific benchmark code.

## Official protocol

Each scenario uses 5 warm-up runs followed by 21 measured trials. Raw samples
are milliseconds. The result stores nearest-rank `p50`, `p95`, and `max` values;
for `n` samples, percentile rank is `ceil(n * percentile)` and the zero-based
sample index is `rank - 1`.

All samples must be finite and nonnegative. Warm-up samples are never persisted
to a result file.

## Frame completion

The end of every `*ToFrameMs` metric is not a physical display paint. It is the
first `requestAnimationFrame` callback scheduled after the production Canvas
draw corresponding to the measured mutation has completed. A stale evaluation
result must not close a sample.

## Scenarios

`source-edit-v1` starts from the settled fixture state and changes the
`benchOffset` literal from `6` to `7`. The fixture must be settled before the
timed action begins.

`point-drag-v1` uses `Benchmark::DragPoint`. Pointerdown and drag setup are
outside the timing window. The timed action is one pointermove with a delta of
`(12, 8)` CSS pixels; pointerup and reset are outside the timing window.

`bezier-handle-drag-v1` uses the `start` handle of `Benchmark::DragCurve`. The
timed action is one pointermove with a delta of `(12, -8)` CSS pixels. Setup,
pointerup, and reset are outside the timing window.

Every warm-up and trial follows this lifecycle:

```text
exact fixture initial state → settle → one deterministic action
→ matching action frame completion → sample → reset
```

## Fixtures and versioning

The files in `fixtures/` are dedicated benchmark workloads and are not part of
the existing DSL fixture directory. The medium workload runs its four generated
geometry declarations 50 times; the large workload runs them 250 times.

`fixtures/manifest.json` records the exact UTF-8 SHA-256 hash and benchmark
anchors for each workload. If fixture content or workload changes, create a new
fixture ID such as `interactive-medium-v2`; do not update only the hash while
keeping the old ID.

The manifest describes stable benchmark inputs. Result validation intentionally
does not restrict `fixture.id` to this manifest so future results can describe
an arbitrary `.nui` file.

## Result comparison

Comparison requires identical schema version, fixture ID and hash, protocol,
machine description, render surface, scenario IDs, and metric IDs. Target,
capture time, build metadata, and webview user agent are host-specific and are
not compatibility keys. The comparison reports baseline and candidate `p50`,
`p95`, and `max`, plus candidate/baseline `p95` ratio. It does not apply a
performance threshold or emit a PASS/FAIL decision. If baseline `p95` is zero,
the ratio is `n/a`.
