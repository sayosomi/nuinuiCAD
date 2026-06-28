use super::types::Point;

pub(crate) const CIRCLE_EPSILON: f64 = 1e-9;

pub(crate) fn angle_from_to(start: &Point, end: &Point) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    (length > CIRCLE_EPSILON).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

pub(crate) fn normalize_degrees(degrees: f64) -> f64 {
    degrees.rem_euclid(360.0)
}
