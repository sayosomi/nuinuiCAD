use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn edge_extends_and_trims_two_line_endpoints() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 150.0, 80.0),
            free_point("d", "D", 150.0, 160.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "edge"));
    assert_close(geometry(&result, "ab")["end"]["x"].as_f64().unwrap(), 150.0);
    assert_close(geometry(&result, "ab")["end"]["y"].as_f64().unwrap(), 0.0);
    assert_close(
        geometry(&result, "cd")["start"]["x"].as_f64().unwrap(),
        150.0,
    );
    assert_close(geometry(&result, "cd")["start"]["y"].as_f64().unwrap(), 0.0);
}

#[test]
fn edge_reports_geometry_errors() {
    let same_line = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("ab", "AB", "a", "b"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "ab", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
    });
    assert!(same_line.errors[0].message.contains("同じ線"));

    let parallel = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 0.0, 20.0),
            free_point("d", "D", 100.0, 20.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0
            })),
        ],
        evaluation_limit_index: None,
    });
    assert!(parallel.errors[0].message.contains("交点"));

    let invalid_index = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("c", "C", 50.0, -20.0),
            free_point("d", "D", 50.0, 20.0),
            line("ab", "AB", "a", "b"),
            line("cd", "CD", "c", "d"),
            element(json!({
                "id": "edge",
                "name": "エッジ",
                "type": "edge",
                "visible": true,
                "enabled": true,
                "endpoint1": { "lineId": "ab", "endpointKey": "end" },
                "endpoint2": { "lineId": "cd", "endpointKey": "start" },
                "intersectionIndex": 0.5
            })),
        ],
        evaluation_limit_index: None,
    });
    assert!(invalid_index.errors[0].message.contains("0以上の整数"));
}
