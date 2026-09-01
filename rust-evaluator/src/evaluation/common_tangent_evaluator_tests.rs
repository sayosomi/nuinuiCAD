use super::*;
use serde_json::{json, Value};

fn input(elements: Vec<Value>) -> EvaluationInput {
    EvaluationInput {
        module_materialization: None,
        property_bindings: None,
        control_boolean_bindings: None,
        condition_expressions: None,
        text_templates: None,
        text_property_bindings: None,
        elements,
        evaluation_limit_index: None,
        allow_disabled_element_ids: None,
        drawing_modifiers: None,
        selected_drawing_profile_id: None,
        scalar_expression_payload: None,
        scalar_program: None,
        binding_versions: None,
    }
}

fn circle(id: &str, center_id: &str, radius: f64) -> Value {
    json!({
        "id": id, "name": id, "type": "arcLine", "activity": "visible",
        "centerPoint": { "mode": "reference", "pointId": center_id },
        "radius": radius, "startAngleDeg": 20, "endAngleDeg": 40
    })
}

fn common(kind: &str, side: &str) -> Value {
    json!({
        "id": "t", "name": "T", "type": "commonTangentLine", "activity": "visible",
        "firstLineId": "a", "secondLineId": "b", "kind": kind, "side": side
    })
}

fn base(kind: &str, side: &str) -> Vec<Value> {
    vec![
        json!({ "id": "c1", "name": "C1", "type": "freePoint", "activity": "visible", "x": 0, "y": 0 }),
        json!({ "id": "c2", "name": "C2", "type": "freePoint", "activity": "visible", "x": 60, "y": 0 }),
        circle("a", "c1", 20.0),
        circle("b", "c2", 10.0),
        common(kind, side),
    ]
}

fn geometry<'a>(result: &'a EvaluationPayload, id: &str) -> &'a Value {
    result
        .computed_geometry
        .iter()
        .find(|item| item["elementId"] == json!(id))
        .expect("geometry")
}

#[test]
fn evaluates_four_common_tangent_solutions() {
    for kind in ["external", "internal"] {
        for side in ["left", "right"] {
            let result = evaluate_document_input(input(base(kind, side)));
            assert!(
                result.errors.is_empty(),
                "{kind}/{side}: {:?}",
                result.errors
            );
            let line = geometry(&result, "t");
            assert_eq!(line["kind"], json!("line"));
            let sy = line["start"]["y"].as_f64().unwrap();
            let ey = line["end"]["y"].as_f64().unwrap();
            assert!(if side == "left" { sy > 0.0 } else { sy < 0.0 });
            assert!(if kind == "external" {
                sy * ey > 0.0
            } else {
                sy * ey < 0.0
            });
        }
    }
}

#[test]
fn reports_exact_common_tangent_boundary_diagnostics() {
    let mut elements = base("internal", "left");
    elements[1]["x"] = json!(30.0);
    let touching = evaluate_document_input(input(elements));
    assert_eq!(touching.errors[0].message, "2つの接点が一致するため、有限長の共通接線として表現できません。2つの円の位置・半径または kind を変更してください。");

    let mut elements = base("internal", "left");
    elements[1]["x"] = json!(29.0);
    let missing = evaluate_document_input(input(elements));
    assert_eq!(missing.errors[0].message, "kind: internal の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。");
}

#[test]
fn rejects_non_arc_and_reports_failed_direct_arc_dependency() {
    let mut elements = base("external", "left");
    elements[2] = json!({
        "id": "a", "name": "A", "type": "line", "activity": "visible",
        "startPoint": { "mode": "reference", "pointId": "c1" },
        "endPoint": { "mode": "reference", "pointId": "c2" }
    });
    let non_arc = evaluate_document_input(input(elements));
    assert_eq!(
        non_arc.errors.last().unwrap().message,
        "first に円弧が指定されていません。共通接線には円弧を指定してください。"
    );

    let mut elements = base("external", "left");
    elements[2]["radius"] = json!(0.0);
    let invalid = evaluate_document_input(input(elements));
    assert_eq!(
        invalid.errors.last().unwrap().message,
        "T は a を参照していますが、a の評価に失敗しているため評価できません。先に a のエラーを解消してください。"
    );
}
