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
        "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": start },
        "endPoint": { "mode": "reference", "pointId": end }
    }))
}

fn free_point(id: &str, name: &str, x: f64, y: f64) -> Value {
    element(json!({
        "id": id,
        "name": name,
        "type": "freePoint",
        "activity": "visible",
        "x": x,
        "y": y
    }))
}

fn intersection(line1_id: &str, line2_id: &str, index: Value, use_extensions: bool) -> Value {
    element(json!({
        "id": "intersection",
        "name": "交点",
        "type": "intersectionPoint",
        "activity": "visible",
        "line1Id": line1_id,
        "line2Id": line2_id,
        "intersectionIndex": index,
        "useExtensions": use_extensions
    }))
}

#[test]
fn evaluates_intersection_point_between_line_segments() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
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
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: [
            base.clone(),
            vec![intersection("ab", "cd", json!(0), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    let with_extension = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: [base, vec![intersection("ab", "cd", json!(0), true)]].concat(),
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("p1", "P1", -20.0, 7.0),
            free_point("p2", "P2", 20.0, 7.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 180
            })),
            line_element("line", "水平線", "p1", "p2"),
            intersection("arc", "line", json!(0), false),
        ],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    // Analytic circle-vs-line precision (was +/-1.0 / +/-0.2 chord-sampling
    // tolerance before arc intersections were refined analytically).
    assert!((intersection["x"].as_f64().unwrap() - 51f64.sqrt()).abs() < 1e-6);
    assert!((intersection["y"].as_f64().unwrap() - 7.0).abs() < 1e-9);
}

#[test]
fn selects_intersection_point_by_index() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            free_point("center", "中心", 0.0, 0.0),
            free_point("p1", "P1", -20.0, 7.0),
            free_point("p2", "P2", 20.0, 7.0),
            element(json!({
                "id": "arc",
                "name": "円弧",
                "type": "arcLine",
                "activity": "visible",
                "centerPoint": { "mode": "reference", "pointId": "center" },
                "radius": 10,
                "startAngleDeg": 0,
                "endAngleDeg": 180
            })),
            line_element("line", "水平線", "p1", "p2"),
            intersection("arc", "line", json!(1), false),
        ],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    // Analytic circle-vs-line precision (see comment in the sibling test
    // above for the tolerance that was previously required).
    assert!((intersection["x"].as_f64().unwrap() + 51f64.sqrt()).abs() < 1e-6);
    assert!((intersection["y"].as_f64().unwrap() - 7.0).abs() < 1e-9);
}

#[test]
fn reports_intersection_point_dependency_that_appears_too_late() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            intersection("ab", "missing", json!(0), false),
            free_point("a", "A", 0.0, 0.0),
            free_point("b", "B", 100.0, 100.0),
            line_element("ab", "AB", "a", "b"),
        ],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
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
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: [
            base.clone(),
            vec![intersection("ab", "ab", json!(0), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    let invalid_index = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: [
            base.clone(),
            vec![intersection("ab", "cd", json!(0.5), false)],
        ]
        .concat(),
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    let out_of_range = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: [base, vec![intersection("ab", "cd", json!(1), false)]].concat(),
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(same_line.errors[0].message.contains("同じ線"));
    assert!(invalid_index.errors[0].message.contains("0以上の整数"));
    assert!(out_of_range.errors[0].message.contains("交点数は 1 個です"));
}

#[test]
fn reports_no_intersection_and_overlapping_lines() {
    let no_intersection = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
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
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });
    let overlap = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
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
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert!(no_intersection.errors[0]
        .message
        .contains("交点を見つけられません"));
    assert!(overlap.errors[0].message.contains("重なっている"));
}

#[test]
fn evaluates_intersection_index_numeric_parameter() {
    let result = evaluate_document_input(EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
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
                "activity": "visible",
                "line1Id": "ab",
                "line2Id": "cd",
                "intersectionIndex": 0,
                "useExtensions": false
            })),
        ],
        evaluation_limit_index: None,
        drawing_modifiers: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    let intersection = point(&result, "intersection");
    assert!(result.errors.is_empty());
    assert_eq!(intersection["x"], json!(50.0));
    assert_eq!(intersection["y"], json!(50.0));
}

