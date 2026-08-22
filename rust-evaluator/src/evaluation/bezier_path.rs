use kurbo::{CubicBez, ParamCurve};
use serde_json::Value;

#[derive(Clone, Copy)]
pub(crate) struct BezierPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

fn value_point(value: &Value) -> Option<BezierPoint> {
    Some(BezierPoint {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn cubic_segment(segment: &Value) -> Option<CubicBez> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    Some(CubicBez::new(
        (start.x, start.y),
        (control1.x, control1.y),
        (control2.x, control2.y),
        (end.x, end.y),
    ))
}

pub(crate) fn cubic_point_at(segment: &Value, t: f64) -> Option<BezierPoint> {
    let point = cubic_segment(segment)?.eval(t);
    Some(BezierPoint {
        x: point.x,
        y: point.y,
    })
}

pub(crate) fn segment_points(segment: &Value, steps: usize) -> Option<Vec<BezierPoint>> {
    (0..=steps)
        .map(|index| cubic_point_at(segment, index as f64 / steps as f64))
        .collect()
}

pub(crate) fn curve_points(geometry: &Value, steps: usize) -> Option<Vec<BezierPoint>> {
    let segments = geometry.get("segments")?.as_array()?;
    let mut points = Vec::new();
    for (segment_index, segment) in segments.iter().enumerate() {
        let segment_points = segment_points(segment, steps)?;
        if segment_index == 0 {
            points.extend(segment_points);
        } else {
            points.extend(segment_points.into_iter().skip(1));
        }
    }
    Some(points)
}

pub(crate) fn approximate_segment_length(segment: &Value, steps: usize) -> Option<f64> {
    let points = segment_points(segment, steps)?;
    Some(
        points
            .windows(2)
            .map(|pair| (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y))
            .sum(),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {actual} to be close to {expected}"
        );
    }

    #[test]
    fn cubic_point_at_uses_cubic_bezier_evaluation() {
        let segment = json!({
            "start": { "x": 0.0, "y": 0.0 },
            "control1": { "x": 10.0, "y": 0.0 },
            "control2": { "x": 10.0, "y": 10.0 },
            "end": { "x": 20.0, "y": 10.0 }
        });

        let point = cubic_point_at(&segment, 0.5).expect("point");

        assert_close(point.x, 10.0);
        assert_close(point.y, 5.0);
    }
}
