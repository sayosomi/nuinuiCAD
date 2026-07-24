use super::edge_extend_test_support::*;
use super::*;
use serde_json::json;

#[test]
fn extend_trim_extends_line_and_supports_coordinate_target() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "coordinate", "x": 140, "y": 0 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    assert!(geometry_missing(&result, "extend"));
    assert_close(
        geometry(&result, "line")["end"]["x"].as_f64().unwrap(),
        140.0,
    );
    assert_close(geometry(&result, "line")["length"].as_f64().unwrap(), 140.0);
}

#[test]
fn extend_trim_reports_line_target_error_and_dependency_error() {
    let target_error = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "外点", 140.0, 20.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    assert!(target_error.errors[0]
        .message
        .contains("直線上または延長線上"));

    let dependency_error = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![element(json!({
            "id": "extend",
            "name": "延長短縮",
            "type": "extendTrim",
            "visible": true,
            "enabled": true,
            "endpoint": { "lineId": "missing", "endpointKey": "end" },
            "point": { "mode": "reference", "pointId": "target" }
        }))],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    assert_eq!(dependency_error.errors[0].missing_dependency_id, "target");
}

#[test]
fn extend_trim_moves_arc_endpoint() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("target", "目標", -10.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let arc = geometry(&result, "arc");
    assert_close(arc["endAngleDeg"].as_f64().unwrap(), 180.0);
    assert_close(arc["sweepAngleDeg"].as_f64().unwrap(), 180.0);
    assert_close(arc["end"]["x"].as_f64().unwrap(), -10.0);
}

#[test]
fn extend_trim_moves_bezier_endpoint_on_tangent() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            free_point("target", "目標", -20.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "start" },
                "startHandleAngleDeg": 0,
                "startHandleLength": 30,
                "intermediatePoints": [],
                "endPoint": { "mode": "reference", "pointId": "end" },
                "endHandleAngleDeg": 180,
                "endHandleLength": 30
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let curve = geometry(&result, "curve");
    assert_close(curve["segments"][0]["start"]["x"].as_f64().unwrap(), -20.0);
    assert_close(
        curve["segments"][0]["control1"]["x"].as_f64().unwrap(),
        10.0,
    );
}

#[test]
fn extend_trim_shortens_bezier_to_division_point_on_body() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            arch_curve("curve", "曲線", "start", "end"),
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "placement": { "kind": "distance", "value": 40 }
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "division" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let division = geometry(&result, "division");
    let curve = geometry(&result, "curve");
    let segments = curve["segments"].as_array().unwrap();
    let moved_end = &segments.last().unwrap()["end"];
    // The division point is on the analytic curve, so the endpoint lands on it exactly.
    assert_close(
        moved_end["x"].as_f64().unwrap(),
        division["x"].as_f64().unwrap(),
    );
    assert_close(
        moved_end["y"].as_f64().unwrap(),
        division["y"].as_f64().unwrap(),
    );
    assert_close(segments[0]["start"]["x"].as_f64().unwrap(), 0.0);
    assert!(curve["length"].as_f64().unwrap() < 100.0);

    // The retained portion must be a true de Casteljau sub-curve: sampling it at t=0.5
    // must land on the same point as sampling the original curve at half the split's t.
    let original = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            arch_curve("curve", "曲線", "start", "end"),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    let original_curve = geometry(&original, "curve");
    let original_segment = &original_curve["segments"].as_array().unwrap()[0];
    let original_start = original_segment["start"].clone();
    let original_control1 = original_segment["control1"].clone();
    let original_control2 = original_segment["control2"].clone();
    let original_end = original_segment["end"].clone();

    let trimmed_segment = &segments[0];
    // The split-point global t is unknown analytically here, so instead verify the
    // control points changed on BOTH sides (not just the truncated endpoint side) --
    // the regression this guards against left control1 untouched.
    assert!(
        (trimmed_segment["control1"]["x"].as_f64().unwrap()
            - original_control1["x"].as_f64().unwrap())
        .abs()
            > 1e-6
            || (trimmed_segment["control1"]["y"].as_f64().unwrap()
                - original_control1["y"].as_f64().unwrap())
            .abs()
                > 1e-6,
        "control1 of the truncated segment must be recomputed by the split, not left at the original value"
    );
    assert_eq!(trimmed_segment["start"], original_start);
    assert_ne!(trimmed_segment["control2"], original_control2);
    assert_ne!(trimmed_segment["end"], original_end);
}