#[test]
fn uses_offset_bezier_endpoint_tangents_for_extension_intersections() {
    let horizontal = json!({
        "kind": "offsetLine",
        "elementId": "horizontal",
        "name": "horizontal",
        "baseLineIds": [],
        "start": { "kind": "point", "elementId": "", "name": "", "x": -100.0, "y": 0.0 },
        "end": { "kind": "point", "elementId": "", "name": "", "x": 0.0, "y": 0.0 },
        "segments": [{
            "kind": "bezier",
            "start": { "kind": "point", "elementId": "", "name": "", "x": -100.0, "y": 0.0 },
            "control1": { "x": -70.0, "y": 0.0 },
            "control2": { "x": -30.0, "y": 0.0 },
            "end": { "kind": "point", "elementId": "", "name": "", "x": 0.0, "y": 0.0 },
            "length": 100.0
        }],
        "closed": false,
        "length": 100.0,
        "startTangentAngleDeg": null,
        "endTangentAngleDeg": null
    });
    let vertical = json!({
        "kind": "offsetLine",
        "elementId": "vertical",
        "name": "vertical",
        "baseLineIds": [],
        "start": { "kind": "point", "elementId": "", "name": "", "x": 10.0, "y": 10.0 },
        "end": { "kind": "point", "elementId": "", "name": "", "x": 10.0, "y": 20.0 },
        "segments": [{
            "kind": "bezier",
            "start": { "kind": "point", "elementId": "", "name": "", "x": 10.0, "y": 10.0 },
            "control1": { "x": 10.0, "y": 13.0 },
            "control2": { "x": 10.0, "y": 17.0 },
            "end": { "kind": "point", "elementId": "", "name": "", "x": 10.0, "y": 20.0 },
            "length": 10.0
        }],
        "closed": false,
        "length": 10.0,
        "startTangentAngleDeg": null,
        "endTangentAngleDeg": null
    });

    let finite = line_intersections::find_line_intersections(&horizontal, &vertical, false)
        .expect("expected finite result");
    assert!(finite.intersections.is_empty());

    let extended = line_intersections::find_line_intersections(&horizontal, &vertical, true)
        .expect("expected extended result");
    assert!(extended.error.is_none());
    assert!((extended.intersections[0].x - 10.0).abs() < 1e-9);
    assert!(extended.intersections[0].y.abs() < 1e-9);
}

fn arc_line_value_at(
    center_x: f64,
    center_y: f64,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) -> Value {
    let start_rad = start_angle_deg.to_radians();
    let end_rad = (start_angle_deg + sweep_angle_deg).to_radians();
    json!({
        "kind": "arcLine",
        "elementId": "circle",
        "name": "circle",
        "center": { "kind": "point", "elementId": "", "name": "", "x": center_x, "y": center_y },
        "start": { "kind": "point", "elementId": "", "name": "", "x": center_x + radius * start_rad.cos(), "y": center_y + radius * start_rad.sin() },
        "end": { "kind": "point", "elementId": "", "name": "", "x": center_x + radius * end_rad.cos(), "y": center_y + radius * end_rad.sin() },
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "endAngleDeg": start_angle_deg + sweep_angle_deg,
        "startTangentAngleDeg": 0.0,
        "endTangentAngleDeg": 0.0,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius.max(0.0) * sweep_angle_deg.to_radians().abs()
    })
}

fn arc_line_value(radius: f64, start_angle_deg: f64, sweep_angle_deg: f64) -> Value {
    arc_line_value_at(0.0, 0.0, radius, start_angle_deg, sweep_angle_deg)
}

fn horizontal_line_value(y: f64) -> Value {
    json!({
        "kind": "line",
        "elementId": "horizontal-line",
        "name": "水平線",
        "start": { "kind": "point", "elementId": "", "name": "", "x": -200.0, "y": y },
        "end": { "kind": "point", "elementId": "", "name": "", "x": 200.0, "y": y },
        "length": 400.0,
        "startAngleDeg": 0.0,
        "endAngleDeg": 180.0,
        "startTangentAngleDeg": 0.0,
        "endTangentAngleDeg": 180.0
    })
}

#[test]
fn refines_circle_and_line_intersection_to_analytic_precision() {
    // Radius-50 circle x line y=30 crosses at exactly (+/-40, 30). The old
    // 64-chord-per-360-degree sampling was off by ~0.1mm here; this asserts
    // the new analytic refinement lands within 1e-6.
    let circle = arc_line_value(50.0, 0.0, 360.0);
    let line = horizontal_line_value(30.0);

    let result = line_intersections::find_line_intersections(&circle, &line, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);

    let mut xs: Vec<f64> = result.intersections.iter().map(|item| item.x).collect();
    xs.sort_by(|a, b| a.total_cmp(b));
    assert!((xs[0] - (-40.0)).abs() < 1e-6, "got {xs:?}");
    assert!((xs[1] - 40.0).abs() < 1e-6, "got {xs:?}");
    for item in &result.intersections {
        assert!((item.y - 30.0).abs() < 1e-9);
    }
}

