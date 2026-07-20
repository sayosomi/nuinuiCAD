use std::time::Instant;

use serde_json::{json, Value};

use super::{
    activity::effective_activity_by_element_id, evaluate_document_input, EvaluationInput,
    EvaluationPayload,
};

const WARM_UP_RUNS: usize = 5;
const TRIALS: usize = 21;

struct TimingStats {
    median_ms: f64,
    p95_ms: f64,
}

struct FixtureMeasurement<'a> {
    statement_count: usize,
    binding_count: usize,
    geometry_statement_count: usize,
    result: &'a EvaluationPayload,
    stats: &'a TimingStats,
}

fn standard_elements(statement_count: usize) -> Vec<Value> {
    assert!(statement_count >= 2 && statement_count.is_multiple_of(2));

    let mut elements = Vec::with_capacity(statement_count);
    for index in 0..(statement_count / 2) {
        let variable_name = format!("V{index}");
        elements.push(json!({
            "id": variable_name,
            "name": variable_name,
            "type": "variable",
            "visible": true,
            "enabled": true,
            "scope": "global",
            "valueMode": "expression",
            "expression": (index + 1) as f64,
            "point1": { "mode": "coordinate", "x": 0, "y": 0 },
            "point2": { "mode": "coordinate", "x": 0, "y": 0 },
            "point": { "mode": "coordinate", "x": 0, "y": 0 },
            "lineId": ""
        }));
        elements.push(json!({
            "id": format!("P{index}"),
            "name": format!("P{index}"),
            "type": "freePoint",
            "visible": true,
            "enabled": true,
            "x": { "kind": "expression", "expression": format!("@V{index}") },
            "y": (index % 37) as f64
        }));
    }
    elements
}

fn for_group_elements(generated_row_count: usize) -> Vec<Value> {
    vec![
        json!({
            "id": "loop",
            "name": "Loop",
            "type": "forGroup",
            "visible": true,
            "enabled": true,
            "variableName": "i",
            "start": 0,
            "count": generated_row_count,
            "step": 1,
            "showGenerated": true
        }),
        json!({
            "id": "template",
            "name": "Repeated",
            "type": "freePoint",
            "parentGroupId": "loop",
            "visible": true,
            "enabled": true,
            "x": 1,
            "y": 0
        }),
    ]
}

fn activity_chain_elements(count: usize) -> Vec<Value> {
    (0..count)
        .map(|index| {
            let mut element = json!({
                "id": format!("group-{index}"),
                "name": format!("group-{index}"),
                "type": "group",
                "visible": index % 3 != 1,
                "enabled": index % 5 != 2,
            });
            if index > 0 {
                element["parentGroupId"] = Value::String(format!("group-{}", index - 1));
            }
            element
        })
        .collect()
}

fn timing_stats(samples: &mut [f64]) -> TimingStats {
    samples.sort_by(f64::total_cmp);
    TimingStats {
        median_ms: samples[samples.len() / 2],
        p95_ms: samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)],
    }
}

fn measure_wall_time(
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

fn log_measurement(area: &str, small: FixtureMeasurement<'_>, large: FixtureMeasurement<'_>) {
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
}

#[test]
#[ignore]
fn performance_typed_variable_production_evaluation_baseline() {
    let small_elements = standard_elements(250);
    let large_elements = standard_elements(1_000);
    let (small_result, small_stats) = measure_wall_time(|| {
        evaluate_document_input(EvaluationInput {
            elements: small_elements.clone(),
            evaluation_limit_index: None,
        })
    });
    let (large_result, large_stats) = measure_wall_time(|| {
        evaluate_document_input(EvaluationInput {
            elements: large_elements.clone(),
            evaluation_limit_index: None,
        })
    });

    assert!(small_result.errors.is_empty());
    assert!(large_result.errors.is_empty());
    assert_eq!(small_result.computed_variables.len(), 125);
    assert_eq!(large_result.computed_variables.len(), 500);
    assert_eq!(small_result.computed_geometry.len(), 125);
    assert_eq!(large_result.computed_geometry.len(), 500);
    log_measurement(
        "rustProductionEvaluation",
        FixtureMeasurement {
            statement_count: 250,
            binding_count: 125,
            geometry_statement_count: 125,
            result: &small_result,
            stats: &small_stats,
        },
        FixtureMeasurement {
            statement_count: 1_000,
            binding_count: 500,
            geometry_statement_count: 500,
            result: &large_result,
            stats: &large_stats,
        },
    );
}

#[test]
#[ignore]
fn performance_typed_variable_for_group_baseline() {
    let small_elements = for_group_elements(250);
    let large_elements = for_group_elements(1_000);
    let (small_result, small_stats) = measure_wall_time(|| {
        evaluate_document_input(EvaluationInput {
            elements: small_elements.clone(),
            evaluation_limit_index: None,
        })
    });
    let (large_result, large_stats) = measure_wall_time(|| {
        evaluate_document_input(EvaluationInput {
            elements: large_elements.clone(),
            evaluation_limit_index: None,
        })
    });

    assert!(small_result.errors.is_empty());
    assert!(large_result.errors.is_empty());
    assert_eq!(small_result.computed_geometry.len(), 250);
    assert_eq!(large_result.computed_geometry.len(), 1_000);
    assert_eq!(small_result.for_group_generated_rows.len(), 250);
    assert_eq!(large_result.for_group_generated_rows.len(), 1_000);
    log_measurement(
        "rustForGroupMutation",
        FixtureMeasurement {
            statement_count: 3,
            binding_count: 0,
            geometry_statement_count: 1,
            result: &small_result,
            stats: &small_stats,
        },
        FixtureMeasurement {
            statement_count: 3,
            binding_count: 0,
            geometry_statement_count: 1,
            result: &large_result,
            stats: &large_stats,
        },
    );
}

#[test]
#[ignore]
fn performance_element_activity_composition_baseline() {
    let measure = |elements: Vec<Value>| {
        for _ in 0..WARM_UP_RUNS {
            let _ = effective_activity_by_element_id(&elements);
        }
        let mut samples = Vec::with_capacity(TRIALS);
        for _ in 0..TRIALS {
            let started = Instant::now();
            let resolved = effective_activity_by_element_id(&elements);
            samples.push(started.elapsed().as_secs_f64() * 1_000.0);
            assert_eq!(resolved.len(), elements.len());
        }
        timing_stats(&mut samples)
    };
    let small = measure(activity_chain_elements(250));
    let large = measure(activity_chain_elements(1_000));
    let scaling_ratio = large.median_ms / small.median_ms.max(f64::EPSILON);
    eprintln!(
        "[typedVariables baseline] {}",
        json!({
            "area": "rustElementActivityComposition",
            "metric": "wallTimeMs",
            "warmUpRuns": WARM_UP_RUNS,
            "trials": TRIALS,
            "runsPerTrial": 1,
            "small": { "statementCount": 250, "medianMs": small.median_ms, "p95Ms": small.p95_ms },
            "large": { "statementCount": 1_000, "medianMs": large.median_ms, "p95Ms": large.p95_ms },
            "scalingRatio": scaling_ratio,
        })
    );
    assert!(small.median_ms.is_finite() && small.p95_ms.is_finite());
    assert!(large.median_ms.is_finite() && large.p95_ms.is_finite());
    assert!(scaling_ratio.is_finite());
}
