use serde_json::Value;
use std::collections::HashMap;

use super::bezier_math::{
    cubic_derivative, cubic_point, dot, select_best_bezier_feature_candidate, solve_real_quadratic,
    BezierFeatureCandidate, Point, EPSILON,
};
use super::errors::{dependency_error, geometry_error};
use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::computed_point;
use super::scalars::{degrees_to_radians, normalize_degrees_360};
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn derivative_projection(segment: &Value, direction: Point, t: f64) -> Option<f64> {
    Some(dot(cubic_derivative(segment, t)?, direction))
}

pub(crate) fn evaluate_bezier_extreme_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(base_line_id) = element.get("baseLineId").and_then(Value::as_str) else {
        return;
    };
    let Some(source) = state.computed_geometry.get(base_line_id).cloned() else {
        state
            .errors
            .push(dependency_error(state, element, base_line_id));
        return;
    };
    if source.get("kind").and_then(Value::as_str) != Some("bezierCurve") {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let Some(segment_index) = evaluate_numeric_or_push(
        element.get("segmentIndex").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if !segment_index.is_finite() {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の区間番号は有限の数値で指定してください。",
                element_name(element)
            ),
        ));
        return;
    }
    if segment_index.fract() != 0.0 || segment_index < 0.0 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の区間番号は0以上の整数で指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let Some(segments) = source.get("segments").and_then(Value::as_array) else {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の参照ベジェ曲線を評価できません。",
                element_name(element)
            ),
        ));
        return;
    };
    if segment_index >= segments.len() as f64 {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の区間番号 {} に対応する区間がありません。区間数は {} 個です。",
                element_name(element),
                segment_index,
                segments.len()
            ),
        ));
        return;
    }

    let Some(direction_deg) = evaluate_numeric_or_push(
        element.get("directionDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    if !direction_deg.is_finite() {
        state.errors.push(geometry_error(
            element,
            format!(
                "{} の方向は有限の数値で指定してください。",
                element_name(element)
            ),
        ));
        return;
    }

    let direction_rad = degrees_to_radians(normalize_degrees_360(direction_deg));
    let direction = Point {
        x: direction_rad.cos(),
        y: direction_rad.sin(),
    };
    let segment = &segments[segment_index as usize];
    let Some(f0) = derivative_projection(segment, direction, 0.0) else {
        return;
    };
    let Some(f_half) = derivative_projection(segment, direction, 0.5) else {
        return;
    };
    let Some(f1) = derivative_projection(segment, direction, 1.0) else {
        return;
    };
    let c = f0;
    let a = 2.0 * (f1 + f0 - 2.0 * f_half);
    let b = f1 - f0 - a;
    let mut candidates = Vec::with_capacity(4);
    for t in [0.0, 1.0] {
        let Some(point) = cubic_point(segment, t) else {
            return;
        };
        candidates.push(BezierFeatureCandidate {
            t,
            score: dot(point, direction),
        });
    }
    for root in solve_real_quadratic(a, b, c) {
        if root > 0.0 && root < 1.0 {
            let Some(point) = cubic_point(segment, root) else {
                return;
            };
            candidates.push(BezierFeatureCandidate {
                t: root,
                score: dot(point, direction),
            });
        }
    }
    if f0.abs() <= EPSILON && f_half.abs() <= EPSILON && f1.abs() <= EPSILON {
        let Some(point) = cubic_point(segment, 0.5) else {
            return;
        };
        candidates.push(BezierFeatureCandidate {
            t: 0.5,
            score: dot(point, direction),
        });
    }

    let Some(best) = select_best_bezier_feature_candidate(&candidates) else {
        return;
    };
    let Some(point) = cubic_point(segment, best.t) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), point.x, point.y),
    );
}

#[cfg(test)]
mod tests {
    use super::super::{evaluate_document_input, EvaluationInput};
    use super::*;
    use serde_json::json;

    fn evaluation_input(elements: Vec<Value>) -> EvaluationInput {
        EvaluationInput {
            property_bindings: None,
            control_boolean_bindings: None,
            condition_expressions: None,
            text_templates: None,
            text_property_bindings: None,
            elements,
            evaluation_limit_index: None,
            scalar_expression_payload: None,
            scalar_program: None,
            binding_versions: None,
        }
    }

    fn source_geometry(kind: &str) -> Value {
        json!({
            "kind": kind,
            "segments": [{
                "start": { "x": 0.0, "y": 0.0 },
                "control1": { "x": 0.0, "y": 10.0 },
                "control2": { "x": 10.0, "y": 10.0 },
                "end": { "x": 10.0, "y": 0.0 }
            }]
        })
    }

