use super::*;
use serde_json::json;

#[test]
fn generated_copy_reports_its_incomplete_numeric_expression_as_the_dependency_id() {
    let result = evaluate_document_input(EvaluationInput {
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements: vec![
            json!({
                "id": "a", "name": "A", "type": "freePoint", "activity": "visible",
                "x": 0, "y": 0
            }),
            json!({
                "id": "b", "name": "B", "type": "freePoint", "activity": "visible",
                "x": 10, "y": 0
            }),
            json!({
                "id": "ab", "name": "AB", "type": "line", "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            }),
            json!({
                "id": "loop", "name": "Loop", "type": "forGroup", "activity": "visible",
                "variableName": "i", "start": 0, "count": 2, "step": 1, "showGenerated": true
            }),
            json!({
                "id": "copy", "name": "Copy", "type": "copyLine", "activity": "visible",
                "parentGroupId": "loop",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" },
                "scale": 1,
                "angleDeg": { "kind": "expression", "expression": "90 +" },
                "mirrorX": false,
                "baseLineIds": ["ab"]
            }),
        ],
        evaluation_limit_index: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    });

    assert_eq!(result.errors.len(), 2);
    for (index, error) in result.errors.iter().enumerate() {
        assert_eq!(error.element_id, format!("copy@loop:{index}"));
        assert_eq!(error.missing_dependency_id, "90 +");
        assert_eq!(
            error.message,
            format!("[i={index}] Copy の数値式を評価できません。式が途中で終わっています。")
        );
    }
}
