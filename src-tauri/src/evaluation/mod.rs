mod errors;
mod groups;
mod line_evaluators;
mod local_variables;
mod math;
mod numeric_expression;
mod point_anchor;
mod point_evaluators;
mod types;
mod variable_evaluator;

use std::collections::{HashMap, HashSet};

use groups::{effective_element_ids, group_state_by_element_id};
use line_evaluators::{evaluate_arc_line, evaluate_line};
use local_variables::evaluate_local_variables;
use point_evaluators::{
    evaluate_division_point, evaluate_free_point, evaluate_offset_point,
    evaluate_polar_offset_point,
};
use types::{element_id, element_type, ElementId, EvaluationState};
pub use types::{EvaluationInput, EvaluationPayload};
use variable_evaluator::evaluate_variable_element;

#[tauri::command]
pub fn evaluate_document(input: EvaluationInput) -> EvaluationPayload {
    evaluate_document_input(input)
}

fn evaluate_document_input(input: EvaluationInput) -> EvaluationPayload {
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let evaluated_ids: HashSet<ElementId> =
        evaluated_elements.iter().filter_map(element_id).collect();
    let group_states = group_state_by_element_id(&input.elements);
    let effective_visible_element_ids = effective_element_ids(&input.elements, &group_states, true)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<Vec<_>>();
    let effective_enabled_ids = effective_element_ids(&input.elements, &group_states, false)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<HashSet<_>>();
    let effective_enabled_element_ids = input
        .elements
        .iter()
        .filter_map(element_id)
        .filter(|id| effective_enabled_ids.contains(id) && evaluated_ids.contains(id))
        .collect::<Vec<_>>();

    let mut state = EvaluationState {
        elements_by_id: input
            .elements
            .iter()
            .enumerate()
            .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
            .collect(),
        elements: input.elements,
        group_states,
        computed_geometry: HashMap::new(),
        computed_geometry_order: Vec::new(),
        computed_variables: HashMap::new(),
        computed_variable_order: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    for index in 0..evaluation_limit_index {
        let element = state.elements[index].clone();
        let id = match element_id(&element) {
            Some(id) => id,
            None => continue,
        };
        if element_type(&element) == Some("group") || !effective_enabled_ids.contains(&id) {
            continue;
        }

        let Some(local_variables) = evaluate_local_variables(index, &mut state) else {
            continue;
        };

        match element_type(&element) {
            Some("variable") => evaluate_variable_element(&element, &local_variables, &mut state),
            Some("freePoint") => evaluate_free_point(&element, &local_variables, &mut state),
            Some("offsetPoint") => evaluate_offset_point(&element, &local_variables, &mut state),
            Some("polarOffsetPoint") => {
                evaluate_polar_offset_point(&element, &local_variables, &mut state)
            }
            Some("divisionPoint") => {
                evaluate_division_point(&element, &local_variables, &mut state)
            }
            Some("line") => evaluate_line(&element, &local_variables, &mut state),
            Some("arcLine") => evaluate_arc_line(&element, &local_variables, &mut state),
            _ => {}
        }
    }

    EvaluationPayload {
        computed_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.computed_geometry.get(id).cloned())
            .collect(),
        computed_variables: state
            .computed_variable_order
            .iter()
            .filter_map(|id| state.computed_variables.get(id).cloned())
            .collect(),
        errors: state.errors,
        warnings: state.warnings,
        evaluated_element_ids: evaluated_elements.iter().filter_map(element_id).collect(),
        evaluation_limit_index,
        effective_visible_element_ids,
        effective_enabled_element_ids,
    }
}

#[cfg(test)]
mod tests {
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

    fn base_points() -> Vec<Value> {
        vec![
            element(json!({
                "id": "a",
                "name": "点A",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 10,
                "y": 20
            })),
            element(json!({
                "id": "b",
                "name": "点B",
                "type": "freePoint",
                "visible": true,
                "enabled": true,
                "x": 40,
                "y": 25
            })),
        ]
    }