#[test]
fn excludes_circle_line_root_outside_the_arc_sweep_range() {
    // A quarter-circle from -45 to 45 degrees only covers the right-hand side
    // of the circle. The line y=30 intersects the *full* circle at x=+/-40,
    // but only x=+40 (angle ~36.87 degrees) falls inside this arc's sweep --
    // x=-40 (angle ~143.13 degrees) is mathematically on the circle yet
    // outside the swept range and must be excluded.
    let arc = arc_line_value(50.0, -45.0, 90.0);
    let line = horizontal_line_value(30.0);

    let result =
        line_intersections::find_line_intersections(&arc, &line, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].x - 40.0).abs() < 1e-6);
}

#[test]
fn refines_circle_and_line_intersection_with_negative_sweep() {
    // Same quarter-circle as above but swept backward (45 down to -45
    // degrees): still only x=+40 should be found, confirming negative sweep
    // is handled without sign errors in the sweep-fraction inversion.
    let arc = arc_line_value(50.0, 45.0, -90.0);
    let line = horizontal_line_value(30.0);

    let result =
        line_intersections::find_line_intersections(&arc, &line, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].x - 40.0).abs() < 1e-6);
}

#[test]
fn refines_tangent_line_to_circle_intersection() {
    // y=50 is tangent to a radius-50 circle centered at the origin: a single
    // double root at (0, 50).
    let circle = arc_line_value(50.0, 0.0, 360.0);
    let line = horizontal_line_value(50.0);

    let result = line_intersections::find_line_intersections(&circle, &line, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].x).abs() < 1e-6);
    assert!((result.intersections[0].y - 50.0).abs() < 1e-9);
}

#[test]
fn refines_circle_and_circle_intersection_to_analytic_precision() {
    // Circle A: center (0,0) r=50. Circle B: center (60,0) r=50. Analytic
    // solution crosses at exactly (30, +/-40).
    let a = arc_line_value_at(0.0, 0.0, 50.0, 0.0, 360.0);
    let b = arc_line_value_at(60.0, 0.0, 50.0, 0.0, 360.0);

    let result =
        line_intersections::find_line_intersections(&a, &b, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);
    let mut ys: Vec<f64> = result.intersections.iter().map(|item| item.y).collect();
    ys.sort_by(|left, right| left.total_cmp(right));
    assert!((ys[0] - (-40.0)).abs() < 1e-6, "got {ys:?}");
    assert!((ys[1] - 40.0).abs() < 1e-6, "got {ys:?}");
    for item in &result.intersections {
        assert!((item.x - 30.0).abs() < 1e-6);
    }
}

#[test]
fn excludes_circle_circle_root_outside_the_arc_sweep_range() {
    // Same two circles as above, but circle A is only a quarter-arc from -10
    // to 100 degrees. Relative to A's center (0,0), (30,40) sits at ~53.13
    // degrees (inside the sweep) while (30,-40) sits at ~-53.13 degrees
    // (outside), so only the first point should survive.
    let a = arc_line_value_at(0.0, 0.0, 50.0, -10.0, 110.0);
    let b = arc_line_value_at(60.0, 0.0, 50.0, 0.0, 360.0);

    let result =
        line_intersections::find_line_intersections(&a, &b, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].y - 40.0).abs() < 1e-6);
}

#[test]
fn refines_circle_and_circle_intersection_with_negative_sweep() {
    let a = arc_line_value_at(0.0, 0.0, 50.0, 100.0, -110.0);
    let b = arc_line_value_at(60.0, 0.0, 50.0, 0.0, 360.0);

    let result =
        line_intersections::find_line_intersections(&a, &b, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].y - 40.0).abs() < 1e-6);
}

