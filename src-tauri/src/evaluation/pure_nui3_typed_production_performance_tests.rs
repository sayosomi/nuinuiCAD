//! Record-only Task 50 production benchmarks for the two mutually-exclusive
//! pure nui 3 payload forms accepted by `evaluate_document`.

use serde_json::{json, Value};

use super::{
    evaluate_document,
    performance_test_support::{
        assert_large_case_under_five_seconds, log_measurement, measure_wall_time,
        FixtureMeasurement,
    },
    EvaluationInput, EvaluationPayload,
};

const SMALL_BINDING_COUNT: usize = 250;
const LARGE_BINDING_COUNT: usize = 1_000;

fn binding_id(index: usize) -> String {
    format!("binding:task50:pure:{index}")
}

fn statement_id(index: usize) -> String {
    format!("task50:pure:{index}")
}

fn number(value: f64) -> Value {
    json!({"kind":"numberLiteral","span":{"start":0,"end":1},"value":value,"type":{"kind":"number"}})
}

fn reference(index: usize) -> Value {
    json!({
        "kind":"reference","span":{"start":0,"end":1},"nameSpan":{"start":0,"end":1},
        "name":format!("V{index}"),"bindingId":binding_id(index),"type":{"kind":"number"}
    })
}

fn add(left: Value, right: Value) -> Value {
    json!({"kind":"binary","span":{"start":0,"end":1},"operator":"+","left":left,"right":right,"type":{"kind":"number"}})
}

fn initializer(index: usize) -> Value {
    if index == 0 {
        number(0.0)
    } else {
        add(reference(index - 1), number(1.0))
    }
}

fn binding_kind(index: usize) -> &'static str {
    if index.is_multiple_of(2) {
        "const"
    } else {
        "let"
    }
}

fn scalar_program(binding_count: usize) -> Value {
    json!({
        "statements": (0..binding_count).map(|index| json!({
            "kind":"declare",
            "bindingId":binding_id(index),
            "scopeId":"root",
            "sourceOrder":index,
            "declaration":{
                "bindingKind":binding_kind(index),
                "declaredType":{"kind":"number"},
                "initializer":initializer(index)
            }
        })).collect::<Vec<_>>()
    })
}

fn binding_versions(binding_count: usize) -> Value {
    assert!(binding_count.is_multiple_of(2));
    let terminal_binding_index = binding_count - 1;
    let mut versions = (0..binding_count)
        .map(|index| {
            let id = statement_id(index);
            json!({
                "versionId":id,
                "statementId":id,
                "kind":"declare",
                "bindingId":binding_id(index),
                "bindingKind":binding_kind(index),
                "declaredType":{"kind":"number"},
                "sourceOrder":index,
                "scopeId":"root",
                "scopeExitSourceOrder":binding_count + 1,
                "control":{"scopeId":"root","scopeExitSourceOrder":binding_count + 1,"ownerChain":[],"kind":"linear"},
                "initialState":{"kind":"uncomputed"},
                "initializer":initializer(index)
            })
        })
        .collect::<Vec<_>>();
    versions.push(json!({
        "versionId":"task50:pure:set",
        "statementId":"task50:pure:set",
        "kind":"set",
        "bindingId":binding_id(terminal_binding_index),
        "targetBindingId":binding_id(terminal_binding_index),
        "bindingKind":"let",
        "declaredType":{"kind":"number"},
        "sourceOrder":binding_count,
        "scopeId":"root",
        "scopeExitSourceOrder":binding_count + 1,
        "control":{"scopeId":"root","scopeExitSourceOrder":binding_count + 1,"ownerChain":[],"kind":"linear"},
        "predecessorId":statement_id(terminal_binding_index),
        "initialState":{"kind":"uncomputed"},
        "expression":add(reference(terminal_binding_index), number(1.0))
    }));
    json!({
        "versions":versions,
        "elementSourceOrders":[],
        "conditionalOwners":[],
        "forGroupOwners":[]
    })
}

fn input(scalar_program: Option<Value>, binding_versions: Option<Value>) -> EvaluationInput {
    assert!(scalar_program.is_some() ^ binding_versions.is_some());
    EvaluationInput {
        path_mutations: None,
        elements: vec![],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program,
        binding_versions,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
    }
}

