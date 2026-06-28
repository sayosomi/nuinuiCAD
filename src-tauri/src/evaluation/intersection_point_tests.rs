use super::*;
use serde_json::json;
use serde_json::Value;

fn element(value: Value) -> Value {
    value
}

fn point<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|geometry| geometry["elementId"] == json!(id))
        .expect("expected computed point")
}

fn line_element(id: &str, name: &str, start: &str, end: &str) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "line",
        "visible": true,
        "enabled": true,
        "startPoint": { "mode": "reference", "pointId": start },
        "endPoint": { "mode": "reference", "pointId": end }
    }))
}

fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "visible": true,
        "enabled": true,
        "x": x,
        "y": y
    }))
}

fn intersection(line1_id: &str, line2_id: &str, index: Value, use_extensions: bool) -> Value {
    element(json!({
        "id": "intersection",
        "name": "交点",
        "type": "intersectionPoint",
        "visible": true,
        "enabled": true,
        "line1Id": line1_id,
        "line2Id": line2_id,
        "intersectionIndex": index,
        "useExtensions": use_extensions
    }))
}

#[test]
fn evaluates_intersection_point_between_line_segments() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 100.0),
            free_point("c", "C", 0.0, 100.0),
            free_point("d", "D", 100.0, 0.0),
            line_element("ab", "AB", "a", "b"),
            line_element("cd", "CD", "c", "d"),
            intersection("ab", "cd", json!(0), false),
        ],
        evaluation_limit_index: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    assert_eq!(intersection["x"], json!(50.0));
    assert_eq!(intersection["y"], json!(50.0));
}

#[test]
fn uses_line_endpoint_tangent_extensions_when_requested() {
    let base = vec![
        free_point("a", "A", 0.0, 0.0),
        free_point("b", "B", 10.0, 0.0),
        free_point("c", "C", 20.0, -10.0),
        free_point("d", "D", 20.0, 10.0),
        line_element("ab", "AB", "a", "b"),
        line_element("cd", "CD", "c", "d"),
    ];
    let without_extension = evaluate_document_input(EvaluationInput {
        elements: [
            base.clone(),
            vec![intersection("ab", "cd", json!(0), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
    });
    let with_extension = evaluate_document_input(EvaluationInput {
        elements: [base, vec![intersection("ab", "cd", json!(0), true)]].concat(),
        evaluation_limit_index: None,
    });

    assert!(without_extension
        .computed_geometry
        .iter()
        .all(|geometry| geometry["elementId"] != json!("intersection")));
    assert!(without_extension.errors[0]
        .message
        .contains("交点を見つけられません"));
    let intersection = point(&with_extension, "intersection");
    assert!(with_extension.errors.is_empty());
    assert_eq!(intersection["x"], json!(20.0));
    assert_eq!(intersection["y"], json!(0.0));
}

#[test]
fn evaluates_intersection_point_between_arc_and_line() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("p1", "P1", -20.0, -7.0),
            free_point("p2", "P2", 20.0, -7.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 180
            })),
            line_element("line", "水平線", "p1", "p2"),
            intersection("arc", "line", json!(0), false),
        ],
        evaluation_limit_index: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    assert!((intersection["x"].as_f64().unwrap() - 51f64.sqrt()).abs() < 1.0);
    assert!((intersection["y"].as_f64().unwrap() + 7.0).abs() < 0.2);
}

#[test]
fn selects_intersection_point_by_index() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("p1", "P1", -20.0, -7.0),
            free_point("p2", "P2", 20.0, -7.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 180
            })),
            line_element("line", "水平線", "p1", "p2"),
            intersection("arc", "line", json!(1), false),
        ],
        evaluation_limit_index: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    assert!((intersection["x"].as_f64().unwrap() + 51f64.sqrt()).abs() < 1.0);
    assert!((intersection["y"].as_f64().unwrap() + 7.0).abs() < 0.2);
}

#[test]
fn reports_intersection_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            intersection("ab", "missing", json!(0), false),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 100.0),
            line_element("ab", "AB", "a", "b"),
        ],
        evaluation_limit_index: None,
    });

    assert_eq!(result.errors[0].element_id, "intersection");
    assert_eq!(result.errors[0].missing_dependency_id, "ab");
    assert_eq!(
        result.errors[0].missing_dependency_name.as_deref(),
        Some("AB")
    );
}

#[test]
fn reports_intersection_point_geometry_errors() {
    let base = vec![
        free_point("a", "A", 0.0, 0.0),
        free_point("b", "B", 100.0, 100.0),
        free_point("c", "C", 10.0, 25.0),
        free_point("d", "D", 40.0, 20.0),
        line_element("ab", "AB", "a", "b"),
        line_element("cd", "CD", "c", "d"),
    ];

    let same_line = evaluate_document_input(EvaluationInput {
        elements: [
            base.clone(),
            vec![intersection("ab", "ab", json!(0), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
    });
    let invalid_index = evaluate_document_input(EvaluationInput {
        elements: [
            base.clone(),
            vec![intersection("ab", "cd", json!(0.5), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
    });
    let out_of_range = evaluate_document_input(EvaluationInput {
        elements: [base, vec![intersection("ab", "cd", json!(1), false)]].concat(),
        evaluation_limit_index: None,
    });

    assert!(same_line.errors[0].message.contains("同じ線"));
    assert!(invalid_index.errors[0].message.contains("0以上の整数"));
    assert!(out_of_range.errors[0].message.contains("交点数は 1 個です"));
}

#[test]
fn reports_no_intersection_and_overlapping_lines() {
    let no_intersection = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("c", "C", 0.0, 10.0),
            free_point("d", "D", 10.0, 10.0),
            line_element("ab", "AB", "a", "b"),
            line_element("cd", "CD", "c", "d"),
            intersection("ab", "cd", json!(0), false),
        ],
        evaluation_limit_index: None,
    });
    let overlap = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 10.0, 0.0),
            free_point("c", "C", 5.0, 0.0),
            free_point("d", "D", 20.0, 0.0),
            line_element("ab", "AB", "a", "b"),
            line_element("cd", "CD", "c", "d"),
            intersection("ab", "cd", json!(0), false),
        ],
        evaluation_limit_index: None,
    });

    assert!(no_intersection.errors[0]
        .message
        .contains("交点を見つけられません"));
    assert!(overlap.errors[0].message.contains("重なっている"));
}

#[test]
fn evaluates_intersection_index_numeric_variables_and_expressions() {
    let result = evaluate_document_input(EvaluationInput {
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 100.0),
            free_point("c", "C", 0.0, 100.0),
            free_point("d", "D", 100.0, 0.0),
            line_element("ab", "AB", "a", "b"),
            line_element("cd", "CD", "c", "d"),
            element(json!({
                "id": "intersection",
                "name": "交点",
                "type": "intersectionPoint",
                "visible": true,
                "enabled": true,
                "numericVariables": [
                    { "id": "index", "name": "番号", "value": 0 }
                ],
                "line1Id": "ab",
                "line2Id": "cd",
                "intersectionIndex": { "kind": "expression", "expression": "@番号" },
                "useExtensions": false
            })),
        ],
        evaluation_limit_index: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    assert_eq!(intersection["x"], json!(50.0));
    assert_eq!(intersection["y"], json!(50.0));
}
