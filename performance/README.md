# Benchmark comparison foundation

This directory contains the shared, host-neutral benchmark contract for the
production VS Code capture path and compatible benchmark results. It defines
the protocol, scenario and metric names, result schema, statistics, comparison
behavior, and fixed `.nui` workloads. Passive production timing instrumentation,
sample correlation, raw timing capture, the host-neutral protocol runner, and
VS Code capture orchestration live in `src/performance/`. The Node launcher and
result file IO live in `scripts/performance/`.

## VS Code capture

Run a local VS Code capture with a fixture from the current manifest:

```text
npm run bench:capture:vscode -- \
  --fixture <fixture-id> \
  --output <result.json>
```

An optional prior result can be supplied with `--baseline <result.json>`. A
capture does not require a prior result. When supplied, the baseline may target
either `vscode` or the explicitly historical `tauri` result target; it is only
a same-machine, coherent-render-surface comparability guard and is not fixture
authority or mandatory Tauri provenance. Fixture ID and hash authority
come from the current manifest and capture input.

Available fixture IDs are `interactive-medium-v1`, `interactive-large-v1`,
`dependency-chain-250-v1`, and `dependency-chain-1000-v1`. Each capture runs
5 warm-ups and 21 measured trials for `source-edit-v1`, `point-drag-v1`, and
`bezier-handle-drag-v1`. The source edit changes `benchOffset` from `6` to
`7`; the drag scenarios use one production DOM pointermove with their
manifest-defined CSS-pixel deltas.

The VS Code capture builds/uses the VS Code extension and the persistent
Extension Host / Node stdio path into `rust-evaluator`'s `evaluation_stdio`
binary. Keep the benchmark window at a fixed size and device-pixel ratio for
the complete run; within-run render-surface or DPR changes fail the capture.
The output JSON is hardware- and environment-specific, so baseline result files
are not automatically committed to the repository.

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
geometry declarations 50 times; the large workload runs them 250 times. The
dependency-chain workloads run one loop iteration containing an explicit,
source-ordered chain of 250 or 1000 cheap offset-point declarations. The first
point depends on `benchOffset`, `Benchmark::DragPoint`, and
`Benchmark::DragCurve.length`; each later point depends on its immediate
predecessor.

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