    #[test]
    fn evaluates_points_lines_variables_and_arcs() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "ease",
                    "name": "ゆとり",
                    "type": "variable",
                    "visible": true,
                    "enabled": true,
                    "scope": "global",
                    "valueMode": "expression",
                    "expression": 12,
                    "point1": { "mode": "reference", "pointId": "a" },
                    "point2": { "mode": "reference", "pointId": "a" },
                    "point": { "mode": "reference", "pointId": "a" },
                    "lineId": ""
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": { "kind": "expression", "expression": "@ゆとり + 8" },
                    "y": 20
                })),
                element(json!({
                    "id": "b",
                    "name": "点B",
                    "type": "polarOffsetPoint",
                    "visible": true,
                    "enabled": true,
                    "fromPointId": "a",
                    "angleDeg": 0,
                    "distance": 10
                })),
                element(json!({
                    "id": "ab",
                    "name": "直線AB",
                    "type": "line",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "reference", "pointId": "b" }
                })),
                element(json!({
                    "id": "arc",
                    "name": "円弧",
                    "type": "arcLine",
                    "visible": true,
                    "enabled": true,
                    "centerPoint": { "mode": "reference", "pointId": "a" },
                    "radius": 20,
                    "startAngleDeg": 0,
                    "endAngleDeg": 90
                })),
            ],
            evaluation_limit_index: None,
        });

        assert!(result.errors.is_empty());
        assert_eq!(result.computed_variables[0]["value"], json!(12.0));
        assert_eq!(result.computed_geometry[0]["x"], json!(20.0));
        assert_eq!(result.computed_geometry[1]["x"], json!(30.0));
        assert_eq!(result.computed_geometry[2]["kind"], json!("line"));
        assert_eq!(result.computed_geometry[3]["kind"], json!("arcLine"));
    }

    #[test]
    fn reports_too_late_dependency() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "line",
                    "name": "参照線",
                    "type": "line",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": 0,
                    "y": 0
                })),
            ],
            evaluation_limit_index: Some(1),
        });

        assert_eq!(result.computed_geometry.len(), 0);
        assert_eq!(result.errors[0].element_id, "line");
        assert_eq!(result.errors[0].missing_dependency_id, "a");
        assert_eq!(
            result.errors[0].missing_dependency_name.as_deref(),
            Some("点A")
        );
    }

    #[test]
    fn applies_group_visibility_and_enabled_masks() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "group",
                    "name": "前身頃",
                    "type": "group",
                    "visible": false,
                    "enabled": false,
                    "expanded": true
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "parentGroupId": "group",
                    "visible": true,
                    "enabled": true,
                    "x": 0,
                    "y": 0
                })),
            ],
            evaluation_limit_index: None,
        });

        assert!(result.computed_geometry.is_empty());
        assert!(!result
            .effective_visible_element_ids
            .contains(&"a".to_owned()));
        assert!(!result
            .effective_enabled_element_ids
            .contains(&"a".to_owned()));
    }

    #[test]
    fn evaluates_division_point_by_distance() {
        let mut elements = base_points();
        elements.push(element(json!({
            "id": "division",
            "name": "分点",
            "type": "divisionPoint",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" },
            "placementMode": "distance",
            "distance": 15,
            "ratio": 0.5
        })));
        let result = evaluate_document_input(EvaluationInput {
            elements,
            evaluation_limit_index: None,
        });

        let division = point(&result, "division");
        assert!(result.errors.is_empty());
        assert_eq!(division["kind"], json!("point"));
        assert!(
            (division["x"].as_f64().unwrap() - (10.0 + (30.0 / 30.4138126514911) * 15.0)).abs()
                < 1e-9
        );
        assert!(
            (division["y"].as_f64().unwrap() - (20.0 + (5.0 / 30.4138126514911) * 15.0)).abs()
                < 1e-9
        );
    }

    #[test]
    fn evaluates_division_point_by_ratio() {
        let mut elements = base_points();
        elements.push(element(json!({
            "id": "division",
            "name": "中点",
            "type": "divisionPoint",
            "visible": true,
            "enabled": true,
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" },
            "placementMode": "ratio",
            "distance": 30,
            "ratio": 0.5
        })));
        let result = evaluate_document_input(EvaluationInput {
            elements,
            evaluation_limit_index: None,
        });

        let division = point(&result, "division");
        assert!(result.errors.is_empty());
        assert_eq!(division["x"], json!(25.0));
        assert_eq!(division["y"], json!(22.5));
    }

    #[test]
    fn reports_division_point_dependency_that_appears_too_late() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": 10,
                    "y": 20
                })),
                element(json!({
                    "id": "division",
                    "name": "分点",
                    "type": "divisionPoint",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "reference", "pointId": "b" },
                    "placementMode": "ratio",
                    "distance": 30,
                    "ratio": 0.5
                })),
                element(json!({
                    "id": "b",
                    "name": "点B",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": 40,
                    "y": 25
                })),
            ],
            evaluation_limit_index: None,
        });

        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != json!("division")));
        assert_eq!(result.errors[0].element_id, "division");
        assert_eq!(result.errors[0].missing_dependency_id, "b");
        assert_eq!(
            result.errors[0].missing_dependency_name.as_deref(),
            Some("点B")
        );
    }

    #[test]
    fn reports_zero_length_distance_division_point() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": 10,
                    "y": 20
                })),
                element(json!({
                    "id": "division",
                    "name": "分点",
                    "type": "divisionPoint",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "reference", "pointId": "a" },
                    "placementMode": "distance",
                    "distance": 15,
                    "ratio": 0.5
                })),
            ],
            evaluation_limit_index: None,
        });

        assert!(result
            .computed_geometry
            .iter()
            .all(|geometry| geometry["elementId"] != json!("division")));
        assert_eq!(result.errors[0].element_id, "division");
        assert_eq!(result.errors[0].missing_dependency_id, "division");
        assert!(result.errors[0].message.contains("始点と終点が同じ位置"));
    }

    #[test]
    fn evaluates_division_point_numeric_variables_and_expressions() {
        let mut elements = base_points();
        elements.push(element(json!({
            "id": "division",
            "name": "式分点",
            "type": "divisionPoint",
            "visible": true,
            "enabled": true,
            "numericVariables": [
                { "id": "base", "name": "基準", "value": 0.25 }
            ],
            "startPoint": { "mode": "reference", "pointId": "a" },
            "endPoint": { "mode": "reference", "pointId": "b" },
            "placementMode": "ratio",
            "distance": 30,
            "ratio": { "kind": "expression", "expression": "@基準 + 0.25" }
        })));
        let result = evaluate_document_input(EvaluationInput {
            elements,
            evaluation_limit_index: None,
        });

        let division = point(&result, "division");
        assert!(result.errors.is_empty());
        assert_eq!(division["x"], json!(25.0));
        assert_eq!(division["y"], json!(22.5));
    }
}
