use std::collections::HashMap;

use serde_json::json;

use super::geometry_builtin_runtime::{
    resolve_geometry_builtin_target, validate_geometry_builtin_arguments,
    GeometryBuiltinRuntimeError, GeometryBuiltinRuntimeTarget,
};
use super::types::{
    BuiltinFunctionName, GeometryInterfaceType, ScalarExpressionResolvedGeometryTarget,
    TypedBuiltinArgument,
};
use crate::evaluation::types::{EvaluationState, Point};

fn point_value(x: f64, y: f64) -> serde_json::Value {
    json!({"kind": "point", "elementId": "point", "name": "point", "x": x, "y": y})
}

fn line_value(start: serde_json::Value, end: serde_json::Value) -> serde_json::Value {
    json!({"kind": "line", "start": start, "end": end})
}

fn state_with_geometry(
    id: &str,
    geometry: serde_json::Value,
    include_element: bool,
) -> EvaluationState {
    let mut elements_by_id = HashMap::new();
    if include_element {
        elements_by_id.insert(id.to_owned(), 0);
    }
    EvaluationState {
        elements: if include_element {
            vec![json!({"id": id})]
        } else {
            Vec::new()
        },
        elements_by_id,
        drawing_modifiers: serde_json::json!([]),
        selected_drawing_profile_id: None,
        group_states: HashMap::new(),
        computed_geometry: HashMap::from([(id.to_owned(), geometry)]),
        computed_geometry_order: vec![id.to_owned()],
        pre_mutation_geometry: HashMap::new(),
        geometry_mutation_executions: Vec::new(),
        condition_evaluation_traces: Vec::new(),
        instance_base_geometry: HashMap::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn disabled_state_with_geometry(id: &str, geometry: serde_json::Value) -> EvaluationState {
    let mut state = state_with_geometry(id, geometry, true);
    state.elements = vec![json!({"id": id, "activity": "disabled"})];
    state
}

fn target(
    id: &str,
    index: usize,
    geometry_type: GeometryInterfaceType,
) -> ScalarExpressionResolvedGeometryTarget {
    ScalarExpressionResolvedGeometryTarget {
        statement_id: id.to_owned(),
        statement_index: index,
        geometry_type,
        point_key: None,
    }
}

fn derived_target(
    id: &str,
    index: usize,
    point_key: &str,
) -> ScalarExpressionResolvedGeometryTarget {
    ScalarExpressionResolvedGeometryTarget {
        statement_id: id.to_owned(),
        statement_index: index,
        geometry_type: GeometryInterfaceType::Point,
        point_key: Some(point_key.to_owned()),
    }
}

fn point_runtime() -> GeometryBuiltinRuntimeTarget {
    GeometryBuiltinRuntimeTarget::Point(Point {
        element_id: "point".to_owned(),
        name: "point".to_owned(),
        x: 0.0,
        y: 0.0,
    })
}

fn line_runtime(length: f64) -> GeometryBuiltinRuntimeTarget {
    GeometryBuiltinRuntimeTarget::Line {
        start: Point {
            element_id: "start".to_owned(),
            name: "start".to_owned(),
            x: 0.0,
            y: 0.0,
        },
        end: Point {
            element_id: "end".to_owned(),
            name: "end".to_owned(),
            x: length,
            y: 0.0,
        },
    }
}

#[test]
fn earlier_point_target_resolves() {
    let state = state_with_geometry("point-id", point_value(2.0, 3.0), true);
    assert!(matches!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("point-id", 1, GeometryInterfaceType::Point)
        ),
        Ok(GeometryBuiltinRuntimeTarget::Point(_))
    ));
}

#[test]
fn hidden_geometry_target_remains_usable() {
    let mut state = state_with_geometry("point-id", point_value(2.0, 3.0), true);
    state.elements = vec![json!({
        "id": "point-id",
        "type": "freePoint",
        "activity": "hidden"
    })];
    assert!(matches!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("point-id", 1, GeometryInterfaceType::Point)
        ),
        Ok(GeometryBuiltinRuntimeTarget::Point(_))
    ));
}

#[test]
fn disabled_geometry_target_has_a_distinct_runtime_failure() {
    let state = disabled_state_with_geometry("point-id", point_value(2.0, 3.0));
    let expected_target = target("point-id", 1, GeometryInterfaceType::Point);
    assert_eq!(
        resolve_geometry_builtin_target(&state, 2, &expected_target),
        Err(GeometryBuiltinRuntimeError::Disabled(expected_target))
    );
}