fn evaluate_scalar_program(program: Value) -> EvaluationPayload {
    evaluate_document(input(Some(program), None))
        .expect("pure nui 3 scalarProgram production payload must be accepted")
}

fn evaluate_binding_versions(versions: Value) -> EvaluationPayload {
    evaluate_document(input(None, Some(versions)))
        .expect("pure nui 3 bindingVersions production payload must be accepted")
}

fn assert_scalar_result(
    result: &EvaluationPayload,
    binding_count: usize,
    expected_last_value: f64,
) {
    assert!(result.errors.is_empty());
    let bindings = result
        .computed_scalar_bindings
        .as_ref()
        .expect("typed production payload must produce scalar bindings");
    assert_eq!(bindings.len(), binding_count);
    let last = bindings.last().expect("fixture contains a final binding");
    assert_eq!(last["bindingId"], binding_id(binding_count - 1));
    assert_eq!(last["evaluation"]["value"]["value"], expected_last_value);
}

#[test]
#[ignore]
fn performance_pure_nui3_typed_production_scalar_program() {
    let small_program = scalar_program(SMALL_BINDING_COUNT);
    let large_program = scalar_program(LARGE_BINDING_COUNT);
    let (small_result, small_stats) =
        measure_wall_time(|| evaluate_scalar_program(small_program.clone()));
    let (large_result, large_stats) =
        measure_wall_time(|| evaluate_scalar_program(large_program.clone()));

    assert_scalar_result(
        &small_result,
        SMALL_BINDING_COUNT,
        (SMALL_BINDING_COUNT - 1) as f64,
    );
    assert_scalar_result(
        &large_result,
        LARGE_BINDING_COUNT,
        (LARGE_BINDING_COUNT - 1) as f64,
    );
    assert!(small_result.computed_scalar_binding_versions.is_none());
    assert!(large_result.computed_scalar_binding_versions.is_none());
    let scaling_ratio = log_measurement(
        "rustPureNui3TypedScalarProgramProduction",
        FixtureMeasurement {
            statement_count: SMALL_BINDING_COUNT,
            binding_count: SMALL_BINDING_COUNT,
            geometry_statement_count: 0,
            result: &small_result,
            stats: &small_stats,
        },
        FixtureMeasurement {
            statement_count: LARGE_BINDING_COUNT,
            binding_count: LARGE_BINDING_COUNT,
            geometry_statement_count: 0,
            result: &large_result,
            stats: &large_stats,
        },
    );
    assert!(scaling_ratio.is_finite());
    assert_large_case_under_five_seconds(&large_stats);
}

#[test]
#[ignore]
fn performance_pure_nui3_typed_production_binding_versions() {
    let small_versions = binding_versions(SMALL_BINDING_COUNT);
    let large_versions = binding_versions(LARGE_BINDING_COUNT);
    let (small_result, small_stats) =
        measure_wall_time(|| evaluate_binding_versions(small_versions.clone()));
    let (large_result, large_stats) =
        measure_wall_time(|| evaluate_binding_versions(large_versions.clone()));

    assert_scalar_result(
        &small_result,
        SMALL_BINDING_COUNT,
        SMALL_BINDING_COUNT as f64,
    );
    assert_scalar_result(
        &large_result,
        LARGE_BINDING_COUNT,
        LARGE_BINDING_COUNT as f64,
    );
    assert_eq!(
        small_result
            .computed_scalar_binding_versions
            .as_ref()
            .map(Vec::len),
        Some(SMALL_BINDING_COUNT + 1)
    );
    assert_eq!(
        large_result
            .computed_scalar_binding_versions
            .as_ref()
            .map(Vec::len),
        Some(LARGE_BINDING_COUNT + 1)
    );
    let scaling_ratio = log_measurement(
        "rustPureNui3TypedBindingVersionsProduction",
        FixtureMeasurement {
            statement_count: SMALL_BINDING_COUNT + 1,
            binding_count: SMALL_BINDING_COUNT,
            geometry_statement_count: 0,
            result: &small_result,
            stats: &small_stats,
        },
        FixtureMeasurement {
            statement_count: LARGE_BINDING_COUNT + 1,
            binding_count: LARGE_BINDING_COUNT,
            geometry_statement_count: 0,
            result: &large_result,
            stats: &large_stats,
        },
    );
    assert!(scaling_ratio.is_finite());
    assert_large_case_under_five_seconds(&large_stats);
}