#[test]
fn extend_trim_shortens_bezier_start_to_division_point_on_body() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            arch_curve("curve", "曲線", "start", "end"),
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "placement": { "kind": "distance", "value": 60 }
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "point": { "mode": "reference", "pointId": "division" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let division = geometry(&result, "division");
    let curve = geometry(&result, "curve");
    let segments = curve["segments"].as_array().unwrap();
    let moved_start = &segments[0]["start"];
    assert_close(
        moved_start["x"].as_f64().unwrap(),
        division["x"].as_f64().unwrap(),
    );
    assert_close(
        moved_start["y"].as_f64().unwrap(),
        division["y"].as_f64().unwrap(),
    );
    assert_close(
        segments.last().unwrap()["end"]["x"].as_f64().unwrap(),
        100.0,
    );
    assert!(curve["length"].as_f64().unwrap() < 100.0);
}

#[test]
fn extend_trim_shortens_multi_segment_bezier_and_keeps_untouched_segments() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "点A", 0.0, 0.0),
            free_point("b", "点B", 50.0, 30.0),
            free_point("c", "点C", 100.0, 0.0),
            element(json!({
                "id": "curve",
                "name": "曲線ABC",
                "type": "bezierCurve",
                "visible": true,
                "enabled": true,
                "startPoint": { "mode": "reference", "pointId": "a" },
                "startHandleAngleDeg": 90,
                "startHandleLength": 20,
                "intermediatePoints": [
                    {
                        "id": "mid-1",
                        "point": { "mode": "reference", "pointId": "b" },
                        "handleAngleDeg": 0,
                        "incomingHandleLength": 10,
                        "outgoingHandleLength": 10
                    }
                ],
                "endPoint": { "mode": "reference", "pointId": "c" },
                "endHandleAngleDeg": 270,
                "endHandleLength": 20
            })),
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.25 }
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "division" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let curve = geometry(&result, "curve");
    let segments = curve["segments"].as_array().unwrap();
    // The division point (ratio 0.25 along the whole path) falls inside the first
    // segment, so the second segment must be dropped entirely and the first segment
    // truncated -- untouched geometry (the first segment's start/control1 handle
    // coming from the curve's own start) must be preserved verbatim.
    assert_eq!(segments.len(), 1);
    assert_close(segments[0]["start"]["x"].as_f64().unwrap(), 0.0);
    assert_close(segments[0]["start"]["y"].as_f64().unwrap(), 0.0);
    assert_eq!(curve["intermediatePointIds"], json!([]));
}

