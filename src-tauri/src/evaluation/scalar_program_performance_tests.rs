use std::time::Instant;

use serde_json::{json, Value};

use super::{evaluate_document_input, EvaluationInput, EvaluationPayload};

const WARM_UP_RUNS: usize = 5;
const TRIALS: usize = 21;

fn scalar_program(binding_count: usize) -> Value {
    let statements = (0..binding_count)
        .map(|index| {
            let initializer = if index == 0 {
                json!({"kind": "numberLiteral", "span": {"start": 0, "end": 1}, "value": 1.0, "type": {"kind": "number"}})
            } else {
                json!({
                    "kind": "reference", "span": {"start": 0, "end": 1}, "nameSpan": {"start": 0, "end": 1},
                    "name": format!("binding:{}", index - 1), "bindingId": format!("binding:{}", index - 1),
                    "type": {"kind": "number"}
                })
            };
            json!({
                "kind": "declare", "bindingId": format!("binding:{index}"), "scopeId": "root", "sourceOrder": index,
                "declaration": {"bindingKind": "const", "declaredType": {"kind": "number"}, "initializer": initializer}
            })
        })
        .collect::<Vec<_>>();
    json!({"statements": statements})
}

fn evaluate(program: Value) -> EvaluationPayload {
    evaluate_document_input(EvaluationInput {
        property_bindings: None,
        elements: vec![],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: Some(program),
    })
}

fn measure(program: &Value) -> (EvaluationPayload, Vec<f64>) {
    let correctness = evaluate(program.clone());
    for _ in 0..WARM_UP_RUNS {
        let _ = evaluate(program.clone());
    }
    let mut samples = Vec::with_capacity(TRIALS);
    for _ in 0..TRIALS {
        let started = Instant::now();
        let _ = evaluate(program.clone());
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    samples.sort_by(f64::total_cmp);
    (correctness, samples)
}

#[test]
#[ignore]
fn performance_scalar_program_const_evaluation() {
    let small_program = scalar_program(250);
    let large_program = scalar_program(1_000);
    let (small_result, small_samples) = measure(&small_program);
    let (large_result, large_samples) = measure(&large_program);
    let small_median = small_samples[TRIALS / 2];
    let large_median = large_samples[TRIALS / 2];
    let small_p95 = small_samples[(TRIALS * 95).div_ceil(100) - 1];
    let large_p95 = large_samples[(TRIALS * 95).div_ceil(100) - 1];

    assert_eq!(
        small_result.computed_scalar_bindings.as_ref().map(Vec::len),
        Some(250)
    );
    assert_eq!(
        large_result.computed_scalar_bindings.as_ref().map(Vec::len),
        Some(1_000)
    );
    assert!(small_median.is_finite() && small_p95.is_finite());
    assert!(large_median.is_finite() && large_p95.is_finite());
    eprintln!(
        "[typedVariables baseline] {}",
        json!({
            "area": "rustScalarProgramConstEvaluation", "metric": "wallTimeMs",
            "warmUpRuns": WARM_UP_RUNS, "trials": TRIALS, "runsPerTrial": 1,
            "small": {"bindingCount": 250, "medianMs": small_median, "p95Ms": small_p95},
            "large": {"bindingCount": 1000, "medianMs": large_median, "p95Ms": large_p95},
            "scalingRatio": large_median / small_median.max(f64::EPSILON)
        })
    );
}
