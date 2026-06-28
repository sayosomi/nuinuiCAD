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

pub(crate) fn cubic_point_at(segment: &Value, t: f64) -> Option<BezierPoint> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let inverse = 1.0 - t;
    let a = inverse * inverse * inverse;
    let b = 3.0 * inverse * inverse * t;
    let c = 3.0 * inverse * t * t;
    let d = t * t * t;

    Some(BezierPoint {
        x: a * start.x + b * control1.x + c * control2.x + d * end.x,
        y: a * start.y + b * control1.y + c * control2.y + d * end.y,
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