    fn evaluate(direction_deg: f64) -> EvaluationState {
        let element = json!({
            "id": "extreme",
            "name": "extreme",
            "type": "bezierExtremePoint",
            "activity": "visible",
            "baseLineId": "curve",
            "segmentIndex": 0.0,
            "directionDeg": direction_deg
        });
        let mut elements_by_id = HashMap::new();
        elements_by_id.insert("extreme".to_owned(), 0);
        let mut computed_geometry = HashMap::new();
        computed_geometry.insert("curve".to_owned(), source_geometry("bezierCurve"));
        let mut state = EvaluationState {
            elements: vec![element.clone()],
            elements_by_id,
            group_states: HashMap::new(),
            computed_geometry,
            computed_geometry_order: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        };
        evaluate_bezier_extreme_point(&element, &(HashMap::new(), HashMap::new()), &mut state);
        state
    }

    #[test]
    fn evaluates_an_interior_maximum_and_normalizes_direction() {
        let state = evaluate(450.0);
        let point = state.computed_geometry.get("extreme").unwrap();
        assert!((point.get("x").and_then(Value::as_f64).unwrap() - 5.0).abs() < 1e-9);
        assert!((point.get("y").and_then(Value::as_f64).unwrap() - 7.5).abs() < 1e-9);
        assert!(state.errors.is_empty());
    }

    #[test]
    fn rejects_an_existing_non_bezier_geometry_with_a_geometry_error() {
        let element = json!({
            "id": "extreme",
            "name": "extreme",
            "type": "bezierExtremePoint",
            "activity": "visible",
            "baseLineId": "curve",
            "segmentIndex": 0.0,
            "directionDeg": 90.0
        });
        let mut elements_by_id = HashMap::new();
        elements_by_id.insert("extreme".to_owned(), 0);
        let mut computed_geometry = HashMap::new();
        computed_geometry.insert("curve".to_owned(), source_geometry("line"));
        let mut state = EvaluationState {
            elements: vec![element.clone()],
            elements_by_id,
            group_states: HashMap::new(),
            computed_geometry,
            computed_geometry_order: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        };

        evaluate_bezier_extreme_point(&element, &(HashMap::new(), HashMap::new()), &mut state);

        assert_eq!(state.computed_geometry.get("extreme"), None);
        assert_eq!(
            state.errors.first().map(|error| error.message.as_str()),
            Some("extreme の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。")
        );
    }

    #[test]
    fn reports_a_missing_source_as_a_dependency_error() {
        let result = evaluate_document_input(evaluation_input(vec![json!({
            "id": "extreme",
            "name": "extreme",
            "type": "bezierExtremePoint",
            "activity": "visible",
            "baseLineId": "missing",
            "segmentIndex": 0,
            "directionDeg": 90
        })]));

        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != "extreme"));
        let error = result.errors.first().expect("expected dependency error");
        assert_eq!(error.element_id, "extreme");
        assert_eq!(error.missing_dependency_id, "missing");
        assert_eq!(error.missing_dependency_name, None);
    }

    #[test]
    fn reports_a_disabled_source_as_the_missing_dependency() {
        let result = evaluate_document_input(evaluation_input(vec![
            json!({
                "id": "curve",
                "name": "ベジェ線",
                "type": "bezierCurve",
                "activity": "disabled",
                "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "startHandleAngleDeg": 90,
                "startHandleLength": 10,
                "intermediatePoints": [],
                "endPoint": { "mode": "coordinate", "x": 10, "y": 0 },
                "endHandleAngleDeg": -90,
                "endHandleLength": 10
            }),
            json!({
                "id": "extreme",
                "name": "extreme",
                "type": "bezierExtremePoint",
                "activity": "visible",
                "baseLineId": "curve",
                "segmentIndex": 0,
                "directionDeg": 90
            }),
        ]));

        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != "extreme"));
        let error = result
            .errors
            .iter()
            .find(|error| error.element_id == "extreme")
            .expect("expected disabled dependency error");
        assert_eq!(error.missing_dependency_id, "curve");
        assert_eq!(error.missing_dependency_name.as_deref(), Some("ベジェ線"));
        assert!(error.message.contains("ベジェ線"));
    }

    #[test]
    fn reports_a_negative_segment_index_as_a_geometry_error() {
        let result = evaluate_document_input(evaluation_input(vec![
            json!({
                "id": "curve",
                "name": "ベジェ線",
                "type": "bezierCurve",
                "activity": "visible",
                "startPoint": { "mode": "coordinate", "x": 0, "y": 0 },
                "startHandleAngleDeg": 90,
                "startHandleLength": 10,
                "intermediatePoints": [],
                "endPoint": { "mode": "coordinate", "x": 10, "y": 0 },
                "endHandleAngleDeg": -90,
                "endHandleLength": 10
            }),
            json!({
                "id": "extreme",
                "name": "extreme",
                "type": "bezierExtremePoint",
                "activity": "visible",
                "baseLineId": "curve",
                "segmentIndex": -1,
                "directionDeg": 90
            }),
        ]));

        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != "extreme"));
        let error = result
            .errors
            .iter()
            .find(|error| error.element_id == "extreme")
            .expect("expected segment index error");
        assert_eq!(
            error.message,
            "extreme の区間番号は0以上の整数で指定してください。"
        );
    }
}