#[test]
fn modifier_disabled_geometry_target_has_a_distinct_runtime_failure() {
    let mut state = state_with_geometry("point-id", point_value(2.0, 3.0), true);
    state.elements = vec![json!({
        "id": "point-id",
        "type": "freePoint",
        "modifierNames": ["Disable"]
    })];
    state.drawing_modifiers = json!([{ "name": "Disable", "state": "disabled" }]);

    let expected_target = target("point-id", 1, GeometryInterfaceType::Point);
    assert_eq!(
        resolve_geometry_builtin_target(&state, 2, &expected_target),
        Err(GeometryBuiltinRuntimeError::Disabled(expected_target))
    );
}

#[test]
fn ancestor_group_disabled_geometry_target_has_a_distinct_runtime_failure() {
    let mut state = state_with_geometry("child", point_value(2.0, 3.0), true);
    state.elements = vec![
        json!({"id": "group", "type": "group", "activity": "disabled"}),
        json!({"id": "child", "type": "freePoint", "parentGroupId": "group", "activity": "visible"}),
    ];
    state.elements_by_id = HashMap::from([("group".to_owned(), 0), ("child".to_owned(), 1)]);
    let expected_target = target("child", 1, GeometryInterfaceType::Point);
    assert_eq!(
        resolve_geometry_builtin_target(&state, 2, &expected_target),
        Err(GeometryBuiltinRuntimeError::Disabled(expected_target))
    );
}