#[test]
fn refines_near_tangent_circle_and_circle_intersection_stably() {
    // Centers 99.99 apart (both radius 50, so 0.01mm short of exactly
    // externally tangent): true single-point tangency isn't reliably seedable
    // through the 64-chord rough-crossing pass (a smooth external tangency's
    // chord approximation bulges inward on both sides and generally never
    // actually crosses), but a hair short of tangent still gives two genuine,
    // very-close-together crossings for the seed to find. This exercises the
    // quadratic solver right at the edge of its near-zero-discriminant branch
    // without depending on exact tangency being seedable.
    let d = 99.99;
    let a = arc_line_value_at(0.0, 0.0, 50.0, 0.0, 360.0);
    let b = arc_line_value_at(d, 0.0, 50.0, 0.0, 360.0);

    let result =
        line_intersections::find_line_intersections(&a, &b, false).expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);
    for item in &result.intersections {
        // Every reported point must sit on both circles to within tolerance.
        assert!((item.x.hypot(item.y) - 50.0).abs() < 1e-6);
        assert!(((item.x - d).hypot(item.y) - 50.0).abs() < 1e-6);
    }
}

fn vertical_bezier_value() -> Value {
    // A cubic whose control points are all on x=0 stays exactly on x=0 for
    // every t, crossing a radius-50 circle centered at the origin at exactly
    // (0, -50) and (0, 50).
    json!({
        "kind": "bezierCurve",
        "elementId": "curve",
        "name": "曲線",
        "segments": [{
            "start": { "x": 0.0, "y": -100.0 },
            "control1": { "x": 0.0, "y": -33.0 },
            "control2": { "x": 0.0, "y": 33.0 },
            "end": { "x": 0.0, "y": 100.0 }
        }]
    })
}

#[test]
fn refines_bezier_and_circle_intersection_to_analytic_precision() {
    let curve = vertical_bezier_value();
    let circle = arc_line_value(50.0, 0.0, 360.0);

    let result = line_intersections::find_line_intersections(&curve, &circle, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);
    let mut ys: Vec<f64> = result.intersections.iter().map(|item| item.y).collect();
    ys.sort_by(|left, right| left.total_cmp(right));
    assert!((ys[0] - (-50.0)).abs() < 1e-6, "got {ys:?}");
    assert!((ys[1] - 50.0).abs() < 1e-6, "got {ys:?}");
    for item in &result.intersections {
        assert!(item.x.abs() < 1e-6);
    }
}

#[test]
fn excludes_bezier_circle_root_outside_the_arc_sweep_range() {
    // Only the right-hand quarter circle (-45..45 degrees) is present. The
    // vertical bezier crosses the *full* circle at (0,-50) and (0,50), but
    // neither of those points (at 90 and -90 degrees) lies inside this arc's
    // sweep, so no intersections should be reported at all.
    let curve = vertical_bezier_value();
    let arc = arc_line_value(50.0, -45.0, 90.0);

    let result = line_intersections::find_line_intersections(&curve, &arc, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert!(result.intersections.is_empty());
}

#[test]
fn refines_bezier_and_circle_intersection_with_negative_sweep() {
    // Arc swept backward from 135 down to 45 degrees covers exactly (0,50)
    // (90 degrees) and excludes (0,-50) (-90 degrees, outside this sweep).
    let curve = vertical_bezier_value();
    let arc = arc_line_value(50.0, 135.0, -90.0);

    let result = line_intersections::find_line_intersections(&curve, &arc, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].y - 50.0).abs() < 1e-6);
    assert!(result.intersections[0].x.abs() < 1e-6);
}

#[test]
fn keeps_near_full_positive_and_negative_arc_intersections_exact() {
    let curve = vertical_bezier_value();
    for (start_angle_deg, sweep_angle_deg) in [(1.0, 358.0), (359.0, -358.0)] {
        let arc = arc_line_value(50.0, start_angle_deg, sweep_angle_deg);
        let result = line_intersections::find_line_intersections(&curve, &arc, false)
            .expect("expected a result");
        assert!(result.error.is_none());
        assert_eq!(result.intersections.len(), 2);
        for item in result.intersections {
            assert!((item.x.hypot(item.y) - 50.0).abs() < 1e-6);
            assert!(item.x.abs() < 1e-6);
        }
    }
}

#[test]
fn keeps_a_full_circle_seam_in_its_local_seed_chord() {
    let angle_deg = 17.0_f64;
    let angle_rad = angle_deg.to_radians();
    let radial = (angle_rad.cos(), angle_rad.sin());
    let tangent = (-radial.1, radial.0);
    let contact = (radial.0 * 50.0, radial.1 * 50.0);
    let line = json!({
        "kind": "line", "elementId": "seam-tangent", "name": "seam-tangent",
        "start": { "x": contact.0 - tangent.0 * 100.0, "y": contact.1 - tangent.1 * 100.0 },
        "end": { "x": contact.0 + tangent.0 * 100.0, "y": contact.1 + tangent.1 * 100.0 },
        "length": 200.0
    });
    let result = line_intersections::find_line_intersections(
        &arc_line_value(50.0, angle_deg, 360.0),
        &line,
        false,
    )
    .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!((result.intersections[0].x - contact.0).abs() < 1e-6);
    assert!((result.intersections[0].y - contact.1).abs() < 1e-6);
}

