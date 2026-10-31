use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    evaluate_document, evaluate_document_input, issue1519_stage_probe_begin,
    issue1519_stage_probe_finish, EvaluationInput, EvaluationPayload,
};

fn point(id: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "name": id,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    })
}

fn line(id: &str, start_point_id: &str, end_point_id: &str) -> Value {
    json!({
        "id": id,
        "name": id,
        "type": "line",
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": start_point_id },
        "endPoint": { "mode": "reference", "pointId": end_point_id }
    })
}

fn run_performance_case(name: &str, elements: Vec<Value>) -> EvaluationPayload {
    let started = Instant::now();
    let result = evaluate_document_input(EvaluationInput {
        evaluation_order: None,
        geometry_input_targets: None,
        geometry_collection_nodes: None,
        geometry_value_program: None,
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        transformation_recipes: None,
        source_statement_indices: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    eprintln!(
        "{name}: {} geometry, {} errors, {:?}",
        result.computed_geometry.len(),
        result.errors.len(),
        started.elapsed()
    );
    result
}

#[test]
#[ignore]
fn performance_1000_line_elements() {
    let mut elements = Vec::new();
    for index in 0..501 {
        elements.push(point(
            &format!("p{index}"),
            (index as f64) * 5.0,
            ((index % 7) as f64) * 3.0,
        ));
    }
    for index in 0..500 {
        elements.push(line(
            &format!("line{index}"),
            &format!("p{index}"),
            &format!("p{}", index + 1),
        ));
    }

    let result = run_performance_case("performance_1000_line_elements", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 1001);
}

#[test]
#[ignore]
fn performance_many_beziers() {
    let mut elements = vec![point("origin", 0.0, 0.0)];
    for index in 0..150 {
        let start_id = format!("start{index}");
        let mid_id = format!("mid{index}");
        let end_id = format!("end{index}");
        elements.push(point(&start_id, 0.0, index as f64));
        elements.push(point(&mid_id, 50.0, (index as f64) + 30.0));
        elements.push(point(&end_id, 100.0, index as f64));
        elements.push(json!({
            "id": format!("curve{index}"),
            "name": format!("curve{index}"),
            "type": "bezierCurve",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": start_id },
            "startHandleAngleDeg": 0,
            "startHandleLength": 20,
            "intermediatePoints": [
                {
                    "id": format!("intermediate{index}"),
                    "point": { "mode": "reference", "pointId": mid_id },
                    "handleAngleDeg": 180,
                    "incomingHandleLength": 18,
                    "outgoingHandleLength": 18
                }
            ],
            "endPoint": { "mode": "reference", "pointId": end_id },
            "endHandleAngleDeg": 180,
            "endHandleLength": 20
        }));
    }

    let result = run_performance_case("performance_many_beziers", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 601);
}

#[test]
#[ignore]
fn performance_many_offset_lines() {
    let mut elements = Vec::new();
    for index in 0..201 {
        elements.push(point(
            &format!("p{index}"),
            (index as f64) * 4.0,
            ((index % 5) as f64) * 6.0,
        ));
    }
    for index in 0..200 {
        elements.push(line(
            &format!("base{index}"),
            &format!("p{index}"),
            &format!("p{}", index + 1),
        ));
        elements.push(json!({
            "id": format!("offset{index}"),
            "name": format!("offset{index}"),
            "type": "offsetLine",
            "activity": "visible",
            "baseLineIds": [format!("base{index}")],
            "offset": 10,
            "side": "right",
            "closed": false
        }));
    }

    let result = run_performance_case("performance_many_offset_lines", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 601);
}

#[test]
#[ignore]
fn performance_deep_groups() {
    let mut elements = Vec::new();
    for index in 0..100 {
        let parent = if index == 0 {
            None
        } else {
            Some(format!("group{}", index - 1))
        };
        let mut group = json!({
            "id": format!("group{index}"),
            "name": format!("group{index}"),
            "type": "group",
            "activity": "visible",
            "expanded": true
        });
        if let Some(parent_group_id) = parent {
            group["parentGroupId"] = json!(parent_group_id);
        }
        elements.push(group);
    }
    for index in 0..300 {
        let mut nested_point = point(&format!("p{index}"), index as f64, index as f64);
        nested_point["parentGroupId"] = json!("group99");
        elements.push(nested_point);
    }

    let result = run_performance_case("performance_deep_groups", elements);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.computed_geometry.len(), 300);
    assert_eq!(result.effective_enabled_element_ids.len(), 400);
}

#[test]
#[ignore]
fn performance_many_dependency_errors() {
    let mut elements = Vec::new();
    for index in 0..400 {
        elements.push(json!({
            "id": format!("line{index}"),
            "name": format!("line{index}"),
            "type": "line",
            "activity": "visible",
            "startPoint": { "mode": "reference", "pointId": format!("missing-start{index}") },
            "endPoint": { "mode": "reference", "pointId": format!("missing-end{index}") }
        }));
    }

    let result = run_performance_case("performance_many_dependency_errors", elements);
    assert_eq!(result.computed_geometry.len(), 0);
    assert_eq!(result.errors.len(), 400);
}

fn issue1519_timing_summary(samples_ms: &[f64]) -> Value {
    let mut sorted = samples_ms.to_vec();
    sorted.sort_by(f64::total_cmp);
    let percentile = |fraction: f64| {
        let rank = (sorted.len() as f64 * fraction).ceil() as usize;
        sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
    };
    json!({
        "p50Ms": percentile(0.50),
        "p95Ms": percentile(0.95),
        "maxMs": sorted[sorted.len() - 1]
    })
}

fn issue1519_variation_summary(samples_ms: &[f64]) -> Value {
    let mut sorted = samples_ms.to_vec();
    sorted.sort_by(f64::total_cmp);
    let percentile = |fraction: f64| {
        let rank = (sorted.len() as f64 * fraction).ceil() as usize;
        sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
    };
    let mean = samples_ms.iter().sum::<f64>() / samples_ms.len() as f64;
    let variance = samples_ms
        .iter()
        .map(|sample| (sample - mean).powi(2))
        .sum::<f64>()
        / (samples_ms.len().saturating_sub(1).max(1) as f64);
    let standard_deviation = variance.sqrt();
    json!({
        "p50Ms": percentile(0.50),
        "p95Ms": percentile(0.95),
        "maxMs": sorted[sorted.len() - 1],
        "minMs": sorted[0],
        "rangeMs": sorted[sorted.len() - 1] - sorted[0],
        "sampleStandardDeviationMs": standard_deviation,
        "coefficientOfVariationPercent": if mean == 0.0 { 0.0 } else { standard_deviation / mean * 100.0 }
    })
}

#[derive(Deserialize)]
struct Issue1519ProbeEvaluationRequest {
    id: u64,
    input: EvaluationInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issue1519ProbeOutputExportRequest {
    id: u64,
    export_output: Value,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Issue1519ProbeRequest {
    Evaluation(Box<Issue1519ProbeEvaluationRequest>),
    OutputExport(Issue1519ProbeOutputExportRequest),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
enum Issue1519ProbeResponse {
    Success {
        id: u64,
        payload: Box<EvaluationPayload>,
    },
}

fn issue1519_read_probe_request(
    request_line: &str,
    case_id: &str,
) -> Issue1519ProbeEvaluationRequest {
    match serde_json::from_str::<Issue1519ProbeRequest>(request_line).unwrap_or_else(|error| {
        panic!("{case_id} production request failed test-only serde decode: {error}")
    }) {
        Issue1519ProbeRequest::Evaluation(request) => *request,
        Issue1519ProbeRequest::OutputExport(request) => {
            let _ = (request.id, request.export_output);
            panic!("{case_id} request unexpectedly decoded as output export")
        }
    }
}

fn issue1519_probe_eval_once(
    request_line: &str,
    case_id: &str,
    expected_drawables: usize,
) -> (f64, super::Issue1519StageProbeMetrics) {
    let request = issue1519_read_probe_request(request_line, case_id);
    issue1519_stage_probe_begin();
    let started = Instant::now();
    let evaluated = evaluate_document(request.input);
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let metrics = issue1519_stage_probe_finish();
    let payload =
        evaluated.unwrap_or_else(|error| panic!("{case_id} evaluate_document failed: {error}"));
    assert!(
        payload.errors.is_empty(),
        "{case_id} Rust dependency errors"
    );
    assert!(
        payload.geometry_value_errors.is_empty(),
        "{case_id} geometry-value errors"
    );
    assert!(payload.warnings.is_empty(), "{case_id} Rust warnings");
    assert_eq!(
        payload.computed_geometry.len(),
        expected_drawables,
        "{case_id} drawable count"
    );
    (elapsed_ms, metrics)
}

#[test]
#[ignore = "explicit Issue #1519 causal work-count regression; reads frozen production requests outside the checkout"]
fn issue1519_snapshot_completion_causality() {
    let request_dir = std::env::var("ISSUE1519_STAGE_MATRIX_DIR")
        .expect("set ISSUE1519_STAGE_MATRIX_DIR to the external frozen request directory");
    let mut case_counts = Vec::new();

    for (case_id, expected_drawables) in [("L-A", 512), ("L-B", 512), ("L-C", 512)] {
        let request_path =
            std::path::Path::new(&request_dir).join(format!("{case_id}.request.json"));
        let response_path =
            std::path::Path::new(&request_dir).join(format!("{case_id}.response.json"));
        let request_line = std::fs::read_to_string(&request_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", request_path.display()));
        let response_line = std::fs::read_to_string(&response_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", response_path.display()));
        let request = issue1519_read_probe_request(&request_line, case_id);

        issue1519_stage_probe_begin();
        let payload = evaluate_document(request.input)
            .unwrap_or_else(|error| panic!("{case_id} Rust evaluation failed: {error}"));
        let metrics = issue1519_stage_probe_finish();
        assert!(payload.errors.is_empty(), "{case_id} Rust errors");
        assert!(
            payload.geometry_value_errors.is_empty(),
            "{case_id} geometry-value errors"
        );
        assert!(payload.warnings.is_empty(), "{case_id} warnings");
        assert_eq!(
            payload.computed_geometry.len(),
            expected_drawables,
            "{case_id} drawable count"
        );
        let response = Issue1519ProbeResponse::Success {
            id: request.id,
            payload: Box::new(payload),
        };
        let encoded = serde_json::to_string(&response).unwrap_or_else(|error| {
            panic!("{case_id} Rust response serialization failed: {error}")
        });
        assert_eq!(
            encoded, response_line,
            "{case_id} production stdio semantic response"
        );

        eprintln!(
            "ISSUE1519_SNAPSHOT_CAUSALITY {}",
            json!({
                "case": case_id,
                "captureCalls": metrics.capture_calls,
                "snapshotInspections": metrics.snapshot_inspections,
                "uncapturedSnapshotInspections": metrics.uncaptured_snapshot_inspections,
                "irrelevantSnapshotInspections": metrics.irrelevant_snapshot_inspections,
                "irrelevantUncapturedSnapshotInspections": metrics.irrelevant_uncaptured_snapshot_inspections,
                "snapshotIndexBuildElapsedMs": metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0,
                "snapshotIndexBuildSnapshotVisits": metrics.snapshot_index_build_snapshot_visits,
                "snapshotIndexBuildDescendantIdVisits": metrics.snapshot_index_build_descendant_id_visits,
                "descendantCompletionIdVisits": metrics.descendant_completion_id_visits,
                "descendantCompletionChecks": metrics.descendant_completion_checks,
                "responseMatchesFrozenProductionStdio": true
            })
        );
        case_counts.push((case_id, metrics));
    }

    let counts = |case_id: &str| {
        &case_counts
            .iter()
            .find(|(id, _)| *id == case_id)
            .expect("causality case was evaluated")
            .1
    };
    assert_eq!(
        counts("L-B").snapshot_inspections,
        0,
        "geometry-only L-B has no Module snapshots"
    );
    assert_eq!(counts("L-B").irrelevant_snapshot_inspections, 0);
    assert!(
        counts("L-A").irrelevant_uncaptured_snapshot_inspections == 0,
        "L-A must not inspect a snapshot when the completed element cannot change its completion state"
    );
    assert!(
        counts("L-C").irrelevant_uncaptured_snapshot_inspections == 0,
        "L-C must not inspect a snapshot when the completed element cannot change its completion state"
    );
}

#[test]
#[ignore = "explicit Issue #1519 matrix Rust stage probe; requires captured production request/response envelopes outside the checkout"]
fn issue1519_matrix_rust_stages() {
    let request_dir = std::env::var("ISSUE1519_STAGE_MATRIX_DIR")
        .expect("set ISSUE1519_STAGE_MATRIX_DIR to the external prepared request directory");
    let cases = [
        ("S-A", 32),
        ("S-B", 32),
        ("S-C", 32),
        ("M-A", 128),
        ("M-B", 128),
        ("M-C", 128),
        ("L-A", 512),
        ("L-B", 512),
        ("L-C", 512),
    ];

    for (case_id, expected_drawables) in cases {
        let request_path =
            std::path::Path::new(&request_dir).join(format!("{case_id}.request.json"));
        let response_path =
            std::path::Path::new(&request_dir).join(format!("{case_id}.response.json"));
        let request_line = std::fs::read_to_string(&request_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", request_path.display()));
        let response_line = std::fs::read_to_string(&response_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", response_path.display()));
        let request_id = issue1519_read_probe_request(&request_line, case_id).id;
        let request_bytes = request_line.len();
        let response_bytes = response_line.len();

        let mut serde_decode_warmups_ms = Vec::with_capacity(5);
        for _ in 0..5 {
            let started = Instant::now();
            let decoded = issue1519_read_probe_request(&request_line, case_id);
            let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
            assert_eq!(decoded.id, request_id, "{case_id} warmup request id");
            std::hint::black_box(decoded);
            serde_decode_warmups_ms.push(elapsed_ms);
        }
        let mut serde_decode_samples_ms = Vec::with_capacity(21);
        for _ in 0..21 {
            let started = Instant::now();
            let decoded = issue1519_read_probe_request(&request_line, case_id);
            let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
            assert_eq!(decoded.id, request_id, "{case_id} request id");
            std::hint::black_box(decoded);
            serde_decode_samples_ms.push(elapsed_ms);
        }

        let mut evaluate_warmups = Vec::with_capacity(5);
        for _ in 0..5 {
            evaluate_warmups.push(issue1519_probe_eval_once(
                &request_line,
                case_id,
                expected_drawables,
            ));
        }
        let mut evaluate_samples = Vec::with_capacity(21);
        for _ in 0..21 {
            evaluate_samples.push(issue1519_probe_eval_once(
                &request_line,
                case_id,
                expected_drawables,
            ));
        }
        let evaluate_samples_ms = evaluate_samples
            .iter()
            .map(|(elapsed, _)| *elapsed)
            .collect::<Vec<_>>();
        let capture_warmups_ms = evaluate_warmups
            .iter()
            .map(|(_, metrics)| metrics.capture_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let capture_samples_ms = evaluate_samples
            .iter()
            .map(|(_, metrics)| metrics.capture_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let readiness_warmups_ms = evaluate_warmups
            .iter()
            .map(|(_, metrics)| metrics.readiness_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let readiness_samples_ms = evaluate_samples
            .iter()
            .map(|(_, metrics)| metrics.readiness_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let snapshot_index_warmups_ms = evaluate_warmups
            .iter()
            .map(|(_, metrics)| metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let snapshot_index_samples_ms = evaluate_samples
            .iter()
            .map(|(_, metrics)| metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let first_metrics = &evaluate_samples[0].1;
        let counters_match = |metrics: &super::Issue1519StageProbeMetrics| {
            metrics.capture_calls == first_metrics.capture_calls
                && metrics.snapshot_inspections == first_metrics.snapshot_inspections
                && metrics.uncaptured_snapshot_inspections
                    == first_metrics.uncaptured_snapshot_inspections
                && metrics.irrelevant_snapshot_inspections
                    == first_metrics.irrelevant_snapshot_inspections
                && metrics.irrelevant_uncaptured_snapshot_inspections
                    == first_metrics.irrelevant_uncaptured_snapshot_inspections
                && metrics.snapshot_index_build_snapshot_visits
                    == first_metrics.snapshot_index_build_snapshot_visits
                && metrics.snapshot_index_build_descendant_id_visits
                    == first_metrics.snapshot_index_build_descendant_id_visits
                && metrics.descendant_completion_id_visits
                    == first_metrics.descendant_completion_id_visits
                && metrics.descendant_completion_checks
                    == first_metrics.descendant_completion_checks
                && metrics.readiness_calls == first_metrics.readiness_calls
                && metrics.candidate_binding_ids_total == first_metrics.candidate_binding_ids_total
                && metrics.candidate_binding_ids_max_per_call
                    == first_metrics.candidate_binding_ids_max_per_call
        };
        assert!(
            evaluate_samples
                .iter()
                .all(|(_, metrics)| counters_match(metrics)),
            "{case_id} counters changed across measured repetitions"
        );

        let response_input = issue1519_read_probe_request(&request_line, case_id);
        let payload = evaluate_document(response_input.input)
            .unwrap_or_else(|error| panic!("{case_id} response setup evaluation failed: {error}"));
        assert!(
            payload.errors.is_empty(),
            "{case_id} response setup dependency errors"
        );
        assert!(
            payload.geometry_value_errors.is_empty(),
            "{case_id} response setup geometry-value errors"
        );
        assert!(
            payload.warnings.is_empty(),
            "{case_id} response setup warnings"
        );
        assert_eq!(
            payload.computed_geometry.len(),
            expected_drawables,
            "{case_id} response setup drawable count"
        );
        let response = Issue1519ProbeResponse::Success {
            id: request_id,
            payload: Box::new(payload),
        };
        let encoded_before_measurement = serde_json::to_string(&response).unwrap_or_else(|error| {
            panic!("{case_id} test-only response encoding failed: {error}")
        });
        assert_eq!(encoded_before_measurement, response_line,
            "{case_id} test-only response serializer must match the captured production stdio response");

        let mut serde_encode_warmups_ms = Vec::with_capacity(5);
        for _ in 0..5 {
            let started = Instant::now();
            let encoded = serde_json::to_string(&response).unwrap_or_else(|error| {
                panic!("{case_id} response warmup serialization failed: {error}")
            });
            let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
            assert_eq!(encoded, response_line, "{case_id} warmup response bytes");
            std::hint::black_box(encoded);
            serde_encode_warmups_ms.push(elapsed_ms);
        }
        let mut serde_encode_samples_ms = Vec::with_capacity(21);
        for _ in 0..21 {
            let started = Instant::now();
            let encoded = serde_json::to_string(&response)
                .unwrap_or_else(|error| panic!("{case_id} response serialization failed: {error}"));
            let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
            assert_eq!(encoded, response_line, "{case_id} response bytes");
            std::hint::black_box(encoded);
            serde_encode_samples_ms.push(elapsed_ms);
        }

        eprintln!(
            "ISSUE1519_MATRIX_RUST_STAGES {}",
            json!({
                "case": case_id,
                "requestBytes": request_bytes,
                "responseBytes": response_bytes,
                "warmupsPerStage": 5,
                "measuredRepetitionsPerStage": 21,
                "serdeRequestDecode": {
                    "warmupSamplesMs": serde_decode_warmups_ms,
                    "rawSamplesMs": serde_decode_samples_ms,
                    "summary": issue1519_variation_summary(&serde_decode_samples_ms)
                },
                "evaluateDocument": {
                    "warmupSamplesMs": evaluate_warmups.iter().map(|(elapsed, _)| *elapsed).collect::<Vec<_>>(),
                    "rawSamplesMs": evaluate_samples_ms,
                    "summary": issue1519_variation_summary(&evaluate_samples_ms),
                    "instrumentation": "Release test binary with the existing cfg(test) Module capture and binding-readiness collectors active"
                },
                "captureCompletedInstancesCumulative": {
                    "warmupSamplesMs": capture_warmups_ms,
                    "rawSamplesMs": capture_samples_ms,
                    "summary": issue1519_variation_summary(&capture_samples_ms),
                    "nestedWithinEvaluateDocument": true
                },
                "snapshotCompletionIndexBuild": {
                    "warmupSamplesMs": snapshot_index_warmups_ms,
                    "rawSamplesMs": snapshot_index_samples_ms,
                    "summary": issue1519_variation_summary(&snapshot_index_samples_ms),
                    "nestedWithinEvaluateDocument": true
                },
                "readyBindingIdsForSourceOrderCumulative": {
                    "warmupSamplesMs": readiness_warmups_ms,
                    "rawSamplesMs": readiness_samples_ms,
                    "summary": issue1519_variation_summary(&readiness_samples_ms),
                    "nestedWithinEvaluateDocument": true
                },
                "serdeResponseEncode": {
                    "warmupSamplesMs": serde_encode_warmups_ms,
                    "rawSamplesMs": serde_encode_samples_ms,
                    "summary": issue1519_variation_summary(&serde_encode_samples_ms),
                    "exactProductionResponseBytesVerified": true
                },
                "actualCountersPerEvaluation": {
                    "captureCalls": first_metrics.capture_calls,
                    "snapshotInspections": first_metrics.snapshot_inspections,
                    "uncapturedSnapshotInspections": first_metrics.uncaptured_snapshot_inspections,
                    "irrelevantSnapshotInspections": first_metrics.irrelevant_snapshot_inspections,
                    "irrelevantUncapturedSnapshotInspections": first_metrics.irrelevant_uncaptured_snapshot_inspections,
                    "snapshotIndexBuildElapsedMs": first_metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0,
                    "snapshotIndexBuildSnapshotVisits": first_metrics.snapshot_index_build_snapshot_visits,
                    "snapshotIndexBuildDescendantIdVisits": first_metrics.snapshot_index_build_descendant_id_visits,
                    "descendantCompletionIdVisits": first_metrics.descendant_completion_id_visits,
                    "descendantCompletionChecks": first_metrics.descendant_completion_checks,
                    "readinessCalls": first_metrics.readiness_calls,
                    "candidateBindingIdsTotal": first_metrics.candidate_binding_ids_total,
                    "candidateBindingIdsMaxPerCall": first_metrics.candidate_binding_ids_max_per_call,
                    "identicalAcrossMeasuredRepetitions": true
                }
            })
        );
    }
}

fn issue1519_evaluate(
    input_json: &Value,
    case_id: &str,
    expected_drawables: usize,
    collect_stages: bool,
) -> (f64, Option<super::Issue1519StageProbeMetrics>) {
    let input: EvaluationInput = serde_json::from_value(input_json.clone())
        .unwrap_or_else(|error| panic!("{case_id} prepared Rust input did not decode: {error}"));
    if collect_stages {
        issue1519_stage_probe_begin();
    }
    let started = Instant::now();
    let evaluated = evaluate_document(input);
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let metrics = collect_stages.then(issue1519_stage_probe_finish);
    let result =
        evaluated.unwrap_or_else(|error| panic!("{case_id} evaluate_document failed: {error}"));
    assert!(result.errors.is_empty(), "{case_id} produced Rust errors");
    assert_eq!(
        result.computed_geometry.len(),
        expected_drawables,
        "{case_id} drawable count"
    );
    (elapsed_ms, metrics)
}

#[test]
#[ignore = "explicit Issue #1519 diagnostic; requires prepared input JSON outside the checkout"]
fn issue1519_stage_probe() {
    let request_dir = std::env::var("ISSUE1519_REQUEST_DIR")
        .expect("set ISSUE1519_REQUEST_DIR to the temporary prepared-input directory");
    let cases = [
        ("S-P-1", 35, 32, 3),
        ("M-P-1", 143, 128, 15),
        ("L-P-1", 575, 512, 63),
    ];

    for (case_id, expected_elements, expected_drawables, expected_snapshots) in cases {
        let request_path = std::path::Path::new(&request_dir).join(format!("{case_id}.json"));
        let input_json: Value = serde_json::from_slice(
            &std::fs::read(&request_path)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", request_path.display())),
        )
        .unwrap_or_else(|error| panic!("invalid {}: {error}", request_path.display()));
        let prepared_input: EvaluationInput = serde_json::from_value(input_json.clone())
            .unwrap_or_else(|error| {
                panic!("{case_id} prepared Rust input did not decode: {error}")
            });
        assert_eq!(
            prepared_input.elements.len(),
            expected_elements,
            "{case_id} elements"
        );
        let snapshots = prepared_input
            .module_materialization
            .as_ref()
            .expect("#1515 prepared input must include Module snapshots");
        assert_eq!(
            snapshots.instances.len(),
            expected_snapshots,
            "{case_id} snapshots"
        );
        assert!(
            snapshots
                .instances
                .iter()
                .all(|snapshot| snapshot.descendant_ids.len() == 8),
            "{case_id} snapshot descendants"
        );

        let mut hook_disabled_warmups_ms = Vec::with_capacity(5);
        let mut diagnostic_warmups_ms = Vec::with_capacity(5);
        for warmup in 0..5 {
            let (hook_disabled_ms, diagnostic_ms) = if warmup % 2 == 0 {
                (
                    issue1519_evaluate(&input_json, case_id, expected_drawables, false).0,
                    issue1519_evaluate(&input_json, case_id, expected_drawables, true).0,
                )
            } else {
                let diagnostic_ms =
                    issue1519_evaluate(&input_json, case_id, expected_drawables, true).0;
                let hook_disabled_ms =
                    issue1519_evaluate(&input_json, case_id, expected_drawables, false).0;
                (hook_disabled_ms, diagnostic_ms)
            };
            hook_disabled_warmups_ms.push(hook_disabled_ms);
            diagnostic_warmups_ms.push(diagnostic_ms);
        }

        let mut hook_disabled_samples_ms = Vec::with_capacity(21);
        let mut diagnostic_samples = Vec::with_capacity(21);
        for repetition in 0..21 {
            let (hook_disabled_ms, diagnostic_result) = if repetition % 2 == 0 {
                (
                    issue1519_evaluate(&input_json, case_id, expected_drawables, false).0,
                    issue1519_evaluate(&input_json, case_id, expected_drawables, true),
                )
            } else {
                let diagnostic = issue1519_evaluate(&input_json, case_id, expected_drawables, true);
                let hook_disabled_ms =
                    issue1519_evaluate(&input_json, case_id, expected_drawables, false).0;
                (hook_disabled_ms, diagnostic)
            };
            hook_disabled_samples_ms.push(hook_disabled_ms);
            let (evaluate_ms, metrics) = diagnostic_result;
            diagnostic_samples.push((
                evaluate_ms,
                metrics.expect("stage metrics must be active for diagnostic samples"),
            ));
        }

        let diagnostic_evaluate_ms = diagnostic_samples
            .iter()
            .map(|(evaluate_ms, _)| *evaluate_ms)
            .collect::<Vec<_>>();
        let capture_ms = diagnostic_samples
            .iter()
            .map(|(_, metrics)| metrics.capture_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let readiness_ms = diagnostic_samples
            .iter()
            .map(|(_, metrics)| metrics.readiness_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let snapshot_index_ms = diagnostic_samples
            .iter()
            .map(|(_, metrics)| metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0)
            .collect::<Vec<_>>();
        let first_metrics = &diagnostic_samples[0].1;
        let counters_match = |metrics: &super::Issue1519StageProbeMetrics| {
            metrics.capture_calls == first_metrics.capture_calls
                && metrics.snapshot_inspections == first_metrics.snapshot_inspections
                && metrics.uncaptured_snapshot_inspections
                    == first_metrics.uncaptured_snapshot_inspections
                && metrics.irrelevant_snapshot_inspections
                    == first_metrics.irrelevant_snapshot_inspections
                && metrics.irrelevant_uncaptured_snapshot_inspections
                    == first_metrics.irrelevant_uncaptured_snapshot_inspections
                && metrics.snapshot_index_build_snapshot_visits
                    == first_metrics.snapshot_index_build_snapshot_visits
                && metrics.snapshot_index_build_descendant_id_visits
                    == first_metrics.snapshot_index_build_descendant_id_visits
                && metrics.descendant_completion_id_visits
                    == first_metrics.descendant_completion_id_visits
                && metrics.descendant_completion_checks
                    == first_metrics.descendant_completion_checks
                && metrics.readiness_calls == first_metrics.readiness_calls
                && metrics.candidate_binding_ids_total == first_metrics.candidate_binding_ids_total
                && metrics.candidate_binding_ids_max_per_call
                    == first_metrics.candidate_binding_ids_max_per_call
        };
        assert!(
            diagnostic_samples
                .iter()
                .all(|(_, metrics)| counters_match(metrics)),
            "{case_id} work counters must remain stable across repetitions"
        );

        eprintln!(
            "ISSUE1519_STAGE_PROBE {}",
            json!({
                "case": case_id,
                "warmupsPerMode": 5,
                "measuredRepetitionsPerMode": 21,
                "hookDisabledWarmupsMs": hook_disabled_warmups_ms,
                "hookDisabledEvaluateMs": {
                    "rawSamples": hook_disabled_samples_ms,
                    "summary": issue1519_timing_summary(&hook_disabled_samples_ms)
                },
                "diagnosticWarmupsMs": diagnostic_warmups_ms,
                "diagnosticEvaluateMs": {
                    "rawSamples": diagnostic_evaluate_ms,
                    "summary": issue1519_timing_summary(&diagnostic_evaluate_ms)
                },
                "captureCumulativeMs": {
                    "rawSamples": capture_ms,
                    "summary": issue1519_timing_summary(&capture_ms)
                },
                "snapshotCompletionIndexBuildCumulativeMs": {
                    "rawSamples": snapshot_index_ms,
                    "summary": issue1519_timing_summary(&snapshot_index_ms),
                    "nestedWithinEvaluateDocument": true
                },
                "readinessCumulativeMs": {
                    "rawSamples": readiness_ms,
                    "summary": issue1519_timing_summary(&readiness_ms)
                },
                "diagnosticCountersPerEvaluation": {
                    "captureCalls": first_metrics.capture_calls,
                    "snapshotInspections": first_metrics.snapshot_inspections,
                    "uncapturedSnapshotInspections": first_metrics.uncaptured_snapshot_inspections,
                    "irrelevantSnapshotInspections": first_metrics.irrelevant_snapshot_inspections,
                    "irrelevantUncapturedSnapshotInspections": first_metrics.irrelevant_uncaptured_snapshot_inspections,
                    "snapshotIndexBuildElapsedMs": first_metrics.snapshot_index_build_elapsed_ns as f64 / 1_000_000.0,
                    "snapshotIndexBuildSnapshotVisits": first_metrics.snapshot_index_build_snapshot_visits,
                    "snapshotIndexBuildDescendantIdVisits": first_metrics.snapshot_index_build_descendant_id_visits,
                    "descendantCompletionIdVisits": first_metrics.descendant_completion_id_visits,
                    "descendantCompletionChecks": first_metrics.descendant_completion_checks,
                    "readinessCalls": first_metrics.readiness_calls,
                    "candidateBindingIdsTotal": first_metrics.candidate_binding_ids_total,
                    "candidateBindingIdsMaxPerCall": first_metrics.candidate_binding_ids_max_per_call,
                    "identicalAcrossMeasuredRepetitions": true
                },
                "timingNote": "Hook-disabled and diagnostic-enabled evaluate_document samples are interleaved separate series from the same prepared input. Hook-disabled samples still use the test binary with collectors inactive; the production Release stdio timing uses a binary compiled without cfg(test) code. Capture/readiness timings are nested owner timings and must not be added or subtracted as independent end-to-end stages."
            })
        );
    }
}