#[test]
fn extend_trim_bezier_to_opposite_anchor_reports_zero_length_error() {
    // Regression: trimming the curve's end to a point that coincides with its own
    // start (as when a user meant to target a division point but referenced the
    // curve's start anchor instead) must produce the zero-length error, not the
    // misleading "not on the endpoint-angle line" error.
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            arch_curve("curve", "曲線", "start", "end"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "start" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(!result.errors.is_empty());
    assert!(result.errors[0].message.contains("長さが0になるため"));
}

#[test]
fn extend_trim_shortens_bezier_to_intersection_point_on_body() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("start", "始点", 0.0, 0.0),
            free_point("end", "終点", 100.0, 0.0),
            free_point("c", "C", 70.0, -50.0),
            free_point("d", "D", 70.0, 50.0),
            arch_curve("curve", "曲線", "start", "end"),
            line("vline", "縦線", "c", "d"),
            element(json!({
                "id": "intersection",
                "name": "交点",
                "type": "intersectionPoint",
                "visible": true,
                "enabled": true,
                "line1Id": "vline",
                "line2Id": "curve",
                "intersectionIndex": 0,
                "useExtensions": false
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "curve", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "intersection" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let intersection = geometry(&result, "intersection");
    let curve = geometry(&result, "curve");
    let moved_end = &curve["segments"].as_array().unwrap().last().unwrap()["end"];
    assert_close(
        moved_end["x"].as_f64().unwrap(),
        intersection["x"].as_f64().unwrap(),
    );
    assert_close(
        moved_end["y"].as_f64().unwrap(),
        intersection["y"].as_f64().unwrap(),
    );
}

#[test]
fn extend_trim_shortens_arc_to_division_point_on_circle() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "visible": true,
                "enabled": true,
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 90
            })),
            element(json!({
                "id": "division",
                "name": "線上分点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "start" },
                "placement": { "kind": "distance", "value": 5 }
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "arc", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "division" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let division = geometry(&result, "division");
    let dx = division["x"].as_f64().unwrap();
    let dy = division["y"].as_f64().unwrap();
    // The division point lies exactly on the circle (radius 10), not on a chord.
    assert_close((dx * dx + dy * dy).sqrt(), 10.0);
    // The arc end is trimmed onto it.
    let arc = geometry(&result, "arc");
    assert_close(arc["end"]["x"].as_f64().unwrap(), dx);
    assert_close(arc["end"]["y"].as_f64().unwrap(), dy);
}

#[test]
fn extend_trim_moves_open_offset_line_and_rejects_closed_offset_line() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, -10.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["line"],
                "offset": 10,
                "side": "right",
                "closed": false
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "offset", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    assert_close(
        offset["segments"].as_array().unwrap().last().unwrap()["end"]["x"]
            .as_f64()
            .unwrap(),
        140.0,
    );
    assert_close(
        offset["segments"].as_array().unwrap().last().unwrap()["end"]["y"]
            .as_f64()
            .unwrap(),
        -10.0,
    );

    let closed = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, -10.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "offset",
                "name": "オフセット",
                "type": "offsetLine",
                "visible": true,
                "enabled": true,
                "baseLineIds": ["line"],
                "offset": 10,
                "side": "right",
                "closed": true
            })),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "offset", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    assert!(closed.errors[0].message.contains("閉じた線"));
}

#[test]
fn updated_line_can_feed_downstream_rust_elements() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 0.0),
            free_point("target", "目標", 140.0, 0.0),
            line("line", "線", "a", "b"),
            element(json!({
                "id": "extend",
                "name": "延長短縮",
                "type": "extendTrim",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "end" },
                "point": { "mode": "reference", "pointId": "target" }
            })),
            element(json!({
                "id": "mid",
                "name": "中点",
                "type": "lineDivisionPoint",
                "visible": true,
                "enabled": true,
                "endpoint": { "lineId": "line", "endpointKey": "start" },
                "placement": { "kind": "ratio", "value": 0.5 }
            })),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    assert_close(geometry(&result, "mid")["x"].as_f64().unwrap(), 70.0);
}

fn offset_bezier_elements() -> Vec<Value> {
    vec![
        free_point("start", "始点", 0.0, 0.0),
        free_point("end", "終点", 100.0, 0.0),
        arch_curve("curve", "曲線", "start", "end"),
        element(json!({
            "id": "offset",
            "name": "オフセット",
            "type": "offsetLine",
            "visible": true,
            "enabled": true,
            "baseLineIds": ["curve"],
            "offset": 10,
            "side": "right",
            "closed": false
        })),
    ]
}

// Evaluate a cubic bezier segment (from its JSON control points) at t, mirroring
// the production cubic point formula, so tests can pick a target that is
// exactly on the analytic curve without depending on chord sampling.
fn cubic_point_at_json(segment: &Value, t: f64) -> (f64, f64) {
    let point = |key: &str| -> (f64, f64) {
        let value = &segment[key];
        (value["x"].as_f64().unwrap(), value["y"].as_f64().unwrap())
    };
    let (sx, sy) = point("start");
    let (c1x, c1y) = point("control1");
    let (c2x, c2y) = point("control2");
    let (ex, ey) = point("end");
    let inverse = 1.0 - t;
    let a = inverse * inverse * inverse;
    let b = 3.0 * inverse * inverse * t;
    let c = 3.0 * inverse * t * t;
    let d = t * t * t;
    (
        a * sx + b * c1x + c * c2x + d * ex,
        a * sy + b * c1y + c * c2y + d * ey,
    )
}

