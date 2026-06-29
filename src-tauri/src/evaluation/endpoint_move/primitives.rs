use serde_json::{json, Value};

use super::super::math::normalize_degrees;

pub(super) const EPSILON: f64 = 1e-9;
pub(super) const TOLERANCE_MM: f64 = 0.001;

#[derive(Clone, Copy)]
pub(super) struct Point {
    pub(super) x: f64,
    pub(super) y: f64,
}

pub(super) struct PathSample {
    pub(super) point: Point,
    pub(super) distance: f64,
}

pub(super) fn value_point(value: &Value) -> Option<Point> {
    Some(Point {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(super) fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

pub(super) fn interpolate(start: Point, end: Point, t: f64) -> Point {
    Point {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
    }
}

pub(super) fn line_distance(point: Point, start: Point, end: Point) -> Option<f64> {
    let line_length = distance(start, end);
    (line_length > EPSILON).then(|| {
        ((end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y)).abs()
            / line_length
    })
}

pub(super) fn angle_from_to(start: Point, end: Point) -> Value {
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    if length <= EPSILON {
        Value::Null
    } else {
        json!(normalize_degrees(dy.atan2(dx).to_degrees()))
    }
}