#[test]
fn keeps_all_three_local_roots_of_a_multi_root_bezier_pair() {
    let wavy = json!({
        "kind": "bezierCurve", "elementId": "wavy", "name": "wavy", "segments": [{
            "start": { "x": 0.0, "y": -10.0 },
            "control1": { "x": 100.0 / 3.0, "y": 30.0 },
            "control2": { "x": 200.0 / 3.0, "y": -30.0 },
            "end": { "x": 100.0, "y": 10.0 }
        }]
    });
    let axis = json!({
        "kind": "bezierCurve", "elementId": "axis", "name": "axis", "segments": [{
            "start": { "x": -10.0, "y": 0.0 },
            "control1": { "x": 30.0, "y": 0.0 },
            "control2": { "x": 70.0, "y": 0.0 },
            "end": { "x": 110.0, "y": 0.0 }
        }]
    });
    let result = line_intersections::find_line_intersections(&wavy, &axis, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 3);
    assert!(result
        .intersections
        .windows(2)
        .all(|pair| pair[0].x < pair[1].x));
    assert!(result.intersections.iter().all(|item| item.y.abs() < 1e-6));
}

#[test]
fn discards_bezier_arc_rough_candidate_when_no_exact_root_exists() {
    let inside = json!({
        "kind": "bezierCurve", "elementId": "inside", "name": "inside", "segments": [{
            "start": { "x": 49.997, "y": -1.0 },
            "control1": { "x": 49.997, "y": 0.0 },
            "control2": { "x": 49.997, "y": 1.0 },
            "end": { "x": 49.997, "y": 2.0 }
        }]
    });
    let result = line_intersections::find_line_intersections(
        &inside,
        &arc_line_value(50.0, 0.0, 1.0),
        false,
    )
    .expect("expected a result");
    assert!(result.error.is_none());
    assert!(result.intersections.is_empty());
}

fn offset_line_value(segments: Vec<Value>, closed: bool) -> Value {
    json!({
        "kind": "offsetLine",
        "elementId": "offset",
        "name": "オフセット",
        "baseLineIds": [],
        "start": segments.first().and_then(|segment| segment.get("start")).cloned().unwrap_or(Value::Null),
        "end": segments.last().and_then(|segment| segment.get("end")).cloned().unwrap_or(Value::Null),
        "segments": segments,
        "closed": closed,
        "length": 0,
        "startTangentAngleDeg": null,
        "endTangentAngleDeg": null
    })
}

fn bezier_segment_value(
    start: (f64, f64),
    control1: (f64, f64),
    control2: (f64, f64),
    end: (f64, f64),
) -> Value {
    json!({
        "kind": "bezier",
        "start": { "kind": "point", "elementId": "", "name": "", "x": start.0, "y": start.1 },
        "control1": { "x": control1.0, "y": control1.1 },
        "control2": { "x": control2.0, "y": control2.1 },
        "end": { "kind": "point", "elementId": "", "name": "", "x": end.0, "y": end.1 },
        "length": (end.1 - start.1).hypot(end.0 - start.0)
    })
}

fn line_segment_value(start: (f64, f64), end: (f64, f64)) -> Value {
    json!({
        "kind": "line",
        "start": { "kind": "point", "elementId": "", "name": "", "x": start.0, "y": start.1 },
        "end": { "kind": "point", "elementId": "", "name": "", "x": end.0, "y": end.1 },
        "length": (end.1 - start.1).hypot(end.0 - start.0)
    })
}

fn arc_segment_value(
    center: (f64, f64),
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) -> Value {
    let start_rad = start_angle_deg.to_radians();
    let end_rad = (start_angle_deg + sweep_angle_deg).to_radians();
    json!({
        "kind": "arc",
        "center": { "kind": "point", "elementId": "", "name": "", "x": center.0, "y": center.1 },
        "start": { "kind": "point", "elementId": "", "name": "", "x": center.0 + radius * start_rad.cos(), "y": center.1 + radius * start_rad.sin() },
        "end": { "kind": "point", "elementId": "", "name": "", "x": center.0 + radius * end_rad.cos(), "y": center.1 + radius * end_rad.sin() },
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius.max(0.0) * sweep_angle_deg.to_radians().abs()
    })
}

