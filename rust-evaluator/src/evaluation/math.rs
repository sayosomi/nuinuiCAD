use super::types::Point;

pub(crate) const CIRCLE_EPSILON: f64 = 1e-9;

pub(crate) fn angle_from_to(start: &Point, end: &Point) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    (length > CIRCLE_EPSILON).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

pub(crate) fn arc_tangent_angles(
    start_angle_deg: f64,
    end_angle_deg: f64,
    sweep_angle_deg: f64,
) -> (f64, f64) {
    let tangent_offset = if sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 };
    (
        normalize_degrees(start_angle_deg + tangent_offset),
        normalize_degrees(end_angle_deg + tangent_offset + 180.0),
    )
}

pub(crate) fn normalize_degrees(degrees: f64) -> f64 {
    let normalized = degrees.rem_euclid(360.0);
    if normalized.abs() < CIRCLE_EPSILON || (360.0 - normalized).abs() < CIRCLE_EPSILON {
        0.0
    } else {
        normalized
    }
}

pub(crate) fn positive_sweep_degrees(start_angle_deg: f64, end_angle_deg: f64) -> f64 {
    let raw_sweep = end_angle_deg - start_angle_deg;
    let normalized = normalize_degrees(raw_sweep);
    if normalized == 0.0 && raw_sweep.abs() > CIRCLE_EPSILON {
        360.0
    } else {
        normalized
    }
}
