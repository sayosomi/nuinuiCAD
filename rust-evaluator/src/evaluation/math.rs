use super::types::Point;

pub(crate) const CIRCLE_EPSILON: f64 = 1e-9;

pub(crate) struct Circle {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) radius: f64,
}

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

pub(crate) fn circle_through_three_points(
    point1: &Point,
    point2: &Point,
    point3: &Point,
) -> Option<Circle> {
    let denominator = 2.0
        * (point1.x * (point2.y - point3.y)
            + point2.x * (point3.y - point1.y)
            + point3.x * (point1.y - point2.y));
    if denominator.abs() < CIRCLE_EPSILON {
        return None;
    }

    let point1_squared = point1.x * point1.x + point1.y * point1.y;
    let point2_squared = point2.x * point2.x + point2.y * point2.y;
    let point3_squared = point3.x * point3.x + point3.y * point3.y;
    let x = (point1_squared * (point2.y - point3.y)
        + point2_squared * (point3.y - point1.y)
        + point3_squared * (point1.y - point2.y))
        / denominator;
    let y = (point1_squared * (point3.x - point2.x)
        + point2_squared * (point1.x - point3.x)
        + point3_squared * (point2.x - point1.x))
        / denominator;
    let radius = (point1.x - x).hypot(point1.y - y);

    (radius.is_finite() && radius > CIRCLE_EPSILON).then_some(Circle { x, y, radius })
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