#[test]
fn self_and_forward_targets_reject() {
    let state = state_with_geometry("point-id", point_value(2.0, 3.0), true);
    assert_eq!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("point-id", 2, GeometryInterfaceType::Point)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
    assert_eq!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("point-id", 3, GeometryInterfaceType::Point)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn fabricated_computed_geometry_without_an_element_rejects() {
    let state = state_with_geometry("fabricated", point_value(0.0, 0.0), false);
    assert_eq!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("fabricated", 1, GeometryInterfaceType::Point)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn point_target_requires_point_runtime_kind() {
    let state = state_with_geometry(
        "line-id",
        line_value(point_value(0.0, 0.0), point_value(1.0, 0.0)),
        true,
    );
    assert_eq!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("line-id", 1, GeometryInterfaceType::Point)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn derived_start_and_end_targets_resolve_to_points() {
    let state = state_with_geometry(
        "line-id",
        line_value(point_value(2.0, 3.0), point_value(5.0, 7.0)),
        true,
    );
    let start = resolve_geometry_builtin_target(&state, 2, &derived_target("line-id", 1, "start"));
    let end = resolve_geometry_builtin_target(&state, 2, &derived_target("line-id", 1, "end"));
    assert!(
        matches!(start, Ok(GeometryBuiltinRuntimeTarget::Point(point)) if point.x == 2.0 && point.y == 3.0)
    );
    assert!(
        matches!(end, Ok(GeometryBuiltinRuntimeTarget::Point(point)) if point.x == 5.0 && point.y == 7.0)
    );
}

#[test]
fn derived_target_requires_an_available_base_geometry() {
    let state = state_with_geometry(
        "line-id",
        line_value(point_value(0.0, 0.0), point_value(1.0, 0.0)),
        false,
    );
    assert_eq!(
        resolve_geometry_builtin_target(&state, 2, &derived_target("line-id", 1, "start")),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn invalid_derived_projection_fails_closed_as_unavailable() {
    let state = state_with_geometry(
        "line-id",
        line_value(point_value(0.0, 0.0), point_value(1.0, 0.0)),
        true,
    );
    assert_eq!(
        resolve_geometry_builtin_target(&state, 2, &derived_target("line-id", 1, "center")),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn line_target_requires_strict_line_kind_and_start_end() {
    let arc =
        json!({"kind": "arcLine", "start": point_value(0.0, 0.0), "end": point_value(1.0, 0.0)});
    let arc_state = state_with_geometry("arc", arc, true);
    assert_eq!(
        resolve_geometry_builtin_target(
            &arc_state,
            2,
            &target("arc", 1, GeometryInterfaceType::Line)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );

    let missing_end = state_with_geometry(
        "line",
        json!({"kind": "line", "start": point_value(0.0, 0.0)}),
        true,
    );
    assert_eq!(
        resolve_geometry_builtin_target(
            &missing_end,
            2,
            &target("line", 1, GeometryInterfaceType::Line)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn offset_line_is_not_a_strict_line() {
    let state = state_with_geometry(
        "offset",
        json!({"kind": "offsetLine", "start": point_value(0.0, 0.0), "end": point_value(1.0, 0.0)}),
        true,
    );
    assert_eq!(
        resolve_geometry_builtin_target(
            &state,
            2,
            &target("offset", 1, GeometryInterfaceType::Line)
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}

#[test]
fn zero_length_line_rejects_at_and_below_threshold() {
    for length in [0.0, 1e-9] {
        let state = state_with_geometry(
            "line",
            line_value(point_value(0.0, 0.0), point_value(length, 0.0)),
            true,
        );
        assert_eq!(
            resolve_geometry_builtin_target(
                &state,
                2,
                &target("line", 1, GeometryInterfaceType::Line)
            ),
            Err(GeometryBuiltinRuntimeError::ZeroLengthLine)
        );
    }
}

#[test]
fn line_longer_than_threshold_validates() {
    let state = state_with_geometry(
        "line",
        line_value(point_value(0.0, 0.0), point_value(2e-9, 0.0)),
        true,
    );
    assert!(resolve_geometry_builtin_target(
        &state,
        2,
        &target("line", 1, GeometryInterfaceType::Line)
    )
    .is_ok());
}

#[test]
fn point_point_and_point_line_signatures_validate_without_calculating() {
    let point_target = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Point,
        target: Some(target("point", 1, GeometryInterfaceType::Point)),
    };
    let line_target = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Line,
        target: Some(target("line", 1, GeometryInterfaceType::Line)),
    };
    let point = point_runtime();
    let first_point = GeometryBuiltinRuntimeTarget::Point(Point {
        element_id: "first".to_owned(),
        name: "first".to_owned(),
        x: 1.0,
        y: 2.0,
    });
    let second_point = GeometryBuiltinRuntimeTarget::Point(Point {
        element_id: "second".to_owned(),
        name: "second".to_owned(),
        x: 3.0,
        y: 4.0,
    });
    let line = line_runtime(1.0);
    assert!(validate_geometry_builtin_arguments(
        BuiltinFunctionName::Distance,
        &[point_target],
        |_| Ok(point.clone()),
    )
    .is_err());
    assert_eq!(
        validate_geometry_builtin_arguments(
            BuiltinFunctionName::Distance,
            &[
                TypedBuiltinArgument::GeometryReference {
                    expected_geometry_type: GeometryInterfaceType::Point,
                    target: Some(target("a", 1, GeometryInterfaceType::Point)),
                },
                TypedBuiltinArgument::GeometryReference {
                    expected_geometry_type: GeometryInterfaceType::Point,
                    target: Some(target("b", 1, GeometryInterfaceType::Point)),
                },
            ],
            |target| {
                if target.statement_id == "a" {
                    Ok(first_point.clone())
                } else {
                    Ok(second_point.clone())
                }
            },
        ),
        Ok(vec![first_point, second_point])
    );
    assert_eq!(
        validate_geometry_builtin_arguments(
            BuiltinFunctionName::LineDistance,
            &[
                TypedBuiltinArgument::GeometryReference {
                    expected_geometry_type: GeometryInterfaceType::Point,
                    target: Some(target("a", 1, GeometryInterfaceType::Point)),
                },
                line_target,
            ],
            |target| {
                if target.geometry_type == GeometryInterfaceType::Point {
                    Ok(point.clone())
                } else {
                    Ok(line.clone())
                }
            },
        ),
        Ok(vec![point, line])
    );

    let first_line = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Line,
        target: Some(target("first-line", 1, GeometryInterfaceType::Line)),
    };
    let second_line = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Line,
        target: Some(target("second-line", 2, GeometryInterfaceType::Line)),
    };
    assert_eq!(
        validate_geometry_builtin_arguments(
            BuiltinFunctionName::LineAngle,
            &[first_line, second_line],
            |target| {
                if target.statement_id == "first-line" {
                    Ok(line_runtime(1.0))
                } else {
                    Ok(line_runtime(2.0))
                }
            },
        ),
        Ok(vec![line_runtime(1.0), line_runtime(2.0)])
    );
}

#[test]
fn expected_target_and_runtime_geometry_type_mismatch_rejects() {
    let first_argument = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Point,
        target: Some(target("line", 1, GeometryInterfaceType::Line)),
    };
    let second_argument = TypedBuiltinArgument::GeometryReference {
        expected_geometry_type: GeometryInterfaceType::Point,
        target: Some(target("point", 1, GeometryInterfaceType::Point)),
    };
    assert_eq!(
        validate_geometry_builtin_arguments(
            BuiltinFunctionName::Distance,
            &[first_argument, second_argument],
            |_| Ok(line_runtime(1.0))
        ),
        Err(GeometryBuiltinRuntimeError::Unavailable)
    );
}
