use super::bezier_math::{
    cubic_derivative, signed_curvature_at, signed_curvature_from_derivatives, Point,
};
use serde_json::json;

#[test]
fn signed_curvature_matches_the_cubic_definition() {
    let segment = json!({
        "start": { "x": 0.0, "y": 0.0 },
        "control1": { "x": 0.0, "y": 10.0 },
        "control2": { "x": 10.0, "y": 10.0 },
        "end": { "x": 10.0, "y": 0.0 }
    });
    let curvature = signed_curvature_at(&segment, 0.5).expect("valid cubic");
    assert!((curvature + 900.0 / 15.0_f64.powi(3)).abs() < 1e-12);
}

#[test]
fn signed_curvature_uses_zero_for_zero_speed() {
    let derivative = cubic_derivative(
        &json!({
            "start": { "x": 0.0, "y": 0.0 },
            "control1": { "x": 0.0, "y": 0.0 },
            "control2": { "x": 10.0, "y": 0.0 },
            "end": { "x": 10.0, "y": 0.0 }
        }),
        0.0,
    )
    .expect("valid cubic");
    assert_eq!(
        signed_curvature_from_derivatives(derivative, Point { x: 1.0, y: 0.0 }),
        0.0
    );
}