#[test]
fn refines_offset_line_bezier_segment_against_a_bezier_curve() {
    // The offset line's single "bezier" sub-segment is the same vertical
    // curve used elsewhere in this file (x=0 for all t). Before the offset
    // segment dispatch was rewritten to preserve analytic primitives, this
    // would have flattened to an approximate polyline and never reached
    // bezier x bezier Newton refinement at all.
    let offset = offset_line_value(
        vec![bezier_segment_value(
            (0.0, -100.0),
            (0.0, -33.0),
            (0.0, 33.0),
            (0.0, 100.0),
        )],
        false,
    );
    let horizontal = json!({
        "kind": "bezierCurve",
        "elementId": "horizontal",
        "name": "horizontal",
        "segments": [bezier_segment_value((-50.0, 25.0), (-16.0, 25.0), (16.0, 25.0), (50.0, 25.0))]
    });

    let result = line_intersections::find_line_intersections(&offset, &horizontal, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!(result.intersections[0].x.abs() < 1e-6);
    assert!((result.intersections[0].y - 25.0).abs() < 1e-6);
}

#[test]
fn refines_offset_line_straight_segment_against_a_bezier_curve() {
    // The offset line's single "line" sub-segment is a genuine straight
    // segment (offset of a straight base line), which should be treated as
    // an exact Line primitive and refined against the bezier via the
    // existing bisection path -- previously offsetLine sub-segments were
    // never marked "exact" so this refinement never fired.
    let offset = offset_line_value(vec![line_segment_value((0.0, -100.0), (0.0, 100.0))], false);
    let horizontal = json!({
        "kind": "bezierCurve",
        "elementId": "horizontal",
        "name": "horizontal",
        "segments": [bezier_segment_value((-50.0, 25.0), (-16.0, 25.0), (16.0, 25.0), (50.0, 25.0))]
    });

    let result = line_intersections::find_line_intersections(&offset, &horizontal, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 1);
    assert!(result.intersections[0].x.abs() < 1e-6);
    assert!((result.intersections[0].y - 25.0).abs() < 1e-6);
}

#[test]
fn refines_offset_line_arc_segment_against_a_line() {
    let offset = offset_line_value(vec![arc_segment_value((0.0, 0.0), 50.0, 0.0, 360.0)], false);
    let line = horizontal_line_value(30.0);

    let result = line_intersections::find_line_intersections(&offset, &line, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);
    let mut xs: Vec<f64> = result.intersections.iter().map(|item| item.x).collect();
    xs.sort_by(|left, right| left.total_cmp(right));
    assert!((xs[0] - (-40.0)).abs() < 1e-6, "got {xs:?}");
    assert!((xs[1] - 40.0).abs() < 1e-6, "got {xs:?}");
}

#[test]
fn finds_intersections_against_a_closed_offset_line() {
    // Regression test: Rust's path_segments_for_line used to early-return an
    // empty segment list for closed offset lines, so a closed offset line
    // never reported any intersections at all (TS always did). A closed
    // square-ish offset line (four straight sub-segments) crossed by a
    // vertical line through its interior should report two crossings.
    let offset = offset_line_value(
        vec![
            line_segment_value((-50.0, -50.0), (50.0, -50.0)),
            line_segment_value((50.0, -50.0), (50.0, 50.0)),
            line_segment_value((50.0, 50.0), (-50.0, 50.0)),
            line_segment_value((-50.0, 50.0), (-50.0, -50.0)),
        ],
        true,
    );
    let vertical = json!({
        "kind": "line",
        "elementId": "vertical-line",
        "name": "垂直線",
        "start": { "kind": "point", "elementId": "", "name": "", "x": 0.0, "y": -200.0 },
        "end": { "kind": "point", "elementId": "", "name": "", "x": 0.0, "y": 200.0 },
        "length": 400.0
    });

    let result = line_intersections::find_line_intersections(&offset, &vertical, false)
        .expect("expected a result");
    assert!(result.error.is_none());
    assert_eq!(result.intersections.len(), 2);
    let mut ys: Vec<f64> = result.intersections.iter().map(|item| item.y).collect();
    ys.sort_by(|left, right| left.total_cmp(right));
    assert!((ys[0] - (-50.0)).abs() < 1e-6, "got {ys:?}");
    assert!((ys[1] - 50.0).abs() < 1e-6, "got {ys:?}");
}
