use nuinuicad_rust_evaluator::{evaluate_document, EvaluationInput};
use serde_json::{json, Value};

#[test]
fn computed_offset_retains_hover_inspection_metadata() {
    let input: EvaluationInput = serde_json::from_value(json!({
        "elements": [
            {
                "id": "a",
                "name": "A",
                "type": "freePoint",
                "activity": "visible",
                "x": 0,
                "y": 0
            },
            {
                "id": "b",
                "name": "B",
                "type": "freePoint",
                "activity": "visible",
                "x": 100,
                "y": 0
            },
            {
                "id": "base",
                "name": "Base",
                "type": "line",
                "activity": "visible",
                "startPoint": { "mode": "reference", "pointId": "a" },
                "endPoint": { "mode": "reference", "pointId": "b" }
            },
            {
                "id": "offset",
                "name": "Seam",
                "type": "offsetLine",
                "activity": "visible",
                "baseLineIds": ["base"],
                "offset": 10,
                "side": "left",
                "closed": false
            }
        ]
    }))
    .expect("test input should deserialize");

    let result = evaluate_document(input).expect("offset evaluation should succeed");
    let payload = serde_json::to_value(result).expect("evaluation payload should serialize");
    let geometry = payload["computedGeometry"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|geometry| geometry["elementId"] == json!("offset"))
        .unwrap_or(&Value::Null);

    assert_eq!(geometry["offsetDistance"].as_f64(), Some(10.0));
    assert_eq!(geometry["offsetSide"], json!("left"));
}
