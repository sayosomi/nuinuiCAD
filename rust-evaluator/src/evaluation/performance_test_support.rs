use std::time::Instant;

use serde_json::json;

use super::EvaluationPayload;

pub(crate) const WARM_UP_RUNS: usize = 5;
pub(crate) const TRIALS: usize = 21;

pub(crate) struct TimingStats {
    pub(crate) median_ms: f64,
    pub(crate) p95_ms: f64,
}

pub(crate) struct FixtureMeasurement<'a> {
    pub(crate) statement_count: usize,
    pub(crate) binding_count: usize,
    pub(crate) geometry_statement_count: usize,
    pub(crate) result: &'a EvaluationPayload,
    pub(crate) stats: &'a TimingStats,
}

pub(crate) fn timing_stats(samples: &mut [f64]) -> TimingStats {
    samples.sort_by(f64::total_cmp);
    TimingStats {
        median_ms: samples[samples.len() / 2],
        p95_ms: samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)],
    }
}

pub(crate) fn measure_wall_time(
    mut run: impl FnMut() -> EvaluationPayload,
) -> (EvaluationPayload, TimingStats) {
    let correctness = run();
    for _ in 0..WARM_UP_RUNS {
        let _ = run();
    }

    let mut samples = Vec::with_capacity(TRIALS);
    for _ in 0..TRIALS {
        let started = Instant::now();
        let _ = run();
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    (correctness, timing_stats(&mut samples))
}

pub(crate) fn log_measurement(
    area: &str,
    small: FixtureMeasurement<'_>,
    large: FixtureMeasurement<'_>,
) -> f64 {
    let scaling_ratio = large.stats.median_ms / small.stats.median_ms.max(f64::EPSILON);
    eprintln!(
        "[typedVariables baseline] {}",
        json!({
            "area": area,
            "metric": "wallTimeMs",
            "warmUpRuns": WARM_UP_RUNS,
            "trials": TRIALS,
            "runsPerTrial": 1,
            "small": {
                "statementCount": small.statement_count,
                "bindingCount": small.binding_count,
                "geometryStatementCount": small.geometry_statement_count,
                "computedGeometryCount": small.result.computed_geometry.len(),
                "generatedRowCount": small.result.for_group_generated_rows.len(),
                "medianMs": small.stats.median_ms,
                "p95Ms": small.stats.p95_ms,
            },
            "large": {
                "statementCount": large.statement_count,
                "bindingCount": large.binding_count,
                "geometryStatementCount": large.geometry_statement_count,
                "computedGeometryCount": large.result.computed_geometry.len(),
                "generatedRowCount": large.result.for_group_generated_rows.len(),
                "medianMs": large.stats.median_ms,
                "p95Ms": large.stats.p95_ms,
            },
            "scalingRatio": scaling_ratio,
        })
    );
    assert!(small.stats.median_ms.is_finite() && small.stats.p95_ms.is_finite());
    assert!(large.stats.median_ms.is_finite() && large.stats.p95_ms.is_finite());
    assert!(scaling_ratio.is_finite());
    scaling_ratio
}

pub(crate) fn assert_large_case_under_five_seconds(stats: &TimingStats) {
    assert!(stats.median_ms < 5_000.0);
    assert!(stats.p95_ms < 5_000.0);
}