#[test]
fn extend_trim_shortens_offset_bezier_and_keeps_untouched_segments_analytic() {
    // Offsetting a bezier curve adaptively fits many small analytic bezier
    // sub-segments. Trimming inside one of them must truncate only that
    // segment and leave every other segment byte-identical -- previously the
    // whole offset line was flattened into an all-"line" polyline.
    let elements = offset_bezier_elements();
    let baseline = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: elements.clone(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    let original_offset = geometry(&baseline, "offset");
    let original_segments = original_offset["segments"].as_array().unwrap().clone();
    assert!(original_segments.len() > 2);
    assert!(original_segments
        .iter()
        .all(|segment| segment["kind"] == json!("bezier")));

    let mid = original_segments.len() / 2;
    let (target_x, target_y) = cubic_point_at_json(&original_segments[mid], 0.5);

    let mut extended_elements = elements;
    extended_elements.push(free_point("target", "目標", target_x, target_y));
    extended_elements.push(element(json!({
        "id": "extend",
        "name": "延長短縮",
        "type": "extendTrim",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "offset", "endpointKey": "start" },
        "point": { "mode": "reference", "pointId": "target" }
    })));
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: extended_elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    let segments = offset["segments"].as_array().unwrap();
    assert_eq!(segments.len(), original_segments.len() - mid);
    assert_eq!(segments[0]["kind"], json!("bezier"));
    assert_close(segments[0]["start"]["x"].as_f64().unwrap(), target_x);
    assert_close(segments[0]["start"]["y"].as_f64().unwrap(), target_y);
    assert_eq!(segments[0]["end"], original_segments[mid]["end"]);
    // Every later segment must be untouched, byte-for-byte.
    for (segment, original) in segments[1..]
        .iter()
        .zip(original_segments[mid + 1..].iter())
    {
        assert_eq!(segment, original);
    }
    assert!(offset["length"].as_f64().unwrap() < original_offset["length"].as_f64().unwrap());
}

#[test]
fn extend_trim_extends_offset_bezier_endpoint_by_appending_line_segment() {
    // Extending past the offset curve's analytic endpoint tangent must append
    // a new "line" segment rather than flattening the existing bezier chain.
    let elements = offset_bezier_elements();
    let probe = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: elements.clone(),
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });
    let probe_offset = geometry(&probe, "offset");
    let original_segments = probe_offset["segments"].as_array().unwrap().clone();
    let end_x = probe_offset["end"]["x"].as_f64().unwrap();
    let end_y = probe_offset["end"]["y"].as_f64().unwrap();
    let end_tangent_deg = probe_offset["endTangentAngleDeg"].as_f64().unwrap();
    let angle_rad = end_tangent_deg.to_radians();
    let target_x = end_x + angle_rad.cos() * 20.0;
    let target_y = end_y + angle_rad.sin() * 20.0;

    let mut extended_elements = elements;
    extended_elements.push(free_point("target", "目標", target_x, target_y));
    extended_elements.push(element(json!({
        "id": "extend",
        "name": "延長短縮",
        "type": "extendTrim",
        "visible": true,
        "enabled": true,
        "endpoint": { "lineId": "offset", "endpointKey": "end" },
        "point": { "mode": "reference", "pointId": "target" }
    })));
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: extended_elements,
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
    });

    assert!(result.errors.is_empty());
    let offset = geometry(&result, "offset");
    let segments = offset["segments"].as_array().unwrap();
    assert_eq!(segments.len(), original_segments.len() + 1);
    // Every original segment must be untouched.
    for (segment, original) in segments.iter().zip(original_segments.iter()) {
        assert_eq!(segment, original);
    }
    // A new straight segment was appended to reach the target.
    let appended = segments.last().unwrap();
    assert_eq!(appended["kind"], json!("line"));
    assert_close(appended["end"]["x"].as_f64().unwrap(), target_x);
    assert_close(appended["end"]["y"].as_f64().unwrap(), target_y);
    assert!(offset["length"].as_f64().unwrap() > probe_offset["length"].as_f64().unwrap());
}
